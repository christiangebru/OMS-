import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiJson, ApiError } from "@/lib/api";
import type { ProductionStage, Staff, StaffRole, StaffStatus } from "@/lib/types";
import { PRODUCTION_STAGES } from "@/lib/types";
import { PageHeader, EmptyState, ErrorState, Badge, Skeleton } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/StatusBadge";
import { boardStatusLabel, stageLabel } from "@/lib/format";
import clsx from "clsx";

const ROLES: StaffRole[] = ["TAILOR", "EMBROIDERER", "FINISHER", "CUTTER", "MANAGER"];
const STATUSES: StaffStatus[] = ["AVAILABLE", "BUSY", "OFF_DUTY"];

export function StaffPage() {
  const [staff, setStaff] = useState<Staff[] | null>(null);
  const [role, setRole] = useState("");
  const [status, setStatus] = useState("");
  const [stage, setStage] = useState<ProductionStage | "">("");
  const [readyOnly, setReadyOnly] = useState(false);
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
      if (stage) p.set("stage", stage);
      p.set("includeInactive", "true");
      setStaff(await apiJson<Staff[]>(`/api/staff?${p}`));
      setErr(null);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Failed to load staff");
    }
  }

  useEffect(() => {
    load();
  }, [role, status, stage]);

  const visible = useMemo(() => {
    const list = staff || [];
    if (!readyOnly) return list;
    return list.filter(
      (s) => s.active && s.status === "AVAILABLE" && (s.activeAssignmentCount || 0) < 4
    );
  }, [staff, readyOnly]);

  const availableNow = (staff || []).filter(
    (s) => s.active && s.status === "AVAILABLE" && (s.activeAssignmentCount || 0) < 4
  ).length;

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
          <Button type="button" onClick={() => setShowForm((v) => !v)}>
            {showForm ? "Cancel" : "Add staff"}
          </Button>
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

      {showForm && (
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
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((s) => (
            <li key={s._id}>
              <Link
                to={`/staff/${s._id}`}
                className="ui-card block h-full p-4 transition hover:border-accent/40"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-ink">{s.name}</p>
                    <p className="text-xs capitalize text-ink-muted">
                      {s.role.toLowerCase()} · {s.phone}
                    </p>
                  </div>
                  <StatusBadge status={s.status} />
                </div>
                {!s.active && (
                  <p className="mt-2 text-xs font-medium text-red-700">Inactive</p>
                )}
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <Badge tone={s.presence === "idle" ? "ok" : s.presence === "in_progress" ? "progress" : "warn"}>
                    {boardStatusLabel(s.presence)}
                  </Badge>
                  {s.strongestStage && (
                    <Badge tone="neutral">
                      {stageLabel(s.strongestStage)} {s.strongestLevel}/5
                    </Badge>
                  )}
                </div>
                <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
                  <Mini label="Active" value={s.activeAssignmentCount ?? 0} />
                  <Mini label="Overdue" value={s.overdueAssignmentCount ?? 0} warn={(s.overdueAssignmentCount || 0) > 0} />
                  <Mini label="Done" value={s.completedAssignmentCount ?? 0} />
                </dl>
                {s.currentGarment ? (
                  <p className="mt-3 truncate text-xs text-ink-muted">
                    Holding {s.currentGarment.clothingType}
                    {s.currentGarment.customerName ? ` · ${s.currentGarment.customerName}` : ""} ·{" "}
                    {stageLabel(s.currentGarment.stage)}
                  </p>
                ) : (
                  <p className="mt-3 text-xs text-ink-faint">No garment in hand</p>
                )}
                {s.skills && s.skills.length > 0 && (
                  <p className="mt-2 truncate text-[11px] capitalize text-ink-faint">
                    {s.skills.map(stageLabel).join(" · ")}
                  </p>
                )}
              </Link>
            </li>
          ))}
        </ul>
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

function Mini({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className="rounded-lg bg-canvas px-2 py-1.5">
      <p className="text-[10px] uppercase tracking-wide text-ink-faint">{label}</p>
      <p className={clsx("text-sm font-semibold tabular", warn && "text-red-700")}>{value}</p>
    </div>
  );
}
