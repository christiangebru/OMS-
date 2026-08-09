import { FormEvent, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { apiJson, ApiError } from "@/lib/api";

export function LoginPage() {
  const { user, login, loading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [bootName, setBootName] = useState("Admin");
  const [bootEmail, setBootEmail] = useState("");
  const [bootPassword, setBootPassword] = useState("");
  const [bootMsg, setBootMsg] = useState<string | null>(null);

  if (!loading && user) return <Navigate to="/" replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(email, password);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  async function onBootstrap(e: FormEvent) {
    e.preventDefault();
    setBootMsg(null);
    setBusy(true);
    try {
      const data = await apiJson<{ token: string }>("/api/auth/bootstrap", {
        method: "POST",
        body: JSON.stringify({
          name: bootName,
          email: bootEmail,
          password: bootPassword
        })
      });
      localStorage.setItem("token", data.token);
      window.location.href = "/";
    } catch (err) {
      setBootMsg(err instanceof ApiError ? err.message : "Bootstrap failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-slate-100 dark:bg-slate-950 lg:flex-row">
      <div className="flex flex-1 flex-col justify-center px-6 py-12 lg:px-16">
        <div className="mx-auto w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-card dark:border-slate-800 dark:bg-slate-900">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Sign in
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Admin and manager access — JWT secured.
          </p>
          <form className="mt-8 space-y-4" onSubmit={onSubmit}>
            <div>
              <label className="text-xs font-semibold text-slate-600 dark:text-slate-300" htmlFor="email">
                Email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none ring-brand-500 focus:ring-2 dark:border-slate-700 dark:bg-slate-950"
              />
            </div>
            <div>
              <label
                className="text-xs font-semibold text-slate-600 dark:text-slate-300"
                htmlFor="password"
              >
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none ring-brand-500 focus:ring-2 dark:border-slate-700 dark:bg-slate-950"
              />
            </div>
            {error && (
              <p className="text-sm text-red-600 dark:text-red-400" role="alert">
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-lg bg-brand-600 py-2.5 text-sm font-semibold text-white shadow hover:bg-brand-700 disabled:opacity-60"
            >
              {busy ? "Please wait…" : "Continue"}
            </button>
          </form>
        </div>

        <div className="mx-auto mt-8 w-full max-w-md rounded-2xl border border-dashed border-slate-300 bg-white/60 p-6 dark:border-slate-700 dark:bg-slate-900/60">
          <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            First-time setup (empty database)
          </h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Creates the first <strong>admin</strong> user. Disabled once any user exists.
          </p>
          <form className="mt-4 grid gap-3" onSubmit={onBootstrap}>
            <input
              placeholder="Admin name"
              value={bootName}
              onChange={(e) => setBootName(e.target.value)}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
              required
            />
            <input
              type="email"
              placeholder="Admin email"
              value={bootEmail}
              onChange={(e) => setBootEmail(e.target.value)}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
              required
            />
            <input
              type="password"
              placeholder="Password (min 8 chars)"
              value={bootPassword}
              onChange={(e) => setBootPassword(e.target.value)}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
              minLength={8}
              required
            />
            {bootMsg && (
              <p className="text-xs text-red-600 dark:text-red-400" role="status">
                {bootMsg}
              </p>
            )}
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg border border-slate-300 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-100 dark:hover:bg-slate-800"
            >
              Create admin &amp; sign in
            </button>
          </form>
        </div>
      </div>
      <div className="hidden flex-1 bg-gradient-to-br from-slate-900 via-slate-800 to-brand-700 lg:flex lg:flex-col lg:justify-end lg:p-16">
        <p className="max-w-md text-3xl font-semibold text-white">Clothing order management, built for production floors.</p>
        <p className="mt-4 max-w-md text-sm text-slate-200">
          Track multi-item orders, grouped jobs, revenue, and delays — on desktop or as an installable PWA.
        </p>
      </div>
    </div>
  );
}
