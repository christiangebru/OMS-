import { useEffect, useState, useCallback, useRef } from "react";
import { Link } from "react-router-dom";
import { apiJson, describeApiError } from "@/lib/api";
import type { ProductionQueue, QueueItem, Staff, StaffRanking } from "@/lib/types";
import { PRODUCTION_STAGES } from "@/lib/types";
import { daysLabel, formatDate, stageLabel, boardStatusLabel, shortOrderId } from "@/lib/format";
import { PageHeader, EmptyState, ErrorState, Badge, Skeleton } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";
import clsx from "clsx";
import { byUrgency, groupBoard, groupStatus, itemCode, type BoardGroup } from "@/lib/boardGroups";

type Lane = "ALL" | "waiting" | "assigned" | "off_site" | "in_progress";
const ASSIGNED = ["assigned", "distributed", "received"];
const DONE_STAGES = ["SHOWROOM", "READY", "PACKAGING", "DELIVERED"];

function laneOf(status: string): Lane {
  if (status === "waiting") return "waiting";
  if (ASSIGNED.includes(status)) return "assigned";
  if (status === "to_send" || status === "off_site") return "off_site";
  if (status === "in_progress") return "in_progress";
  return "ALL";
}

export function DistributionPage() {
  const [board, setBoard] = useState<ProductionQueue | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [stage, setStage] = useState<string>("ALL");
  const [busy, setBusy] = useState<string | null>(null);
  const [manual, setManual] = useState<Record<string, string>>({});
  const [lane, setLane] = useState<Lane>("ALL");
  const hydrated = useRef(false);

  const load = useCallback(async () => {
    try {
      const data = await apiJson<ProductionQueue>("/api/production/queue");
      hydrated.current = true;
      setBoard(data);
      setErr(null);
    } catch (e) {
      if (!hydrated.current) setErr(describeApiError(e, "Failed to load distribution board"));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);
  useLiveRefresh(load, 20000);

  // Finished garments (showroom, packing) need no decision here.
  const groups = board
    ? groupBoard(board.items)
        .filter((g) => !DONE_STAGES.includes(g.stage))
        .sort(byUrgency)
    : [];
  const inLane = groups.filter((g) => lane === "ALL" || laneOf(groupStatus(g)) === lane);
  const shown = inLane.filter((g) => stage === "ALL" || g.stage === stage);
  const laneCount = (l: Lane) => groups.filter((g) => l === "ALL" || laneOf(groupStatus(g)) === l).length;
  const stageCount = (s: string) => inLane.filter((g) => g.stage === s).length;

  async function assignRows(g: BoardGroup, staffId: string, followed: boolean) {
    setBusy(g.key);
    try {
      for (const row of g.rows.filter((r) => r.boardStatus === "waiting" || ASSIGNED.includes(r.boardStatus))) {
        await apiJson("/api/production/assignments", {
          method: "POST",
          body: JSON.stringify({
            staffId,
            orderItemId: row.itemId,
            stage: row.nextStage,
            suggestedStaffId: row.recommended?.staff._id || staffId,
            followedSuggestion: followed
          })
        });
      }
      setErr(null);
      await load();
    } catch (e) {
      setErr(describeApiError(e, "Assign failed"));
    } finally {
      setBusy(null);
    }
  }

  async function assignManual(g: BoardGroup) {
    const staffId = manual[g.key];
    if (!staffId) return;
    setBusy(g.key);
    try {
      for (const row of g.rows) {
        const data = await apiJson<{ rankings: StaffRanking[] }>(
          `/api/production/suggest-assignment?orderItemId=${row.itemId}&stage=${row.nextStage}`
        );
        if (!data.rankings.some((r) => r.staff._id === staffId)) {
          throw new Error(`That worker can't do ${stageLabel(row.nextStage)} (no skill for it)`);
        }
      }
      await assignRows(g, staffId, staffId === recommendationOf(g)?.staff._id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Assign failed");
      setBusy(null);
    }
  }

  const s = board?.summary;
  const actions = {
    busy,
    manual,
    workers: board?.staff.workers || [],
    onManual: (key: string, value: string) => setManual((m) => ({ ...m, [key]: value })),
    onAssign: (g: BoardGroup, staffId: string, followed: boolean) => void assignRows(g, staffId, followed),
    onAssignManual: (g: BoardGroup) => void assignManual(g)
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Distribution"
        description="Choose a worker for each garment. Scanning it in is the hand-over. Most urgent first."
        actions={
          <Button type="button" variant="secondary" onClick={load}>
            Refresh
          </Button>
        }
      />

      {err && <ErrorState message={err} />}

      {!board || !s ? (
        <Skeleton className="h-40" />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Needs a worker" value={laneCount("waiting")} />
            <Stat label="Assigned · waiting for scan-in" value={laneCount("assigned")} />
            <Stat
              label="Off-site"
              value={s.itemsAway ?? 0}
              note={`away · ${s.itemsToSend ?? 0} to send`}
            />
            <Stat label="Checked in" value={laneCount("in_progress")} />
          </div>

          <div className="flex flex-wrap gap-2" role="tablist" aria-label="Lanes">
            {(
              [
                ["ALL", "All"],
                ["waiting", "Needs a worker"],
                ["assigned", "Assigned"],
                ["off_site", "Off-site"],
                ["in_progress", "Checked in"]
              ] as const
            ).map(([value, label]) => (
              <Chip key={value} active={lane === value} onClick={() => setLane(value)}>
                {label} <span className="tabular">{laneCount(value)}</span>
              </Chip>
            ))}
          </div>

          <div className="flex flex-wrap gap-2" aria-label="Stages">
            <Chip active={stage === "ALL"} onClick={() => setStage("ALL")} small>
              Every stage
            </Chip>
            {PRODUCTION_STAGES.filter((st) => stageCount(st) > 0 || stage === st).map((st) => (
              <Chip key={st} active={stage === st} onClick={() => setStage(st)} small>
                {stageLabel(st)} <span className="tabular">{stageCount(st)}</span>
              </Chip>
            ))}
          </div>

          {shown.length === 0 ? (
            <EmptyState title="Nothing here" body="Try another lane, or All." />
          ) : (
            <>
              <ul className="space-y-3 lg:hidden">
                {shown.map((g) => (
                  <li key={g.key} className="ui-card space-y-3 p-4">
                    <div>
                      <ItemCell g={g} />
                      <p className="mt-1 text-xs text-ink-muted">
                        {stageLabel(g.stage)} · {boardStatusLabel(groupStatus(g))} · {daysLabel(g.lead.daysRemaining, g.lead.overdue)}
                      </p>
                      <WhoCell g={g} />
                    </div>
                    <LaneActions g={g} {...actions} />
                  </li>
                ))}
              </ul>
              <div className="hidden overflow-hidden ui-card lg:block">
                <div className="overflow-x-auto">
                  <table className="ui-table min-w-[960px] w-full text-sm">
                    <thead className="border-b border-line bg-canvas/70">
                      <tr>
                        <th>Item</th>
                        <th>Stage</th>
                        <th>Priority / due</th>
                        <th>Worker</th>
                        <th>Status</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {shown.map((g) => (
                        <tr key={g.key} className="border-t border-line">
                          <td>
                            <ItemCell g={g} />
                            <PathStrip path={g.lead.path} />
                          </td>
                          <td>{stageLabel(g.stage)}</td>
                          <td>
                            {g.lead.priority !== "NORMAL" && (
                              <Badge tone={g.lead.priority === "VIP" ? "accent" : "warn"}>{g.lead.priority}</Badge>
                            )}
                            <p className={clsx("text-xs", g.lead.overdue ? "font-semibold text-red-700" : "text-ink-muted")}>
                              {daysLabel(g.lead.daysRemaining, g.lead.overdue)} · {formatDate(g.lead.requiredCompletionDate)}
                            </p>
                          </td>
                          <td className="max-w-xs">
                            <WhoCell g={g} />
                          </td>
                          <td>
                            <Badge tone={STATUS_TONE[groupStatus(g)] || "ok"}>{boardStatusLabel(groupStatus(g))}</Badge>
                          </td>
                          <td className="text-right">
                            <LaneActions g={g} {...actions} align="end" />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

const STATUS_TONE: Record<string, "progress" | "warn" | "ok"> = {
  in_progress: "progress",
  waiting: "warn",
  to_send: "warn",
  off_site: "warn"
};

function recommendationOf(g: BoardGroup): StaffRanking | null {
  return g.rows.find((r) => r.recommended)?.recommended || null;
}

function ItemCell({ g }: { g: BoardGroup }) {
  const lead = g.lead;
  return (
    <div>
      <p className="font-medium text-ink">
        <Link className="hover:text-accent" to={`/garments/${encodeURIComponent(lead.itemId)}`}>
          {g.title}
        </Link>
      </p>
      <p className="text-xs text-ink-muted">
        {lead.customer?.name || "—"} ·{" "}
        <Link className="hover:text-accent" to={`/orders/${encodeURIComponent(lead.orderId)}`}>
          {shortOrderId(lead.orderId)}
        </Link>
      </p>
      <p className="font-mono text-[11px] text-ink-faint">{g.code}</p>
      {g.isParts && (
        <p className="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-ink-muted">
          <span>Parts:</span>
          {g.rows.map((r) => (
            <Link
              key={r.itemId}
              to={`/scan?barcode=${encodeURIComponent(itemCode(r))}`}
              title={`${itemCode(r)} · ${boardStatusLabel(r.boardStatus)}`}
              className={clsx(
                "rounded-sm border px-1.5 py-0.5 font-mono font-semibold",
                r.boardStatus === "in_progress" ? "border-accent bg-accent-soft text-accent" : "border-line"
              )}
            >
              {r.partCode}
            </Link>
          ))}
          {g.partsTotal > g.rows.length && (
            <span className="text-ink-faint">
              · {g.partsTotal - g.rows.length} more elsewhere{g.partsReady ? `, ${g.partsReady} ready to join` : ""}
            </span>
          )}
        </p>
      )}
    </div>
  );
}

/** Who has it, or who should get it. */
function WhoCell({ g }: { g: BoardGroup }) {
  const status = groupStatus(g);
  const trip = g.rows.find((r) => r.offSiteTrip);
  if (trip) return <OffSiteTripLine item={trip} />;
  if (status === "to_send") return <p className="text-xs text-amber-800">Goes off-site next · not sent yet</p>;
  const assigned = [...new Set(g.rows.map((r) => r.assignment?.staff?.name).filter(Boolean))];
  if (status !== "waiting") {
    return <p className="text-xs text-ink">{assigned.length ? assigned.join(", ") : "—"}</p>;
  }
  const rec = recommendationOf(g);
  if (!rec) {
    return (
      <p className="text-xs text-red-700">
        No worker has the {stageLabel(g.stage)} skill.{" "}
        <Link to="/staff" className="font-semibold underline">
          Staff
        </Link>
      </p>
    );
  }
  return (
    <div>
      <p className="text-xs text-ink-muted">Suggested</p>
      <p className="font-medium text-ink">{rec.staff.name}</p>
      <p className="mt-0.5 flex flex-wrap gap-1 text-[11px] text-ink-muted">
        {(rec.reasons || []).slice(0, 3).map((r) => (
          <span key={r.code + r.label} className={r.ok ? "text-ink-muted" : "text-red-700"}>
            {r.label}
          </span>
        ))}
        {!rec.reasons?.length && rec.summary}
      </p>
    </div>
  );
}

function LaneActions({
  g,
  busy,
  manual,
  workers,
  onManual,
  onAssign,
  onAssignManual,
  align = "start"
}: {
  g: BoardGroup;
  busy: string | null;
  manual: Record<string, string>;
  workers: Staff[];
  onManual: (key: string, value: string) => void;
  onAssign: (g: BoardGroup, staffId: string, followed: boolean) => void;
  onAssignManual: (g: BoardGroup) => void;
  align?: "start" | "end";
}) {
  const status = groupStatus(g);
  const rec = recommendationOf(g);
  const isBusy = busy === g.key;
  const many = g.rows.length > 1 ? ` (${g.rows.length})` : "";
  const assignedIds = new Set(g.rows.map((r) => r.assignment?.staff?._id).filter(Boolean));
  return (
    <div className={clsx("flex flex-col gap-1.5", align === "end" && "items-end")}>
      {status === "to_send" && (
        <Link to="/off-site" className="rounded-control bg-accent px-3 py-1.5 text-center text-xs font-semibold text-white">
          Send off-site
        </Link>
      )}
      {status === "waiting" && rec && (
        <Button size="sm" disabled={isBusy} onClick={() => onAssign(g, rec.staff._id, true)}>
          {isBusy ? "Assigning…" : `Assign ${rec.staff.name.split(" ")[0]}${many}`}
        </Button>
      )}
      {ASSIGNED.includes(status) && !g.isParts && (
        <Link
          to={`/scan?barcode=${encodeURIComponent(itemCode(g.lead))}`}
          className="rounded-control bg-accent px-3 py-1.5 text-center text-xs font-semibold text-white"
        >
          Scan in to hand over
        </Link>
      )}
      {ASSIGNED.includes(status) && g.isParts && (
        <p className="text-[11px] text-ink-muted">Scan each part in to hand over</p>
      )}
      {(status === "waiting" || ASSIGNED.includes(status)) && (
        <div className="flex gap-1">
          <select
            className="rounded-control border border-line bg-surface px-2 py-1 text-xs"
            value={manual[g.key] || ""}
            onChange={(e) => onManual(g.key, e.target.value)}
            aria-label={status === "waiting" ? "Choose a worker" : "Give to another worker"}
          >
            <option value="">{status === "waiting" ? "Other worker…" : "Reassign to…"}</option>
            {workers
              .filter((w) => w.active !== false && !assignedIds.has(w._id))
              .map((w) => (
                <option key={w._id} value={w._id}>
                  {w.name} ({w.status === "AVAILABLE" ? "free" : w.status === "BUSY" ? "busy" : "off"})
                </option>
              ))}
          </select>
          <Button
            size="sm"
            variant="secondary"
            disabled={!manual[g.key] || isBusy}
            onClick={() => onAssignManual(g)}
          >
            {status === "waiting" ? "Assign" : "Reassign"}
          </Button>
        </div>
      )}
    </div>
  );
}

function OffSiteTripLine({ item }: { item: QueueItem }) {
  const trip = item.offSiteTrip;
  if (!trip) return null;
  const bits = [
    trip.handlerName ? `with ${trip.handlerName}` : "no name recorded",
    trip.handlerPhone || "",
    trip.expectedReturnAt ? `due back ${formatDate(trip.expectedReturnAt)}` : ""
  ].filter(Boolean);
  return (
    <p className={clsx("mt-1 text-[11px]", trip.overdue ? "font-semibold text-red-700" : "text-amber-800")}>
      Off-site · {bits.join(" · ")}
    </p>
  );
}

function Stat({ label, value, note }: { label: string; value: number; note?: string }) {
  return (
    <div className="ui-card px-4 py-3">
      <p className="ui-label">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular text-ink">
        {value}
        {note && <span className="ml-1.5 text-xs font-normal text-ink-muted">{note}</span>}
      </p>
    </div>
  );
}

function PathStrip({ path }: { path?: QueueItem["path"] }) {
  if (!path?.length) return null;
  return (
    <ol className="mt-2 flex flex-wrap items-center gap-x-1 gap-y-0.5 text-[11px] text-ink-muted">
      {path.map((p, i) => (
        <li key={p.stage} className="flex items-center gap-1">
          <span className="font-semibold uppercase tracking-wide text-ink-faint">
            {i === 0 ? "Give to" : "then"}
          </span>
          <span className="capitalize">{stageLabel(p.stage)}</span>
          <span className={p.offSite ? "text-amber-800" : "text-ink"}>
            {p.offSite ? "→ off-site" : p.staffName ? `→ ${p.staffName}` : "→ —"}
          </span>
        </li>
      ))}
    </ol>
  );
}

function Chip({
  active,
  onClick,
  small,
  children
}: {
  active: boolean;
  onClick: () => void;
  small?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={clsx(
        "rounded-control border font-medium",
        small ? "px-2.5 py-1 text-[11px]" : "min-h-9 px-3 py-1.5 text-xs",
        active ? "border-accent bg-accent-soft text-accent" : "border-line bg-surface text-ink-muted hover:text-ink"
      )}
    >
      {children}
    </button>
  );
}
