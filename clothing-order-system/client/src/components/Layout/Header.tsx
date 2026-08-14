import { Link } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { navForRole } from "@/lib/roles";
import { Button } from "@/components/ui/Button";

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
          <nav className="flex gap-2 overflow-x-auto text-xs font-medium text-ink-muted">
            {items.slice(0, 5).map((l) => (
              <Link key={l.to} className="whitespace-nowrap hover:text-ink" to={l.to}>
                {l.label}
              </Link>
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
