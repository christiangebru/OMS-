import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { apiJson, ApiError } from "@/lib/api";
import type { ClothingTypeConfig, Order } from "@/lib/types";
import { SpecSheet } from "@/components/SpecSheet";
import { daysLabel, formatDate, formatMoney, labelBarcode, shortOrderId, stageLabel, boardStatusLabel } from "@/lib/format";
import { stageSequenceFor } from "@/lib/stages";
import { PageHeader, ErrorState, Skeleton, Badge } from "@/components/ui/PageHeader";
import { StageStrip } from "@/components/StageStrip";
import { SmartImage } from "@/components/SmartImage";
import { useAuth } from "@/context/AuthContext";
import { canWriteOrders, canSee, canDeleteOrders } from "@/lib/roles";
import { RowActions } from "@/components/RowActions";

export function OrderDetailPage() {
  const { orderId } = useParams<{ orderId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [order, setOrder] = useState<Order | null>(null);
  const [types, setTypes] = useState<ClothingTypeConfig[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    apiJson<ClothingTypeConfig[]>("/api/clothing-types")
      .then(setTypes)
      .catch(() => setTypes([]));
  }, []);

  useEffect(() => {
    if (!orderId) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await apiJson<Order>(`/api/orders/${encodeURIComponent(orderId)}`);
        if (!cancelled) setOrder(data);
      } catch (e) {
        if (!cancelled) setErr(e instanceof ApiError ? e.message : "Could not load this order from the API");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orderId]);

  if (err && !order) {
    return <ErrorState title="Order API failed" message={err} />;
  }
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
  const canDelete = canDeleteOrders(user?.role);
  const customerId = order.customerId || order.customer?._id;
  const paid = order.productionStatus === "delivered" || (order.balanceRemaining || 0) <= 0;

  return (
    <div className="space-y-8">
      <PageHeader
        title={shortOrderId(order.orderId)}
        description={`${order.customerName || order.customer?.name || "Customer"} · ${formatDate(order.createdAt)}`}
        actions={
          <RowActions
            actions={[
              {
                label: "Print labels",
                hidden: !canLabels,
                to: `/orders/${encodeURIComponent(order.orderId)}/print-labels`
              },
              {
                label: "Edit order",
                hidden: !canEdit,
                to: `/orders/${encodeURIComponent(order.orderId)}/edit`
              },
              {
                label: "View customer",
                hidden: !customerId,
                to: customerId ? `/customers/${customerId}` : undefined
              },
              {
                label: "Delete order",
                hidden: !canDelete,
                danger: true,
                confirm:
                  "This permanently deletes the order and all garments, assignments, and production history. This cannot be undone.",
                onClick: () => {
                  void (async () => {
                    try {
                      await apiJson(`/api/orders/${encodeURIComponent(order.orderId)}`, { method: "DELETE" });
                      navigate("/orders");
                    } catch (e) {
                      setErr(e instanceof ApiError ? e.message : "Could not delete order");
                    }
                  })();
                }
              }
            ]}
          />
        }
      />

      <section className="grid gap-px overflow-hidden border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
        <Fact
          label="Customer"
          value={
            customerId ? (
              <Link to={`/customers/${customerId}`} className="hover:text-accent">
                {order.customerName || order.customer?.name || "—"}
              </Link>
            ) : (
              order.customerName || "—"
            )
          }
          hint={order.customerPhone || order.customer?.phone}
        />
        {order.group && (
          <Fact
            label="Group"
            value={
              <Link to={`/orders/groups/${order.group._id}`} className="hover:text-accent">
                {order.group.name}
              </Link>
            }
            hint={order.group.responsibleName}
          />
        )}
        <Fact
          label="Due"
          value={daysLabel(days, overdue)}
          hint={formatDate(order.requiredCompletionDate)}
          warn={overdue}
        />
        <Fact
          label="Priority / status"
          value={order.priority && order.priority !== "NORMAL" ? order.priority : "Normal"}
          hint={order.productionStatus}
        />
        <Fact
          label="Balance"
          value={paid ? "Paid" : formatMoney(order.balanceRemaining)}
          hint={`${formatMoney(order.depositPaid)} of ${formatMoney(order.totalAgreedPrice)}`}
        />
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-ink">Garments</h2>
        <ul className="space-y-3">
          {order.items.map((it) => {
            const stages = stageSequenceFor(it.clothingType, types);
            const current = it.currentStage || it.nextStage || stages[0];
            const thumb = it.images?.[0]?.imageUrl || it.imagePath;
            return (
              <li key={it._id || it.barcodeValue} className="border border-line bg-surface p-4">
                <div className="flex flex-wrap items-start gap-4">
                  {thumb ? (
                    <SmartImage src={thumb} alt="" className="h-16 w-16 rounded-control object-cover" />
                  ) : (
                    <div className="flex h-16 w-16 items-center justify-center rounded-control bg-canvas text-xs text-ink-faint">
                      {it.clothingType.slice(0, 2)}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold text-ink">{it.clothingType}</p>
                        <p className="font-mono text-[11px] text-ink-muted">
                          {it.labelBarcode || labelBarcode(order.orderId, order.items.indexOf(it) + 1, it.barcodeValue)}
                        </p>
                        <p className="mt-1 text-xs capitalize text-ink-muted">
                          {it.size}
                          {it.fabricType ? ` · ${it.fabricType}` : ""}
                          {it.color ? ` · ${it.color}` : ""}
                        </p>
                      </div>
                      <div className="text-right">
                        {it.boardStatus && (
                          <Badge tone={it.boardStatus === "waiting" ? "warn" : it.boardStatus === "in_progress" ? "progress" : "ok"}>
                            {boardStatusLabel(it.boardStatus)}
                          </Badge>
                        )}
                        <p className="mt-1 text-xs text-ink-muted">{it.workerName || "Unassigned"}</p>
                        <p className="text-xs capitalize text-ink-muted">{stageLabel(current)}</p>
                      </div>
                    </div>
                    <div className="mt-3">
                      <StageStrip stages={stages} current={current} compact />
                    </div>
                    <div className="mt-4">
                      <SpecSheet item={it} />
                    </div>
                    {it._id && (
                      <div className="mt-3">
                        <RowActions
                          align="left"
                          actions={[
                            { label: "View garment", to: `/garments/${encodeURIComponent(it._id)}` },
                            {
                              label: "Take to scanner",
                              to: `/scan?barcode=${encodeURIComponent(it.labelBarcode || it.barcodeValue || "")}`
                            }
                          ]}
                        />
                      </div>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

function Fact({
  label,
  value,
  hint,
  warn
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  warn?: boolean;
}) {
  return (
    <div className="bg-surface px-4 py-3">
      <p className="ui-label">{label}</p>
      <p className={`mt-1 font-semibold ${warn ? "text-red-700" : "text-ink"}`}>{value}</p>
      {hint ? <p className="text-xs text-ink-muted">{hint}</p> : null}
    </div>
  );
}
