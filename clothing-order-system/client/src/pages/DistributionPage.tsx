import { useEffect, useState, useCallback, useRef } from "react";
import { Link } from "react-router-dom";
import { apiJson, ApiError } from "@/lib/api";
import type { ProductionQueue, ProductionStage, QueueItem, Staff, StaffRanking } from "@/lib/types";
import { PRODUCTION_STAGES } from "@/lib/types";
import { daysLabel, formatDate, stageLabel, boardStatusLabel } from "@/lib/format";
import { PageHeader, EmptyState, ErrorState, Badge, Skeleton } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";
import clsx from "clsx";

export function DistributionPage() {
  const [board, setBoard] = useState<ProductionQueue | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [stage, setStage] = useState<ProductionStage | "ALL">("ALL");
  const [busy, setBusy] = useState<string | null>(null);
  const [manual, setManual] = useState<Record<string, string>>({});
  const [lane, setLane] = useState<
    "ALL" | "waiting" | "assigned" | "distributed" | "received" | "in_progress"
  >("ALL");
  const hydrated = useRef(false);

  const load = useCallback(async () => {
    try {
      const data = await apiJson<ProductionQueue>("/api/production/queue");
      hydrated.current = true;
      setBoard(data);
      setErr(null);
    } catch (e) {
      if (!hydrated.current) setErr(e instanceof ApiError ? e.message : "Failed to load distribution board");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);
  useLiveRefresh(load, 20000);

  const items = (board?.items || []).filter((i) => {
    const stageOk = stage === "ALL" ? true : i.nextStage === stage || i.openStage === stage;
    const laneOk = lane === "ALL" ? true : i.boardStatus === lane;
    return stageOk && laneOk;
  }) as Array<QueueItem & { openStage?: string | null }>;

  async function assign(item: QueueItem, ranking: StaffRanking, followed: boolean) {
    setBusy(item.itemId);
    try {
      await apiJson("/api/production/assignments", {
        method: "POST",
        body: JSON.stringify({
          staffId: ranking.staff._id,
          orderItemId: item.itemId,
          stage: item.nextStage,
          suggestedStaffId: item.recommended?.staff._id || ranking.staff._id,
          followedSuggestion: followed
        })
      });
      await load();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Assign failed");
    } finally {
      setBusy(null);
    }
  }

  async function assignManual(item: QueueItem) {
    const staffId = manual[item.itemId];
    if (!staffId) return;
    setBusy(item.itemId);
    try {
      const data = await apiJson<{ rankings: StaffRanking[] }>(
        `/api/production/suggest-assignment?orderItemId=${item.itemId}&stage=${item.nextStage}`
      );
      const ranking = data.rankings.find((r) => r.staff._id === staffId);
      if (!ranking) throw new Error("Selected worker is not eligible for this stage");
      await assign(item, ranking, ranking.staff._id === item.recommended?.staff._id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Assign failed");
      setBusy(null);
    }
  }

  async function distribute(item: QueueItem) {
    if (!item.assignment?._id) return;
    setBusy(item.itemId);
    try {
      await apiJson(`/api/production/assignments/${item.assignment._id}/distribute`, {
        method: "POST"
      });
      await load();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Distribute failed");
    } finally {
      setBusy(null);
    }
  }

  async function receive(item: QueueItem) {
    if (!item.assignment?._id) return;
    setBusy(item.itemId);
    try {
      await apiJson(`/api/production/assignments/${item.assignment._id}/receive`, {
        method: "POST"
      });
      await load();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Receive failed");
    } finally {
      setBusy(null);
    }
  }

  const waiting = board?.summary.itemsWaiting ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Distribution"
        description="Recommend a worker, assign, then hand the garment over. Assignment and handover are separate events."
        actions={
          <Button type="button" variant="secondary" onClick={load}>
            Refresh
          </Button>
        }
      />

      {err && <ErrorState message={err} />}

      {!board ? (
        <Skeleton className="h-40" />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Stat label="Waiting assignment" value={waiting} />
            <Stat label="Assigned" value={board.summary.itemsAssigned} />
            <Stat label="Handed over" value={board.summary.itemsDistributed} />
            <Stat label="Received" value={board.summary.itemsReceived || 0} />
            <Stat label="Checked in" value={board.summary.itemsInProgress} />
          </div>

          <div className="flex flex-wrap gap-2">
            {(
              [
                ["ALL", "All lanes"],
                ["waiting", "Waiting"],
                ["assigned", "Assigned"],
                ["distributed", "Handed over"],
                ["received", "Received"],
                ["in_progress", "In progress"]
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setLane(value)}
                className={clsx(
                  "rounded-control border px-3 py-1.5 text-xs font-medium",
                  lane === value
                    ? "border-accent bg-accent-soft text-accent"
                    : "border-line bg-surface text-ink-muted hover:text-ink"
                )}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            <StageFilter current={stage} onChange={setStage} label="All" value="ALL" count={board.items.length} />
            {PRODUCTION_STAGES.map((s) => (
              <StageFilter
                key={s}
                current={stage}
                onChange={setStage}
                label={stageLabel(s)}
                value={s}
                count={board.byStage[s]?.items.length || 0}
              />
            ))}
          </div>

          {items.length === 0 ? (
            <EmptyState title="Nothing waiting in this stage" body="New orders will appear here once they are created." />
          ) : (
            <>
              <ul className="space-y-3 lg:hidden">
                {items.map((item) => (
                  <li key={item.itemId} className="ui-card space-y-3 p-4">
                    <div>
                      <p className="font-medium text-ink">{item.clothingType}</p>
                      <p className="text-xs text-ink-muted">
                        {item.customer?.name || "—"} · {item.orderId}
                      </p>
                      <p className="mt-1 text-xs capitalize text-ink-muted">
                        {stageLabel(item.nextStage)} · {boardStatusLabel(item.boardStatus)}
                        {item.assignment?.staff ? ` · ${item.assignment.staff.name}` : ""}
                      </p>
                      {item.recommended && item.boardStatus === "waiting" && (
                        <p className="mt-1 text-[11px] text-ink-muted">
                          Recommended: {item.recommended.staff.name}
                          {item.recommended.summary ? ` — ${item.recommended.summary}` : ""}
                        </p>
                      )}
                    </div>
                    <LaneActions
                      item={item}
                      busy={busy}
                      manual={manual}
                      workers={board.staff.workers || []}
                      onManual={(id, value) => setManual((m) => ({ ...m, [id]: value }))}
                      onAssign={assign}
                      onAssignManual={assignManual}
                      onDistribute={distribute}
                      onReceive={receive}
                    />
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
                      <th>Recommended</th>
                      <th>Status</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => (
                      <tr key={item.itemId} className="border-t border-line">
                        <td>
                          <p className="font-medium text-ink">{item.clothingType}</p>
                          <p className="text-xs text-ink-muted">
                            {item.customer?.name || "—"} ·{" "}
                            <Link className="hover:text-accent" to={`/orders/${encodeURIComponent(item.orderId)}`}>
                              {item.orderId}
                            </Link>
                          </p>
                          <p className="font-mono text-[11px] text-ink-faint">
                            <Link className="hover:text-accent" to={`/scan?barcode=${encodeURIComponent(item.barcodeValue)}`}>
                              {item.barcodeValue}
                            </Link>
                          </p>
                        </td>
                        <td className="capitalize">{stageLabel(item.nextStage)}</td>
                        <td>
                          {item.priority !== "NORMAL" && (
                            <Badge tone={item.priority === "VIP" ? "accent" : "warn"}>{item.priority}</Badge>
                          )}
                          <p
                            className={clsx(
                              "text-xs",
                              item.overdue ? "font-semibold text-red-700" : "text-ink-muted"
                            )}
                          >
                            {daysLabel(item.daysRemaining, item.overdue)} · {formatDate(item.requiredCompletionDate)}
                          </p>
                        </td>
                        <td className="max-w-xs">
                          {item.recommended ? (
                            <div>
                              <p className="font-medium text-ink">{item.recommended.staff.name}</p>
                              <p className="mt-0.5 text-[11px] text-ink-muted">
                                {item.recommended.summary ||
                                  `Skill ${item.recommended.staff.skillLevel}/5 · ${item.recommended.staff.activeAssignmentCount} active`}
                              </p>
                            </div>
                          ) : (
                            <span className="text-xs text-ink-muted">No eligible worker</span>
                          )}
                        </td>
                        <td>
                          <Badge
                            tone={
                              item.boardStatus === "in_progress"
                                ? "progress"
                                : item.boardStatus === "waiting"
                                  ? "warn"
                                  : "ok"
                            }
                          >
                            {boardStatusLabel(item.boardStatus)}
                          </Badge>
                          {item.assignment?.staff && (
                            <p className="mt-1 text-xs text-ink-muted">{item.assignment.staff.name}</p>
                          )}
                        </td>
                        <td className="text-right">
                          <LaneActions
                            item={item}
                            busy={busy}
                            manual={manual}
                            workers={board.staff.workers || []}
                            onManual={(id, value) => setManual((m) => ({ ...m, [id]: value }))}
                            onAssign={assign}
                            onAssignManual={assignManual}
                            onDistribute={distribute}
                            onReceive={receive}
                            align="end"
                          />
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

function LaneActions({
  item,
  busy,
  manual,
  workers,
  onManual,
  onAssign,
  onAssignManual,
  onDistribute,
  onReceive,
  align = "start"
}: {
  item: QueueItem;
  busy: string | null;
  manual: Record<string, string>;
  workers: Staff[];
  onManual: (id: string, value: string) => void;
  onAssign: (item: QueueItem, ranking: StaffRanking, followed: boolean) => void;
  onAssignManual: (item: QueueItem) => void;
  onDistribute: (item: QueueItem) => void;
  onReceive: (item: QueueItem) => void;
  align?: "start" | "end";
}) {
  return (
    <div className={clsx("flex flex-col gap-1.5", align === "end" && "items-end")}>
      {item.boardStatus === "waiting" && item.recommended && (
        <Button size="sm" disabled={busy === item.itemId} onClick={() => onAssign(item, item.recommended!, true)}>
          Assign {item.recommended.staff.name.split(" ")[0]}
        </Button>
      )}
      {item.boardStatus === "assigned" && (
        <Button size="sm" disabled={busy === item.itemId} onClick={() => onDistribute(item)}>
          Mark handed over
        </Button>
      )}
      {item.boardStatus === "distributed" && (
        <Button size="sm" disabled={busy === item.itemId} onClick={() => onReceive(item)}>
          Confirm received
        </Button>
      )}
      {item.boardStatus === "waiting" && (
        <div className="flex gap-1">
          <select
            className="rounded-control border border-line bg-surface px-2 py-1 text-xs"
            value={manual[item.itemId] || ""}
            onChange={(e) => onManual(item.itemId, e.target.value)}
            aria-label="Manual worker"
          >
            <option value="">Manual…</option>
            {workers
              .filter((w) => w.active !== false)
              .map((w) => (
                <option key={w._id} value={w._id}>
                  {w.name} ({w.status})
                </option>
              ))}
          </select>
          <Button
            size="sm"
            variant="secondary"
            disabled={!manual[item.itemId] || busy === item.itemId}
            onClick={() => onAssignManual(item)}
          >
            Assign
          </Button>
        </div>
      )}
      {(item.boardStatus === "assigned" ||
        item.boardStatus === "distributed" ||
        item.boardStatus === "received") &&
        item.recommended &&
        item.recommended.staff._id !== item.assignment?.staff?._id && (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy === item.itemId}
            onClick={() => onAssign(item, item.recommended!, false)}
          >
            Reassign
          </Button>
        )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="ui-card px-4 py-3">
      <p className="ui-label">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular text-ink">{value}</p>
    </div>
  );
}

function StageFilter({
  current,
  onChange,
  label,
  value,
  count
}: {
  current: string;
  onChange: (v: ProductionStage | "ALL") => void;
  label: string;
  value: ProductionStage | "ALL";
  count: number;
}) {
  const active = current === value;
  return (
    <button
      type="button"
      onClick={() => onChange(value)}
      className={clsx(
        "rounded-control border px-3 py-1.5 text-xs font-medium capitalize",
        active ? "border-accent bg-accent-soft text-accent" : "border-line bg-surface text-ink-muted hover:text-ink"
      )}
    >
      {label} <span className="tabular">{count}</span>
    </button>
  );
}
