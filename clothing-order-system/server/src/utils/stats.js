import { Order } from "../models/Order.js";
import { OrderItem } from "../models/OrderItem.js";
import { StatisticSnapshot } from "../models/StatisticSnapshot.js";
import { isOrderDelayed } from "./orderId.js";

/**
 * Recompute dashboard aggregates and persist a snapshot document.
 */
export async function refreshStatisticSnapshot() {
  const orders = await Order.find().lean();
  const byStatus = {};
  const byClothingType = {};
  let totalRevenue = 0;
  let completed = 0;
  let delayed = 0;

  for (const o of orders) {
    byStatus[o.productionStatus] = (byStatus[o.productionStatus] || 0) + 1;
    totalRevenue += o.totalRevenue || 0;
    if (["completed", "delivered"].includes(o.productionStatus)) completed += 1;
    if (isOrderDelayed(o)) delayed += 1;
  }

  const items = await OrderItem.find().lean();
  for (const item of items) {
    const t = item.clothingType || "unknown";
    byClothingType[t] = (byClothingType[t] || 0) + (item.quantity || 0);
  }

  await StatisticSnapshot.findOneAndUpdate(
    { key: "global" },
    {
      totalOrders: orders.length,
      completedOrders: completed,
      delayedOrders: delayed,
      totalRevenue,
      byStatus,
      byClothingType,
      lastComputedAt: new Date()
    },
    { upsert: true, new: true }
  );
}
