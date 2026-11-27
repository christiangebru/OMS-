import clsx from "clsx";
import { BarcodeImage } from "./BarcodeImage";
import { formatDate } from "@/lib/format";
import type { Label, PrintMode } from "@/lib/labels";

/**
 * Physical sticker sizes (mm). On a roll every sticker is 50×30. On an A4
 * sheet the order label (for the bag) is larger and parts/accessories smaller.
 */
const SHEET_MM: Record<Label["kind"], [number, number]> = {
  order: [60, 40],
  garment: [50, 30],
  part: [40, 25],
  accessory: [40, 25]
};
const ROLL_MM: [number, number] = [50, 30];

/** On screen the types also differ in size, so they are told apart at a glance. */
const SCREEN_SCALE: Record<Label["kind"], number> = {
  order: 1.95,
  garment: 1.7,
  part: 1.45,
  accessory: 1.45
};

const KIND_TEXT: Record<Label["kind"], string> = {
  order: "Order · bag",
  garment: "Garment",
  part: "Part",
  accessory: "Accessory"
};

/**
 * One sticker. Thermal printers print black only, so each type has its own
 * shape: order = black top band + heavy border; garment = plain firm border;
 * part = dashed border + big black part-code block; accessory = rounded with
 * an outlined tag. Fixed physical size; nothing spills over the edge.
 */
export function LabelCard({
  label,
  mode = "roll",
  screenScale,
  className
}: {
  label: Label;
  mode?: PrintMode;
  screenScale?: number;
  className?: string;
}) {
  const [w, h] = mode === "roll" ? ROLL_MM : SHEET_MM[label.kind];
  const urgent = label.priority && label.priority !== "NORMAL";
  const scale = screenScale ?? SCREEN_SCALE[label.kind];

  const body = (
    <>
      <div className="label-top">
        <span className="label-kind">{KIND_TEXT[label.kind]}</span>
        {urgent && <span className="label-priority">{label.priority}</span>}
      </div>
      <p className="label-title">{label.title}</p>
      <p className="label-sub">
        {label.subtitle}
        {label.due && label.kind !== "part" ? ` · due ${formatDate(label.due)}` : ""}
      </p>
      <div className="label-bars">
        <BarcodeImage value={label.code} className="label-barcode" />
      </div>
      <p className="label-code">{label.code}</p>
    </>
  );

  return (
    <article
      className={clsx("label-card", `label-card--${label.kind}`, className)}
      style={
        {
          "--lw": `${w}mm`,
          "--lh": `${h}mm`,
          "--ls": scale
        } as React.CSSProperties
      }
    >
      {label.kind === "part" ? (
        <div className="label-part-row">
          <div className="label-part-code" aria-label={`Part ${label.partCode}`}>
            {label.partCode || "P"}
          </div>
          <div className="label-part-body">{body}</div>
        </div>
      ) : (
        body
      )}
    </article>
  );
}
