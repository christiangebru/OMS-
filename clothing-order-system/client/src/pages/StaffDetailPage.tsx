import { useEffect, useState, useCallback, useRef } from "react";
import { Link, useParams } from "react-router-dom";
import { apiJson, ApiError } from "@/lib/api";
import type { ProductionStage, Staff, StaffRole, StaffStatus } from "@/lib/types";
import { PRODUCTION_STAGES } from "@/lib/types";
import { StatusBadge } from "@/components/StatusBadge";
import { PageHeader, ErrorState, Badge } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { formatDate, formatDuration, stageLabel } from "@/lib/format";
import { useAuth } from "@/context/AuthContext";
import { canWriteStaff } from "@/lib/roles";
import { useToast } from "@/context/ToastContext";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";

type Workload = {
  activeAssignmentCount: number;
  completedAssignmentCount: number;
  overdueAssignmentCount: number;
  averageStageDurationMs: number | null;
  assignedItems: Array<{
    assignmentId: string;
    stage: string;
    assignedAt: string;
    distributedAt?: string | null;
    receivedAt?: string | null;
    priorityReason?: string;
    item: { _id: string; clothingType: string; barcodeValue: string; orderId: string };
    due: string | null;
    overdue: boolean;
    customerName: string | null;
    priority: string | null;
  }>;
  queue?: {
    nowWorking: Workload["assignedItems"];
    upNext: Workload["assignedItems"][number] | null;
    queued: Workload["assignedItems"];
    completed: Array<{
      assignmentId: string;
      stage: string;
      completedAt: string;
      item: { _id: string; clothingType: string; barcodeValue: string; orderId: string } | null;
    }>;
  };
};

export function StaffDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const canManage = canWriteStaff(user?.role);
  const { push } = useToast();
  const [staff, setStaff] = useState<Staff | null>(null);
  const [work, setWork] = useState<Workload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [skillMap, setSkillMap] = useState<Partial<Record<ProductionStage, number>>>({});
  const [tab, setTab] = useState<"identity" | "skills" | "work">("work");
  const hydrated = useRef(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [data, wl] = await Promise.all([
        apiJson<Staff>(`/api/staff/${id}`),
        apiJson<Workload>(`/api/staff/${id}/workload`)
      ]);
      setStaff(data);
      const map: Partial<Record<ProductionStage, number>> = {};
      for (const d of data.skillDetails || []) map[d.stage] = d.level;
      for (const s of data.skills || []) if (map[s] == null) map[s] = data.skillLevel || 3;
      setSkillMap(map);
      setWork(wl);
      hydrated.current = true;
      setErr(null);
    } catch (e) {
      if (!hydrated.current) setErr(e instanceof ApiError ? e.message : "Failed to load");
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);
  useLiveRefresh(load, 25000);

  async function setStatus(status: StaffStatus) {
    if (!id || !canManage) return;
    try {
      const updated = await apiJson<Staff>(`/api/staff/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status })
      });
      setStaff(updated);
      push("Availability updated", "ok");
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Update failed");
    }
  }

  async function saveSkills() {
    if (!id || !canManage) return;
    try {
      const requestedSkills = Object.entries(skillMap).map(([stage, level]) => ({ stage, level }));
      const updated = await apiJson<Staff>(`/api/staff/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ skills: requestedSkills })
      });
      setStaff(updated);
      const savedMap: Partial<Record<ProductionStage, number>> = {};
      for (const detail of updated.skillDetails || []) savedMap[detail.stage] = detail.level;
      for (const stage of updated.skills || []) {
        if (savedMap[stage] == null) savedMap[stage] = updated.skillLevel || 3;
      }
      setSkillMap(savedMap);
      const missingStages = requestedSkills
        .map(({ stage }) => stage)
        .filter((stage) => savedMap[stage as ProductionStage] == null);
      if (missingStages.length) {
        setErr(`Skills were not saved: ${missingStages.join(", ")}`);
        return;
      }
      push("Skills saved", "ok");
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Skills update failed");
    }
  }

  async function deactivate() {
    if (!id || !canManage || !window.confirm("This worker will no longer appear for new assignments. Queued work stays until it is scanned out.")) return;
    try {
      const updated = await apiJson<Staff>(`/api/staff/${id}/deactivate`, { method: "POST" });
      setStaff(updated);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Deactivate failed");
    }
  }

  if (!staff && !err) return <div className="h-24 animate-pulse rounded-xl bg-line/60" />;
  if (!staff) return <ErrorState message={err || "Not found"} />;

  return (
    <div className="space-y-6">
      <PageHeader
        title={staff.name}
        description={`${staff.role.replace("_", " ")} · ${staff.phone}`}
        actions={
          <Link to="/staff">
            <Button variant="secondary">All staff</Button>
          </Link>
        }
      />
      {err && <ErrorState message={err} />}

      <div className="grid gap-3 sm:grid-cols-4">
        <Metric label="Active" value={work?.activeAssignmentCount ?? "—"} />
        <Metric label="Completed" value={work?.completedAssignmentCount ?? "—"} />
        <Metric label="Overdue" value={work?.overdueAssignmentCount ?? "—"} warn={(work?.overdueAssignmentCount || 0) > 0} />
        <Metric
          label="Avg stage time"
          value={work?.averageStageDurationMs != null ? formatDuration(work.averageStageDurationMs) : "—"}
        />
      </div>

      <div className="flex gap-2">
        {(["work", "skills", "identity"] as const).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={
              tab === key
                ? "rounded-control bg-accent-soft px-3 py-1.5 text-sm font-medium text-accent"
                : "rounded-control px-3 py-1.5 text-sm text-ink-muted hover:bg-canvas"
            }
          >
            {key === "work" ? "Workload" : key === "skills" ? "Skills" : "Availability"}
          </button>
        ))}
      </div>

      {tab === "identity" && (
        <section className="ui-card space-y-3 p-5">
          <div className="flex items-center gap-3">
            <StatusBadge status={staff.status} />
            {!staff.active && <Badge tone="urgent">Inactive</Badge>}
          </div>
          <div className="flex flex-wrap gap-2">
            {canManage &&
              (["AVAILABLE", "BUSY", "OFF_DUTY"] as StaffStatus[]).map((s) => (
                <Button key={s} type="button" size="sm" variant="secondary" onClick={() => setStatus(s)}>
                  Set {s.replace("_", " ")}
                </Button>
              ))}
            {canManage && staff.active && (
              <Button type="button" size="sm" variant="danger" onClick={deactivate}>
                Deactivate
              </Button>
            )}
            {canManage && !staff.active && (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() =>
                  apiJson<Staff>(`/api/staff/${id}`, {
                    method: "PATCH",
                    body: JSON.stringify({ active: true, status: "AVAILABLE" })
                  }).then(setStaff)
                }
              >
                Activate
              </Button>
            )}
          </div>
          {canManage && (
            <form
              className="grid gap-3 border-t border-line pt-4 sm:grid-cols-3"
              onSubmit={async (e) => {
                e.preventDefault();
                const form = e.currentTarget;
                const name = (form.elements.namedItem("staff-name") as HTMLInputElement).value;
                const phone = (form.elements.namedItem("staff-phone") as HTMLInputElement).value;
                const role = (form.elements.namedItem("staff-role") as HTMLSelectElement).value as StaffRole;
                try {
                  const updated = await apiJson<Staff>(`/api/staff/${id}`, {
                    method: "PATCH",
                    body: JSON.stringify({ name, phone, role })
                  });
                  setStaff(updated);
                  push("Profile saved", "ok");
                } catch (err) {
                  setErr(err instanceof ApiError ? err.message : "Could not save");
                }
              }}
            >
              <label className="text-sm">
                <span className="ui-label">Name</span>
                <input name="staff-name" defaultValue={staff.name} className="ui-input" required />
              </label>
              <label className="text-sm">
                <span className="ui-label">Phone</span>
                <input name="staff-phone" defaultValue={staff.phone} className="ui-input" required />
              </label>
              <label className="text-sm">
                <span className="ui-label">Role</span>
                <select name="staff-role" defaultValue={staff.role} className="ui-input">
                  {(["TAILOR", "EMBROIDERER", "FINISHER", "CUTTER", "PACKER", "MANAGER"] as StaffRole[]).map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </label>
              <div className="sm:col-span-3">
                <Button type="submit">Save profile</Button>
              </div>
            </form>
          )}
        </section>
      )}

      {tab === "skills" && (
        <section className="ui-card space-y-4 p-5">
          <p className="text-sm text-ink-muted">Turn on stages this worker can run, then set skill from 1 to 5.</p>
          <ul className="space-y-3">
            {PRODUCTION_STAGES.map((stage) => {
              const level = skillMap[stage];
              const on = level != null;
              return (
                <li key={stage} className="flex flex-wrap items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() =>
                      setSkillMap((prev) => {
                        const next = { ...prev };
                        if (on) delete next[stage];
                        else next[stage] = 3;
                        return next;
                      })
                    }
                    className={
                      on
                        ? "rounded-control bg-accent px-3 py-1.5 text-xs font-semibold text-white"
                        : "rounded-control border border-line px-3 py-1.5 text-xs font-medium text-ink-muted"
                    }
                  >
                    {stageLabel(stage)}
                  </button>
                  {on && (
                    <div className="flex gap-1" aria-label={`${stage} skill level`}>
                      {[1, 2, 3, 4, 5].map((n) => (
                        <button
                          key={n}
                          type="button"
                          onClick={() => setSkillMap((prev) => ({ ...prev, [stage]: n }))}
                          className={n <= (level || 0) ? "text-accent" : "text-line"}
                        >
                          ★
                        </button>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          <Button type="button" onClick={saveSkills} disabled={!canManage}>
            Save skills
          </Button>
        </section>
      )}

      {tab === "work" && (
        <section className="space-y-4">
          <QueueBlock title="Now working" rows={work?.queue?.nowWorking || []} empty="Not currently checked in." />
          {work?.queue?.upNext && (
            <QueueBlock title="Up next" rows={[work.queue.upNext]} empty="" />
          )}
          <QueueBlock title="Queued" rows={work?.queue?.queued || []} empty="No additional queued assignments." />
          <QueueBlock
            title="Completed"
            rows={(work?.queue?.completed || []).map((c) => ({
              assignmentId: c.assignmentId,
              stage: c.stage,
              assignedAt: c.completedAt,
              item: c.item || { _id: "", clothingType: "—", barcodeValue: "", orderId: "" },
              due: null,
              overdue: false,
              customerName: null,
              priority: null
            }))}
            empty="No completed work yet."
          />
        </section>
      )}
    </div>
  );
}

function QueueBlock({
  title,
  rows,
  empty
}: {
  title: string;
  rows: Array<{
    assignmentId: string;
    stage: string;
    item: { _id: string; clothingType: string; barcodeValue: string; orderId: string };
    due?: string | null;
    overdue?: boolean;
    customerName?: string | null;
    priorityReason?: string;
  }>;
  empty: string;
}) {
  return (
    <section className="overflow-hidden border border-line bg-surface">
      <div className="border-b border-line px-4 py-2">
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
      </div>
      {!rows.length ? (
        empty ? <p className="px-4 py-6 text-sm text-ink-muted">{empty}</p> : null
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((a) => (
            <li key={a.assignmentId} className="flex items-center justify-between gap-2 px-4 py-3 text-sm">
              <div>
                <p className="font-medium text-ink">
                  {a.item.clothingType} · {a.customerName || a.item.orderId}
                </p>
                <p className="text-xs capitalize text-ink-muted">
                  {stageLabel(a.stage)}
                  {a.priorityReason ? ` · ${a.priorityReason}` : ""}
                </p>
              </div>
              {a.item._id && (
                <Link to={`/garments/${encodeURIComponent(a.item._id)}`} className="text-xs font-semibold text-accent">
                  Open
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Metric({
  label,
  value,
  warn
}: {
  label: string;
  value: string | number;
  warn?: boolean;
}) {
  return (
    <div className="ui-card px-4 py-3">
      <p className="ui-label">{label}</p>
      <p className={`mt-1 text-xl font-semibold tabular ${warn ? "text-red-700" : "text-ink"}`}>{value}</p>
    </div>
  );
}
