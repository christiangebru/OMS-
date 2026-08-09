import { Order } from "../models/Order.js";
import { OrderItem } from "../models/OrderItem.js";
import { StageCheckpoint } from "../models/StageCheckpoint.js";
import { ProductionLog } from "../models/ProductionLog.js";
import { deriveCurrentStage, resolveStageSequence } from "./stageSequence.js";
import { furthestStageAcrossItems, orderStatusFromStage } from "./orderStatusSync.js";

/**
 * Sync parent Order.productionStatus from furthest stage across its items.
 */
export async function syncOrderStatusFromItems(orderMongoId, userId = null) {
  const order = await Order.findById(orderMongoId);
  if (!order) return null;

  const items = await OrderItem.find({ order: order._id }).lean();
  const itemIds = items.map((i) => i._id);
  const checkpoints = itemIds.length
    ? await StageCheckpoint.find({ orderItemId: { $in: itemIds } }).lean()
    : [];

  const byItem = new Map();
  for (const cp of checkpoints) {
    const key = String(cp.orderItemId);
    if (!byItem.has(key)) byItem.set(key, []);
    byItem.get(key).push(cp);
  }

  const stages = [];
  for (const item of items) {
    const cps = byItem.get(String(item._id)) || [];
    const { stageSequence } = await resolveStageSequence(item.clothingType);
    stages.push(deriveCurrentStage(cps, stageSequence));
  }

  const furthest = furthestStageAcrossItems(stages);
  const nextStatus = orderStatusFromStage(furthest);
  const prev = order.productionStatus;

  if (prev !== nextStatus) {
    order.productionStatus = nextStatus;
    if (userId) order.lastUpdatedBy = userId;
    await order.save();
    await ProductionLog.create({
      orderId: order.orderId,
      mongoOrderId: order._id,
      userId: userId || undefined,
      action: "status_change",
      fromStatus: prev,
      toStatus: nextStatus,
      notes: furthest ? `Synced from furthest stage ${furthest}` : "Synced from production stages"
    });
  }

  return order;
}
