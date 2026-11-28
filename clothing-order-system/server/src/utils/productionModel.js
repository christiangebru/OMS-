import {
  CANONICAL_GARMENT_SEQUENCE,
  FULL_STAGE_SEQUENCE,
  LATE_ADDED_STAGES,
  SKIP_EMBROIDERY_SEQUENCE,
  ProductionStage,
  canonicalStage as rulebookCanonical,
  stageAliases,
  stepStageNames,
  stageMatchesStep
} from "../constants/production.js";

export { stepStageNames, stageMatchesStep };

/** Derived from the rulebook in constants/production.js (kept for existing imports). */
export const STAGE_CANONICAL = Object.fromEntries(
  [...ProductionStage].map((stage) => [stage, rulebookCanonical(stage)])
);

export const PART_CATALOG = {
  WR: { code: "WR", label: "Wrist" },
  UB: { code: "UB", label: "Upper body" },
  LB: { code: "LB", label: "Lower body" },
  BD: { code: "BD", label: "Body" }
};

export const GARMENT_COMPLETE_STAGES = new Set(["SHOWROOM", "READY", "PACKAGING", "DELIVERED"]);

export function canonicalStage(stage) {
  return rulebookCanonical(stage);
}

export function aliasesForStage(stage) {
  return stageAliases(stage);
}

export function stagesMatch(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  return canonicalStage(a) === canonicalStage(b);
}

/** Skill rows that qualify a worker for `stage` (same rule as everywhere else). */
export function skillStagesFor(stage) {
  return stageAliases(stage);
}

/**
 * Checkpoint for route step `stage`. With `stageSequence`, names that are their
 * own step in that route are not borrowed. Prefers an open checkpoint, then the
 * most recent one (so a redone stage reflects the latest attempt).
 */
export function findCheckpoint(checkpoints = [], stage, stageSequence = []) {
  const names = stepStageNames(stage, stageSequence);
  const matches = checkpoints.filter((c) => names.includes(c.stage));
  if (!matches.length) return null;
  const open = matches.find((c) => !c.checkedOutAt);
  if (open) return open;
  return [...matches].sort(
    (a, b) => new Date(b.checkedInAt || 0) - new Date(a.checkedInAt || 0)
  )[0];
}

/**
 * A step added to the routes later (DESIGN) that this garment went past
 * before it existed: no checkpoint for it, but a later step has one (in the
 * shop, or covered by an off-site trip). It counts as not part of its route.
 */
export function skippedLateStage(stage, stageSequence = [], checkpoints = []) {
  if (!LATE_ADDED_STAGES.includes(stage)) return false;
  if (findCheckpoint(checkpoints, stage, stageSequence)) return false;
  const later = stageSequence.slice(stageSequence.indexOf(stage) + 1);
  return checkpoints.some(
    (c) =>
      later.some((s) => stepStageNames(s, stageSequence).includes(c.stage)) ||
      (Array.isArray(c.coveredStages) && c.coveredStages.some((s) => later.includes(s)))
  );
}

/** The route without late-added steps this garment never had. */
export function routeForCheckpoints(stageSequence = [], checkpoints = []) {
  return stageSequence.filter((s) => !skippedLateStage(s, stageSequence, checkpoints));
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
    return checkpoints.some((c) => c.checkedOutAt && c.stage !== "RECEIVED");
  }
  return prior.every((stage) => {
    if (skippedLateStage(stage, stageSequence, checkpoints)) return true;
    const cp = findCheckpoint(checkpoints, stage, stageSequence);
    return Boolean(cp?.checkedOutAt);
  });
}

/** Stages an item skips; no embroidery also means no design drawn for it. */
export function expandSkipStages(skipStages = []) {
  const skip = Array.isArray(skipStages) ? skipStages.filter(Boolean) : [];
  if (skip.includes("EMBROIDERY") && !skip.includes("DESIGN")) skip.push("DESIGN");
  return skip;
}

/** Each part is judged on its own route (a part may skip a stage, e.g. EMBROIDERY). */
export function parentReadyForAssembly(parts, checkpointsByItem, stageSequence) {
  if (!parts?.length) return false;
  return parts.every((part) => {
    const skip = expandSkipStages(part.skipStages || []);
    const seq = skip.length ? stageSequence.filter((s) => !skip.includes(s)) : stageSequence;
    return isPartReadyForAssembly(checkpointsByItem.get(part.id) || [], seq);
  });
}
