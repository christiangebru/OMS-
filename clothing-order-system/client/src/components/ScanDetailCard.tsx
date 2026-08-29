import { Link } from "react-router-dom";
import { useState, type ReactNode } from "react";
import { imageUrlFromPath } from "@/lib/api";
import type { ScanDetails } from "@/lib/types";
import { daysLabel, formatDate, formatMoney, stageLabel, shortOrderId } from "@/lib/format";
import { ProductionTimeline } from "@/components/ProductionTimeline";
import { Badge } from "@/components/ui/PageHeader";
import { garmentPath } from "@/components/GarmentCard";
import clsx from "clsx";

export function ScanDetailCard({ details }: { details: ScanDetails }) {
  const days = details.timing.daysRemaining;
  const action = details.production?.action;
  const worker = details.production?.assignment?.staff;
  const assignment = details.production?.assignment;
  const [preview, setPreview] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <div className="ui-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="ui-label">Who</p>
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
              {shortOrderId(details.order.orderId)}
            </Link>
            <Link
              className="mt-1 inline-block text-xs font-semibold text-accent hover:underline"
              to={garmentPath(details.item._id)}
            >
              Garment view
            </Link>
            <p className="text-xs text-ink-muted">
              {formatDate(details.order.createdAt)} · due {formatDate(details.timing.requiredCompletionDate)}
            </p>
            {details.order.priority && details.order.priority !== "NORMAL" && (
              <div className="mt-2 flex justify-end">
                <Badge tone={details.order.priority === "VIP" ? "accent" : "warn"}>{details.order.priority}</Badge>
              </div>
            )}
          </div>
        </div>

        <div className="mt-5 grid gap-4 border-t border-line pt-4 sm:grid-cols-2 lg:grid-cols-4">
          <Fact label="Garment" value={details.item.clothingType}>
            {details.item.fabricType} · {details.item.color} · {details.item.size}
            <span className="mt-1 block font-mono text-[11px] text-ink-faint">{details.item.barcodeValue}</span>
          </Fact>
          <Fact label="Now" value={details.production?.offSite ? "Off-site" : stageLabel(details.timing.currentStage || "unstarted")} capitalize>
            Next: {stageLabel(details.timing.nextExpectedStage)}
          </Fact>
          <Fact label="Worker" value={worker?.name || "Unassigned"}>
            {assignment?.receivedAt
              ? "Received"
              : assignment?.distributedAt
                ? "Handed over — waiting to receive"
                : assignment
                  ? "Assigned"
                  : "Needs assignment"}
          </Fact>
          <Fact
            label="Due / balance"
            value={daysLabel(days, details.timing.overdue)}
            tone={details.timing.overdue ? "urgent" : undefined}
          >
            {formatMoney(details.pricing.balanceRemaining)} remaining · deposit{" "}
            {formatMoney(details.pricing.depositPaid)}
          </Fact>
        </div>

        {action && (
          <p className="mt-4 rounded-control bg-accent-soft px-3 py-2 text-sm text-accent">
            Next action: <strong>{action === "check_in" ? "Check in" : "Check out"}</strong> at{" "}
            <span className="capitalize">{stageLabel(details.production?.actionStage || "")}</span>
          </p>
        )}
      </div>

      <div className="ui-card p-5">
        <h3 className="text-sm font-semibold text-ink">Production</h3>
        <div className="mt-4">
          {details.item._id && (
            <ProductionTimeline orderItemId={details.item._id} stages={details.production?.stageStates} />
          )}
        </div>
      </div>

      <section className="ui-card space-y-4 p-5">
        <h3 className="text-sm font-semibold text-ink">Specifications</h3>
        {details.item.notes && <p className="text-sm text-ink-muted">{details.item.notes}</p>}
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
              <button
                type="button"
                key={img._id || img.imageUrl}
                className="w-20 text-left"
                onClick={() => setPreview(img.imageUrl)}
              >
                <img
                  src={imageUrlFromPath(img.imageUrl)}
                  alt={img.caption || img.category || "Reference"}
                  className="h-20 w-20 rounded-control object-cover"
                />
                {(img.category || img.caption) && (
                  <span className="mt-1 block truncate text-[10px] capitalize text-ink-faint">
                    {img.caption || img.category}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
        {details.order.siblingItems.length > 1 && (
          <div>
            <p className="ui-label">Other items on this order</p>
            <ul className="mt-2 space-y-1 text-sm">
              {details.order.siblingItems.map((s) => (
                <li key={s._id} className={clsx(s.isCurrent && "font-semibold text-accent")}>
                  {s.isCurrent ? (
                    <span>
                      {s.clothingType} — {stageLabel(s.currentStage || "unstarted")}
                    </span>
                  ) : (
                    <Link to={garmentPath(s._id)} className="hover:underline">
                      {s.clothingType} — {stageLabel(s.currentStage || "unstarted")}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {preview && (
        <button
          type="button"
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 p-4"
          onClick={() => setPreview(null)}
          aria-label="Close preview"
        >
          <img src={imageUrlFromPath(preview)} alt="" className="max-h-full max-w-full rounded-lg object-contain" />
        </button>
      )}
    </div>
  );
}

function Fact({
  label,
  value,
  children,
  capitalize,
  tone
}: {
  label: string;
  value: string;
  children?: ReactNode;
  capitalize?: boolean;
  tone?: "urgent";
}) {
  return (
    <div>
      <p className="ui-label">{label}</p>
      <p
        className={clsx(
          "mt-1 text-lg font-semibold text-ink",
          capitalize && "capitalize",
          tone === "urgent" && "text-red-700"
        )}
      >
        {value}
      </p>
      {children && <p className="text-sm text-ink-muted">{children}</p>}
    </div>
  );
}
