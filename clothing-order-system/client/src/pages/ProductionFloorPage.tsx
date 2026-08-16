import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { apiJson, ApiError } from "@/lib/api";
import type { ProductionQueue, QueueItem } from "@/lib/types";
import { PRODUCTION_STAGES } from "@/lib/types";
import { boardStatusLabel, daysLabel, shortOrderId, stageLabel } from "@/lib/format";
import { PageHeader, ErrorState, Skeleton, Badge, EmptyState } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/context/AuthContext";
import { isManagerRole, isFloorRole } from "@/lib/roles";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";

export function ProductionFloorPage() {
  const { user } = useAuth();
  const manager = isManagerRole(user?.role);
  const [items, setItems] = useState<QueueItem[] | null>(null);
  const [visibleStages, setVisibleStages] = useState<string[]>(PRODUCTION_STAGES);
  const [err, setErr] = useState<string | null>(null);
  const hydrated = useRef(false);

  const load = useCallback(async () => {
    try {
      if (manager) {
        const data = await apiJson<ProductionQueue>("/api/production/queue?lite=1");
        setItems(data.items || []);
        setVisibleStages(PRODUCTION_STAGES);
      } else {
        const data = await apiJson<{ stages: string[]; items: QueueItem[] }>("/api/production/floor");
        setItems(data.items || []);
        setVisibleStages(data.stages?.length ? data.stages : PRODUCTION_STAGES);
      }
      hydrated.current = true;
      setErr(null);
    } catch (e) {
      if (!hydrated.current) setErr(e instanceof ApiError ? e.message : "Failed to load floor");
    }
  }, [manager]);

  useEffect(() => {
    load();
  }, [load]);
  useLiveRefresh(load, 15000);

  if (err && !items) return <ErrorState message={err} />;
  if (!items) return <Skeleton className="h-48" />;

  const columns = visibleStages.filter(
    (s) => items.some((i) => stageOf(i) === s) || !["RECEIVED", "DELIVERED"].includes(s) || manager
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Production floor"
        description="Garments sit in the stage they are waiting for or currently checked into."
        actions={
          <Link to="/scan">
            <Button size="lg">Open scanner</Button>
          </Link>
        }
      />

      {err && <ErrorState message={err} />}

      {items.length === 0 ? (
        <EmptyState title="No garments on the floor" body="New orders appear here once they enter production." />
      ) : (
        <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <div className="flex min-w-max gap-3 pb-2 xl:grid xl:min-w-0 xl:grid-cols-7">
            {columns.map((stage) => {
              const cards = items.filter((i) => stageOf(i) === stage);
              return (
                <section key={stage} className="w-[220px] shrink-0 xl:w-auto">
                  <div className="mb-2 flex items-baseline justify-between gap-2">
                    <h2 className="ui-label">{stageLabel(stage)}</h2>
                    <span className="text-xs tabular text-ink-muted">{cards.length}</span>
                  </div>
                  <ul className="space-y-2">
                    {cards.map((g) => (
                      <li key={g.itemId} className="border border-line bg-surface p-2.5">
                        <p className="truncate text-xs font-semibold text-ink">{g.clothingType}</p>
                        <p className="truncate text-[11px] text-ink-muted">{g.customer?.name || "—"}</p>
                        <p className="mt-0.5 font-mono text-[10px] text-ink-faint">{g.barcodeValue}</p>
                        <p className="text-[10px] text-ink-faint">{shortOrderId(g.orderId)}</p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1">
                          <Badge
                            tone={
                              g.overdue
                                ? "urgent"
                                : g.boardStatus === "in_progress"
                                  ? "progress"
                                  : g.boardStatus === "waiting"
                                    ? "warn"
                                    : "ok"
                            }
                          >
                            {boardStatusLabel(g.boardStatus)}
                          </Badge>
                        </div>
                        <p className="mt-1 truncate text-[11px] text-ink-muted">
                          {g.assignment?.staff?.name || "Unassigned"}
                          {g.overdue ? " · overdue" : ` · ${daysLabel(g.daysRemaining, g.overdue)}`}
                        </p>
                        <div className="mt-1.5 flex gap-2">
                          <Link
                            to={`/garments/${encodeURIComponent(g.itemId)}`}
                            className="text-[11px] font-semibold text-accent hover:underline"
                          >
                            Open
                          </Link>
                          <Link
                            to={`/scan?barcode=${encodeURIComponent(g.barcodeValue)}`}
                            className="text-[11px] font-semibold text-accent hover:underline"
                          >
                            Scan
                          </Link>
                        </div>
                      </li>
                    ))}
                    {cards.length === 0 && (
                      <li className="border border-dashed border-line px-2 py-6 text-center text-[11px] text-ink-faint">
                        Empty
                      </li>
                    )}
                  </ul>
                </section>
              );
            })}
          </div>
        </div>
      )}

      {isFloorRole(user?.role) && (
        <p className="text-xs text-ink-muted">Showing stages for {user?.role}.</p>
      )}
    </div>
  );
}

function stageOf(item: QueueItem) {
  return item.inProgress || item.boardStatus === "in_progress"
    ? item.openStage || item.currentStage || item.nextStage
    : item.nextStage;
}
