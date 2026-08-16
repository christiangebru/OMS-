import { useEffect, useState, useCallback, useRef } from "react";
import { Link } from "react-router-dom";
import { apiJson, ApiError } from "@/lib/api";
import type { DashboardOperations, QueueItem } from "@/lib/types";
import { PRODUCTION_STAGES } from "@/lib/types";
import { daysLabel, stageLabel, boardStatusLabel, shortOrderId } from "@/lib/format";
import { PageHeader, ErrorState, Skeleton, EmptyState } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { isFloorRole, isManagerRole, canWriteOrders, canSee } from "@/lib/roles";
import { useAuth } from "@/context/AuthContext";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";
import clsx from "clsx";

export function DashboardPage() {
  const { user } = useAuth();
  if (isFloorRole(user?.role)) return <FloorDashboard />;
  return <OfficeDashboard />;
}

function OfficeDashboard() {
  const { user } = useAuth();
  const [ops, setOps] = useState<DashboardOperations | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const hydrated = useRef(false);
  const reception = user?.role === "reception";

  const load = useCallback(async () => {
    try {
      const data = await apiJson<DashboardOperations>("/api/dashboard/operations");
      hydrated.current = true;
      setOps(data);
      setErr(null);
    } catch (e) {
      if (!hydrated.current) {
        const detail = e instanceof ApiError ? e.message : "Network error talking to the operations API";
        setErr(detail);
      }
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);
  useLiveRefresh(load, 20000);

  if (err && !ops) {
    return (
      <div className="space-y-4">
        <PageHeader title="Overview" description="Live production attention for today." />
        <ErrorState
          title="Operations API failed"
          message={`${err}. This is the backend /api/dashboard/operations response, not a missing screen.`}
          onRetry={() => load()}
        />
      </div>
    );
  }
  if (!ops) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-48" />
        <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-5">
          {Array.from({ length: 9 }).map((_, i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      </div>
    );
  }

  const bottleneck = PRODUCTION_STAGES.map((s) => ({
    stage: s,
    waiting: ops.production[s]?.waiting || 0,
    inProgress: ops.production[s]?.inProgress || 0
  })).sort((a, b) => b.waiting + b.inProgress - (a.waiting + a.inProgress))[0];

  return (
    <div className="space-y-8">
      <PageHeader
        title={reception ? "Reception" : "Overview"}
        description="What requires attention on the floor right now."
        actions={
          <div className="flex flex-wrap gap-2">
            {canSee(user?.role, "production") && (
              <Link to="/production">
                <Button variant="secondary">Floor</Button>
              </Link>
            )}
            {isManagerRole(user?.role) && (
              <Link to="/distribution">
                <Button variant="secondary">Distribution</Button>
              </Link>
            )}
            <Link to="/scan">
              <Button variant="secondary">Scanner</Button>
            </Link>
            {canWriteOrders(user?.role) && (
              <Link to="/orders/new">
                <Button>New order</Button>
              </Link>
            )}
          </div>
        }
      />

      <section className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
        <Metric label="In production" value={ops.today.inProduction} />
        <Metric label="Waiting assignment" value={ops.distribution.unassigned} />
        <Metric label="Assigned" value={ops.distribution.awaitingDistribution} />
        <Metric label="Handed over" value={ops.distribution.handedOver || 0} />
        <Metric label="Received" value={ops.distribution.received || 0} />
        <Metric label="In progress" value={ops.distribution.inProgress} />
        <Metric label="Overdue" value={ops.today.overdue} tone={ops.today.overdue ? "urgent" : undefined} />
        <Metric label="Ready" value={ops.today.ready} />
        <Metric label="Today's intake" value={ops.today.orders} />
      </section>

      {!reception && bottleneck && bottleneck.waiting + bottleneck.inProgress > 0 && (
        <p className="text-sm text-ink">
          Bottleneck: <span className="font-semibold capitalize">{stageLabel(bottleneck.stage)}</span>
          <span className="text-ink-muted">
            {" "}
            · {bottleneck.inProgress} in progress · {bottleneck.waiting} waiting
          </span>
        </p>
      )}

      <section className="grid gap-6 lg:grid-cols-2">
        <AttentionList
          title="Urgent"
          empty="Nothing overdue or due within two days."
          rows={ops.urgent.map((u) => ({
            key: u.itemId,
            title: `${u.customerName} · ${u.clothingType}`,
            meta: `${shortOrderId(u.orderId)} · ${stageLabel(u.nextStage)}`,
            href: `/garments/${encodeURIComponent(u.itemId)}`,
            aside: daysLabel(u.daysRemaining, u.overdue),
            warn: u.overdue
          }))}
        />
        <AttentionList
          title="Needs assignment"
          empty="No garments waiting for a worker."
          rows={(ops.needsAssignment || []).map((u) => ({
            key: u.itemId,
            title: `${u.customerName} · ${u.clothingType}`,
            meta: `${shortOrderId(u.orderId)} · ${stageLabel(u.nextStage)}`,
            href: `/garments/${encodeURIComponent(u.itemId)}`,
            aside: u.overdue ? "Overdue" : daysLabel(u.daysRemaining, u.overdue)
          }))}
        />
      </section>

      {(ops.recentlyReceived || []).length > 0 && (
        <AttentionList
          title="Recently received"
          empty=""
          rows={(ops.recentlyReceived || []).map((u) => ({
            key: u.itemId,
            title: `${u.customerName} · ${u.clothingType}`,
            meta: `${shortOrderId(u.orderId)} · ${u.workerName || "—"}`,
            href: `/scan?barcode=${encodeURIComponent(u.barcodeValue || "")}`,
            aside: "Check in"
          }))}
        />
      )}
    </div>
  );
}

function FloorDashboard() {
  const { user } = useAuth();
  const [items, setItems] = useState<QueueItem[] | null>(null);
  const [stages, setStages] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const hydrated = useRef(false);

  const load = useCallback(async () => {
    try {
      const data = await apiJson<{ stages: string[]; items: QueueItem[] }>("/api/production/floor");
      hydrated.current = true;
      setItems(data.items || []);
      setStages(data.stages || []);
      setErr(null);
    } catch (e) {
      if (!hydrated.current) {
        setErr(e instanceof ApiError ? e.message : "Network error loading /api/production/floor");
      }
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);
  useLiveRefresh(load, 15000);

  if (err && !items) {
    return <ErrorState title="Could not load your stage" message={err} onRetry={() => load()} />;
  }
  if (!items) return <Skeleton className="h-40" />;

  const dueToday = items.filter((i) => i.daysRemaining != null && i.daysRemaining < 1 && !i.overdue);
  const overdue = items.filter((i) => i.overdue);
  const inProgress = items.filter((i) => i.boardStatus === "in_progress");

  return (
    <div className="space-y-6">
      <PageHeader
        title="My stage"
        description={
          stages.length
            ? `Work in ${stages.map(stageLabel).join(" · ")}. Scan to check in or check out.`
            : "Assigned production for your role."
        }
        actions={
          <div className="flex flex-wrap gap-2">
            {canSee(user?.role, "production") && (
              <Link to="/production">
                <Button variant="secondary">Open floor</Button>
              </Link>
            )}
            <Link to="/scan">
              <Button size="lg">Open scanner</Button>
            </Link>
          </div>
        }
      />
      <div className="grid grid-cols-3 gap-2">
        <Metric label="In progress" value={inProgress.length} />
        <Metric label="Due today" value={dueToday.length} />
        <Metric label="Overdue" value={overdue.length} tone={overdue.length ? "urgent" : undefined} />
      </div>
      {items.length === 0 ? (
        <EmptyState title="No garments in your stage" body="When work is assigned here, it will show up on this list." />
      ) : (
        <ul className="divide-y divide-line overflow-hidden border border-line bg-surface">
          {items.map((row) => (
            <li key={row.itemId} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
              <div>
                <p className="text-sm font-medium text-ink">
                  {row.customer?.name || "—"} · {row.clothingType}
                </p>
                <p className="text-xs font-mono text-ink-muted">{row.barcodeValue}</p>
              </div>
              <div className="text-right">
                <p className="text-xs capitalize text-ink-muted">
                  {boardStatusLabel(row.boardStatus)} · {stageLabel(row.openStage || row.nextStage)}
                </p>
                <p className={clsx("text-xs font-semibold", row.overdue ? "text-red-700" : "text-ink-muted")}>
                  {daysLabel(row.daysRemaining, row.overdue)}
                </p>
                <Link
                  to={`/scan?barcode=${encodeURIComponent(row.barcodeValue)}`}
                  className="text-xs font-semibold text-accent hover:underline"
                >
                  Scan
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AttentionList({
  title,
  empty,
  rows
}: {
  title: string;
  empty: string;
  rows: Array<{ key: string; title: string; meta: string; href: string; aside?: string; warn?: boolean }>;
}) {
  return (
    <section className="overflow-hidden border border-line bg-surface">
      <div className="border-b border-line px-4 py-3">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
      </div>
      {rows.length === 0 ? (
        empty ? <p className="px-4 py-8 text-sm text-ink-muted">{empty}</p> : null
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((r) => (
            <li key={r.key}>
              <Link to={r.href} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-canvas">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink">{r.title}</p>
                  <p className="truncate text-xs text-ink-muted">{r.meta}</p>
                </div>
                {r.aside && (
                  <span className={clsx("shrink-0 text-xs font-semibold", r.warn ? "text-red-700" : "text-accent")}>
                    {r.aside}
                  </span>
                )}
              </Link>
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
  tone
}: {
  label: string;
  value: number;
  tone?: "urgent";
}) {
  return (
    <div className="border border-line bg-surface px-3 py-2.5">
      <p className="ui-label">{label}</p>
      <p className={clsx("mt-1 text-xl font-semibold tabular", tone === "urgent" ? "text-red-700" : "text-ink")}>
        {value}
      </p>
    </div>
  );
}
