import { Link } from "react-router-dom";
import { imageUrlFromPath } from "@/lib/api";
import { boardStatusLabel, formatMoney, stageLabel } from "@/lib/format";
import { Badge } from "@/components/ui/PageHeader";
import clsx from "clsx";

export type GarmentCardModel = {
  itemId: string;
  clothingType: string;
  barcodeValue?: string;
  customerName?: string | null;
  orderId?: string;
  stage?: string | null;
  workerName?: string | null;
  boardStatus?: string | null;
  dueLabel?: string;
  overdue?: boolean;
  thumbnail?: string;
  unitPrice?: number;
};

export function garmentPath(itemId: string) {
  return `/garments/${encodeURIComponent(itemId)}`;
}

export function GarmentCard({ garment, compact = false }: { garment: GarmentCardModel; compact?: boolean }) {
  const status = garment.boardStatus;
  return (
    <Link
      to={garmentPath(garment.itemId)}
      className={clsx(
        "ui-card block p-3 transition hover:border-accent/40",
        compact ? "p-2.5" : "p-4"
      )}
    >
      <div className="flex gap-3">
        {garment.thumbnail ? (
          <img
            src={imageUrlFromPath(garment.thumbnail)}
            alt=""
            className={clsx("shrink-0 rounded-control object-cover", compact ? "h-12 w-12" : "h-16 w-16")}
          />
        ) : (
          <div
            className={clsx(
              "flex shrink-0 items-center justify-center rounded-control bg-canvas text-[10px] font-semibold uppercase text-ink-faint",
              compact ? "h-12 w-12" : "h-16 w-16"
            )}
          >
            {garment.clothingType.slice(0, 2)}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-ink">{garment.clothingType}</p>
          {garment.barcodeValue && (
            <p className="mt-0.5 font-mono text-[11px] tracking-wide text-ink-muted">{garment.barcodeValue}</p>
          )}
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {garment.stage && (
              <span className="text-[11px] capitalize text-ink-muted">{stageLabel(garment.stage)}</span>
            )}
            {status && (
              <Badge
                tone={
                  garment.overdue
                    ? "urgent"
                    : status === "in_progress"
                      ? "progress"
                      : status === "waiting"
                        ? "warn"
                        : "ok"
                }
              >
                {boardStatusLabel(status)}
              </Badge>
            )}
          </div>
          <p className="mt-1 truncate text-[11px] text-ink-muted">
            {[garment.workerName || (status === "waiting" ? "Unassigned" : null), garment.dueLabel]
              .filter(Boolean)
              .join(" · ")}
            {garment.unitPrice ? ` · ${formatMoney(garment.unitPrice)}` : ""}
          </p>
        </div>
      </div>
    </Link>
  );
}
