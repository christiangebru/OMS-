import { FormEvent, useState } from "react";
import { NavLink, Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { navForRole } from "@/lib/roles";
import { Button } from "@/components/ui/Button";
import { apiJson } from "@/lib/api";
import { garmentPath } from "@/components/GarmentCard";
import clsx from "clsx";

export function Header() {
  const { user, logout } = useAuth();
  const items = navForRole(user?.role);
  const navigate = useNavigate();
  const [q, setQ] = useState("");

  async function onFind(e: FormEvent) {
    e.preventDefault();
    const term = q.trim();
    if (!term) return;
    if (/^ITM-/i.test(term)) {
      try {
        const data = await apiJson<{ scanDetails: { item: { _id: string } } }>(
          `/api/production/lookup?barcodeValue=${encodeURIComponent(term)}`
        );
        setQ("");
        navigate(garmentPath(data.scanDetails.item._id));
        return;
      } catch {
        /* fall through to order search */
      }
    }
    setQ("");
    navigate(`/orders?q=${encodeURIComponent(term)}`);
  }

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
        <div className="hidden min-w-0 flex-1 px-4 lg:block">
          <form onSubmit={onFind} className="mx-auto max-w-sm">
            <label className="sr-only" htmlFor="oms-find">
              Find garment or order
            </label>
            <input
              id="oms-find"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="ITM barcode, order, customer…"
              className="ui-input mt-0 h-9 text-sm"
              autoComplete="off"
            />
          </form>
        </div>
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
