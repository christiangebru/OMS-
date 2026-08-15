import { useEffect, useState, useCallback, useRef } from "react";
import { Link, useParams } from "react-router-dom";
import { apiJson, ApiError } from "@/lib/api";
import type { ProductionStage, Staff, StaffStatus } from "@/lib/types";
import { PRODUCTION_STAGES } from "@/lib/types";
import { StatusBadge } from "@/components/StatusBadge";
import { PageHeader, ErrorState, Badge } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { formatDate, formatDuration, stageLabel } from "@/lib/format";
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
    item: { _id: string; clothingType: string; barcodeValue: string; orderId: string };
    due: string | null;
    overdue: boolean;
    customerName: string | null;
    priority: string | null;
  }>;
};

export function StaffDetailPage() {
  const { id } = useParams<{ id: string }>();
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
    if (!id) return;
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
    if (!id) return;
    try {
      const updated = await apiJson<Staff>(`/api/staff/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          skills: Object.entries(skillMap).map(([stage, level]) => ({ stage, level }))
        })
      });
      setStaff(updated);
      push("Skills saved", "ok");
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Skills update failed");
    }
  }

  async function deactivate() {
    if (!id || !window.confirm("Deactivate this staff member?")) return;
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
            {(["AVAILABLE", "BUSY", "OFF_DUTY"] as StaffStatus[]).map((s) => (
              <Button key={s} type="button" size="sm" variant="secondary" onClick={() => setStatus(s)}>
                Set {s.replace("_", " ")}
              </Button>
            ))}
            {staff.active && (
              <Button type="button" size="sm" variant="danger" onClick={deactivate}>
                Deactivate
              </Button>
            )}
          </div>
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
          <Button type="button" onClick={saveSkills}>
            Save skills
          </Button>
        </section>
      )}

      {tab === "work" && (
        <section className="ui-card overflow-hidden">
          {!(work?.assignedItems || []).length ? (
            <p className="px-5 py-8 text-sm text-ink-muted">No active assignments.</p>
          ) : (
            <ul className="divide-y divide-line">
              {work!.assignedItems.map((a) => (
                <li key={a.assignmentId} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                  <div>
                    <p className="font-medium text-ink">
                      {a.item.clothingType} · {a.customerName || "—"}
                    </p>
                    <p className="text-xs capitalize text-ink-muted">
                      {stageLabel(a.stage)} · {a.item.orderId}
                      {a.distributedAt ? " · handed over" : " · assigned"}
                      {a.receivedAt ? " · received" : ""}
                    </p>
                  </div>
                  <div className="text-right">
                    <span className={a.overdue ? "text-xs font-semibold text-red-700" : "text-xs text-ink-muted"}>
                      {a.due ? formatDate(a.due) : "—"}
                    </span>
                    {a.item.barcodeValue && (
                      <Link
                        to={`/scan?barcode=${encodeURIComponent(a.item.barcodeValue)}`}
                        className="mt-1 block text-xs font-semibold text-accent"
                      >
                        Scan
                      </Link>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
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
