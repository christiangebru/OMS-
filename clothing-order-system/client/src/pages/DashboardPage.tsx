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
        setErr(e instanceof ApiError ? e.message : "Failed to load operations");
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
        <ErrorState message={err} />
        <Button type="button" variant="secondary" onClick={() => load()}>
          Retry
        </Button>
      </div>
    );
  }
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
        title={reception ? "Reception" : "Overview"}
        description={
          reception
            ? "Orders, due dates, and garments waiting on delivery."
            : "What is on the floor right now — waiting, in progress, overdue, ready."
        }
        actions={
          canWriteOrders(user?.role) ? (
            <Link to="/orders/new">
              <Button>New order</Button>
            </Link>
          ) : isManagerRole(user?.role) ? (
            <Link to="/production">
              <Button>Open floor</Button>
            </Link>
          ) : (
            <Link to="/scan">
              <Button>Open scanner</Button>
            </Link>
          )
        }
      />

      <section>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          <Metric label="In production" value={ops.today.inProduction} />
          <Metric label="Waiting assignment" value={ops.distribution.unassigned} />
          <Metric label="Being worked on" value={ops.distribution.inProgress} />
          <Metric label="Overdue" value={ops.today.overdue} tone={ops.today.overdue ? "urgent" : undefined} />
          <Metric label="Ready" value={ops.today.ready} />
          <Metric label="Orders in today" value={ops.today.orders} />
        </div>
      </section>

      {!reception && (
        <section className="grid gap-6 lg:grid-cols-2">
          <div className="ui-card p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-ink">Bottleneck</h2>
                {(() => {
                  const bottleneck = PRODUCTION_STAGES.map((s) => ({
                    stage: s,
                    waiting: ops.production[s]?.waiting || 0,
                    inProgress: ops.production[s]?.inProgress || 0
                  })).sort((a, b) => b.waiting + b.inProgress - (a.waiting + a.inProgress))[0];
                  return bottleneck && bottleneck.waiting + bottleneck.inProgress > 0 ? (
                    <p className="mt-2 text-sm text-ink">
                      <span className="font-semibold capitalize">{stageLabel(bottleneck.stage)}</span>
                      <span className="text-ink-muted">
                        {" "}
                        · {bottleneck.inProgress} in progress · {bottleneck.waiting} waiting
                      </span>
                    </p>
                  ) : (
                    <p className="mt-2 text-sm text-ink-muted">No stage is backed up.</p>
                  );
                })()}
              </div>
              {canSee(user?.role, "production") && (
                <Link to="/production" className="text-xs font-semibold text-accent hover:underline">
                  Open floor
                </Link>
              )}
            </div>
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

      {canSee(user?.role, "production") && (
        <section className="flex flex-wrap items-center justify-between gap-3 border border-line bg-surface px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-ink">Production floor</h2>
            <p className="mt-0.5 text-xs text-ink-muted">
              Garments sit in the stage they are waiting for or currently checked into.
            </p>
          </div>
          <Link to="/production">
            <Button variant="secondary">Open floor</Button>
          </Link>
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
                    {shortOrderId(u.orderId)} · {stageLabel(u.nextStage)}
                    {u.priority !== "NORMAL" ? ` · ${u.priority}` : ""}
                  </p>
                </div>
                <Link to={`/garments/${encodeURIComponent(u.itemId)}`} className="text-xs font-semibold text-accent">
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
          <div className="flex flex-wrap gap-2">
            <Link to="/production">
              <Button variant="secondary">Open floor</Button>
            </Link>
            <Link to="/scan">
              <Button size="lg">Open scanner</Button>
            </Link>
          </div>
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
                  to={`/garments/${encodeURIComponent(row.itemId)}`}
                  className="text-xs font-semibold text-accent hover:underline"
                >
                  Open garment
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
