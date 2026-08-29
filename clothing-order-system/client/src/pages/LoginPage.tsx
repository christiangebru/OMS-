import { FormEvent, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { apiJson, ApiError } from "@/lib/api";
import { AUTH_TOKEN_KEY, writeCachedAuthUser } from "@/lib/authRestore.js";
import { Button } from "@/components/ui/Button";
import type { AuthUser } from "@/lib/types";

export function LoginPage() {
  const { user, login, loading, sessionError } = useAuth();
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
      const data = await apiJson<{ token: string; user?: AuthUser }>("/api/auth/bootstrap", {
        method: "POST",
        body: JSON.stringify({
          name: bootName,
          email: bootEmail,
          password: bootPassword
        })
      });
      localStorage.setItem(AUTH_TOKEN_KEY, data.token);
      if (data.user) writeCachedAuthUser(data.user);
      window.location.href = "/";
    } catch (err) {
      setBootMsg(err instanceof ApiError ? err.message : "Bootstrap failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-canvas lg:flex-row">
      <div className="flex flex-1 flex-col justify-center px-6 py-12 lg:px-16">
        <div className="mx-auto w-full max-w-md ui-card p-8">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-accent">Atelier OMS</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink">Sign in</h1>
          <p className="mt-1 text-sm text-ink-muted">Production operations for the floor and the office.</p>
          <form className="mt-8 space-y-4" onSubmit={onSubmit}>
            <div>
              <label className="ui-label" htmlFor="email">
                Email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="ui-input"
              />
            </div>
            <div>
              <label className="ui-label" htmlFor="password">
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="ui-input"
              />
            </div>
            {(sessionError || error) && (
              <p className="text-sm text-red-700" role="alert">
                {error || sessionError}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "Please wait…" : "Continue"}
            </Button>
          </form>
        </div>

        <div className="mx-auto mt-8 w-full max-w-md rounded-xl border border-dashed border-line bg-surface/60 p-6">
          <h2 className="text-sm font-semibold text-ink">First-time setup</h2>
          <p className="mt-1 text-xs text-ink-muted">
            Creates the first admin user. Disabled once any user exists.
          </p>
          <form className="mt-4 grid gap-3" onSubmit={onBootstrap}>
            <input
              placeholder="Admin name"
              value={bootName}
              onChange={(e) => setBootName(e.target.value)}
              className="ui-input mt-0"
              required
            />
            <input
              type="email"
              placeholder="Admin email"
              value={bootEmail}
              onChange={(e) => setBootEmail(e.target.value)}
              className="ui-input mt-0"
              required
            />
            <input
              type="password"
              placeholder="Password (min 8 chars)"
              value={bootPassword}
              onChange={(e) => setBootPassword(e.target.value)}
              className="ui-input mt-0"
              minLength={8}
              required
            />
            {bootMsg && (
              <p className="text-xs text-red-700" role="status">
                {bootMsg}
              </p>
            )}
            <Button type="submit" variant="secondary" disabled={busy}>
              Create admin &amp; sign in
            </Button>
          </form>
        </div>
      </div>
      <div className="hidden flex-1 items-end bg-accent lg:flex lg:p-16">
        <div className="max-w-md text-white">
          <p className="text-3xl font-semibold leading-tight">Garment production, from order to delivery.</p>
          <p className="mt-4 text-sm text-white/80">
            Search the customer. Reuse measurements. Scan the barcode. See exactly where every piece is.
          </p>
        </div>
      </div>
    </div>
  );
}
