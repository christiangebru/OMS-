import { prisma } from "../db/prisma.js";
import {
  clothingTypeToKey,
  SKIP_EMBROIDERY_SEQUENCE,
  ProductionStage,
  CANONICAL_GARMENT_SEQUENCE
} from "../constants/production.js";
import {
  canonicalStage,
  findCheckpoint,
  aliasesForStage
} from "./productionModel.js";

export async function resolveStageSequence(clothingType) {
  const key = clothingTypeToKey(clothingType);
  if (key) {
    const config = await prisma.clothingTypeConfig.findUnique({ where: { key } });
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
  }
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
 * Current stage for an item: open checkpoint stage, else last completed, else null (unstarted).
 */
export function deriveCurrentStage(checkpoints, stageSequence) {
  const open = checkpoints.find((c) => c.checkedInAt && !c.checkedOutAt);
  if (open) return resolveRequestedStage(open.stage, stageSequence) || open.stage;

  const closed = checkpoints
    .filter((c) => c.checkedOutAt)
    .sort((a, b) => new Date(b.checkedOutAt) - new Date(a.checkedOutAt));
  if (closed.length) {
    return resolveRequestedStage(closed[0].stage, stageSequence) || closed[0].stage;
  }

  return null;
}

export function nextExpectedStage(checkpoints, stageSequence) {
  const seq = stageSequence?.length ? stageSequence : SKIP_EMBROIDERY_SEQUENCE;
  for (const stage of seq) {
    const cp = findCheckpoint(checkpoints, stage);
    if (!cp) return stage;
    if (!cp.checkedOutAt) return stage;
  }
  return seq[seq.length - 1] || "SHOWROOM";
}

/**
 * Validate check-in at targetStage.
 * @returns {{ ok: true } | { ok: false, message: string }}
 */
export async function validateCheckIn(orderItemId, targetStage, stageSequence, { adminOverride = false } = {}) {
  if (!ProductionStage.includes(targetStage)) {
    return { ok: false, message: `Invalid stage: ${targetStage}` };
  }

  const seq = stageSequence || SKIP_EMBROIDERY_SEQUENCE;
  const resolved = resolveRequestedStage(targetStage, seq);
  if (!seq.includes(resolved) && !adminOverride) {
    return {
      ok: false,
      message: `Stage ${targetStage} is not in this clothing type's sequence (${seq.join(" → ")})`
    };
  }

  const checkpoints = await prisma.stageCheckpoint.findMany({ where: { orderItemId } });

  const openOther = checkpoints.find(
    (c) => !c.checkedOutAt && !aliasesForStage(resolved).includes(c.stage)
  );
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

  const idx = seq.indexOf(resolved);
  if (idx > 0 && !adminOverride) {
    for (let i = 0; i < idx; i++) {
      const prior = seq[i];
      const cp = findCheckpoint(checkpoints, prior);
      if (!cp?.checkedOutAt) {
        return {
          ok: false,
          message: `Cannot check in to ${targetStage}: prior stage ${prior} is not complete. Complete prior stages or use admin override.`
        };
      }
    }
  }

  return { ok: true, resolvedStage: resolved };
}

export function stageRank(stage, stageSequence) {
  const seq = stageSequence || CANONICAL_GARMENT_SEQUENCE;
  const resolved = resolveRequestedStage(stage, seq);
  const i = seq.indexOf(resolved);
  return i < 0 ? -1 : i;
}
