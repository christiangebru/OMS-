import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { apiJson, ApiError, imageUrlFromPath } from "@/lib/api";
import type { Order, OrderPriority, ProductionStatus } from "@/lib/types";
import { formatDate } from "@/lib/format";
import { PageHeader, EmptyState, ErrorState, Badge } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/context/ToastContext";
import { useAuth } from "@/context/AuthContext";
import { canWriteOrders } from "@/lib/roles";
import { garmentPath } from "@/components/GarmentCard";
import clsx from "clsx";

const STATUSES: ProductionStatus[] = [
  "pending",
  "cutting",
  "stitching",
  "finishing",
  "completed",
  "delivered"
];
const PRIORITIES: Array<OrderPriority | ""> = ["", "NORMAL", "RUSH", "VIP"];

export function OrdersPage() {
  const { push } = useToast();
  const { user } = useAuth();
  const canCreate = canWriteOrders(user?.role);
  const [searchParams] = useSearchParams();
  const [orders, setOrders] = useState<Order[]>([]);
  const [q, setQ] = useState(searchParams.get("q") || "");
  const [status, setStatus] = useState("");
  const [priority, setPriority] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [barcodeHit, setBarcodeHit] = useState<{ id: string; type: string } | null>(null);

  const queryString = useMemo(() => {
    const p = new URLSearchParams();
    if (q.trim()) p.set("q", q.trim());
    if (status) p.set("status", status);
    const s = p.toString();
    return s ? `?${s}` : "";
  }, [q, status]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const data = await apiJson<Order[]>(`/api/orders${queryString}`);
        if (!cancelled) setOrders(data);
      } catch (e) {
        if (!cancelled) setErr(e instanceof ApiError ? e.message : "Failed to load orders");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [queryString]);

  useEffect(() => {
    const term = q.trim();
    if (!/^ITM-/i.test(term)) {
      setBarcodeHit(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const data = await apiJson<{ scanDetails: { item: { _id: string; clothingType: string } } }>(
          `/api/production/lookup?barcodeValue=${encodeURIComponent(term)}`
        );
        if (!cancelled) {
          setBarcodeHit({ id: data.scanDetails.item._id, type: data.scanDetails.item.clothingType });
        }
      } catch {
        if (!cancelled) setBarcodeHit(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [q]);

  const visible = orders.filter((o) => (priority ? o.priority === priority : true));

  function copyTailorDetails(order: Order) {
    const customerLabel = order.customerName || order.customer?.name || "—";
    let text = `CUSTOMER: ${customerLabel}\n\n`;
    order.items.forEach((item, index) => {
      text += `ITEM ${index + 1}\nType: ${item.clothingType}\n`;
      if (item.color) text += `Color: ${item.color}\n`;
      if (item.fabricType) text += `Fabric: ${item.fabricType}\n`;
      text += `Quantity: ${item.quantity}\n`;
      if (item.notes) text += `Notes: ${item.notes}\n`;
      if (item.measurements) {
        text += `\nMEASUREMENTS\n`;
        Object.entries(item.measurements).forEach(([key, value]) => {
          if (value) text += `${key}: ${value}\n`;
        });
      }
      text += `\n------------------\n\n`;
    });
    navigator.clipboard.writeText(text);
    push("Copied garment details", "ok");
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Orders"
        description="Find work by customer, due date, stage, or priority."
        actions={
          canCreate ? (
            <Link to="/orders/new">
              <Button>New order</Button>
            </Link>
          ) : undefined
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className="ui-label" htmlFor="search-q">
            Search
          </label>
          <input
            id="search-q"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Name, order ID, ITM barcode, type…"
            className="ui-input"
          />
        </div>
        <div>
          <label className="ui-label" htmlFor="search-status">
            Status
          </label>
          <select id="search-status" value={status} onChange={(e) => setStatus(e.target.value)} className="ui-input">
            <option value="">All</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="ui-label" htmlFor="search-priority">
            Priority
          </label>
          <select
            id="search-priority"
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
            className="ui-input"
          >
            {PRIORITIES.map((p) => (
              <option key={p || "all"} value={p}>
                {p || "All"}
              </option>
            ))}
          </select>
        </div>
      </div>

      {barcodeHit && (
        <Link
          to={garmentPath(barcodeHit.id)}
          className="ui-card flex items-center justify-between gap-3 p-4"
        >
          <div>
            <p className="text-sm font-semibold text-ink">Open garment</p>
            <p className="text-xs text-ink-muted">
              {barcodeHit.type} matches {q.trim()}
            </p>
          </div>
          <span className="text-sm font-semibold text-accent">View →</span>
        </Link>
      )}

      {err && <ErrorState message={err} />}

      {!loading && !visible.length && (
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

      <ul className="space-y-3 md:hidden">
        {visible.map((o) => {
          const due = new Date(o.requiredCompletionDate);
          const overdue =
            due.getTime() < Date.now() && !["completed", "delivered"].includes(o.productionStatus);
          return (
            <li key={o.orderId} className="ui-card p-4">
              <Link to={`/orders/${encodeURIComponent(o.orderId)}`} className="block">
                <p className="font-mono text-xs font-semibold text-ink">{o.orderId}</p>
                <p className="mt-1 font-medium text-ink">{o.customerName || o.customer?.name || "—"}</p>
                <p className="mt-1 text-xs text-ink-muted">
                  {o.items.map((it) => it.clothingType).join(" · ")}
                </p>
                <p className={clsx("mt-2 text-xs", overdue && "font-semibold text-red-700")}>
                  {formatDate(o.requiredCompletionDate)} · {o.productionStatus}
                  {o.priority && o.priority !== "NORMAL" ? ` · ${o.priority}` : ""}
                </p>
              </Link>
            </li>
          );
        })}
      </ul>

      <div className="hidden overflow-hidden ui-card md:block">
        <div className="overflow-x-auto">
          <table className="ui-table min-w-[880px] w-full text-sm">
            <thead className="border-b border-line bg-canvas/70">
              <tr>
                <th>Order</th>
                <th>Customer</th>
                <th>Items</th>
                <th>Due</th>
                <th>Status</th>
                <th>Priority</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {visible.map((o) => {
                const due = new Date(o.requiredCompletionDate);
                const overdue =
                  due.getTime() < Date.now() && !["completed", "delivered"].includes(o.productionStatus);
                return (
                  <tr key={o.orderId} className="border-t border-line">
                    <td className="font-mono text-xs font-semibold">{o.orderId}</td>
                    <td>
                      <div className="font-medium text-ink">{o.customerName || o.customer?.name || "—"}</div>
                      <div className="text-xs text-ink-muted">{o.customerPhone || o.customer?.phone || ""}</div>
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-1.5">
                        {o.items.slice(0, 3).map((it) => {
                          const first = it.images?.[0]?.imageUrl || it.imagePath || "";
                          return (
                            <span
                              key={it._id || it.clothingCode}
                              className="inline-flex items-center gap-1 rounded bg-canvas px-1.5 py-0.5 text-xs"
                            >
                              {first ? (
                                <img src={imageUrlFromPath(first)} alt="" className="h-5 w-5 rounded object-cover" />
                              ) : null}
                              {it.clothingType}
                            </span>
                          );
                        })}
                        {o.items.length > 3 && (
                          <span className="text-xs text-ink-faint">+{o.items.length - 3}</span>
                        )}
                      </div>
                    </td>
                    <td className={clsx("text-xs", overdue && "font-semibold text-red-700")}>
                      {formatDate(o.requiredCompletionDate)}
                    </td>
                    <td>
                      <Badge
                        tone={
                          o.productionStatus === "delivered" || o.productionStatus === "completed"
                            ? "ok"
                            : o.productionStatus === "pending"
                              ? "neutral"
                              : "progress"
                        }
                      >
                        {o.productionStatus}
                      </Badge>
                    </td>
                    <td>
                      {o.priority && o.priority !== "NORMAL" ? (
                        <Badge tone={o.priority === "VIP" ? "accent" : "warn"}>{o.priority}</Badge>
                      ) : (
                        <span className="text-xs text-ink-faint">Normal</span>
                      )}
                    </td>
                    <td className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button type="button" size="sm" variant="ghost" onClick={() => copyTailorDetails(o)}>
                          Copy
                        </Button>
                        <Link to={`/orders/${encodeURIComponent(o.orderId)}`}>
                          <Button size="sm" variant="secondary">
                            Open
                          </Button>
                        </Link>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!loading && !visible.length && (
                <tr>
                  <td colSpan={7} className="p-0" />
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
