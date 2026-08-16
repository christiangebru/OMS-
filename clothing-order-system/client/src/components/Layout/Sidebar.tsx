import { NavLink } from "react-router-dom";
import clsx from "clsx";
import { useAuth } from "@/context/AuthContext";
import { navForRole } from "@/lib/roles";

export function Sidebar() {
  const { user } = useAuth();
  const items = navForRole(user?.role);
  const overview = items.filter((i) => i.group === "overview");
  const commercial = items.filter((i) => i.group === "commercial");
  const production = items.filter((i) => i.group === "production");
  const people = items.filter((i) => i.group === "people");

  return (
    <aside className="hidden w-[232px] shrink-0 border-r border-line bg-surface lg:flex lg:flex-col">
      <div className="flex h-14 items-center gap-2.5 border-b border-line px-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-control bg-accent text-[11px] font-semibold tracking-wide text-white">
          AT
        </div>
        <div>
          <p className="text-sm font-semibold leading-none text-ink">Atelier</p>
          <p className="mt-0.5 text-[11px] text-ink-muted">Production OMS</p>
        </div>
      </div>
      <nav className="flex-1 space-y-6 overflow-y-auto p-3" aria-label="Main">
        <NavGroup label="Overview" items={overview} />
        <NavGroup label="" items={commercial} />
        <NavGroup label="Production" items={production} />
        <NavGroup label="People" items={people} />
      </nav>
    </aside>
  );
}

function NavGroup({
  label,
  items
}: {
  label: string;
  items: { to: string; label: string; end?: boolean }[];
}) {
  if (!items.length) return null;
  return (
    <div>
      {label ? (
        <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-faint">
          {label}
        </p>
      ) : null}
      <div className="space-y-0.5">
        {items.map((l) => (
          <NavLink
            key={l.to}
            to={l.to}
            end={l.end}
            className={({ isActive }) =>
              clsx(
                "block rounded-control px-3 py-2 text-sm transition-colors",
                isActive
                  ? "bg-accent-soft font-medium text-accent"
                  : "text-ink-muted hover:bg-canvas hover:text-ink"
              )
            }
          >
            {l.label}
          </NavLink>
        ))}
      </div>
    </div>
  );
}
