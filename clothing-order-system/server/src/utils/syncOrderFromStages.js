import { prisma } from "../db/prisma.js";
import { deriveCurrentStage, resolveStageSequence } from "./stageSequence.js";
import { orderStatusFromItemStages } from "./orderStatusSync.js";
import { isTopLevelItem } from "./productionModel.js";

/**
 * Sync parent Order.productionStatus from per-garment completion.
 * An order stays incomplete until every garment is complete, then READY TO PACK.
 * Accepts an optional Prisma client so it can participate in a transaction.
 */
export async function syncOrderStatusFromItems(orderId, userId = null, client = prisma) {
  const order = await client.order.findUnique({ where: { id: orderId } });
  if (!order) return null;
  if (order.productionStatus === "delivered") return order;

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

  const garmentStates = [];
  for (const item of items) {
    if (!isTopLevelItem(item)) continue;
    const cps = byItem.get(item.id) || [];
    const { stageSequence, offSiteStages } = await resolveStageSequence(item.clothingType);
    const itemOffSite = item.offSiteStages?.length ? item.offSiteStages : offSiteStages;
    garmentStates.push({
      ...item,
      stage: deriveCurrentStage(cps, stageSequence, itemOffSite)
    });
  }

  const nextStatus = orderStatusFromItemStages(garmentStates, { packedAt: order.packedAt });
  const prev = order.productionStatus;

  if (prev !== nextStatus) {
    const updated = await client.order.update({
      where: { id: order.id },
      data: { productionStatus: nextStatus, ...(userId ? { lastUpdatedBy: userId } : {}) }
    });
    const complete = garmentStates.filter((g) =>
      ["SHOWROOM", "READY", "PACKAGING", "DELIVERED"].includes(g.stage)
    ).length;
    await client.productionLog.create({
      data: {
        orderId: order.orderId,
        mongoOrderId: order.id,
        userId: userId || null,
        action: "status_change",
        fromStatus: prev,
        toStatus: nextStatus,
        notes: `Synced from garments ${complete}/${garmentStates.length} complete`
      }
    });
    return updated;
  }

  return order;
}
