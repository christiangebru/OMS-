import {
  CANONICAL_GARMENT_SEQUENCE,
  FULL_STAGE_SEQUENCE,
  SKIP_EMBROIDERY_SEQUENCE
} from "../constants/production.js";

export const STAGE_CANONICAL = {
  CUTTING: "SEWING_CUTTING",
  SEWING: "SEWING_CUTTING",
  SEWING_CUTTING: "SEWING_CUTTING",
  READY: "SHOWROOM",
  SHOWROOM: "SHOWROOM",
  PACKAGING: "PACKAGING",
  FINAL_SEWING: "FINAL_SEWING",
  EMBROIDERY: "EMBROIDERY",
  FINISHING: "FINISHING",
  RECEIVED: "RECEIVED",
  DELIVERED: "DELIVERED"
};

export const STAGE_ALIASES = {
  SEWING_CUTTING: ["SEWING_CUTTING", "CUTTING", "SEWING"],
  SHOWROOM: ["SHOWROOM", "READY"],
  PACKAGING: ["PACKAGING"],
  FINAL_SEWING: ["FINAL_SEWING"],
  EMBROIDERY: ["EMBROIDERY"],
  FINISHING: ["FINISHING"],
  RECEIVED: ["RECEIVED"],
  DELIVERED: ["DELIVERED"]
};

export const PART_CATALOG = {
  WR: { code: "WR", label: "Wrist" },
  UB: { code: "UB", label: "Upper body" },
  LB: { code: "LB", label: "Lower body" },
  BD: { code: "BD", label: "Body" }
};

export const GARMENT_COMPLETE_STAGES = new Set(["SHOWROOM", "READY", "PACKAGING", "DELIVERED"]);

export function canonicalStage(stage) {
  if (!stage) return stage;
  return STAGE_CANONICAL[stage] || stage;
}

export function aliasesForStage(stage) {
  const canon = canonicalStage(stage);
  return STAGE_ALIASES[canon] || [stage, canon].filter(Boolean);
}

export function stagesMatch(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  return canonicalStage(a) === canonicalStage(b);
}

export function skillStagesFor(stage) {
  const canon = canonicalStage(stage);
  if (canon === "SEWING_CUTTING") return ["SEWING_CUTTING", "CUTTING", "SEWING"];
  if (canon === "SHOWROOM") return ["SHOWROOM", "READY"];
  if (canon === "FINAL_SEWING") return ["FINAL_SEWING", "SEWING"];
  return [...new Set([stage, canon])];
}

export function findCheckpoint(checkpoints = [], stage) {
  const aliases = aliasesForStage(stage);
  return checkpoints.find((c) => aliases.includes(c.stage)) || null;
}

export function isGarmentCompleteStage(stage) {
  return GARMENT_COMPLETE_STAGES.has(canonicalStage(stage)) || GARMENT_COMPLETE_STAGES.has(stage);
}

export function isTopLevelItem(item) {
  return String(item?.itemKind || "garment") !== "part" && !item?.parentItemId;
}

export function partLabel(code) {
  return PART_CATALOG[String(code || "").toUpperCase()]?.label || String(code || "Part");
}

export function defaultPartCodesForType(clothingType) {
  const t = String(clothingType || "").toLowerCase();
  if (/dress|abaya|thobe|gown/.test(t) && /women|female|dress|abaya/.test(t)) {
    return ["WR", "UB", "LB"];
  }
  if (/dress|abaya/.test(t)) return ["WR", "UB", "LB"];
  if (/shirt|top/.test(t)) return ["WR", "BD"];
  return [];
}

export function resolvePartCodes(clothingType, config, mode, selected = []) {
  const available = (config?.partCodes?.length ? config.partCodes : defaultPartCodesForType(clothingType)).map(
    (c) => String(c).toUpperCase()
  );
  if (mode === "all") return available;
  if (mode === "selected") {
    const want = new Set((selected || []).map((c) => String(c).toUpperCase()));
    return available.filter((c) => want.has(c));
  }
  return [];
}

/** Display sequence used by timelines — canonical names only. */
export function displayStageSequence() {
  return [...FULL_STAGE_SEQUENCE];
}

export function defaultSequence({ includesEmbroidery = false } = {}) {
  return includesEmbroidery ? [...CANONICAL_GARMENT_SEQUENCE] : [...SKIP_EMBROIDERY_SEQUENCE];
}

/**
 * Assembly is FINAL_SEWING (or FINISHING when a type has no final sewing).
 */
export function assemblyStage(stageSequence = []) {
  if (stageSequence.includes("FINAL_SEWING")) return "FINAL_SEWING";
  if (stageSequence.includes("FINISHING")) return "FINISHING";
  return null;
}

export function isPartReadyForAssembly(checkpoints, stageSequence) {
  const assembleAt = assemblyStage(stageSequence);
  if (!assembleAt) {
    return checkpoints.some((c) => c.checkedOutAt && isGarmentCompleteStage(c.stage));
  }
  const idx = stageSequence.indexOf(assembleAt);
  const prior = idx > 0 ? stageSequence.slice(0, idx) : [];
  if (!prior.length) {
    return checkpoints.some((c) => c.checkedOutAt);
  }
  return prior.every((stage) => {
    const cp = findCheckpoint(checkpoints, stage);
    return Boolean(cp?.checkedOutAt);
  });
}

export function parentReadyForAssembly(parts, checkpointsByItem, stageSequence) {
  if (!parts?.length) return false;
  return parts.every((part) =>
    isPartReadyForAssembly(checkpointsByItem.get(part.id) || [], stageSequence)
  );
}
