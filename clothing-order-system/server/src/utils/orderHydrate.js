import { OrderItem } from "../models/OrderItem.js";
import { OrderItemImage } from "../models/OrderItemImage.js";
import { StageCheckpoint } from "../models/StageCheckpoint.js";
import { Customer } from "../models/Customer.js";

export function balanceRemaining(order) {
  const total = Number(order.totalAgreedPrice) || 0;
  const deposit = Number(order.depositPaid) || 0;
  return Math.max(0, total - deposit);
}

/**
 * Attach customer, items (+ images), balanceRemaining, and optional checkpoints.
 */
export async function hydrateOrder(orderLean, { includeCheckpoints = true } = {}) {
  if (!orderLean) return null;

  const [customer, items] = await Promise.all([
    orderLean.customerId
      ? Customer.findById(orderLean.customerId).lean()
      : Promise.resolve(null),
    OrderItem.find({ order: orderLean._id }).sort({ createdAt: 1 }).lean()
  ]);

  const itemIds = items.map((i) => i._id);
  const [images, checkpoints] = await Promise.all([
    itemIds.length
      ? OrderItemImage.find({ orderItemId: { $in: itemIds } }).sort({ uploadedAt: 1 }).lean()
      : Promise.resolve([]),
    includeCheckpoints && itemIds.length
      ? StageCheckpoint.find({ orderItemId: { $in: itemIds } }).sort({ checkedInAt: 1 }).lean()
      : Promise.resolve([])
  ]);

  const imagesByItem = new Map();
  for (const img of images) {
    const key = String(img.orderItemId);
    if (!imagesByItem.has(key)) imagesByItem.set(key, []);
    imagesByItem.get(key).push(img);
  }

  const checkpointsByItem = new Map();
  for (const cp of checkpoints) {
    const key = String(cp.orderItemId);
    if (!checkpointsByItem.has(key)) checkpointsByItem.set(key, []);
    checkpointsByItem.get(key).push(cp);
  }

  const hydratedItems = items.map((it) => ({
    ...it,
    images: imagesByItem.get(String(it._id)) || [],
    stageCheckpoints: checkpointsByItem.get(String(it._id)) || [],
    // backward-compat for clients that still read imagePath
    imagePath: (imagesByItem.get(String(it._id)) || [])[0]?.imageUrl || ""
  }));

  return {
    ...orderLean,
    customer: customer
      ? {
          _id: customer._id,
          name: customer.name,
          phone: customer.phone,
          secondaryPhone: customer.secondaryPhone
        }
      : null,
    customerName: customer?.name || "",
    customerPhone: customer?.phone || "",
    items: hydratedItems,
    balanceRemaining: balanceRemaining(orderLean)
  };
}

export async function hydrateOrders(ordersLean) {
  return Promise.all(ordersLean.map((o) => hydrateOrder(o, { includeCheckpoints: false })));
}
