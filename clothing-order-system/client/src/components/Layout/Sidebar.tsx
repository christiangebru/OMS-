import { NavLink } from "react-router-dom";
import clsx from "clsx";

const links = [
  { to: "/", label: "Dashboard", end: true },
  { to: "/scan", label: "Scan" },
  { to: "/orders", label: "Orders" },
  { to: "/orders/new", label: "New order" },
  { to: "/customers", label: "Customers" },
  { to: "/staff", label: "Staff" }
];

export function Sidebar() {
  return (
    <aside className="hidden w-64 shrink-0 border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 lg:block">
      <div className="flex h-16 items-center gap-2 border-b border-slate-200 px-6 dark:border-slate-800">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-900 text-sm font-bold text-white dark:bg-brand-600">
          CO
        </div>
        <div>
          <p className="text-sm font-semibold">ClothOrders</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">Production suite</p>
        </div>
      </div>
      <nav className="space-y-1 p-4" aria-label="Main">
        {links.map((l) => (
          <NavLink
            key={l.to}
            to={l.to}
            end={l.end}
            className={({ isActive }) =>
              clsx(
                "block rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-brand-50 text-brand-700 dark:bg-slate-800 dark:text-brand-300"
                  : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              )
            }
          >
            {l.label}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
