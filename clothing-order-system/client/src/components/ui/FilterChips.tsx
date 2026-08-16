import clsx from "clsx";

export type Chip<T extends string> = { id: T; label: string };

export function FilterChips<T extends string>({
  options,
  value,
  onChange,
  ariaLabel
}: {
  options: Chip<T>[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel?: string;
}) {
  return (
    <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" role="tablist" aria-label={ariaLabel}>
      {options.map((opt) => {
        const on = value === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(opt.id)}
            className={clsx(
              "shrink-0 rounded-control px-3 py-2 text-xs font-medium min-h-11",
              on ? "bg-accent text-white" : "bg-surface text-ink-muted ring-1 ring-line hover:text-ink"
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

export function Tabs<T extends string>({
  options,
  value,
  onChange
}: {
  options: Chip<T>[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1 border-b border-line">
      {options.map((opt) => {
        const on = value === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => onChange(opt.id)}
            className={clsx(
              "min-h-11 border-b-2 px-3 py-2 text-sm font-medium",
              on
                ? "border-accent text-ink"
                : "border-transparent text-ink-muted hover:text-ink"
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
