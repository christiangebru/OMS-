import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiJson, ApiError } from "@/lib/api";
import type { Order } from "@/lib/types";
import { daysLabel, formatDate, formatMoney } from "@/lib/format";
import { PageHeader, ErrorState, Skeleton } from "@/components/ui/PageHeader";
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
        title={order.orderId}
        description="Commercial overview. Open a garment for production."
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
        <div className="mb-3 flex items-end justify-between">
          <h2 className="text-sm font-semibold text-ink">Garments</h2>
          <p className="text-xs text-ink-muted">Each item has its own barcode and production path.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
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
