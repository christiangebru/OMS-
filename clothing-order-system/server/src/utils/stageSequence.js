import { prisma } from "../db/prisma.js";
import {
  clothingTypeToKey,
  SKIP_EMBROIDERY_SEQUENCE,
  ProductionStage
} from "../constants/production.js";

export async function resolveStageSequence(clothingType) {
  const key = clothingTypeToKey(clothingType);
  if (key) {
    const config = await prisma.clothingTypeConfig.findUnique({ where: { key } });
    if (config?.stageSequence?.length) {
      return {
        key: config.key,
        label: config.label,
        stageSequence: config.stageSequence,
        includesEmbroidery: config.includesEmbroidery,
        fallback: false
      };
    }
  }
  return {
    key: key || "unknown",
    label: clothingType || "Unknown",
    stageSequence: [...SKIP_EMBROIDERY_SEQUENCE],
    includesEmbroidery: false,
    fallback: true
  };
}

/**
 * Current stage for an item: open checkpoint stage, else last completed, else null (unstarted).
 */
export function deriveCurrentStage(checkpoints, stageSequence) {
  const open = checkpoints.find((c) => c.checkedInAt && !c.checkedOutAt);
  if (open) return open.stage;

  const closed = checkpoints
    .filter((c) => c.checkedOutAt)
    .sort((a, b) => new Date(b.checkedOutAt) - new Date(a.checkedOutAt));
  if (closed.length) return closed[0].stage;

  return null;
}

export function nextExpectedStage(checkpoints, stageSequence) {
  const seq = stageSequence || SKIP_EMBROIDERY_SEQUENCE;
  for (const stage of seq) {
    const cp = checkpoints.find((c) => c.stage === stage);
    if (!cp) return stage;
    if (!cp.checkedOutAt) return stage; // still in this stage
  }
  return seq[seq.length - 1] || "DELIVERED";
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
  if (!seq.includes(targetStage) && !adminOverride) {
    return {
      ok: false,
      message: `Stage ${targetStage} is not in this clothing type's sequence (${seq.join(" → ")})`
    };
  }

  const checkpoints = await prisma.stageCheckpoint.findMany({ where: { orderItemId } });

  const openOther = checkpoints.find(
    (c) => !c.checkedOutAt && c.stage !== targetStage
  );
  if (openOther) {
    return {
      ok: false,
      message: `Item has an open checkpoint at ${openOther.stage}. Check out that stage first.`
    };
  }

  const openSame = checkpoints.find((c) => !c.checkedOutAt && c.stage === targetStage);
  if (openSame) {
    return { ok: true, alreadyOpen: true, checkpoint: openSame };
  }

  const idx = seq.indexOf(targetStage);
  if (idx > 0 && !adminOverride) {
    for (let i = 0; i < idx; i++) {
      const prior = seq[i];
      const cp = checkpoints.find((c) => c.stage === prior && c.checkedOutAt);
      if (!cp) {
        return {
          ok: false,
          message: `Cannot check in to ${targetStage}: prior stage ${prior} is not complete. Complete prior stages or use admin override.`
        };
      }
    }
  }

  return { ok: true };
}

export function stageRank(stage, stageSequence) {
  const seq = stageSequence || ProductionStage;
  const i = seq.indexOf(stage);
  return i < 0 ? -1 : i;
}
