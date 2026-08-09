import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiJson, ApiError, imageUrlFromPath } from "@/lib/api";
import type { Order, ProductionStatus } from "@/lib/types";
import clsx from "clsx";

const STATUSES: ProductionStatus[] = [
  "pending",
  "cutting",
  "stitching",
  "finishing",
  "completed",
  "delivered"
];

export function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string>("");
  const [clothingType, setClothingType] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const queryString = useMemo(() => {
    const p = new URLSearchParams();
    if (q.trim()) p.set("q", q.trim());
    if (status) p.set("status", status);
    if (clothingType.trim()) p.set("clothingType", clothingType.trim());
    const s = p.toString();
    return s ? `?${s}` : "";
  }, [q, status, clothingType]);
const copyTailorDetails = (order: Order) => {
  const customerLabel = order.customerName || order.customer?.name || "—";
  let text = `CUSTOMER: ${customerLabel}\n\n`;

  order.items.forEach((item, index) => {
    text += `ITEM ${index + 1}\n`;
    text += `Type: ${item.clothingType}\n`;

    if (item.color) {
      text += `Color: ${item.color}\n`;
    }

    if (item.fabricType) {
      text += `Fabric: ${item.fabricType}\n`;
    }

    text += `Quantity: ${item.quantity}\n`;

    if (item.neckType) {
      text += `Neck: ${item.neckType}\n`;
    }

    if (item.handType) {
      text += `Hand: ${item.handType}\n`;
    }

    if (item.notes) {
      text += `Notes: ${item.notes}\n`;
    }

    if (item.measurements) {
      text += `\nMEASUREMENTS\n`;

      Object.entries(item.measurements).forEach(([key, value]) => {
        if (value) {
          text += `${key}: ${value}\n`;
        }
      });
    }

    text += `\n------------------\n\n`;
  });

  navigator.clipboard.writeText(text);

  alert("Tailor details copied!");
};
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await apiJson<Order[]>(`/api/orders${queryString}`);
        if (!cancelled) setOrders(data);
      } catch (e) {
        if (!cancelled) setErr(e instanceof ApiError ? e.message : "Failed to load orders");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [queryString]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Orders</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Search by customer, order ID, or clothing type. Filter by status.
          </p>
        </div>
        <Link
          to="/orders/new"
          className="inline-flex justify-center rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow hover:bg-brand-700"
        >
          New order
        </Link>
      </div>

      <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-card dark:border-slate-800 dark:bg-slate-900 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className="text-xs font-semibold text-slate-600 dark:text-slate-300" htmlFor="search-q">
            Search
          </label>
          <input
            id="search-q"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Name, order ID, type…"
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
          />
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-600 dark:text-slate-300" htmlFor="search-status">
            Status
          </label>
          <select
            id="search-status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
          >
            <option value="">All</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label
            className="text-xs font-semibold text-slate-600 dark:text-slate-300"
            htmlFor="search-type"
          >
            Clothing type contains
          </label>
          <input
            id="search-type"
            value={clothingType}
            onChange={(e) => setClothingType(e.target.value)}
            placeholder="e.g. Shirt"
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
          />
        </div>
      </div>

      {err && <p className="text-sm text-red-600 dark:text-red-400">{err}</p>}

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-card dark:border-slate-800 dark:bg-slate-900">
        <div className="overflow-x-auto">
          <table className="min-w-[900px] w-full border-collapse text-left text-sm">
            <thead className="bg-slate-50 text-xs font-semibold uppercase text-slate-500 dark:bg-slate-800 dark:text-slate-400">
              <tr>
                <th className="px-4 py-3">Order</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Items</th>
                <th className="px-4 py-3">Due</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Group</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr
                  key={o.orderId}
                  className="border-t border-slate-100 dark:border-slate-800"
                >
                  <td className="px-4 py-3 font-mono text-xs font-semibold text-slate-800 dark:text-slate-100">
                    {o.orderId}
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-900 dark:text-white">
                      {o.customerName || o.customer?.name || "—"}
                    </div>
                    <div className="text-xs text-slate-500">
                      {o.customerPhone || o.customer?.phone || ""}
                    </div>
                    {(o.totalAgreedPrice != null || o.balanceRemaining != null) && (
                      <div className="mt-1 text-xs text-slate-500">
                        Balance{" "}
                        {(
                          o.balanceRemaining ??
                          Math.max(0, (o.totalAgreedPrice || 0) - (o.depositPaid || 0))
                        ).toFixed(2)}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-2">
                      {o.items.slice(0, 3).map((it) => {
                        const first =
                          it.images?.[0]?.imageUrl || it.imagePath || "";
                        const extra = Math.max(0, (it.images?.length || (it.imagePath ? 1 : 0)) - 1);
                        return (
                          <span
                            key={it._id || it.clothingCode}
                            className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs dark:bg-slate-800"
                          >
                            {first ? (
                              <span className="relative">
                                <img
                                  src={imageUrlFromPath(first)}
                                  alt=""
                                  className="h-6 w-6 rounded object-cover"
                                />
                                {extra > 0 && (
                                  <span className="absolute -right-1 -top-1 rounded bg-slate-900 px-1 text-[9px] text-white">
                                    +{extra}
                                  </span>
                                )}
                              </span>
                            ) : null}
                            {it.clothingType} ×{it.quantity}
                          </span>
                        );
                      })}
                      {o.items.length > 3 && (
                        <span className="text-xs text-slate-400">+{o.items.length - 3}</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-300">
                    {o.requiredCompletionDate?.slice(0, 10)}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={clsx(
                        "inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize",
                        statusClass(o.productionStatus)
                      )}
                    >
                      {o.productionStatus}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">{o.groupCode || "—"}</td>
                  <td className="px-4 py-3 text-right">
  <div className="flex justify-end gap-2">
    <button
      onClick={() => copyTailorDetails(o)}
      className="rounded-lg bg-blue-600 px-3 py-1 text-xs font-semibold text-white hover:bg-blue-700"
    >
      Copy
    </button>

    <Link
      to={`/orders/${encodeURIComponent(o.orderId)}`}
      className="rounded-lg bg-slate-200 px-3 py-1 text-xs font-semibold text-slate-800 hover:bg-slate-300 dark:bg-slate-700 dark:text-white"
    >
      Open
    </Link>
  </div>
</td>
                </tr>
              ))}
              {!orders.length && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                    No orders match your filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function statusClass(s: ProductionStatus) {
  switch (s) {
    case "completed":
    case "delivered":
      return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200";
    case "pending":
      return "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200";
    default:
      return "bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-100";
  }
}
