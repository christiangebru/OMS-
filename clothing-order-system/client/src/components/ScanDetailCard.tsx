import { useState } from "react";
import { Link } from "react-router-dom";
import { imageUrlFromPath } from "@/lib/api";
import type { ScanDetails } from "@/lib/types";
import clsx from "clsx";

export function ScanDetailCard({ details }: { details: ScanDetails }) {
  const [open, setOpen] = useState(false);
  const days = details.timing.daysRemaining;
  const daysLabel =
    days == null
      ? "—"
      : details.timing.overdue
        ? `${Math.abs(Math.ceil(days))}d overdue`
        : `${Math.ceil(days)}d left`;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-card dark:border-slate-800 dark:bg-slate-900">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <p className="text-xs font-semibold uppercase text-slate-500">Customer</p>
          <p className="text-2xl font-bold text-slate-900 dark:text-white">
            {details.customer?.name || "—"}
          </p>
          <p className="text-sm text-slate-500">{details.customer?.phone}</p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase text-slate-500">Item</p>
          <p className="text-2xl font-bold text-slate-900 dark:text-white">
            {details.item.clothingType}
          </p>
          <p className="text-sm text-slate-500">
            {details.item.fabricType} · {details.item.color} · {details.item.size}
          </p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase text-slate-500">Stage</p>
          <p className="text-xl font-bold">
            {details.timing.currentStage || "UNSTARTED"}
            <span className="ml-2 text-sm font-normal text-slate-500">
              → {details.timing.nextExpectedStage}
            </span>
          </p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase text-slate-500">Due</p>
          <p
            className={clsx(
              "text-xl font-bold",
              details.timing.overdue ? "text-red-600" : "text-slate-900 dark:text-white"
            )}
          >
            {daysLabel}
          </p>
          <p className="text-xs text-slate-500">
            {String(details.timing.requiredCompletionDate).slice(0, 10)} ·{" "}
            <Link
              className="font-semibold text-brand-600 hover:underline"
              to={`/orders/${encodeURIComponent(details.order.orderId)}`}
            >
              {details.order.orderId}
            </Link>
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-4 text-sm">
        <span>
          Balance <strong>{details.pricing.balanceRemaining.toFixed(2)}</strong> (deposit{" "}
          {details.pricing.depositPaid.toFixed(2)} / {details.pricing.totalAgreedPrice.toFixed(2)})
        </span>
        {details.order.priority && details.order.priority !== "NORMAL" && (
          <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-900">
            {details.order.priority}
          </span>
        )}
      </div>

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="mt-4 text-sm font-semibold text-brand-600 hover:underline"
      >
        {open ? "Hide details" : "Show measurements, images, siblings"}
      </button>

      {open && (
        <div className="mt-4 space-y-4 border-t border-slate-100 pt-4 dark:border-slate-800">
          {details.customer?.secondaryPhone && (
            <p className="text-sm">Secondary phone: {details.customer.secondaryPhone}</p>
          )}
          {details.item.notes && (
            <p className="text-sm text-slate-600 dark:text-slate-300">Notes: {details.item.notes}</p>
          )}
          {details.item.measurements && (
            <div>
              <p className="text-xs font-semibold uppercase text-slate-500">Measurements</p>
              <div className="mt-1 flex flex-wrap gap-2 text-xs">
                {Object.entries(details.item.measurements).map(([k, v]) =>
                  v ? (
                    <span key={k} className="rounded bg-slate-100 px-2 py-1 dark:bg-slate-800">
                      {k}: {v}
                    </span>
                  ) : null
                )}
              </div>
            </div>
          )}
          {details.item.images?.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {details.item.images.map((img) => (
                <img
                  key={img._id || img.imageUrl}
                  src={imageUrlFromPath(img.imageUrl)}
                  alt={img.caption || ""}
                  className="h-20 w-20 rounded-lg object-cover"
                />
              ))}
            </div>
          )}
          {details.group.groupCode && (
            <p className="text-sm">
              Group <strong>{details.group.groupCode}</strong> —{" "}
              {details.group.otherOrdersSharingGroup} other orders /{" "}
              {details.group.otherItemsSharingGroup} other items
            </p>
          )}
          <div>
            <p className="text-xs font-semibold uppercase text-slate-500">Sibling items</p>
            <ul className="mt-1 space-y-1 text-sm">
              {details.order.siblingItems.map((s) => (
                <li
                  key={s._id}
                  className={clsx(s.isCurrent && "font-semibold text-brand-700 dark:text-brand-300")}
                >
                  {s.clothingType} ({s.clothingCode}) — {s.currentStage || "UNSTARTED"}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
