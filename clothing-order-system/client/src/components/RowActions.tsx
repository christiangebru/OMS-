import { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router-dom";
import clsx from "clsx";

export type RowAction = {
  label: string;
  to?: string;
  onClick?: () => void;
  danger?: boolean;
  confirm?: string;
  hidden?: boolean;
};

export function RowActions({
  actions,
  align = "right",
  label = "Actions"
}: {
  actions: RowAction[];
  align?: "left" | "right";
  label?: string;
}) {
  const visible = actions.filter((a) => !a.hidden);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!visible.length) return null;

  function run(action: RowAction) {
    if (action.confirm && !window.confirm(action.confirm)) return;
    setOpen(false);
    action.onClick?.();
  }

  return (
    <div ref={rootRef} className="relative inline-flex">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={label}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-12 min-w-12 items-center justify-center rounded-control border border-line bg-surface text-sm font-semibold text-ink hover:bg-canvas"
      >
        ⋯
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          className={clsx(
            "absolute z-20 mt-1 min-w-[11rem] border border-line bg-surface py-1 shadow-lg",
            align === "right" ? "right-0" : "left-0"
          )}
        >
          {visible.map((action) =>
            action.to && !action.onClick ? (
              <Link
                key={action.label}
                role="menuitem"
                to={action.to}
                className="flex min-h-12 items-center px-3 text-sm text-ink hover:bg-canvas"
                onClick={() => setOpen(false)}
              >
                {action.label}
              </Link>
            ) : (
              <button
                key={action.label}
                type="button"
                role="menuitem"
                className={clsx(
                  "flex min-h-12 w-full items-center px-3 text-left text-sm hover:bg-canvas",
                  action.danger ? "text-red-800" : "text-ink"
                )}
                onClick={() => run(action)}
              >
                {action.label}
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
}
