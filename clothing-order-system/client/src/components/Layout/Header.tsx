import { NavLink, Link } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { navForRole } from "@/lib/roles";
import { Button } from "@/components/ui/Button";
import clsx from "clsx";

export function Header() {
  const { user, logout } = useAuth();
  const items = navForRole(user?.role);

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-surface/90 backdrop-blur">
      <div className="flex h-14 items-center justify-between gap-3 px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3 lg:hidden">
          <Link
            to="/"
            className="rounded-control bg-accent px-2 py-1 text-[11px] font-semibold text-white"
          >
            AT
          </Link>
          <nav className="flex gap-1 overflow-x-auto text-xs font-medium" aria-label="Mobile">
            {items.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                end={l.end}
                className={({ isActive }) =>
                  clsx(
                    "whitespace-nowrap rounded-control px-2 py-1",
                    isActive ? "bg-accent-soft text-accent" : "text-ink-muted hover:text-ink"
                  )
                }
              >
                {l.label}
              </NavLink>
            ))}
          </nav>
        </div>
        <div className="hidden lg:block" />
        <div className="flex items-center gap-3">
          <div className="hidden text-right sm:block">
            <p className="text-xs font-semibold text-ink">{user?.name}</p>
            <p className="text-[11px] capitalize text-ink-muted">{user?.role}</p>
          </div>
          <Button variant="secondary" size="sm" type="button" onClick={logout}>
            Log out
          </Button>
        </div>
      </div>
    </header>
  );
}
