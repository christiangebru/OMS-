import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiJson, ApiError } from "@/lib/api";
import type { ProductionQueue, ProductionStage, QueueItem, StaffRanking } from "@/lib/types";
import { PRODUCTION_STAGES } from "@/lib/types";
import { daysLabel, formatDate, stageLabel } from "@/lib/format";
import { PageHeader, EmptyState, ErrorState, Badge, Skeleton } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import clsx from "clsx";

export function DistributionPage() {
  const [board, setBoard] = useState<ProductionQueue | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [stage, setStage] = useState<ProductionStage | "ALL">("ALL");
  const [busy, setBusy] = useState<string | null>(null);
  const [manual, setManual] = useState<Record<string, string>>({});

  async function load() {
    try {
      const data = await apiJson<ProductionQueue>("/api/production/queue");
      setBoard(data);
      setErr(null);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Failed to load distribution board");
    }
  }

  useEffect(() => {
    load();
  }, []);

  const items = (board?.items || []).filter((i) =>
    stage === "ALL" ? true : i.nextStage === stage || i.openStage === stage
  ) as Array<QueueItem & { openStage?: string | null }>;

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
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Waiting assignment" value={waiting} />
            <Stat label="Assigned" value={board.summary.itemsAssigned} />
            <Stat label="Handed over" value={board.summary.itemsDistributed} />
            <Stat label="In progress" value={board.summary.itemsInProgress} />
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
            <div className="overflow-hidden ui-card">
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
                          <p className="font-mono text-[11px] text-ink-faint">{item.barcodeValue}</p>
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
                              <ul className="mt-1 space-y-0.5 text-[11px]">
                                {(item.recommended.reasons || []).slice(0, 4).map((r) => (
                                  <li key={r.code + r.label} className={r.ok ? "text-accent" : "text-ink-muted"}>
                                    {r.ok ? "✓" : "–"} {r.label}
                                  </li>
                                ))}
                              </ul>
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
                            {item.boardStatus.replace("_", " ")}
                          </Badge>
                          {item.assignment?.staff && (
                            <p className="mt-1 text-xs text-ink-muted">{item.assignment.staff.name}</p>
                          )}
                        </td>
                        <td className="text-right">
                          <div className="flex flex-col items-end gap-1.5">
                            {item.boardStatus === "waiting" && item.recommended && (
                              <Button
                                size="sm"
                                disabled={busy === item.itemId}
                                onClick={() => assign(item, item.recommended!, true)}
                              >
                                Assign {item.recommended.staff.name.split(" ")[0]}
                              </Button>
                            )}
                            {item.boardStatus === "assigned" && (
                              <Button
                                size="sm"
                                disabled={busy === item.itemId}
                                onClick={() => distribute(item)}
                              >
                                Mark handed over
                              </Button>
                            )}
                            {item.boardStatus === "waiting" && (
                              <div className="flex gap-1">
                                <select
                                  className="rounded-control border border-line bg-surface px-2 py-1 text-xs"
                                  value={manual[item.itemId] || ""}
                                  onChange={(e) =>
                                    setManual((m) => ({ ...m, [item.itemId]: e.target.value }))
                                  }
                                >
                                  <option value="">Manual…</option>
                                  {(board.staff.workers || [])
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
                                  onClick={() => assignManual(item)}
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
                                  onClick={() => assign(item, item.recommended!, false)}
                                >
                                  Reassign
                                </Button>
                              )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
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
