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
  cutter: ["CUTTING"],
  tailor: ["SEWING"],
  embroiderer: ["EMBROIDERY"],
  finisher: ["FINISHING"],
  packer: ["READY"],
  delivery: ["READY", "DELIVERED"]
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
