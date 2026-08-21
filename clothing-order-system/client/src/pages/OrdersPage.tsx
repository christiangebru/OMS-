import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiJson, describeApiError } from "@/lib/api";
import type { Order, OrderGroup } from "@/lib/types";
import { formatDate, formatMoney, shortOrderId } from "@/lib/format";
import { PageHeader, EmptyState, ErrorState, Badge } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/context/AuthContext";
import { canWriteOrders } from "@/lib/roles";
import { FilterChips } from "@/components/ui/FilterChips";
import clsx from "clsx";

const LANES = [
  { id: "all", label: "All" },
  { id: "active", label: "Active" },
  { id: "waiting", label: "Waiting" },
  { id: "in_production", label: "In production" },
  { id: "ready", label: "Ready" },
  { id: "delivered", label: "Delivered" },
  { id: "overdue", label: "Overdue" },
  { id: "priority", label: "Priority" }
] as const;
type Lane = (typeof LANES)[number]["id"];

export function OrdersPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const canCreate = canWriteOrders(user?.role);
  const [orders, setOrders] = useState<Order[]>([]);
  const [groups, setGroups] = useState<OrderGroup[]>([]);
  const [q, setQ] = useState("");
  const [lane, setLane] = useState<Lane>("active");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const qs = q.trim() ? `?q=${encodeURIComponent(q.trim())}` : "";
      try {
        const data = await apiJson<Order[]>(`/api/orders${qs}`);
        if (!cancelled) {
          setOrders(data);
          setErr(null);
        }
      } catch (e) {
        if (!cancelled) setErr(describeApiError(e, "Failed to load orders"));
      }
      try {
        const groupData = await apiJson<OrderGroup[]>(`/api/order-groups${qs}`);
        if (!cancelled) setGroups(groupData);
      } catch {
        if (!cancelled) setGroups([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [q]);

  const groupedIds = useMemo(() => new Set(orders.filter((o) => o.groupId).map((o) => o.groupId as string)), [orders]);

  const visibleOrders = useMemo(() => {
    return orders.filter((o) => {
      if (lane === "active") return o.productionStatus !== "delivered";
      if (lane === "waiting") return o.productionStatus === "pending";
      if (lane === "in_production") return ["cutting", "stitching", "finishing"].includes(o.productionStatus);
      if (lane === "ready") return o.productionStatus === "completed";
      if (lane === "delivered") return o.productionStatus === "delivered";
      if (lane === "overdue") {
        return (
          new Date(o.requiredCompletionDate).getTime() < Date.now() &&
          !["completed", "delivered"].includes(o.productionStatus)
        );
      }
      if (lane === "priority") return o.priority === "RUSH" || o.priority === "VIP";
      return true;
    });
  }, [orders, lane]);

  const ungrouped = visibleOrders.filter((o) => !o.groupId);
  const groupsOnPage = groups.filter((g) => groupedIds.has(g._id) || visibleOrders.some((o) => o.groupId === g._id));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Orders"
        description="Individual orders and event groups in one list."
        actions={
          canCreate ? (
            <Link to="/orders/new">
              <Button>New order</Button>
            </Link>
          ) : undefined
        }
      />

      <input
        id="search-q"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Customer, ORD-1042, group name…"
        className="ui-input max-w-md"
        aria-label="Search orders"
      />
      <FilterChips options={[...LANES]} value={lane} onChange={setLane} ariaLabel="Order filters" />

      {err && <ErrorState title="Could not load orders" message={err} />}

      {!loading && !ungrouped.length && !groupsOnPage.length && (
        <EmptyState
          title="No orders match"
          body="Try clearing filters, or create a new order."
          action={
            canCreate ? (
              <Link to="/orders/new">
                <Button>New order</Button>
              </Link>
            ) : undefined
          }
        />
      )}

      <ul className="space-y-3">
        {groupsOnPage.map((g) => {
          const members = visibleOrders.filter((o) => o.groupId === g._id);
          const open = expanded[g._id];
          return (
            <li key={g._id} className="border border-line bg-surface">
              <button
                type="button"
                className="flex w-full flex-wrap items-center justify-between gap-3 px-4 py-4 text-left"
                onClick={() => setExpanded((p) => ({ ...p, [g._id]: !p[g._id] }))}
              >
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-muted">Group</p>
                  <p className="mt-0.5 text-base font-semibold text-ink">{g.name}</p>
                  <p className="mt-1 text-xs text-ink-muted">
                    {g.orderCount ?? members.length} orders
                    {g.responsibleName ? ` · ${g.responsibleName}` : ""}
                    {g.responsiblePhone ? ` · ${g.responsiblePhone}` : ""}
                    {g.earliestDue ? ` · Due ${formatDate(g.earliestDue)}` : ""}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-medium text-ink">
                    {g.readyCount || 0} / {g.orderCount || members.length} ready
                  </p>
                  <p className="text-xs text-ink-muted">
                    {g.status || "In Production"}
                    {(g.outstanding || 0) > 0 ? ` · ${formatMoney(g.outstanding)} outstanding` : ""}
                  </p>
                </div>
              </button>
              {open && (
                <div className="border-t border-line px-4 py-3">
                  <div className="mb-2 flex justify-end">
                    <Button type="button" size="sm" variant="secondary" onClick={() => navigate(`/orders/groups/${g._id}`)}>
                      Group details
                    </Button>
                  </div>
                  <ul className="divide-y divide-line">
                    {members.map((o) => (
                      <li key={o.orderId}>
                        <Link
                          to={`/orders/${encodeURIComponent(o.orderId)}`}
                          className="flex items-center justify-between gap-3 py-2.5 text-sm hover:text-accent"
                        >
                          <span>
                            <span className="font-mono text-xs font-semibold">{shortOrderId(o.orderId)}</span>
                            <span className="ml-2">{o.customerName || o.customer?.name}</span>
                            <span className="ml-2 text-ink-muted">{o.items.map((it) => it.clothingType).join(" · ")}</span>
                          </span>
                          <span className="text-xs capitalize text-ink-muted">
                            {o.items[0]?.currentStage || o.productionStatus} · {formatDate(o.requiredCompletionDate)}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </li>
          );
        })}
        {ungrouped.map((o) => {
          const overdue =
            new Date(o.requiredCompletionDate).getTime() < Date.now() &&
            !["completed", "delivered"].includes(o.productionStatus);
          const balance = Math.max(0, (o.totalAgreedPrice || 0) - (o.depositPaid || 0));
          return (
            <li key={o.orderId} className="border border-line bg-surface px-4 py-4">
              <Link to={`/orders/${encodeURIComponent(o.orderId)}`} className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-mono text-xs font-semibold text-ink">{shortOrderId(o.orderId)}</p>
                  <p className="mt-1 font-medium text-ink">{o.customerName || o.customer?.name || "—"}</p>
                  <p className="mt-1 text-xs text-ink-muted">{o.items.map((it) => it.clothingType).join(" · ")}</p>
                  <p className="mt-1 text-xs text-ink-muted">
                    Ordered {formatDate(o.createdAt)}
                    {o.priority && o.priority !== "NORMAL" ? ` · ${o.priority}` : ""}
                  </p>
                </div>
                <div className="text-right text-xs">
                  <Badge tone={o.productionStatus === "completed" || o.productionStatus === "delivered" ? "ok" : "progress"}>
                    {o.productionStatus}
                  </Badge>
                  <p className={clsx("mt-2", overdue && "font-semibold text-red-700")}>{formatDate(o.requiredCompletionDate)}</p>
                  <p className="mt-1 text-ink-muted">{balance > 0 ? `${formatMoney(balance)} due` : "Paid"}</p>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
