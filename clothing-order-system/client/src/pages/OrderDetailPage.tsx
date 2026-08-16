import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiJson, ApiError } from "@/lib/api";
import type { Order } from "@/lib/types";
import { PRODUCTION_STAGES } from "@/lib/types";
import { daysLabel, formatDate, formatMoney, shortOrderId, stageLabel, boardStatusLabel } from "@/lib/format";
import { PageHeader, ErrorState, Skeleton, Badge } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { GarmentCard } from "@/components/GarmentCard";
import { useAuth } from "@/context/AuthContext";
import { canWriteOrders, canSee } from "@/lib/roles";

export function OrderDetailPage() {
  const { orderId } = useParams<{ orderId: string }>();
  const { user } = useAuth();
  const [order, setOrder] = useState<Order | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!orderId) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await apiJson<Order>(`/api/orders/${encodeURIComponent(orderId)}`);
        if (!cancelled) setOrder(data);
      } catch (e) {
        if (!cancelled) setErr(e instanceof ApiError ? e.message : "Failed to load order");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orderId]);

  if (err && !order) return <ErrorState message={err} />;
  if (!order) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-40" />
        <Skeleton className="h-32" />
      </div>
    );
  }

  const due = new Date(order.requiredCompletionDate);
  const overdue = due.getTime() < Date.now() && !["completed", "delivered"].includes(order.productionStatus);
  const days = (due.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
  const canEdit = canWriteOrders(user?.role);
  const canLabels = canSee(user?.role, "labels");
  const customerId = order.customerId || order.customer?._id;

  return (
    <div className="space-y-6">
      <PageHeader
        title={shortOrderId(order.orderId)}
        description={`${order.customerName || order.customer?.name || "Customer"} · ${formatDate(order.createdAt)}`}
        actions={
          <div className="flex flex-wrap gap-2">
            {canLabels && (
              <Link to={`/orders/${encodeURIComponent(order.orderId)}/print-labels`}>
                <Button variant="secondary">Print labels</Button>
              </Link>
            )}
            {canEdit && (
              <Link to={`/orders/${encodeURIComponent(order.orderId)}/edit`}>
                <Button variant="secondary">Edit order</Button>
              </Link>
            )}
            <Link to="/orders">
              <Button variant="ghost">All orders</Button>
            </Link>
          </div>
        }
      />

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="ui-card px-4 py-3">
          <p className="ui-label">Customer</p>
          {customerId ? (
            <Link to={`/customers/${customerId}`} className="mt-1 block font-semibold text-ink hover:text-accent">
              {order.customerName || order.customer?.name || "—"}
            </Link>
          ) : (
            <p className="mt-1 font-semibold text-ink">{order.customerName || "—"}</p>
          )}
          <p className="text-xs text-ink-muted">{order.customerPhone || order.customer?.phone}</p>
        </div>
        <div className="ui-card px-4 py-3">
          <p className="ui-label">Status</p>
          <p className="mt-1 font-semibold capitalize text-ink">{order.productionStatus}</p>
          <p className="text-xs text-ink-muted">
            {order.items.length} garment{order.items.length === 1 ? "" : "s"}
            {order.priority && order.priority !== "NORMAL" ? ` · ${order.priority}` : ""}
          </p>
        </div>
        <div className="ui-card px-4 py-3">
          <p className="ui-label">Due</p>
          <p className={`mt-1 font-semibold ${overdue ? "text-red-700" : "text-ink"}`}>
            {daysLabel(days, overdue)}
          </p>
          <p className="text-xs text-ink-muted">{formatDate(order.requiredCompletionDate)}</p>
        </div>
        <div className="ui-card px-4 py-3">
          <p className="ui-label">Balance</p>
          <p className="mt-1 text-xl font-semibold tabular">{formatMoney(order.balanceRemaining)}</p>
          <p className="text-xs text-ink-muted">
            {formatMoney(order.depositPaid)} of {formatMoney(order.totalAgreedPrice)} paid
          </p>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-ink">Production</h2>
        <ol className="flex gap-2 overflow-x-auto pb-1">
          {PRODUCTION_STAGES.map((stage) => {
            const count = order.items.filter(
              (it) => (it.currentStage || it.nextStage) === stage
            ).length;
            return (
              <li
                key={stage}
                className="min-w-[104px] flex-1 border border-line bg-surface px-3 py-2"
              >
                <p className="ui-label">{stageLabel(stage)}</p>
                <p className="mt-1 text-lg font-semibold tabular text-ink">{count}</p>
              </li>
            );
          })}
        </ol>
      </section>

      <section>
        <div className="mb-3 flex items-end justify-between">
          <h2 className="text-sm font-semibold text-ink">Garments</h2>
          <p className="text-xs text-ink-muted">Open a garment for the production timeline.</p>
        </div>
        <div className="hidden overflow-hidden border border-line md:block">
          <table className="ui-table w-full text-sm">
            <thead className="border-b border-line bg-canvas/70">
              <tr>
                <th>Garment</th>
                <th>Barcode</th>
                <th>Stage</th>
                <th>Worker</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {order.items.map((it) => (
                <tr key={it._id || it.barcodeValue} className="border-t border-line">
                  <td>
                    <p className="font-medium text-ink">{it.clothingType}</p>
                    <p className="text-[11px] capitalize text-ink-muted">
                      {it.size} · {it.color || "—"}
                    </p>
                  </td>
                  <td className="font-mono text-xs">{it.barcodeValue}</td>
                  <td className="capitalize text-xs">{stageLabel(it.currentStage || it.nextStage || "—")}</td>
                  <td className="text-xs text-ink-muted">{it.workerName || "Unassigned"}</td>
                  <td>
                    {it.boardStatus ? (
                      <Badge tone={it.boardStatus === "waiting" ? "warn" : "ok"}>{boardStatusLabel(it.boardStatus)}</Badge>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="text-right">
                    {it._id && (
                      <div className="flex justify-end gap-2">
                        <Link to={`/garments/${encodeURIComponent(it._id)}`} className="text-xs font-semibold text-accent">
                          Open
                        </Link>
                        {it.barcodeValue && (
                          <Link
                            to={`/scan?barcode=${encodeURIComponent(it.barcodeValue)}`}
                            className="text-xs font-semibold text-accent"
                          >
                            Scan
                          </Link>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="grid gap-3 md:hidden">
          {order.items.map((it) => (
            <GarmentCard
              key={it._id || it.barcodeValue}
              garment={{
                itemId: it._id || "",
                clothingType: it.clothingType,
                barcodeValue: it.barcodeValue,
                customerName: order.customerName,
                orderId: order.orderId,
                stage: it.currentStage || it.nextStage || null,
                workerName: it.workerName,
                boardStatus: it.boardStatus,
                dueLabel: daysLabel(days, overdue),
                overdue,
                thumbnail: it.images?.[0]?.imageUrl || it.imagePath,
                unitPrice: it.unitPrice
              }}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
