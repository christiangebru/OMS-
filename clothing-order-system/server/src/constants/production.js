export const ProductionStage = [
  "RECEIVED",
  "CUTTING",
  "SEWING",
  "EMBROIDERY",
  "FINISHING",
  "READY",
  "DELIVERED"
];

export const FULL_STAGE_SEQUENCE = [...ProductionStage];

export const SKIP_EMBROIDERY_SEQUENCE = ProductionStage.filter((s) => s !== "EMBROIDERY");

export const OrderPriority = ["NORMAL", "RUSH", "VIP"];

export const StaffRole = ["TAILOR", "EMBROIDERER", "FINISHER", "CUTTER", "MANAGER"];

export const StaffStatus = ["AVAILABLE", "BUSY", "OFF_DUTY"];

export const NeckType = ["V-shape", "square", "oval"];
export const HandType = ["wide", "normal"];
export const SizeCategory = ["adult", "kids", "baby"];
export const ProductionStatus = [
  "pending",
  "cutting",
  "stitching",
  "finishing",
  "completed",
  "delivered"
];

/** Normalize free-text clothing type to a ClothingTypeConfig key */
export function clothingTypeToKey(clothingType) {
  return String(clothingType || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}
