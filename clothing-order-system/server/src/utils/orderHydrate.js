import { prisma } from "../db/prisma.js";
import { s } from "./serialize.js";
import { operationalItemBarcode } from "./barcode.js";
import { deriveCurrentStage, nextExpectedStage, resolveStageSequence } from "./stageSequence.js";
import { boardStatusFrom } from "./stageTimeline.js";

export function balanceRemaining(order) {
  const total = Number(order.totalAgreedPrice) || 0;
  const deposit = Number(order.depositPaid) || 0;
  return Math.max(0, total - deposit);
}

function buildCustomerSummary(customer) {
  return customer
    ? {
        _id: customer.id,
        name: customer.name,
        phone: customer.phone,
        secondaryPhone: customer.secondaryPhone
      }
    : null;
}

/**
 * Attach customer, items (+ images), balanceRemaining, and optional checkpoints
 * to a single order record.
 */
export async function hydrateOrder(order, { includeCheckpoints = true } = {}) {
  if (!order) return null;

  const [customer, items] = await Promise.all([
    order.customerId
      ? prisma.customer.findUnique({ where: { id: order.customerId } })
      : Promise.resolve(null),
    prisma.orderItem.findMany({
      where: { order: order.id },
      orderBy: { createdAt: "asc" }
    })
  ]);
  if (!order.group && order.groupId) {
    order.group = await prisma.orderGroup.findUnique({ where: { id: order.groupId } });
  }

  const itemIds = items.map((i) => i.id);
  const [images, checkpoints, assignments] = await Promise.all([
    itemIds.length
      ? prisma.orderItemImage.findMany({
          where: { orderItemId: { in: itemIds } },
          orderBy: [{ sortOrder: "asc" }, { uploadedAt: "asc" }]
        })
      : Promise.resolve([]),
    includeCheckpoints && itemIds.length
      ? prisma.stageCheckpoint.findMany({
          where: { orderItemId: { in: itemIds } },
          orderBy: { checkedInAt: "asc" }
        })
      : Promise.resolve([]),
    includeCheckpoints && itemIds.length
      ? prisma.staffAssignment.findMany({
          where: { orderItemId: { in: itemIds }, completedAt: null },
          include: { staff: true }
        })
      : Promise.resolve([])
  ]);

  const presence = await itemPresence(items, checkpoints, assignments);
  return assembleOrder(order, customer, items, images, checkpoints, presence);
}

/**
 * Batched hydration for lists — 4 queries total regardless of order count
 * (avoids the N+1 the audit flagged on GET /api/orders). Checkpoints omitted
 * to match the previous list contract.
 */
export async function hydrateOrders(orders) {
  if (!orders.length) return [];

  const orderIds = orders.map((o) => o.id);
  const customerIds = [...new Set(orders.map((o) => o.customerId).filter(Boolean))];

  const [customers, items] = await Promise.all([
    customerIds.length
      ? prisma.customer.findMany({ where: { id: { in: customerIds } } })
      : Promise.resolve([]),
    prisma.orderItem.findMany({
      where: { order: { in: orderIds } },
      orderBy: { createdAt: "asc" }
    })
  ]);

  const allItemIds = items.map((i) => i.id);
  const images = allItemIds.length
    ? await prisma.orderItemImage.findMany({
        where: { orderItemId: { in: allItemIds } },
        orderBy: [{ sortOrder: "asc" }, { uploadedAt: "asc" }]
      })
    : [];

  const customerById = new Map(customers.map((c) => [c.id, c]));
  const itemsByOrder = groupBy(items, (it) => it.order);
  const imagesByItem = groupBy(images, (img) => img.orderItemId);
  const groupIds = [...new Set(orders.map((o) => o.groupId).filter(Boolean))];
  const groups = groupIds.length
    ? await prisma.orderGroup.findMany({ where: { id: { in: groupIds } } })
    : [];
  const groupById = new Map(groups.map((g) => [g.id, g]));

  return orders.map((order) =>
    assembleOrder(
      { ...order, group: groupById.get(order.groupId) || order.group || null },
      customerById.get(order.customerId) || null,
      itemsByOrder.get(order.id) || [],
      imagesForItems(itemsByOrder.get(order.id) || [], imagesByItem),
      [],
      new Map()
    )
  );
}

function imagesForItems(items, imagesByItem) {
  const out = [];
  for (const it of items) out.push(...(imagesByItem.get(it.id) || []));
  return out;
}

async function itemPresence(items, checkpoints, assignments) {
  const cpsByItem = groupBy(checkpoints, (cp) => cp.orderItemId);
  const asgByItem = groupBy(assignments, (a) => a.orderItemId);
  const map = new Map();
  for (const it of items) {
    const { stageSequence } = await resolveStageSequence(it.clothingType);
    const cps = cpsByItem.get(it.id) || [];
    const nextStage = nextExpectedStage(cps, stageSequence);
    const assignment =
      (asgByItem.get(it.id) || []).find((a) => a.stage === nextStage) ||
      (asgByItem.get(it.id) || [])[0] ||
      null;
    map.set(it.id, {
      currentStage: deriveCurrentStage(cps, stageSequence),
      nextStage,
      boardStatus: boardStatusFrom({ checkpoints: cps, assignment }),
      workerName: assignment?.staff?.name || null
    });
  }
  return map;
}

function assembleOrder(order, customer, items, images, checkpoints, presence = new Map()) {
  const imagesByItem = groupBy(images, (img) => img.orderItemId);
  const checkpointsByItem = groupBy(checkpoints, (cp) => cp.orderItemId);

  const hydratedItems = items.map((it, idx) => {
    const imgs = (imagesByItem.get(it.id) || []).map(s);
    const ops = presence.get(it.id) || {};
    return {
      ...s(it),
      images: imgs,
      stageCheckpoints: (checkpointsByItem.get(it.id) || []).map(s),
      imagePath: imgs[0]?.imageUrl || "",
      currentStage: ops.currentStage ?? null,
      nextStage: ops.nextStage ?? null,
      boardStatus: ops.boardStatus ?? null,
      workerName: ops.workerName ?? null,
      labelBarcode: operationalItemBarcode(order.orderId, idx + 1, it.barcodeValue)
    };
  });

  return {
    ...s(order),
    customer: buildCustomerSummary(customer),
    customerName: customer?.name || "",
    customerPhone: customer?.phone || "",
    items: hydratedItems,
    balanceRemaining: balanceRemaining(order),
    group: order.group
      ? {
          _id: order.group.id,
          name: order.group.name,
          responsibleName: order.group.responsibleName,
          responsiblePhone: order.group.responsiblePhone,
          sharedDueDate: order.group.sharedDueDate,
          sharedPriority: order.group.sharedPriority
        }
      : order.groupId
        ? { _id: order.groupId, name: order.groupCode || "" }
        : null
  };
}

function groupBy(arr, keyFn) {
  const map = new Map();
  for (const el of arr) {
    const k = keyFn(el);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(el);
  }
  return map;
}
