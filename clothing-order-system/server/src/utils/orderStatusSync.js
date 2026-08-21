import { ProductionStage } from "../constants/production.js";

/** Map ProductionStage → Order.productionStatus */
export const STAGE_TO_ORDER_STATUS = {
  RECEIVED: "pending",
  CUTTING: "cutting",
  SEWING: "stitching",
  EMBROIDERY: "stitching",
  FINISHING: "finishing",
  PACKAGING: "finishing",
  READY: "completed",
  DELIVERED: "delivered"
};

const STAGE_PROGRESS = Object.fromEntries(ProductionStage.map((s, i) => [s, i]));

/**
 * Furthest stage among items (open or last completed per item).
 */
export function furthestStageAcrossItems(itemStages) {
  let best = null;
  let bestRank = -1;
  for (const stage of itemStages) {
    if (!stage) continue;
    const rank = STAGE_PROGRESS[stage] ?? -1;
    if (rank > bestRank) {
      bestRank = rank;
      best = stage;
    }
  }
  return best;
}

export function orderStatusFromStage(stage) {
  if (!stage) return "pending";
  return STAGE_TO_ORDER_STATUS[stage] || "pending";
}
