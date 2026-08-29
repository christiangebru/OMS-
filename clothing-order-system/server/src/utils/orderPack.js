import { canonicalStage, isGarmentCompleteStage, isTopLevelItem } from "./productionModel.js";
import { parseOperationalBarcode } from "./barcode.js";
import { prisma } from "../db/prisma.js";
import { hydrateOrder } from "./orderHydrate.js";
import { syncOrderStatusFromItems } from "./syncOrderFromStages.js";
import { s } from "./serialize.js";
import { deriveCurrentStage, resolveStageSequence } from "./stageSequence.js";

export function isOrderContainerBarcode(value) {
  const parsed = parseOperationalBarcode(value);
  return parsed?.kind === "order";
}

export function orderCompleteForPack(items) {
  const garments = (items || []).filter(isTopLevelItem);
  if (!garments.length) return false;
  return garments.every((g) => isGarmentCompleteStage(g.currentStage || g.stage));
}

export async function assertOrderReadyToPack(order, client = prisma) {
  const items = await client.orderItem.findMany({ where: { order: order.id } });
  const top = items.filter(isTopLevelItem);
  if (!top.length) {
    throw Object.assign(new Error("Order has no garments to pack"), { status: 400 });
  }
  const ids = top.map((i) => i.id);
  const checkpoints = await client.stageCheckpoint.findMany({
    where: { orderItemId: { in: ids } }
  });
  const byItem = new Map();
  for (const cp of checkpoints) {
    if (!byItem.has(cp.orderItemId)) byItem.set(cp.orderItemId, []);
    byItem.get(cp.orderItemId).push(cp);
  }
  const incomplete = [];
  for (const item of top) {
    const { stageSequence, offSiteStages } = await resolveStageSequence(item.clothingType);
    const itemOff = item.offSiteStages?.length ? item.offSiteStages : offSiteStages;
    const stage = deriveCurrentStage(byItem.get(item.id) || [], stageSequence, itemOff);
    if (!isGarmentCompleteStage(stage)) {
      incomplete.push({
        _id: item.id,
        clothingType: item.clothingType,
        barcodeValue: item.barcodeValue,
        currentStage: stage
      });
    }
  }
  if (incomplete.length) {
    throw Object.assign(
      new Error(
        `Cannot pack: ${incomplete.length} garment(s) are not complete (showroom). Incomplete orders must not pack.`
      ),
      { status: 400, incomplete }
    );
  }
  return top;
}

export async function packOrder(order, { userId, staffId, notes = "" }, client = prisma) {
  if (order.packedAt || order.productionStatus === "ready_for_pickup") {
    throw Object.assign(new Error("Order is already packed"), { status: 400 });
  }
  if (order.productionStatus === "delivered") {
    throw Object.assign(new Error("Order is already delivered"), { status: 400 });
  }
  await assertOrderReadyToPack(order, client);
  const now = new Date();
  const updated = await client.order.update({
    where: { id: order.id },
    data: {
      packedAt: now,
      productionStatus: "ready_for_pickup",
      lastUpdatedBy: userId || undefined
    }
  });
  await client.productionLog.create({
    data: {
      orderId: order.orderId,
      mongoOrderId: order.id,
      userId: userId || null,
      action: "pack",
      fromStatus: order.productionStatus,
      toStatus: "ready_for_pickup",
      notes: notes || "Packed via order barcode",
      metadata: { staffId, barcodeValue: order.barcodeValue }
    }
  });
  return updated;
}

export async function deliverPackedOrder(order, { userId, staffId, notes = "" }, client = prisma) {
  if (order.productionStatus === "delivered") {
    throw Object.assign(new Error("Order is already delivered"), { status: 400 });
  }
  if (!order.packedAt && order.productionStatus !== "ready_for_pickup") {
    throw Object.assign(
      new Error("Pack the order with the order barcode before pickup / delivery"),
      { status: 400 }
    );
  }
  const updated = await client.order.update({
    where: { id: order.id },
    data: {
      productionStatus: "delivered",
      lastUpdatedBy: userId || undefined
    }
  });
  await client.productionLog.create({
    data: {
      orderId: order.orderId,
      mongoOrderId: order.id,
      userId: userId || null,
      action: "deliver",
      fromStatus: order.productionStatus,
      toStatus: "delivered",
      notes: notes || "Marked ready for pickup / delivered via order barcode",
      metadata: { staffId, barcodeValue: order.barcodeValue }
    }
  });
  return updated;
}

export async function findOrderByContainerBarcode(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (!isOrderContainerBarcode(raw)) {
    return prisma.order.findFirst({
      where: {
        OR: [
          { barcodeValue: { equals: raw, mode: "insensitive" } },
          { orderId: { equals: raw, mode: "insensitive" } }
        ]
      }
    });
  }
  return prisma.order.findFirst({
    where: {
      OR: [
        { barcodeValue: { equals: raw, mode: "insensitive" } },
        { orderId: { equals: raw, mode: "insensitive" } }
      ]
    }
  });
}

export function packagingMessage(orderId) {
  return `Packing and delivery use the order barcode (${orderId || "ORD-n"}), not a garment scan.`;
}

export { canonicalStage, hydrateOrder, syncOrderStatusFromItems, s };
