import { ProductionStage } from "../constants/production.js";
import {
  canonicalStage,
  isGarmentCompleteStage,
  isTopLevelItem
} from "./productionModel.js";

/** Map ProductionStage → Order.productionStatus (incomplete garments). */
export const STAGE_TO_ORDER_STATUS = {
  RECEIVED: "pending",
  CUTTING: "cutting",
  SEWING: "stitching",
  SEWING_CUTTING: "cutting",
  EMBROIDERY: "stitching",
  FINAL_SEWING: "stitching",
  FINISHING: "finishing",
  PACKAGING: "ready_to_pack",
  READY: "completed",
  SHOWROOM: "completed",
  DELIVERED: "delivered"
};

const STAGE_PROGRESS = Object.fromEntries(
  [
    "RECEIVED",
    "SEWING_CUTTING",
    "CUTTING",
    "SEWING",
    "EMBROIDERY",
    "FINAL_SEWING",
    "FINISHING",
    "SHOWROOM",
    "READY",
    "PACKAGING",
    "DELIVERED"
  ].map((s, i) => [s, i])
);

function rankOf(stage) {
  if (!stage) return -1;
  const canon = canonicalStage(stage);
  return STAGE_PROGRESS[canon] ?? STAGE_PROGRESS[stage] ?? -1;
}

/**
 * Furthest stage among items (legacy helper — order status no longer uses this).
 */
export function furthestStageAcrossItems(itemStages) {
  let best = null;
  let bestRank = -1;
  for (const stage of itemStages) {
    if (!stage) continue;
    const rank = rankOf(stage);
    if (rank > bestRank) {
      bestRank = rank;
      best = canonicalStage(stage) || stage;
    }
  }
  return best;
}

/**
 * Least-progressed stage among incomplete garments. Unstarted counts as lowest.
 */
export function laggingStageAcrossItems(itemStages) {
  let worst = null;
  let worstRank = Infinity;
  let sawUnstarted = false;
  for (const stage of itemStages) {
    if (!stage) {
      sawUnstarted = true;
      continue;
    }
    const rank = rankOf(stage);
    if (rank < worstRank) {
      worstRank = rank;
      worst = canonicalStage(stage) || stage;
    }
  }
  if (sawUnstarted) return worstRank === Infinity ? null : worst && rankOf(worst) <= 0 ? worst : null;
  return worst;
}

export function orderStatusFromStage(stage) {
  if (!stage) return "pending";
  return STAGE_TO_ORDER_STATUS[canonicalStage(stage)] || STAGE_TO_ORDER_STATUS[stage] || "pending";
}

/**
 * Completion is per garment. The order is incomplete until every top-level
 * garment/accessory is complete; then it becomes ready_to_pack.
 */
export function orderStatusFromItemStages(items) {
  const garments = (items || []).filter(isTopLevelItem);
  if (!garments.length) return "pending";

  const allDelivered = garments.every((g) => canonicalStage(g.stage) === "DELIVERED");
  if (allDelivered) return "delivered";

  const allComplete = garments.every((g) => isGarmentCompleteStage(g.stage));
  if (allComplete) return "ready_to_pack";

  const incomplete = garments.filter((g) => !isGarmentCompleteStage(g.stage));
  const lagging = laggingStageAcrossItems(incomplete.map((g) => g.stage));
  return orderStatusFromStage(lagging);
}

export { ProductionStage };
