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
  "OFF_SITE",
  "PACKAGING",
  "READY",
  "SHOWROOM",
  "DELIVERED"
];

/**
 * THE stage-name rulebook. Every stage comparison (checkpoints, assignments,
 * skills, scans) goes through canonicalStage / stageAliases below.
 *
 * Legacy name → atelier name. SEWING_CUTTING (first preparation) and
 * FINAL_SEWING (joining the parts) are different work: neither qualifies for
 * the other.
 */
export const LEGACY_STAGE_CANONICAL = {
  CUTTING: "SEWING_CUTTING",
  SEWING: "SEWING_CUTTING",
  READY: "SHOWROOM"
};

/** @deprecated kept for existing imports; same as LEGACY_STAGE_CANONICAL. */
export const SkillStageAliases = LEGACY_STAGE_CANONICAL;

export function canonicalStage(stage) {
  if (!stage) return stage;
  return LEGACY_STAGE_CANONICAL[stage] || stage;
}

/**
 * Stored stage values that count as `stage`.
 * - Atelier name: itself plus every legacy name that maps to it
 *   (SEWING_CUTTING → SEWING_CUTTING, CUTTING, SEWING).
 * - Legacy name: itself plus its atelier name only, so a legacy route that
 *   still lists CUTTING and SEWING as separate steps keeps them separate.
 */
export function stageAliases(stage) {
  if (!stage) return [];
  if (LEGACY_STAGE_CANONICAL[stage]) return [stage, LEGACY_STAGE_CANONICAL[stage]];
  const legacy = Object.keys(LEGACY_STAGE_CANONICAL).filter(
    (name) => LEGACY_STAGE_CANONICAL[name] === stage
  );
  return [stage, ...legacy];
}

/**
 * Stored stage values that belong to route step `step`. Names that are their
 * own step in `stageSequence` are excluded, so they are never double-counted.
 */
export function stepStageNames(step, stageSequence = []) {
  const seq = Array.isArray(stageSequence) ? stageSequence : [];
  return stageAliases(step).filter((name) => name === step || !seq.includes(name));
}

export function stageMatchesStep(storedStage, step, stageSequence = []) {
  return stepStageNames(step, stageSequence).includes(storedStage);
}

/**
 * Skills are workstation work only. RECEIVED, OFF_SITE, SHOWROOM, PACKAGING and
 * DELIVERED are states or locations the manager scans, not skills.
 */
export const SkillProductionStage = ["SEWING_CUTTING", "EMBROIDERY", "FINAL_SEWING", "FINISHING"];

export function normalizeSkillStage(stage) {
  return canonicalStage(stage);
}

/** Skill rows (by stored stage) that qualify a worker for `stage`. */
export function skillStageVariants(stage) {
  return stageAliases(stage);
}

/** Display / timeline sequence (no duplicate legacy aliases). */
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

/** Physical off-site location — not a workstation and not RECEIVED. */
export const OFF_SITE_STAGE = "OFF_SITE";

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

/** In-shop workstations in atelier terms (legacy names fold into these). */
export const CANONICAL_WORKSTATION_STAGES = ["SEWING_CUTTING", "EMBROIDERY", "FINAL_SEWING", "FINISHING"];

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
  cutter: ["CUTTING", "SEWING_CUTTING", "OFF_SITE"],
  tailor: ["SEWING", "SEWING_CUTTING", "FINAL_SEWING", "OFF_SITE"],
  embroiderer: ["EMBROIDERY", "OFF_SITE"],
  finisher: ["FINISHING", "OFF_SITE"],
  packer: ["PACKAGING", "SHOWROOM", "READY", "OFF_SITE"],
  delivery: ["SHOWROOM", "READY", "DELIVERED", "PACKAGING"]
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
export const ItemAudience = ["men", "women", "kids_boy", "kids_girl"];
export const ItemSetChoice = ["shirt", "trouser", "both", "belt", "netela", "garment"];
export const PartLabelMode = ["none", "all", "selected"];

export const ProductionStatus = [
  "pending",
  "cutting",
  "stitching",
  "finishing",
  "completed",
  "ready_to_pack",
  "ready_for_pickup",
  "delivered"
];

export const ORDER_COMPLETE_STATUSES = [
  "completed",
  "ready_to_pack",
  "ready_for_pickup",
  "delivered"
];
export const ORDER_OPEN_STATUSES = ProductionStatus.filter((s) => s !== "delivered");

/** Normalize free-text clothing type to a ClothingTypeConfig key */
export function clothingTypeToKey(clothingType) {
  return String(clothingType || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}
