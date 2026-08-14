import { FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiJson, ApiError } from "@/lib/api";
import type { Staff, StaffRole, StaffStatus } from "@/lib/types";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/StatusBadge";

const ROLES: StaffRole[] = ["TAILOR", "EMBROIDERER", "FINISHER", "CUTTER", "MANAGER"];
const STATUSES: StaffStatus[] = ["AVAILABLE", "BUSY", "OFF_DUTY"];

export function StaffPage() {
  const [staff, setStaff] = useState<Staff[]>([]);
  const [role, setRole] = useState("");
  const [status, setStatus] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    name: "",
    phone: "",
    role: "TAILOR" as StaffRole,
    skillLevel: 3
  });

  async function load() {
    try {
      const p = new URLSearchParams();
      if (role) p.set("role", role);
      if (status) p.set("status", status);
      p.set("includeInactive", "true");
      const qs = p.toString() ? `?${p}` : "";
      setStaff(await apiJson<Staff[]>(`/api/staff${qs}`));
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Failed to load staff");
    }
  }

  useEffect(() => {
    load();
  }, [role, status]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    try {
      await apiJson("/api/staff", {
        method: "POST",
        body: JSON.stringify(form)
      });
      setShowForm(false);
      setForm({ name: "", phone: "", role: "TAILOR", skillLevel: 3 });
      await load();
    } catch (ex) {
      setErr(ex instanceof ApiError ? ex.message : "Create failed");
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Staff"
        description="Workers, skills, availability, and current workload."
        actions={
          <Button type="button" onClick={() => setShowForm((v) => !v)}>
            {showForm ? "Cancel" : "Add staff"}
          </Button>
        }
      />

      <div className="flex flex-wrap gap-3">
        <select
          value={role}
          onChange={(e) => setRole(e.target.value)}
          className="ui-input mt-0 w-auto"
        >
          <option value="">All roles</option>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="ui-input mt-0 w-auto"
        >
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      {showForm && (
        <form
          onSubmit={onCreate}
          className="ui-card grid gap-3 p-4 sm:grid-cols-4"
        >
          <input
            required
            placeholder="Name"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            className="ui-input mt-0"
          />
          <input
            required
            placeholder="Phone"
            value={form.phone}
            onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
            className="ui-input mt-0"
          />
          <select
            value={form.role}
            onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as StaffRole }))}
            className="ui-input mt-0"
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <Button type="submit">Create</Button>
        </form>
      )}

      {err && <p className="text-sm text-red-700">{err}</p>}

      <div className="ui-card overflow-hidden">
        <table className="ui-table min-w-full text-left text-sm">
          <thead className="bg-canvas">
            <tr>
              <th>Name</th>
              <th>Role</th>
              <th>Status</th>
              <th>Skill</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {staff.map((s) => (
              <tr key={s._id} className="border-t border-line">
                <td>
                  <div className="font-medium text-ink">{s.name}</div>
                  <div className="text-xs text-ink-muted">{s.phone}</div>
                  {!s.active && <span className="text-xs text-red-700">Inactive</span>}
                </td>
                <td className="text-xs font-semibold capitalize">{s.role.toLowerCase()}</td>
                <td>
                  <StatusBadge status={s.status} />
                </td>
                <td className="tabular">{s.skillLevel}/5</td>
                <td className="text-right">
                  <Link to={`/staff/${s._id}`} className="text-xs font-semibold text-accent hover:underline">
                    Open
                  </Link>
                </td>
              </tr>
            ))}
            {!staff.length && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-ink-muted">
                  No staff yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
