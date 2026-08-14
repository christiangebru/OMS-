import { prisma } from "../db/prisma.js";
import { deriveCurrentStage, resolveStageSequence } from "./stageSequence.js";
import { furthestStageAcrossItems, orderStatusFromStage } from "./orderStatusSync.js";

/**
 * Sync parent Order.productionStatus from furthest stage across its items.
 * Accepts an optional Prisma client so it can participate in a transaction.
 */
export async function syncOrderStatusFromItems(orderId, userId = null, client = prisma) {
  const order = await client.order.findUnique({ where: { id: orderId } });
  if (!order) return null;

  const items = await client.orderItem.findMany({ where: { order: order.id } });
  const itemIds = items.map((i) => i.id);
  const checkpoints = itemIds.length
    ? await client.stageCheckpoint.findMany({ where: { orderItemId: { in: itemIds } } })
    : [];

  const byItem = new Map();
  for (const cp of checkpoints) {
    const key = cp.orderItemId;
    if (!byItem.has(key)) byItem.set(key, []);
    byItem.get(key).push(cp);
  }

  const stages = [];
  for (const item of items) {
    const cps = byItem.get(item.id) || [];
    const { stageSequence } = await resolveStageSequence(item.clothingType);
    stages.push(deriveCurrentStage(cps, stageSequence));
  }

  const furthest = furthestStageAcrossItems(stages);
  const nextStatus = orderStatusFromStage(furthest);
  const prev = order.productionStatus;

  if (prev !== nextStatus) {
    const updated = await client.order.update({
      where: { id: order.id },
      data: { productionStatus: nextStatus, ...(userId ? { lastUpdatedBy: userId } : {}) }
    });
    await client.productionLog.create({
      data: {
        orderId: order.orderId,
        mongoOrderId: order.id,
        userId: userId || null,
        action: "status_change",
        fromStatus: prev,
        toStatus: nextStatus,
        notes: furthest
          ? `Synced from furthest stage ${furthest}`
          : "Synced from production stages"
      }
    });
    return updated;
  }

  return order;
}
