import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { apiJson, ApiError } from "@/lib/api";
import type { ClothingTypeConfig, Order } from "@/lib/types";
import { SpecSheet } from "@/components/SpecSheet";
import { daysLabel, formatDate, formatMoney, labelBarcode, productionStatusLabel, shortOrderId, stageLabel, boardStatusLabel } from "@/lib/format";
import { effectiveScanSequence, stageSequenceFor } from "@/lib/stages";
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
  const overdue = due.getTime() < Date.now() && !["completed", "ready_to_pack", "ready_for_pickup", "delivered"].includes(order.productionStatus);
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
          hint={productionStatusLabel(order.productionStatus)}
        />
        <Fact
          label="Balance"
          value={paid ? "Paid" : formatMoney(order.balanceRemaining)}
          hint={`${formatMoney(order.depositPaid)} of ${formatMoney(order.totalAgreedPrice)}`}
        />
      </section>

      <section className="space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-semibold text-ink">Garments</h2>
          <p className="text-xs text-ink-muted">
            {order.completion
              ? `${order.completion.completed}/${order.completion.total} complete`
              : `${order.items.filter((it) => it.itemKind !== "part").length} items`}
            {order.completion?.readyToPack ||
            order.productionStatus === "ready_to_pack" ||
            order.productionStatus === "ready_for_pickup"
              ? order.productionStatus === "ready_for_pickup" || order.packedAt
                ? " · Ready for pickup"
                : " · Ready to pack"
              : ""}
          </p>
        </div>
        <ul className="space-y-3">
          {order.items.filter((it) => it.itemKind !== "part").map((it) => {
            const stages = effectiveScanSequence(
              stageSequenceFor(it.clothingType, types),
              it.offSiteStages || []
            );
            const away = it.boardStatus === "off_site";
            const current = away ? "OFF_SITE" : it.currentStage || it.nextStage || stages[0];
            const locationLabel = away
              ? "Off-site"
              : it.nextStage === "OFF_SITE"
                ? "In shop — send off-site"
                : stageLabel(current);
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
                          <Badge tone={it.boardStatus === "waiting" ? "warn" : it.boardStatus === "in_progress" || it.boardStatus === "off_site" ? "progress" : "ok"}>
                            {boardStatusLabel(it.boardStatus)}
                          </Badge>
                        )}
                        <p className="mt-1 text-xs text-ink-muted">{it.workerName || "Unassigned"}</p>
                        <p className="text-xs capitalize text-ink-muted">{locationLabel}</p>
                      </div>
                    </div>
                    <div className="mt-3">
                      <StageStrip stages={stages} current={current} compact />
                    </div>
                    <div className="mt-4">
                      <SpecSheet item={it} />
                    </div>
                    {it.offSiteStages?.length ? (
                      <p className="mt-2 text-xs text-ink-muted">
                        Off-site stages: {it.offSiteStages.map((s) => stageLabel(s)).join(" · ")}
                      </p>
                    ) : null}
                    {it.readyForAssembly ? (
                      <p className="mt-2 text-xs font-semibold text-accent">Ready for assembly</p>
                    ) : null}
                    {(it.parts || order.items.filter((p) => p.parentItemId === it._id)).length > 0 && (
                      <ul className="mt-3 space-y-1 text-xs text-ink-muted">
                        {(it.parts || order.items.filter((p) => p.parentItemId === it._id)).map((p) => (
                          <li key={p._id} className="flex justify-between gap-2 font-mono">
                            <span>
                              {p.labelBarcode || p.barcodeValue} · {p.partCode}
                            </span>
                            <span className="font-sans capitalize">{stageLabel(p.currentStage || p.nextStage || "")}</span>
                          </li>
                        ))}
                      </ul>
                    )}
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
