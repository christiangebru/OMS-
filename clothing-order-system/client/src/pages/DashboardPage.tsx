import { useEffect, useState, useCallback, useRef } from "react";
import { Link } from "react-router-dom";
import { apiJson, ApiError } from "@/lib/api";
import type { DashboardOperations, QueueItem } from "@/lib/types";
import { PRODUCTION_STAGES } from "@/lib/types";
import { daysLabel, stageLabel, boardStatusLabel } from "@/lib/format";
import { PageHeader, ErrorState, Skeleton, EmptyState, Badge } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { isFloorRole, isManagerRole, canWriteOrders } from "@/lib/roles";
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
      if (!hydrated.current) setErr(e instanceof ApiError ? e.message : "Failed to load operations");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);
  useLiveRefresh(load, 20000);

  if (err) return <ErrorState message={err} />;
  if (!ops) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-48" />
        <div className="grid gap-3 sm:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title={reception ? "Reception" : "Today"}
        description={
          reception
            ? "Orders, due dates, and customers waiting on delivery."
            : "What needs attention on the floor right now."
        }
        actions={
          canWriteOrders(user?.role) ? (
            <Link to="/orders/new">
              <Button>New order</Button>
            </Link>
          ) : isManagerRole(user?.role) ? (
            <Link to="/distribution">
              <Button>Open distribution</Button>
            </Link>
          ) : (
            <Link to="/scan">
              <Button>Open scanner</Button>
            </Link>
          )
        }
      />

      <section>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <Metric label="Orders in today" value={ops.today.orders} />
          <Metric label="Due today" value={ops.today.dueToday} />
          <Metric label="Overdue" value={ops.today.overdue} tone={ops.today.overdue ? "urgent" : undefined} />
          <Metric label="In production" value={ops.today.inProduction} />
          <Metric label="Ready" value={ops.today.ready} />
        </div>
      </section>

      {!reception && (
        <section className="grid gap-6 lg:grid-cols-2">
          <div className="ui-card p-5">
            <h2 className="text-sm font-semibold text-ink">Production</h2>
            {(() => {
              const bottleneck = PRODUCTION_STAGES.map((s) => ({
                stage: s,
                waiting: ops.production[s]?.waiting || 0
              })).sort((a, b) => b.waiting - a.waiting)[0];
              return bottleneck && bottleneck.waiting > 0 ? (
                <p className="mt-2 text-xs text-ink-muted">
                  Bottleneck: <span className="font-semibold capitalize text-ink">{stageLabel(bottleneck.stage)}</span>{" "}
                  ({bottleneck.waiting} waiting)
                </p>
              ) : null;
            })()}
            <ul className="mt-4 divide-y divide-line">
              {PRODUCTION_STAGES.filter(
                (s) => !["RECEIVED", "DELIVERED"].includes(s) || (ops.production[s]?.total || 0) > 0
              ).map((stage) => {
                const row = ops.production[stage];
                if (!row) return null;
                return (
                  <li key={stage} className="flex items-center justify-between py-2.5 text-sm">
                    <span className="capitalize text-ink">{stageLabel(stage)}</span>
                    <span className="tabular text-ink-muted">
                      {row.inProgress} in progress · {row.waiting} waiting
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="ui-card p-5">
            <h2 className="text-sm font-semibold text-ink">Distribution & staff</h2>
            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <Pair label="Unassigned" value={ops.distribution.unassigned} />
              <Pair label="Awaiting handover" value={ops.distribution.awaitingDistribution} />
              <Pair label="Handed over" value={ops.distribution.handedOver || 0} />
              <Pair label="Received" value={ops.distribution.received || 0} />
              <Pair label="Checked in" value={ops.distribution.inProgress} />
              <Pair label="Available staff" value={ops.staff.available} />
            </dl>
          </div>
        </section>
      )}

      {!reception && ops.floor && ops.floor.length > 0 && (
        <section>
          <div className="mb-3 flex items-end justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-ink">Floor presence</h2>
              <p className="text-xs text-ink-muted">
                Assigned is not the same as handed over, received, or checked in.
              </p>
            </div>
            <Link to="/distribution" className="text-xs font-semibold text-accent hover:underline">
              Open distribution
            </Link>
          </div>
          <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
            <div className="flex min-w-max gap-3 pb-2 lg:grid lg:min-w-0 lg:grid-cols-4 xl:grid-cols-7">
              {PRODUCTION_STAGES.map((stage) => {
                const cards = (ops.floor || []).filter((g) => g.stage === stage);
                if (!cards.length && ["RECEIVED", "DELIVERED"].includes(stage)) return null;
                return (
                  <div key={stage} className="w-[220px] shrink-0 lg:w-auto">
                    <p className="ui-label">{stageLabel(stage)}</p>
                    <p className="mt-0.5 text-xs tabular text-ink-muted">{cards.length}</p>
                    <ul className="mt-2 space-y-2">
                      {cards.slice(0, 6).map((g) => (
                        <li key={g.itemId} className="ui-card p-2.5">
                          <p className="truncate text-xs font-medium text-ink">
                            {g.customerName} · {g.clothingType}
                          </p>
                          <div className="mt-1 flex flex-wrap items-center gap-1">
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
                            {g.workerName || "Unassigned"}
                            {g.overdue ? " · overdue" : ""}
                          </p>
                          {g.barcodeValue && (
                            <Link
                              to={`/scan?barcode=${encodeURIComponent(g.barcodeValue)}`}
                              className="mt-1 inline-block text-[11px] font-semibold text-accent"
                            >
                              Scan
                            </Link>
                          )}
                        </li>
                      ))}
                      {cards.length > 6 && (
                        <li className="text-[11px] text-ink-faint">+{cards.length - 6} more</li>
                      )}
                    </ul>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      <section className="ui-card overflow-hidden">
        <div className="border-b border-line px-5 py-3">
          <h2 className="text-sm font-semibold text-ink">{reception ? "Upcoming / overdue" : "Urgent"}</h2>
          <p className="text-xs text-ink-muted">Overdue or due within two days.</p>
        </div>
        {ops.urgent.length === 0 ? (
          <p className="px-5 py-8 text-sm text-ink-muted">Nothing urgent.</p>
        ) : (
          <ul className="divide-y divide-line">
            {ops.urgent.map((u) => (
              <li key={u.itemId} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                <div>
                  <p className="font-medium text-ink">
                    {u.customerName} · {u.clothingType}
                  </p>
                  <p className="text-xs capitalize text-ink-muted">
                    {u.orderId} · {stageLabel(u.nextStage)}
                    {u.priority !== "NORMAL" ? ` · ${u.priority}` : ""}
                  </p>
                </div>
                <Link to={`/orders/${encodeURIComponent(u.orderId)}`} className="text-xs font-semibold text-accent">
                  {daysLabel(u.daysRemaining, u.overdue)}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
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
      if (!hydrated.current) setErr(e instanceof ApiError ? e.message : "Failed to load work");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);
  useLiveRefresh(load, 15000);

  if (err) return <ErrorState message={err} />;
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
            ? `Work waiting in ${stages.map(stageLabel).join(" · ")}.`
            : "Assigned production for your role."
        }
        actions={
          <Link to="/scan">
            <Button size="lg">Open scanner</Button>
          </Link>
        }
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <Metric label="In progress" value={inProgress.length} />
        <Metric label="Due today" value={dueToday.length} />
        <Metric label="Overdue" value={overdue.length} tone={overdue.length ? "urgent" : undefined} />
      </div>
      {items.length === 0 ? (
        <EmptyState title="No garments in your stage" body="When work is assigned here, it will show up on this list." />
      ) : (
        <ul className="ui-card divide-y divide-line overflow-hidden">
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
      <p className="text-xs text-ink-muted">Signed in as {user?.name} · {user?.role}</p>
    </div>
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
    <div className="ui-card px-4 py-3">
      <p className="ui-label">{label}</p>
      <p className={clsx("mt-1 text-2xl font-semibold tabular", tone === "urgent" ? "text-red-700" : "text-ink")}>
        {value}
      </p>
    </div>
  );
}

function Pair({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className="rounded-lg bg-canvas px-3 py-2">
      <p className="text-[11px] text-ink-muted">{label}</p>
      <p className={clsx("text-lg font-semibold tabular", warn && "text-red-700")}>{value}</p>
    </div>
  );
}
