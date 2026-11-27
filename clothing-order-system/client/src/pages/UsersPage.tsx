import { useCallback, useEffect, useState, type FormEvent } from "react";
import { apiJson, describeApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { PageHeader, ErrorState, Badge, Skeleton } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { formatDate } from "@/lib/format";

type LoginRole = "admin" | "manager" | "reception";

interface LoginUser {
  _id: string;
  email: string;
  name: string;
  role: string;
  active: boolean;
  createdAt: string;
}

const ROLE_OPTIONS: Array<{ id: LoginRole; label: string; hint: string }> = [
  { id: "admin", label: "Owner / admin", hint: "Everything, including logins" },
  { id: "manager", label: "Manager", hint: "Production, assignments, scanning" },
  { id: "reception", label: "Reception", hint: "Customers and new orders" }
];

function roleLabel(role: string) {
  return ROLE_OPTIONS.find((r) => r.id === role)?.label || role;
}

/** Owners add and manage logins. Workers are staff records, not logins. */
export function UsersPage() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<LoginUser[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", role: "manager" as LoginRole, password: "" });
  const [resetFor, setResetFor] = useState<string | null>(null);
  const [resetPassword, setResetPassword] = useState("");

  const load = useCallback(async () => {
    try {
      setUsers(await apiJson<LoginUser[]>("/api/users"));
      setErr(null);
    } catch (e) {
      setErr(describeApiError(e, "Could not load logins"));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setOk(null);
    try {
      await apiJson("/api/users", { method: "POST", body: JSON.stringify(form) });
      setOk(`Login created for ${form.name}`);
      setForm({ name: "", email: "", role: "manager", password: "" });
      await load();
    } catch (e2) {
      setErr(describeApiError(e2, "Could not create login"));
    } finally {
      setBusy(false);
    }
  }

  async function update(u: LoginUser, data: Record<string, unknown>, done: string) {
    setBusy(true);
    setErr(null);
    setOk(null);
    try {
      await apiJson(`/api/users/${u._id}`, { method: "PATCH", body: JSON.stringify(data) });
      setOk(done);
      setResetFor(null);
      setResetPassword("");
      await load();
    } catch (e) {
      setErr(describeApiError(e, "Could not update login"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Logins"
        description="Who can sign in. Workers don't need a login — they are managed under Staff."
      />
      {err && <ErrorState message={err} />}
      {ok && <p className="bg-accent-soft px-4 py-3 text-sm font-semibold text-accent">{ok}</p>}

      <form onSubmit={create} className="ui-card grid gap-3 p-5 sm:grid-cols-2">
        <p className="text-sm font-semibold text-ink sm:col-span-2">Add a login</p>
        <label className="text-sm">
          <span className="ui-label">Name</span>
          <input
            required
            className="ui-input"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
        </label>
        <label className="text-sm">
          <span className="ui-label">Email</span>
          <input
            required
            type="email"
            autoComplete="off"
            className="ui-input"
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
          />
        </label>
        <label className="text-sm">
          <span className="ui-label">Role</span>
          <select
            className="ui-input"
            value={form.role}
            onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as LoginRole }))}
          >
            {ROLE_OPTIONS.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label} — {r.hint}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="ui-label">Starting password (8+ characters)</span>
          <input
            required
            minLength={8}
            type="password"
            autoComplete="new-password"
            className="ui-input"
            value={form.password}
            onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
          />
        </label>
        <div className="sm:col-span-2">
          <Button type="submit" disabled={busy}>
            {busy ? "Saving…" : "Add login"}
          </Button>
        </div>
      </form>

      {!users ? (
        <Skeleton className="h-32" />
      ) : (
        <ul className="ui-card divide-y divide-line">
          {users.map((u) => {
            const self = u._id === me?.id;
            return (
              <li key={u._id} className="space-y-2 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-medium text-ink">
                      {u.name} {self && <span className="text-xs text-ink-muted">(you)</span>}
                    </p>
                    <p className="text-xs text-ink-muted">
                      {u.email} · added {formatDate(u.createdAt)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {!u.active && <Badge tone="urgent">Switched off</Badge>}
                    <select
                      aria-label={`Role for ${u.name}`}
                      className="ui-input mt-0 w-auto"
                      value={u.role}
                      disabled={busy || self}
                      onChange={(e) => update(u, { role: e.target.value }, `${u.name} is now ${roleLabel(e.target.value)}`)}
                    >
                      {!ROLE_OPTIONS.some((r) => r.id === u.role) && <option value={u.role}>{u.role}</option>}
                      {ROLE_OPTIONS.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => setResetFor(resetFor === u._id ? null : u._id)}
                  >
                    Set new password
                  </Button>
                  {!self && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() =>
                        update(
                          u,
                          { active: !u.active },
                          u.active ? `${u.name} can no longer sign in` : `${u.name} can sign in again`
                        )
                      }
                    >
                      {u.active ? "Switch off login" : "Switch login back on"}
                    </Button>
                  )}
                </div>
                {resetFor === u._id && (
                  <form
                    className="flex flex-wrap gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      update(u, { password: resetPassword }, `Password changed for ${u.name}`);
                    }}
                  >
                    <input
                      required
                      minLength={8}
                      type="password"
                      autoComplete="new-password"
                      className="ui-input mt-0 w-auto"
                      placeholder="New password (8+)"
                      value={resetPassword}
                      onChange={(e) => setResetPassword(e.target.value)}
                    />
                    <Button type="submit" size="sm" disabled={busy}>
                      Save password
                    </Button>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
