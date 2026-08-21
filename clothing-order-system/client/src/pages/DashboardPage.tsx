import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { apiJson, ApiError, describeApiError } from "@/lib/api";
import type { DashboardBusiness, DashboardOperations, QueueItem } from "@/lib/types";
import { PRODUCTION_STAGES } from "@/lib/types";
import { daysLabel, formatDate, formatDuration, formatMoney, shortOrderId, stageLabel } from "@/lib/format";
import { ErrorState, Skeleton, EmptyState } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { isFloorRole, isManagerRole, canWriteOrders, canSee } from "@/lib/roles";
import { useAuth } from "@/context/AuthContext";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";
import clsx from "clsx";

const RANGES = [
  { id: "today", label: "Today" },
  { id: "week", label: "This week" },
  { id: "month", label: "This month" }
] as const;

const PIE_COLORS = ["#3E5C48", "#6B645C", "#C4A35A", "#8A9A84", "#B45309", "#9A9389"];

export function DashboardPage() {
  const { user } = useAuth();
  if (isFloorRole(user?.role)) return <FloorDashboard />;
  return <OfficeDashboard />;
}

function greeting(name?: string) {
  const h = new Date().getHours();
  const hi = h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  return `${hi}, ${name?.split(" ")[0] || "there"}`;
}

function OfficeDashboard() {
  const { user } = useAuth();
  const [range, setRange] = useState<(typeof RANGES)[number]["id"]>("month");
  const [ops, setOps] = useState<DashboardOperations | null>(null);
  const [opsErr, setOpsErr] = useState<string | null>(null);
  const [biz, setBiz] = useState<DashboardBusiness | null>(null);
  const [bizErr, setBizErr] = useState<string | null>(null);
  const opsHydrated = useRef(false);
  const bizHydrated = useRef(false);

  const loadOps = useCallback(async () => {
    try {
      const data = await apiJson<DashboardOperations>("/api/dashboard/operations");
      opsHydrated.current = true;
      setOps(data);
      setOpsErr(null);
    } catch (e) {
      if (!opsHydrated.current) {
        setOpsErr(describeApiError(e, "Operations API failed (/api/dashboard/operations)"));
      }
    }
  }, []);

  const loadBiz = useCallback(async () => {
    try {
      const data = await apiJson<DashboardBusiness>(`/api/dashboard/business?range=${range}`);
      bizHydrated.current = true;
      setBiz(data);
      setBizErr(null);
    } catch (e) {
      if (!bizHydrated.current) {
        setBizErr(describeApiError(e, "Business API failed (/api/dashboard/business)"));
      }
    }
  }, [range]);

  useEffect(() => {
    loadOps();
  }, [loadOps]);
  useEffect(() => {
    loadBiz();
  }, [loadBiz]);
  useLiveRefresh(loadOps, 20000);

  const bottleneck = useMemo(() => {
    if (!ops) return null;
    return PRODUCTION_STAGES.map((s) => ({
      stage: s,
      waiting: ops.production[s]?.waiting || 0,
      inProgress: ops.production[s]?.inProgress || 0,
      total: (ops.production[s]?.waiting || 0) + (ops.production[s]?.inProgress || 0)
    })).sort((a, b) => b.total - a.total)[0];
  }, [ops]);

  const pipeline = PRODUCTION_STAGES.filter((s) => s !== "DELIVERED").map((s) => ({
    stage: stageLabel(s),
    count: (ops?.production[s]?.total || 0) || (ops?.production[s]?.inProgress || 0) + (ops?.production[s]?.waiting || 0)
  }));
  const maxPipe = Math.max(1, ...pipeline.map((p) => p.count));

  return (
    <div className="space-y-8">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-muted">
            {biz?.organization || "Atelier OMS"}
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink">{greeting(user?.name)}</h1>
          <p className="mt-1 text-sm text-ink-muted">Business performance and production attention in one place.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {RANGES.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setRange(r.id)}
              className={clsx(
                "min-h-12 rounded-control px-3 text-sm sm:min-h-10",
                range === r.id ? "bg-accent text-white" : "bg-surface text-ink-muted ring-1 ring-line hover:text-ink"
              )}
            >
              {r.label}
            </button>
          ))}
          {canWriteOrders(user?.role) && (
            <Link to="/orders/new">
              <Button>Create order</Button>
            </Link>
          )}
          <Link to="/scan">
            <Button variant="secondary">Receive order</Button>
          </Link>
          <Link to="/scan">
            <Button variant="secondary">Scan</Button>
          </Link>
          {canSee(user?.role, "labels") && (
            <Link to="/labels">
              <Button variant="secondary">Print labels</Button>
            </Link>
          )}
        </div>
      </header>

      <section>
        <h2 className="ui-label mb-2">Business</h2>
        {bizErr && !biz ? (
          <ErrorState title="Business metrics unavailable" message={bizErr} onRetry={loadBiz} />
        ) : !biz ? (
          <div className="grid grid-cols-2 gap-2 xl:grid-cols-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-20" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
            <Metric label="Revenue / sales" value={formatMoney(biz.kpis.revenue)} />
            <Metric label="Orders" value={biz.kpis.orders} />
            <Metric label="New customers" value={biz.kpis.customers} />
            <Metric label="Avg order value" value={formatMoney(biz.kpis.averageOrderValue)} />
            <Metric label="Outstanding" value={formatMoney(biz.kpis.outstanding)} tone={biz.kpis.outstanding ? "urgent" : undefined} />
            <Metric label="Ready orders" value={biz.kpis.ready} />
            <Metric
              label="Delivered (period)"
              value={biz.statusDistribution.find((s) => String(s.status).toLowerCase() === "delivered")?.count ?? "—"}
            />
          </div>
        )}
      </section>

      <section>
        <h2 className="ui-label mb-2">Production</h2>
        {opsErr && !ops ? (
          <ErrorState title="Production metrics unavailable" message={opsErr} onRetry={loadOps} />
        ) : !ops ? (
          <div className="grid grid-cols-2 gap-2 xl:grid-cols-7">
            {Array.from({ length: 7 }).map((_, i) => (
              <Skeleton key={i} className="h-16" />
            ))}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
              <Metric label="In production" value={ops.today.inProduction} />
              <Metric label="Waiting assignment" value={ops.distribution.unassigned} />
              <Metric label="Received" value={ops.distribution.received || 0} />
              <Metric label="In progress" value={ops.distribution.inProgress} />
              <Metric label="Overdue" value={ops.today.overdue} tone={ops.today.overdue ? "urgent" : undefined} />
              <Metric label="Ready" value={ops.today.ready} />
              <Metric label="Today's intake" value={ops.today.orders} />
            </div>
            {bottleneck && bottleneck.total > 0 && (
              <p className="mt-3 text-sm text-ink">
                Bottleneck: <span className="font-semibold capitalize">{stageLabel(bottleneck.stage)}</span>
                <span className="text-ink-muted">
                  {" "}
                  · {bottleneck.inProgress} in progress · {bottleneck.waiting} waiting
                </span>
              </p>
            )}
          </>
        )}
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <ChartCard title="Sales / revenue trend" error={bizErr} empty={!biz?.trend.length} emptyText="No sales in this period.">
          {biz && biz.trend.length > 0 && (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={biz.trend}>
                <CartesianGrid stroke="#E4DDD2" vertical={false} />
                <XAxis dataKey="period" tick={{ fontSize: 11, fill: "#6B645C" }} />
                <YAxis tick={{ fontSize: 11, fill: "#6B645C" }} />
                <Tooltip />
                <Line type="monotone" dataKey="revenue" stroke="#3E5C48" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
        <ChartCard title="Order volume" error={bizErr} empty={!biz?.trend.length} emptyText="No orders in this period.">
          {biz && biz.trend.length > 0 && (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={biz.trend}>
                <CartesianGrid stroke="#E4DDD2" vertical={false} />
                <XAxis dataKey="period" tick={{ fontSize: 11, fill: "#6B645C" }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#6B645C" }} />
                <Tooltip />
                <Bar dataKey="orders" fill="#3E5C48" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
        <ChartCard
          title="Order status"
          error={bizErr}
          empty={!biz?.statusDistribution.length}
          emptyText="No status mix to show."
        >
          {biz && biz.statusDistribution.length > 0 && (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={biz.statusDistribution} dataKey="count" nameKey="status" innerRadius={48} outerRadius={78}>
                  {biz.statusDistribution.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
        <ChartCard title="Top customers" error={bizErr} empty={!biz?.topCustomers.length} emptyText="No customer sales in this period.">
          {biz && biz.topCustomers.length > 0 && (
            <ul className="divide-y divide-line">
              {biz.topCustomers.map((c) => (
                <li key={c.customerId} className="flex items-center justify-between py-2 text-sm">
                  <span className="truncate text-ink">{c.name}</span>
                  <span className="tabular text-ink-muted">
                    {formatMoney(c.revenue)} · {c.orders}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </ChartCard>
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="border border-line bg-surface p-4">
          <h2 className="text-sm font-semibold text-ink">Production pipeline</h2>
          <p className="mt-0.5 text-xs text-ink-muted">Items waiting or in progress at each stage.</p>
          {!ops ? (
            <Skeleton className="mt-4 h-40" />
          ) : (
            <ul className="mt-4 space-y-2">
              {pipeline.map((p) => (
                <li key={p.stage} className="flex items-center gap-3">
                  <span className="w-24 shrink-0 text-xs capitalize text-ink">{p.stage}</span>
                  <div className="h-2 flex-1 bg-canvas">
                    <div className="h-2 bg-accent" style={{ width: `${(p.count / maxPipe) * 100}%` }} />
                  </div>
                  <span className="w-8 text-right text-xs tabular text-ink-muted">{p.count}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="border border-line bg-surface p-4">
          <h2 className="text-sm font-semibold text-ink">Worker queues</h2>
          <p className="mt-0.5 text-xs text-ink-muted">Assigned work stacked on each worker. Assigned is not busy.</p>
          {!ops?.workerQueues?.length ? (
            <p className="mt-6 text-sm text-ink-muted">No active worker queues.</p>
          ) : (
            <ul className="mt-3 divide-y divide-line">
              {ops.workerQueues
                .filter((w) => w.queued > 0)
                .sort((a, b) => b.queued - a.queued)
                .slice(0, 8)
                .map((w) => (
                  <li key={w._id} className="flex items-center justify-between py-2 text-sm">
                    <Link to={`/staff/${w._id}`} className="font-medium text-ink hover:text-accent">
                      {w.name}
                    </Link>
                    <span className="text-xs text-ink-muted">{w.queued} queued</span>
                  </li>
                ))}
            </ul>
          )}
          {biz && (
            <p className="mt-4 text-xs text-ink-muted">
              Completed stages today: {biz.completedToday}
              {biz.avgStageTurnaroundMs != null ? ` · avg ${formatDuration(biz.avgStageTurnaroundMs)}` : ""}
            </p>
          )}
        </div>
      </section>

      {ops && (
        <section className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          <AttentionList
            title="Overdue orders"
            empty="Nothing overdue."
            rows={ops.urgent
              .filter((u) => u.overdue)
              .map((u) => ({
                key: u.itemId,
                title: `${u.customerName} · ${u.clothingType}`,
                meta: `${shortOrderId(u.orderId)} · ${stageLabel(u.nextStage)}`,
                href: `/garments/${encodeURIComponent(u.itemId)}`,
                aside: daysLabel(u.daysRemaining, true),
                warn: true
              }))}
          />
          <AttentionList
            title="Due today"
            empty="Nothing due today."
            rows={ops.urgent
              .filter((u) => !u.overdue && u.daysRemaining != null && u.daysRemaining < 1)
              .map((u) => ({
                key: u.itemId,
                title: `${u.customerName} · ${u.clothingType}`,
                meta: `${shortOrderId(u.orderId)} · ${stageLabel(u.nextStage)}`,
                href: `/garments/${encodeURIComponent(u.itemId)}`,
                aside: "Due today"
              }))}
          />
          <AttentionList
            title="Waiting assignment"
            empty="No garments waiting for a worker."
            rows={(ops.needsAssignment || []).map((u) => ({
              key: u.itemId,
              title: `${u.customerName} · ${u.clothingType}`,
              meta: `${shortOrderId(u.orderId)} · ${stageLabel(u.nextStage)}`,
              href: `/distribution`,
              aside: u.overdue ? "Overdue" : daysLabel(u.daysRemaining, u.overdue)
            }))}
          />
          <AttentionList
            title="Waiting at workstation"
            empty="Nothing waiting to be scanned in."
            rows={(ops.waitingAtWorkstation || []).map((u) => ({
              key: u.itemId,
              title: `${u.customerName} · ${u.clothingType}`,
              meta: `${shortOrderId(u.orderId)} · ${u.workerName || "—"}`,
              href: `/scan?barcode=${encodeURIComponent(u.barcodeValue || "")}`,
              aside: "Scan in"
            }))}
          />
          <AttentionList
            title="Recently received"
            empty="No recent handovers."
            rows={(ops.recentlyReceived || []).map((u) => ({
              key: u.itemId,
              title: `${u.customerName} · ${u.clothingType}`,
              meta: `${shortOrderId(u.orderId)} · ${u.workerName || "—"}`,
              href: `/scan?barcode=${encodeURIComponent(u.barcodeValue || "")}`,
              aside: "Check in"
            }))}
          />
        </section>
      )}

      <section className="border border-line bg-surface">
        <div className="border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold text-ink">Recent activity</h2>
        </div>
        {bizErr && !biz ? (
          <p className="px-4 py-6 text-sm text-ink-muted">Activity unavailable.</p>
        ) : !biz ? (
          <div className="p-4">
            <Skeleton className="h-24" />
          </div>
        ) : biz.activity.length === 0 ? (
          <p className="px-4 py-8 text-sm text-ink-muted">No production events yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {biz.activity.map((a) => (
              <li key={a._id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium capitalize text-ink">{a.action.replace(/_/g, " ")}</p>
                  <p className="truncate text-xs text-ink-muted">
                    {shortOrderId(a.orderId)} {a.notes ? `· ${a.notes}` : ""} {a.userName ? `· ${a.userName}` : ""}
                  </p>
                </div>
                <span className="shrink-0 text-xs text-ink-faint">{formatDate(a.createdAt, true)}</span>
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
      <div>
        <h1 className="text-2xl font-semibold text-ink">My stage</h1>
        <p className="mt-1 text-sm text-ink-muted">
          {stages.length
            ? `Work in ${stages.map(stageLabel).join(" · ")}. Scan to check in or check out.`
            : "Assigned production for your role."}
        </p>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Metric label="In progress" value={inProgress.length} />
        <Metric label="Due today" value={dueToday.length} />
        <Metric label="Overdue" value={overdue.length} tone={overdue.length ? "urgent" : undefined} />
      </div>
      <Link to="/scan">
        <Button size="lg">Open scanner</Button>
      </Link>
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
              <Link to={`/scan?barcode=${encodeURIComponent(row.barcodeValue)}`} className="text-xs font-semibold text-accent">
                Scan
              </Link>
            </li>
          ))}
        </ul>
      )}
      {isManagerRole(user?.role) ? null : null}
    </div>
  );
}

function ChartCard({
  title,
  children,
  error,
  empty,
  emptyText
}: {
  title: string;
  children?: React.ReactNode;
  error?: string | null;
  empty?: boolean;
  emptyText: string;
}) {
  return (
    <div className="border border-line bg-surface p-4">
      <h2 className="text-sm font-semibold text-ink">{title}</h2>
      {error && empty ? (
        <p className="mt-8 text-sm text-ink-muted">{error}</p>
      ) : empty ? (
        <p className="mt-8 text-sm text-ink-muted">{emptyText}</p>
      ) : (
        <div className="mt-3">{children}</div>
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
        <p className="px-4 py-8 text-sm text-ink-muted">{empty}</p>
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
  value: number | string;
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
