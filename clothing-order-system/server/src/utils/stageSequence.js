import { prisma } from "../db/prisma.js";
import {
  clothingTypeToKey,
  SKIP_EMBROIDERY_SEQUENCE,
  ProductionStage,
  CANONICAL_GARMENT_SEQUENCE
} from "../constants/production.js";
import { findClothingTypeConfig } from "./clothingTypeConfig.js";
import { canonicalStage, aliasesForStage } from "./productionModel.js";
import {
  OFF_SITE_STAGE,
  deriveCurrentStageWithOffSite,
  effectiveScanSequence,
  nextExpectedStageWithOffSite,
  openOffSiteCheckpoint,
  pendingOffSiteWindow,
  priorEffectiveStagesComplete,
  stageIsOffSiteWork
} from "./offSite.js";

export async function resolveStageSequence(clothingType, clothingCode) {
  const config = await findClothingTypeConfig(prisma, clothingType, clothingCode);
  if (config?.stageSequence?.length) {
    const stageSequence = normalizeStoredSequence(config.stageSequence);
    return {
      key: config.key,
      label: config.label,
      stageSequence,
      includesEmbroidery: config.includesEmbroidery,
      itemKind: config.itemKind || "garment",
      partCodes: config.partCodes || [],
      offSiteStages: config.offSiteStages || [],
      compactLabel: Boolean(config.compactLabel),
      measurementProfile: config.measurementProfile || "",
      fallback: false
    };
  }
  const key = clothingTypeToKey(clothingType);
  return {
    key: key || "unknown",
    label: clothingType || "Unknown",
    stageSequence: [...SKIP_EMBROIDERY_SEQUENCE],
    includesEmbroidery: false,
    itemKind: "garment",
    partCodes: [],
    offSiteStages: [],
    compactLabel: false,
    measurementProfile: "",
    fallback: true
  };
}

/**
 * New canonical sequences do not include PACKAGING (order-level).
 * Legacy configs that still list READY without PACKAGING keep the old insert.
 */
export function ensurePackagingStage(seq = []) {
  return normalizeStoredSequence(seq);
}

export function normalizeStoredSequence(seq = []) {
  const list = Array.isArray(seq) ? [...seq] : [];
  const isCanonical =
    list.includes("SEWING_CUTTING") || list.includes("FINAL_SEWING") || list.includes("SHOWROOM");
  if (isCanonical) {
    return list.filter((s) => s !== "RECEIVED");
  }
  if (list.includes("PACKAGING")) return list;
  const ready = list.indexOf("READY");
  if (ready >= 0) {
    list.splice(ready, 0, "PACKAGING");
    return list;
  }
  const delivered = list.indexOf("DELIVERED");
  if (delivered >= 0) {
    list.splice(delivered, 0, "PACKAGING");
    return list;
  }
  return list.length ? list : [...SKIP_EMBROIDERY_SEQUENCE];
}

/**
 * Map a scanned/requested stage onto the clothing type's sequence (aliases).
 */
export function resolveRequestedStage(requested, stageSequence = []) {
  if (!requested) return requested;
  if (stageSequence.includes(requested)) return requested;
  const canon = canonicalStage(requested);
  if (stageSequence.includes(canon)) return canon;
  const match = stageSequence.find((s) => aliasesForStage(s).includes(requested));
  return match || requested;
}

/**
 * Current stage for an item: open checkpoint (OFF_SITE if the garment is off-site),
 * else last completed in-shop stage, else null (unstarted).
 */
export function deriveCurrentStage(checkpoints, stageSequence, offSiteStages = []) {
  return deriveCurrentStageWithOffSite(checkpoints, stageSequence, offSiteStages);
}

export function nextExpectedStage(checkpoints, stageSequence, offSiteStages = []) {
  return nextExpectedStageWithOffSite(checkpoints, stageSequence, offSiteStages);
}

/**
 * Validate check-in at targetStage.
 * Off-site windows use OFF_SITE as the scan location; in-shop stages that
 * happen off-site are not valid workstations unless adminOverride.
 * @returns {{ ok: true } | { ok: false, message: string }}
 */
export async function validateCheckIn(
  orderItemId,
  targetStage,
  stageSequence,
  { adminOverride = false, offSiteStages = [] } = {}
) {
  if (!ProductionStage.includes(targetStage)) {
    return { ok: false, message: `Invalid stage: ${targetStage}` };
  }

  const seq = stageSequence || SKIP_EMBROIDERY_SEQUENCE;
  const effective = effectiveScanSequence(seq, offSiteStages);
  const resolved =
    targetStage === OFF_SITE_STAGE
      ? OFF_SITE_STAGE
      : resolveRequestedStage(targetStage, seq);

  if (!adminOverride && stageIsOffSiteWork(resolved, offSiteStages) && resolved !== OFF_SITE_STAGE) {
    return {
      ok: false,
      message: `Stage ${targetStage} happens off-site. Scan out to off-site, then scan in on return.`
    };
  }

  if (!effective.includes(resolved) && !adminOverride) {
    return {
      ok: false,
      message: `Stage ${targetStage} is not in this clothing type's sequence (${seq.join(" → ")})`
    };
  }

  const checkpoints = await prisma.stageCheckpoint.findMany({ where: { orderItemId } });
  const openOff = openOffSiteCheckpoint(checkpoints);
  const pending = pendingOffSiteWindow(checkpoints, seq, offSiteStages);

  if (resolved === OFF_SITE_STAGE && !adminOverride && !openOff && !pending) {
    return {
      ok: false,
      message: "This garment has no remaining off-site trip."
    };
  }
  const returnStage = pending?.returnStage;
  const returningHere =
    Boolean(openOff) &&
    returnStage &&
    (returnStage === resolved || aliasesForStage(returnStage).includes(resolved));

  if (openOff && resolved !== OFF_SITE_STAGE && !adminOverride && !returningHere) {
    return {
      ok: false,
      message: `Item is off-site. Scan in from off-site (return at ${returnStage || "the next in-shop stage"}) first.`
    };
  }

  const openOther = checkpoints.find((c) => {
    if (c.checkedOutAt) return false;
    if (aliasesForStage(resolved).includes(c.stage)) return false;
    if (c.stage === OFF_SITE_STAGE && returningHere) return false;
    return true;
  });
  if (openOther) {
    return {
      ok: false,
      message: `Item has an open checkpoint at ${openOther.stage}. Check out that stage first.`
    };
  }

  const openSame = checkpoints.find(
    (c) => !c.checkedOutAt && aliasesForStage(resolved).includes(c.stage)
  );
  if (openSame) {
    return { ok: true, alreadyOpen: true, checkpoint: openSame };
  }

  if (!adminOverride) {
    const prior = priorEffectiveStagesComplete(checkpoints, resolved, seq, offSiteStages);
    if (!prior.ok) {
      return { ok: false, message: prior.message };
    }
  }

  return { ok: true, resolvedStage: resolved, closeOffSite: Boolean(returningHere && openOff) };
}

export function stageRank(stage, stageSequence) {
  const seq = stageSequence || CANONICAL_GARMENT_SEQUENCE;
  const resolved = resolveRequestedStage(stage, seq);
  const i = seq.indexOf(resolved);
  return i < 0 ? -1 : i;
}
