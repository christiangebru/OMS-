import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { apiJson, ApiError } from "@/lib/api";
import type { ProductionStage, Staff, StaffRole, StaffStatus } from "@/lib/types";
import { PRODUCTION_STAGES } from "@/lib/types";
import { PageHeader, EmptyState, ErrorState, Skeleton } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/StatusBadge";
import { stageLabel } from "@/lib/format";
import { canWriteStaff } from "@/lib/roles";
import { RowActions } from "@/components/RowActions";
import { useAuth } from "@/context/AuthContext";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";
import clsx from "clsx";

const ROLES: StaffRole[] = ["TAILOR", "EMBROIDERER", "FINISHER", "CUTTER", "PACKER", "MANAGER"];
const STATUSES: StaffStatus[] = ["AVAILABLE", "BUSY", "OFF_DUTY"];

export function StaffPage() {
  const { user } = useAuth();
  const canManage = canWriteStaff(user?.role);
  const [staff, setStaff] = useState<Staff[] | null>(null);
  const [role, setRole] = useState("");
  const [status, setStatus] = useState("");
  const [stage, setStage] = useState<ProductionStage | "">("");
  const [readyOnly, setReadyOnly] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const hydrated = useRef(false);
  const [form, setForm] = useState({
    name: "",
    phone: "",
    role: "TAILOR" as StaffRole,
    skillLevel: 3
  });

  const load = useCallback(async () => {
    try {
      const p = new URLSearchParams();
      if (role) p.set("role", role);
      if (status) p.set("status", status);
      if (stage) p.set("stage", stage);
      p.set("includeInactive", "true");
      setStaff(await apiJson<Staff[]>(`/api/staff?${p}`));
      hydrated.current = true;
      setErr(null);
    } catch (e) {
      if (!hydrated.current) setErr(e instanceof ApiError ? e.message : "Failed to load staff");
    }
  }, [role, status, stage]);

  useEffect(() => {
    load();
  }, [load]);
  useLiveRefresh(load, 25000);

  const visible = useMemo(() => {
    const list = staff || [];
    if (!readyOnly) return list;
    return list.filter((s) => s.active && s.status !== "OFF_DUTY");
  }, [staff, readyOnly]);

  const availableNow = (staff || []).filter((s) => s.active && s.status !== "OFF_DUTY").length;

  async function deactivateStaff(id: string) {
    try {
      await apiJson(`/api/staff/${id}/deactivate`, { method: "POST" });
      await load();
    } catch (ex) {
      setErr(ex instanceof ApiError ? ex.message : "Could not deactivate");
    }
  }

  async function activateStaff(id: string) {
    try {
      await apiJson(`/api/staff/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ active: true, status: "AVAILABLE" })
      });
      await load();
    } catch (ex) {
      setErr(ex instanceof ApiError ? ex.message : "Could not activate");
    }
  }

  function staffActions(s: Staff) {
    return [
      { label: "View", to: `/staff/${s._id}` },
      { label: "Edit", to: `/staff/${s._id}` },
      {
        label: "Deactivate",
        hidden: !canManage || !s.active,
        danger: true,
        confirm:
          "This worker will no longer appear for new assignments. Queued work stays until it is scanned out.",
        onClick: () => void deactivateStaff(s._id)
      },
      {
        label: "Activate",
        hidden: !canManage || s.active,
        onClick: () => void activateStaff(s._id)
      }
    ];
  }

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
        title="Workforce"
        description="Who can take work right now, what they are holding, and where they are strongest."
        actions={
          canManage ? (
            <Button type="button" onClick={() => setShowForm((v) => !v)}>
              {showForm ? "Cancel" : "Add staff"}
            </Button>
          ) : undefined
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Can take work" value={staff ? availableNow : "—"} />
        <Stat
          label="Busy / in hand"
          value={
            staff
              ? staff.filter((s) => s.presence && s.presence !== "idle").length
              : "—"
          }
        />
        <Stat
          label="Overdue assignments"
          value={staff ? staff.reduce((n, s) => n + (s.overdueAssignmentCount || 0), 0) : "—"}
          warn
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <select value={role} onChange={(e) => setRole(e.target.value)} className="ui-input mt-0 w-auto" aria-label="Role">
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
          aria-label="Availability"
        >
          <option value="">All availability</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.replace("_", " ")}
            </option>
          ))}
        </select>
        <select
          value={stage}
          onChange={(e) => setStage(e.target.value as ProductionStage | "")}
          className="ui-input mt-0 w-auto"
          aria-label="Stage skill"
        >
          <option value="">All stages</option>
          {PRODUCTION_STAGES.map((s) => (
            <option key={s} value={s}>
              {stageLabel(s)}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setReadyOnly((v) => !v)}
          className={clsx(
            "rounded-control border px-3 py-2 text-xs font-medium",
            readyOnly
              ? "border-accent bg-accent-soft text-accent"
              : "border-line bg-surface text-ink-muted hover:text-ink"
          )}
        >
          Ready now
        </button>
      </div>

      {showForm && canManage && (
        <form onSubmit={onCreate} className="ui-card grid gap-3 p-4 sm:grid-cols-4">
          <input
            required
            placeholder="Name"
            aria-label="Name"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            className="ui-input mt-0"
          />
          <input
            required
            placeholder="Phone"
            aria-label="Phone"
            value={form.phone}
            onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
            className="ui-input mt-0"
          />
          <select
            value={form.role}
            aria-label="Role"
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

      {err && <ErrorState message={err} />}
      {staff === null && !err && <Skeleton className="h-40" />}

      {staff && visible.length === 0 && (
        <EmptyState title="No workers match" body="Clear filters, or add a staff member." />
      )}

      {staff && visible.length > 0 && (
        <>
          <ul className="space-y-3 md:hidden">
            {visible.map((s) => (
              <li key={s._id} className="flex items-start justify-between gap-3 border border-line bg-surface p-4">
                <Link to={`/staff/${s._id}`} className="min-w-0 flex-1">
                  <p className="font-semibold text-ink">{s.name}</p>
                  <p className="text-xs capitalize text-ink-muted">
                    {s.role.toLowerCase()}
                    {s.strongestStage ? ` · ${stageLabel(s.strongestStage)}` : ""}
                    {` · ${s.status.replace("_", " ").toLowerCase()}`}
                  </p>
                  <p className="mt-1 text-xs text-ink-muted">
                    {s.activeAssignmentCount ?? 0} active · {s.overdueAssignmentCount ?? 0} overdue · skill{" "}
                    {s.strongestLevel ?? s.skillLevel}/5
                  </p>
                </Link>
                <RowActions actions={staffActions(s)} />
              </li>
            ))}
          </ul>
          <div className="hidden overflow-hidden border border-line md:block">
            <table className="ui-table w-full text-sm">
              <thead className="border-b border-line bg-canvas/70">
                <tr>
                  <th>Worker</th>
                  <th>Role</th>
                  <th>Stage</th>
                  <th>Availability</th>
                  <th>Active</th>
                  <th>Overdue</th>
                  <th>Skill</th>
                  <th className="text-right"> </th>
                </tr>
              </thead>
              <tbody>
                {visible.map((s) => (
                  <tr key={s._id} className="border-t border-line">
                    <td>
                      <Link to={`/staff/${s._id}`} className="font-medium text-ink hover:text-accent">
                        {s.name}
                      </Link>
                      {!s.active && <span className="ml-2 text-xs text-red-700">Inactive</span>}
                    </td>
                    <td className="capitalize text-xs text-ink-muted">{s.role.toLowerCase()}</td>
                    <td className="capitalize text-xs text-ink-muted">
                      {s.strongestStage ? stageLabel(s.strongestStage) : "—"}
                    </td>
                    <td>
                      <StatusBadge status={s.status} />
                    </td>
                    <td className="tabular">{s.activeAssignmentCount ?? 0}</td>
                    <td className={clsx("tabular", (s.overdueAssignmentCount || 0) > 0 && "font-semibold text-red-700")}>
                      {s.overdueAssignmentCount ?? 0}
                    </td>
                    <td className="tabular text-xs text-ink-muted">{s.strongestLevel ?? s.skillLevel}/5</td>
                    <td className="text-right">
                      <RowActions actions={staffActions(s)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, warn }: { label: string; value: number | string; warn?: boolean }) {
  return (
    <div className="ui-card px-4 py-3">
      <p className="ui-label">{label}</p>
      <p className={clsx("mt-1 text-2xl font-semibold tabular", warn && value !== 0 && value !== "—" && "text-red-700")}>
        {value}
      </p>
    </div>
  );
}
