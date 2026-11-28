import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { apiJson, ApiError } from "@/lib/api";
import type { ProductionQueue, QueueItem } from "@/lib/types";
import { PRODUCTION_STAGES } from "@/lib/types";
import { boardStatusLabel, daysLabel, stageLabel } from "@/lib/format";
import { PageHeader, ErrorState, Skeleton, Badge, EmptyState } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { FilterChips } from "@/components/ui/FilterChips";
import { useAuth } from "@/context/AuthContext";
import { isManagerRole, isFloorRole } from "@/lib/roles";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";
import clsx from "clsx";
import { byUrgency, groupBoard, groupStatus, itemCode, type BoardGroup } from "@/lib/boardGroups";

export function ProductionFloorPage() {
  const { user } = useAuth();
  const manager = isManagerRole(user?.role);
  const [items, setItems] = useState<QueueItem[] | null>(null);
  const [visibleStages, setVisibleStages] = useState<string[]>(PRODUCTION_STAGES);
  const [filter, setFilter] = useState("ALL");
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
      if (!hydrated.current) {
        setErr(e instanceof ApiError ? e.message : "Could not load the production floor API");
      }
    }
  }, [manager]);

  useEffect(() => {
    load();
  }, [load]);
  useLiveRefresh(load, 15000);

  if (err && !items) {
    return <ErrorState title="Production floor API failed" message={err} onRetry={() => load()} />;
  }
  if (!items) return <Skeleton className="h-48" />;

  const chips = [
    { id: "ALL", label: "All" },
    ...visibleStages
            .filter((s) => !["RECEIVED", "DELIVERED", "PACKAGING"].includes(s) || manager || s === "OFF_SITE")
      .map((s) => ({ id: s, label: stageLabel(s) })),
    { id: "overdue", label: "Overdue" }
  ];

  const groups = groupBoard(items).sort(byUrgency);
  const filtered =
    filter === "ALL"
      ? groups
      : filter === "overdue"
        ? groups.filter((g) => g.lead.overdue)
        : groups.filter((g) => g.stage === filter);

  const columns = (filter === "ALL" ? visibleStages : [filter === "overdue" ? null : filter].filter(Boolean) as string[])
    .filter((s) => filtered.some((g) => g.stage === s) || (filter === "ALL" && !["RECEIVED", "DELIVERED"].includes(s)) || filter === s);

  const showColumns = filter === "overdue" ? visibleStages.filter((s) => filtered.some((g) => g.stage === s)) : columns;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Production floor"
        description="Check in → working → check out → next stage. Scanning moves the garment."
        actions={
          <Link to="/scan">
            <Button size="lg">Open scanner</Button>
          </Link>
        }
      />

      <FilterChips options={chips} value={filter} onChange={setFilter} ariaLabel="Floor filters" />

      {items.length === 0 ? (
        <EmptyState title="No garments on the floor" body="New orders appear here once they enter production." />
      ) : filtered.length === 0 ? (
        <EmptyState title="Nothing in this filter" body="Try All, or open the scanner." />
      ) : (
        <>
          <div className="lg:hidden">
            <div className="space-y-2">
              {filtered.map((g) => (
                <FloorCard key={g.key} g={g} />
              ))}
            </div>
          </div>
          <div className="hidden -mx-4 overflow-x-auto px-4 lg:block">
            <div className="flex min-w-max gap-3 pb-2 xl:grid xl:min-w-0" style={{ gridTemplateColumns: `repeat(${Math.max(showColumns.length, 1)}, minmax(0, 1fr))` }}>
              {showColumns.map((stage) => {
                const cards = filtered.filter((g) => g.stage === stage);
                return (
                  <section key={stage} className="w-[220px] shrink-0 xl:w-auto">
                    <div className="mb-2 flex items-baseline justify-between gap-2">
                      <h2 className="ui-label">{stageLabel(stage)}</h2>
                      <span className="text-xs tabular text-ink-muted">{cards.length}</span>
                    </div>
                    <ul className="space-y-2">
                      {cards.map((g) => (
                        <li key={g.key}>
                          <FloorCard g={g} />
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
        </>
      )}

      {isFloorRole(user?.role) && (
        <p className="text-xs text-ink-muted">Showing stages for {user?.role}.</p>
      )}
    </div>
  );
}

const STATUS_TONE: Record<string, "urgent" | "warn" | "progress" | "ok"> = {
  off_site: "warn",
  to_send: "warn",
  waiting: "warn",
  in_progress: "progress"
};

function FloorCard({ g }: { g: BoardGroup }) {
  const lead = g.lead;
  const status = groupStatus(g);
  const workers = [...new Set(g.rows.map((r) => r.assignment?.staff?.name).filter(Boolean))];
  const trip = g.rows.find((r) => r.offSiteTrip)?.offSiteTrip;
  return (
    <article className={clsx("border border-line bg-surface p-2.5", lead.overdue && "border-red-200")}>
      <p className="truncate text-xs font-semibold text-ink">{g.title}</p>
      <p className="truncate text-[11px] text-ink-muted">{lead.customer?.name || "—"}</p>
      <p className="mt-0.5 font-mono text-[10px] text-ink-faint">{g.code}</p>
      {g.isParts && (
        <div className="mt-1.5">
          <ul className="flex flex-wrap gap-1" aria-label="Parts at this stage">
            {g.rows.map((r) => (
              <li key={r.itemId}>
                <Link
                  to={`/scan?barcode=${encodeURIComponent(itemCode(r))}`}
                  title={`${itemCode(r)} · ${boardStatusLabel(r.boardStatus)}`}
                  className={clsx(
                    "inline-block rounded-sm border px-1.5 py-0.5 font-mono text-[10px] font-semibold",
                    r.boardStatus === "in_progress"
                      ? "border-accent bg-accent-soft text-accent"
                      : "border-line text-ink-muted hover:text-ink"
                  )}
                >
                  {r.partCode}
                </Link>
              </li>
            ))}
          </ul>
          {g.partsTotal > 0 && (
            <p className="mt-1 text-[10px] text-ink-faint">
              {g.rows.length} of {g.partsTotal} parts here
              {g.partsReady ? ` · ${g.partsReady} ready to join` : ""}
            </p>
          )}
        </div>
      )}
      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        <Badge tone={lead.overdue ? "urgent" : STATUS_TONE[status] || "ok"}>{boardStatusLabel(status)}</Badge>
        {lead.priority && lead.priority !== "NORMAL" && <Badge tone="warn">{lead.priority}</Badge>}
      </div>
      <p className="mt-1 truncate text-[11px] text-ink-muted">
        {trip
          ? trip.handlerName
            ? `With ${trip.handlerName}`
            : "Away"
          : status === "to_send"
            ? "Not sent yet"
            : workers.join(", ") || "Unassigned"}
        {lead.overdue ? " · overdue" : ` · ${daysLabel(lead.daysRemaining, lead.overdue)}`}
      </p>
      <div className="mt-1.5 flex gap-3">
        <Link to={`/garments/${encodeURIComponent(lead.itemId)}`} className="text-[11px] font-semibold text-accent">
          Open
        </Link>
        {status === "to_send" ? (
          <Link to="/off-site" className="text-[11px] font-semibold text-accent">
            Send
          </Link>
        ) : (
          !g.isParts && (
            <Link to={`/scan?barcode=${encodeURIComponent(itemCode(lead))}`} className="text-[11px] font-semibold text-accent">
              Scan
            </Link>
          )
        )}
      </div>
    </article>
  );
}
