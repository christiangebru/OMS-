import { Link } from "react-router-dom";
import { imageUrlFromPath } from "@/lib/api";
import type { ScanDetails } from "@/lib/types";
import { daysLabel, formatDate, formatMoney, stageLabel } from "@/lib/format";
import { ProductionTimeline } from "@/components/ProductionTimeline";
import { Badge } from "@/components/ui/PageHeader";
import clsx from "clsx";

export function ScanDetailCard({ details }: { details: ScanDetails }) {
  const days = details.timing.daysRemaining;
  const action = details.production?.action;
  const worker = details.production?.assignment?.staff;

  return (
    <div className="space-y-4">
      <div className="ui-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="ui-label">Customer</p>
            <p className="mt-1 text-xl font-semibold text-ink">{details.customer?.name || "—"}</p>
            <p className="text-sm text-ink-muted">{details.customer?.phone}</p>
            {details.customer?._id && (
              <Link
                className="mt-1 inline-block text-xs font-medium text-accent hover:underline"
                to={`/customers/${details.customer._id}`}
              >
                Customer history
              </Link>
            )}
          </div>
          <div className="text-right">
            <p className="ui-label">Order</p>
            <Link
              className="mt-1 block font-mono text-sm font-semibold text-ink hover:text-accent"
              to={`/orders/${encodeURIComponent(details.order.orderId)}`}
            >
              {details.order.orderId}
            </Link>
            <p className="text-xs text-ink-muted">
              {formatDate(details.order.createdAt)} · due {formatDate(details.timing.requiredCompletionDate)}
            </p>
          </div>
        </div>

        <div className="mt-5 grid gap-4 border-t border-line pt-4 sm:grid-cols-3">
          <div>
            <p className="ui-label">Garment</p>
            <p className="mt-1 text-lg font-semibold text-ink">{details.item.clothingType}</p>
            <p className="text-sm text-ink-muted">
              {details.item.fabricType} · {details.item.color} · {details.item.size}
            </p>
            <p className="mt-1 font-mono text-xs text-ink-faint">{details.item.barcodeValue}</p>
          </div>
          <div>
            <p className="ui-label">Production</p>
            <p className="mt-1 text-lg font-semibold capitalize text-ink">
              {stageLabel(details.timing.currentStage || "unstarted")}
            </p>
            <p className="text-sm text-ink-muted">
              Next: {stageLabel(details.timing.nextExpectedStage)}
            </p>
            {worker && <p className="mt-1 text-xs text-ink-muted">Assigned: {worker.name}</p>}
          </div>
          <div>
            <p className="ui-label">Payment</p>
            <p className="mt-1 text-lg font-semibold tabular text-ink">
              {formatMoney(details.pricing.balanceRemaining)}{" "}
              <span className="text-sm font-normal text-ink-muted">balance</span>
            </p>
            <p className="text-xs text-ink-muted">
              Deposit {formatMoney(details.pricing.depositPaid)} /{" "}
              {formatMoney(details.pricing.totalAgreedPrice)}
            </p>
            <p
              className={clsx(
                "mt-2 text-sm font-semibold",
                details.timing.overdue ? "text-red-700" : "text-ink"
              )}
            >
              {daysLabel(days, details.timing.overdue)}
            </p>
            {details.order.priority && details.order.priority !== "NORMAL" && (
              <div className="mt-2">
                <Badge tone={details.order.priority === "VIP" ? "accent" : "warn"}>
                  {details.order.priority}
                </Badge>
              </div>
            )}
          </div>
        </div>

        {action && (
          <p className="mt-4 rounded-control bg-accent-soft px-3 py-2 text-sm text-accent">
            Ready to <strong>{action === "check_in" ? "check in" : "check out"}</strong> at{" "}
            <span className="capitalize">{stageLabel(details.production?.actionStage || "")}</span>
          </p>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="ui-card p-5">
          <h3 className="text-sm font-semibold text-ink">Production timeline</h3>
          <div className="mt-4">
            {details.item._id && (
              <ProductionTimeline
                orderItemId={details.item._id}
                stages={details.production?.stageStates}
              />
            )}
          </div>
        </section>

        <section className="ui-card space-y-4 p-5">
          <h3 className="text-sm font-semibold text-ink">Specifications</h3>
          {details.item.notes && (
            <p className="text-sm text-ink-muted">{details.item.notes}</p>
          )}
          {details.item.measurements && (
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(details.item.measurements).map(([k, v]) =>
                v ? (
                  <span key={k} className="rounded bg-canvas px-2 py-1 text-xs capitalize text-ink-muted">
                    {k}: {v}
                  </span>
                ) : null
              )}
            </div>
          )}
          {details.item.images?.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {details.item.images.map((img) => (
                <figure key={img._id || img.imageUrl} className="w-20">
                  <img
                    src={imageUrlFromPath(img.imageUrl)}
                    alt={img.caption || img.category || "Reference"}
                    className="h-20 w-20 rounded-control object-cover"
                  />
                  {(img.category || img.caption) && (
                    <figcaption className="mt-1 truncate text-[10px] capitalize text-ink-faint">
                      {img.caption || img.category}
                    </figcaption>
                  )}
                </figure>
              ))}
            </div>
          )}
          {details.order.siblingItems.length > 1 && (
            <div>
              <p className="ui-label">Other items on this order</p>
              <ul className="mt-2 space-y-1 text-sm">
                {details.order.siblingItems.map((s) => (
                  <li key={s._id} className={clsx(s.isCurrent && "font-semibold text-accent")}>
                    {s.clothingType} — {stageLabel(s.currentStage || "unstarted")}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
