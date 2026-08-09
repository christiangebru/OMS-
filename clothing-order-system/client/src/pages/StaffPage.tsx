import { FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiJson, ApiError } from "@/lib/api";
import type { Staff, StaffRole, StaffStatus } from "@/lib/types";
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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Staff</h1>
          <p className="text-sm text-slate-500">Workers, roles, and availability.</p>
        </div>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white"
        >
          {showForm ? "Cancel" : "Add staff"}
        </button>
      </div>

      <div className="flex flex-wrap gap-3">
        <select
          value={role}
          onChange={(e) => setRole(e.target.value)}
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
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
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
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
          className="grid gap-3 rounded-xl border border-slate-200 p-4 sm:grid-cols-4 dark:border-slate-800"
        >
          <input
            required
            placeholder="Name"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
          />
          <input
            required
            placeholder="Phone"
            value={form.phone}
            onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
          />
          <select
            value={form.role}
            onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as StaffRole }))}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <button type="submit" className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white">
            Create
          </button>
        </form>
      )}

      {err && <p className="text-sm text-red-600">{err}</p>}

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-card dark:border-slate-800 dark:bg-slate-900">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500 dark:bg-slate-800">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Skill</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {staff.map((s) => (
              <tr key={s._id} className="border-t border-slate-100 dark:border-slate-800">
                <td className="px-4 py-3">
                  <div className="font-medium">{s.name}</div>
                  <div className="text-xs text-slate-500">{s.phone}</div>
                  {!s.active && <span className="text-xs text-red-500">Inactive</span>}
                </td>
                <td className="px-4 py-3 text-xs font-semibold">{s.role}</td>
                <td className="px-4 py-3">
                  <StatusBadge status={s.status} />
                </td>
                <td className="px-4 py-3">{s.skillLevel}/5</td>
                <td className="px-4 py-3 text-right">
                  <Link
                    to={`/staff/${s._id}`}
                    className="text-xs font-semibold text-brand-600 hover:underline"
                  >
                    Open
                  </Link>
                </td>
              </tr>
            ))}
            {!staff.length && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
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
