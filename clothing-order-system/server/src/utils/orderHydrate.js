import { prisma } from "../db/prisma.js";
import { s } from "./serialize.js";

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

  const itemIds = items.map((i) => i.id);
  const [images, checkpoints] = await Promise.all([
    itemIds.length
      ? prisma.orderItemImage.findMany({
          where: { orderItemId: { in: itemIds } },
          orderBy: { uploadedAt: "asc" }
        })
      : Promise.resolve([]),
    includeCheckpoints && itemIds.length
      ? prisma.stageCheckpoint.findMany({
          where: { orderItemId: { in: itemIds } },
          orderBy: { checkedInAt: "asc" }
        })
      : Promise.resolve([])
  ]);

  return assembleOrder(order, customer, items, images, checkpoints);
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
        orderBy: { uploadedAt: "asc" }
      })
    : [];

  const customerById = new Map(customers.map((c) => [c.id, c]));
  const itemsByOrder = groupBy(items, (it) => it.order);
  const imagesByItem = groupBy(images, (img) => img.orderItemId);

  return orders.map((order) =>
    assembleOrder(
      order,
      customerById.get(order.customerId) || null,
      itemsByOrder.get(order.id) || [],
      imagesForItems(itemsByOrder.get(order.id) || [], imagesByItem),
      []
    )
  );
}

function imagesForItems(items, imagesByItem) {
  const out = [];
  for (const it of items) out.push(...(imagesByItem.get(it.id) || []));
  return out;
}

function assembleOrder(order, customer, items, images, checkpoints) {
  const imagesByItem = groupBy(images, (img) => img.orderItemId);
  const checkpointsByItem = groupBy(checkpoints, (cp) => cp.orderItemId);

  const hydratedItems = items.map((it) => {
    const imgs = (imagesByItem.get(it.id) || []).map(s);
    return {
      ...s(it),
      images: imgs,
      stageCheckpoints: (checkpointsByItem.get(it.id) || []).map(s),
      imagePath: imgs[0]?.imageUrl || ""
    };
  });

  return {
    ...s(order),
    customer: buildCustomerSummary(customer),
    customerName: customer?.name || "",
    customerPhone: customer?.phone || "",
    items: hydratedItems,
    balanceRemaining: balanceRemaining(order)
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
