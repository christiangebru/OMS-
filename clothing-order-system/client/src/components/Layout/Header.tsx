import { Link } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import clsx from "clsx";

export function Header() {
  const { user, logout } = useAuth();

  function toggleTheme() {
    const root = document.documentElement;
    const next = !root.classList.contains("dark");
    root.classList.toggle("dark", next);
    localStorage.setItem("theme", next ? "dark" : "light");
  }

  return (
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur dark:border-slate-800 dark:bg-slate-900/90">
      <div className="flex h-14 items-center justify-between gap-3 px-4 sm:px-6">
        <div className="flex items-center gap-3 lg:hidden">
          <Link
            to="/"
            className="rounded-lg bg-slate-900 px-2 py-1 text-xs font-bold text-white dark:bg-brand-600"
          >
            CO
          </Link>
          <nav className="flex gap-2 text-xs font-medium text-slate-600 dark:text-slate-300">
            <Link className="hover:text-brand-600" to="/">
              Home
            </Link>
            <Link className="hover:text-brand-600" to="/scan">
              Scan
            </Link>
            <Link className="hover:text-brand-600" to="/orders">
              Orders
            </Link>
            <Link className="hover:text-brand-600" to="/customers">
              Customers
            </Link>
            <Link className="hover:text-brand-600" to="/staff">
              Staff
            </Link>
          </nav>
        </div>
        <div className="hidden lg:block" />
        <div className="flex items-center gap-2 sm:gap-3">
          <button
            type="button"
            onClick={toggleTheme}
            className={clsx(
              "rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium",
              "text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            )}
            aria-label="Toggle dark mode"
          >
            Theme
          </button>
          <div className="hidden text-right text-xs sm:block">
            <p className="font-semibold text-slate-800 dark:text-slate-100">{user?.name}</p>
            <p className="capitalize text-slate-500 dark:text-slate-400">{user?.role}</p>
          </div>
          <button
            type="button"
            onClick={logout}
            className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white dark:bg-brand-600"
          >
            Log out
          </button>
        </div>
      </div>
    </header>
  );
}
