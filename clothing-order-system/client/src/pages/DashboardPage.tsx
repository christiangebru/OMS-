import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  PieChart,
  Pie,
  Cell,
  Legend
} from "recharts";
import { apiJson, ApiError } from "@/lib/api";
import type { DashboardSummary } from "@/lib/types";

const COLORS = ["#3b82f6", "#22c55e", "#f97316", "#a855f7", "#64748b", "#eab308", "#06b6d4", "#ec4899"];

export function DashboardPage() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [notifications, setNotifications] = useState<{
    delayed: { orderId: string; customerName: string }[];
    lowProductionTime: { orderId: string; customerName: string; daysRemaining: number }[];
  } | null>(null);
  const [revenue, setRevenue] = useState<{ period: string; revenue: number }[]>([]);
  const [statusDist, setStatusDist] = useState<{ status: string; count: number }[]>([]);
  const [stageDist, setStageDist] = useState<{ stage: string; count: number }[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [s, n, r, st, sg] = await Promise.all([
          apiJson<DashboardSummary>("/api/dashboard/summary"),
          apiJson<{
            delayed: { orderId: string; customerName: string }[];
            lowProductionTime: { orderId: string; customerName: string; daysRemaining: number }[];
          }>("/api/dashboard/notifications"),
          apiJson<{ period: string; revenue: number }[]>("/api/analytics/revenue-trend"),
          apiJson<{ status: string; count: number }[]>("/api/analytics/status-distribution"),
          apiJson<{ stage: string; count: number }[]>("/api/analytics/stage-distribution")
        ]);
        if (!cancelled) {
          setSummary(s);
          setNotifications(n);
          setRevenue(r);
          setStatusDist(st);
          setStageDist(sg);
        }
      } catch (e) {
        if (!cancelled) setErr(e instanceof ApiError ? e.message : "Failed to load dashboard");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const pieData =
    statusDist.length > 0
      ? statusDist.map((s) => ({ name: s.status, value: s.count }))
      : summary?.byStatus
        ? Object.entries(summary.byStatus).map(([name, value]) => ({ name, value }))
        : [];

  const stagePie = stageDist.map((s) => ({ name: s.stage, value: s.count }));

  if (err) {
    return <p className="text-sm text-red-600 dark:text-red-400">{err}</p>;
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Dashboard</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Live production KPIs, revenue, and risk alerts.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total orders" value={summary?.totalOrders ?? "—"} />
        <StatCard label="Completed" value={summary?.completedOrders ?? "—"} accent="text-emerald-600" />
        <StatCard label="Delayed (active)" value={summary?.delayedOrders ?? "—"} accent="text-red-600" />
        <StatCard
          label="Revenue (all time)"
          value={summary != null ? `$${summary.totalRevenue.toLocaleString()}` : "—"}
          accent="text-brand-600"
        />
      </div>

      {summary?.mostOrderedClothingType && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-card dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Most ordered clothing type
          </p>
          <p className="mt-1 text-lg font-bold text-slate-900 dark:text-white">
            {summary.mostOrderedClothingType.type}{" "}
            <span className="text-sm font-normal text-slate-500 dark:text-slate-400">
              ({summary.mostOrderedClothingType.quantity} units)
            </span>
          </p>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-card dark:border-slate-800 dark:bg-slate-900">
          <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Revenue by month</h2>
          <div className="mt-4 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={revenue}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="period" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="revenue" fill="#2563eb" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-card dark:border-slate-800 dark:bg-slate-900">
          <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Orders by status</h2>
          <div className="mt-4 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieData}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={50}
                  outerRadius={80}
                  paddingAngle={3}
                >
                  {pieData.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Legend />
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-card dark:border-slate-800 dark:bg-slate-900">
          <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            Items by current stage
          </h2>
          <div className="mt-4 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={stagePie}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={50}
                  outerRadius={80}
                  paddingAngle={3}
                >
                  {stagePie.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Legend />
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-card dark:border-slate-800 dark:bg-slate-900">
          <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            Stage breakdown (counts)
          </h2>
          <div className="mt-4 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stageDist}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="stage" tick={{ fontSize: 10 }} interval={0} angle={-30} textAnchor="end" height={60} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="count" fill="#a855f7" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <AlertPanel
          title="Delayed orders"
          description="Active orders past estimated or required completion."
          items={notifications?.delayed.map((d) => ({
            id: d.orderId,
            text: `${d.orderId} — ${d.customerName}`
          }))}
          variant="danger"
        />
        <AlertPanel
          title="Low production time"
          description="Due within threshold — prioritize cutting/stitching."
          items={notifications?.lowProductionTime.map((d) => ({
            id: d.orderId,
            text: `${d.orderId} — ${d.customerName} (${d.daysRemaining}d left)`
          }))}
          variant="warn"
        />
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  accent
}: {
  label: string;
  value: string | number;
  accent?: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-card dark:border-slate-800 dark:bg-slate-900">
      <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</p>
      <p className={`mt-2 text-2xl font-bold text-slate-900 dark:text-white ${accent || ""}`}>{value}</p>
    </div>
  );
}

function AlertPanel({
  title,
  description,
  items,
  variant
}: {
  title: string;
  description: string;
  items?: { id: string; text: string }[];
  variant: "danger" | "warn";
}) {
  const border =
    variant === "danger"
      ? "border-red-200 dark:border-red-900/50"
      : "border-amber-200 dark:border-amber-900/50";
  return (
    <section
      className={`rounded-2xl border bg-white p-4 shadow-card dark:bg-slate-900 ${border}`}
      aria-label={title}
    >
      <h2 className="text-sm font-semibold text-slate-900 dark:text-white">{title}</h2>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{description}</p>
      <ul className="mt-3 max-h-48 space-y-2 overflow-auto text-sm">
        {!items?.length && <li className="text-slate-400">None — you&apos;re clear.</li>}
        {items?.map((i) => (
          <li key={i.id} className="rounded-lg bg-slate-50 px-2 py-1 dark:bg-slate-800">
            {i.text}
          </li>
        ))}
      </ul>
    </section>
  );
}
