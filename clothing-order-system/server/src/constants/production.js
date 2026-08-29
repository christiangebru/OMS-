/**
 * Production stages.
 *
 * Canonical shop-floor path (per garment):
 *   SEWING_CUTTING → EMBROIDERY (optional) → FINAL_SEWING → FINISHING → SHOWROOM
 *
 * RECEIVED is a manager assignment state, not a workstation.
 * READY TO PACK is an order-level state (all garments in SHOWROOM).
 * CUTTING / SEWING / READY / PACKAGING remain valid for legacy checkpoints and scans.
 */
export const ProductionStage = [
  "RECEIVED",
  "CUTTING",
  "SEWING",
  "SEWING_CUTTING",
  "EMBROIDERY",
  "FINAL_SEWING",
  "FINISHING",
  "PACKAGING",
  "READY",
  "SHOWROOM",
  "DELIVERED"
];

/** Display / timeline sequence (no duplicate alias stages). */
export const FULL_STAGE_SEQUENCE = [
  "RECEIVED",
  "SEWING_CUTTING",
  "EMBROIDERY",
  "FINAL_SEWING",
  "FINISHING",
  "SHOWROOM",
  "PACKAGING",
  "DELIVERED"
];

/** Default garment path including embroidery. Pack/delivery are order-level. */
export const CANONICAL_GARMENT_SEQUENCE = [
  "SEWING_CUTTING",
  "EMBROIDERY",
  "FINAL_SEWING",
  "FINISHING",
  "SHOWROOM"
];

export const SKIP_EMBROIDERY_SEQUENCE = CANONICAL_GARMENT_SEQUENCE.filter((s) => s !== "EMBROIDERY");

export const OrderPriority = ["NORMAL", "RUSH", "VIP"];

export const StaffRole = ["TAILOR", "EMBROIDERER", "FINISHER", "CUTTER", "PACKER", "MANAGER"];

/** Stages that represent a physical workstation (workers of the same stage). */
export const WORKSTATION_STAGES = ["SEWING_CUTTING", "CUTTING", "SEWING", "EMBROIDERY", "FINAL_SEWING", "FINISHING"];

/** Login roles. Workers are optional user accounts; staff records remain the shop-floor identity. */
export const UserRole = [
  "admin",
  "manager",
  "reception",
  "cutter",
  "tailor",
  "embroiderer",
  "finisher",
  "packer",
  "delivery"
];

export const ROLE_PRODUCTION_STAGES = {
  cutter: ["CUTTING", "SEWING_CUTTING"],
  tailor: ["SEWING", "SEWING_CUTTING", "FINAL_SEWING"],
  embroiderer: ["EMBROIDERY"],
  finisher: ["FINISHING"],
  packer: ["PACKAGING", "SHOWROOM", "READY"],
  delivery: ["SHOWROOM", "READY", "DELIVERED"]
};

export function stagesForUserRole(role) {
  return ROLE_PRODUCTION_STAGES[role] || null;
}

export const IMAGE_CATEGORIES = [
  "front",
  "back",
  "side",
  "detail",
  "inspiration",
  "reference",
  "sleeve",
  "collar",
  "embroidery",
  "fabric",
  "design",
  "customer",
  "other"
];

export const MEASUREMENT_CATEGORIES = ["male", "female", "child", "baby", "unspecified"];

export const StaffStatus = ["AVAILABLE", "BUSY", "OFF_DUTY"];

export const NeckType = ["V-shape", "square", "oval"];
export const HandType = ["wide", "normal"];
export const SizeCategory = ["adult", "kids", "baby"];
export const ItemKind = ["garment", "accessory", "part"];
export const PartLabelMode = ["none", "all", "selected"];

export const ProductionStatus = [
  "pending",
  "cutting",
  "stitching",
  "finishing",
  "completed",
  "ready_to_pack",
  "delivered"
];

export const ORDER_COMPLETE_STATUSES = ["completed", "ready_to_pack", "delivered"];
export const ORDER_OPEN_STATUSES = ProductionStatus.filter((s) => s !== "delivered");

/** Normalize free-text clothing type to a ClothingTypeConfig key */
export function clothingTypeToKey(clothingType) {
  return String(clothingType || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}
