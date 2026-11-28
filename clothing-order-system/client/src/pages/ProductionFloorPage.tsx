import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { apiJson, ApiError } from "@/lib/api";
import type { ProductionQueue, QueueItem } from "@/lib/types";
import { daysLabel } from "@/lib/format";
import { PageHeader, ErrorState, Skeleton, EmptyState } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/context/AuthContext";
import { isManagerRole } from "@/lib/roles";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";
import { byUrgency, groupBoard, itemCode, placeLabel, PLACES, workerOf, type BoardGroup } from "@/lib/boardGroups";
import clsx from "clsx";

/**
 * Where every garment is right now. One column per place; tap a card to open
 * it in the scanner, where its next step is one button.
 */
export function ProductionFloorPage() {
  const { user } = useAuth();
  const manager = isManagerRole(user?.role);
  const [items, setItems] = useState<QueueItem[] | null>(null);
  const [roleStages, setRoleStages] = useState<string[] | null>(null);
  const [lateOnly, setLateOnly] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const hydrated = useRef(false);

  const load = useCallback(async () => {
    try {
      if (manager) {
        const data = await apiJson<ProductionQueue>("/api/production/queue?lite=1");
        setItems(data.items || []);
        setRoleStages(null);
      } else {
        const data = await apiJson<{ stages: string[]; items: QueueItem[] }>("/api/production/floor");
        setItems(data.items || []);
        setRoleStages(data.stages?.length ? data.stages : null);
      }
      hydrated.current = true;
      setErr(null);
    } catch (e) {
      if (!hydrated.current) setErr(e instanceof ApiError ? e.message : "Could not load the floor");
    }
  }, [manager]);

  useEffect(() => {
    load();
  }, [load]);
  useLiveRefresh(load, 15000);

  if (err && !items) return <ErrorState title="Floor failed to load" message={err} onRetry={() => load()} />;
  if (!items) return <Skeleton className="h-48" />;

  const all = groupBoard(items);
  const groups = all.filter((g) => !lateOnly || g.lead.overdue).sort(byUrgency);
  const places = roleStages ? PLACES.filter((p) => roleStages.includes(p)) : PLACES;
  const lateCount = all.filter((g) => g.lead.overdue).length;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Floor"
        description="Where every garment is. Tap one to move it."
        actions={
          <Link to="/scan">
            <Button size="lg">Scan</Button>
          </Link>
        }
      />

      {lateCount > 0 && (
        <button
          type="button"
          onClick={() => setLateOnly((v) => !v)}
          aria-pressed={lateOnly}
          className={clsx(
            "min-h-9 rounded-control border px-3 text-xs font-semibold",
            lateOnly ? "border-red-300 bg-red-50 text-red-800" : "border-line bg-surface text-ink-muted"
          )}
        >
          {lateOnly ? "Showing late only · show all" : `${lateCount} late`}
        </button>
      )}

      {groups.length === 0 ? (
        <EmptyState title="Nothing in production" body="New orders appear here once they are created." />
      ) : (
        <div className="-mx-4 overflow-x-auto px-4 pb-2">
          <div
            className="flex min-w-max gap-3 lg:grid lg:min-w-0"
            style={{ gridTemplateColumns: `repeat(${places.length}, minmax(0, 1fr))` }}
          >
            {places.map((place) => {
              const cards = groups.filter((g) => g.place === place);
              return (
                <section key={place} className="w-[200px] shrink-0 lg:w-auto">
                  <div className="mb-2 flex items-baseline justify-between gap-2 border-b border-line pb-1">
                    <h2 className="text-xs font-semibold text-ink">{placeLabel(place)}</h2>
                    <span className="text-xs tabular text-ink-muted">{cards.length}</span>
                  </div>
                  <ul className="space-y-2">
                    {cards.map((g) => (
                      <li key={g.key}>
                        <FloorCard g={g} />
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function FloorCard({ g }: { g: BoardGroup }) {
  const lead = g.lead;
  const trip = g.rows.find((r) => r.offSiteTrip)?.offSiteTrip;
  const who = trip ? trip.handlerName || "Outside" : workerOf(g);
  const target = g.isParts ? itemCode(g.rows[0]) : g.code;
  return (
    <Link
      to={`/scan?barcode=${encodeURIComponent(target)}`}
      className={clsx(
        "block border bg-surface p-2.5 hover:border-accent",
        lead.overdue ? "border-red-300" : "border-line"
      )}
    >
      <div className="flex items-start justify-between gap-1">
        <p className="truncate text-sm font-semibold text-ink">{lead.customer?.name || "—"}</p>
        {lead.priority && lead.priority !== "NORMAL" && (
          <span className="shrink-0 text-[10px] font-bold text-amber-800">{lead.priority}</span>
        )}
      </div>
      <p className="truncate text-[11px] text-ink-muted">{g.title}</p>
      <p className="mt-0.5 font-mono text-[10px] text-ink-faint">
        {g.code}
        {g.isParts && <span className="ml-1 font-semibold text-ink-muted">· {g.rows.map((r) => r.partCode).join(" ")}</span>}
      </p>
      <p className={clsx("mt-1 text-[11px]", lead.overdue ? "font-semibold text-red-700" : "text-ink-muted")}>
        {who ? `${who} · ` : ""}
        {daysLabel(lead.daysRemaining, lead.overdue)}
      </p>
    </Link>
  );
}
