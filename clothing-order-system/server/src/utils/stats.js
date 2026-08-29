import { prisma } from "../db/prisma.js";
import { isOrderDelayed } from "./orderId.js";

/**
 * Recompute dashboard aggregates and persist a snapshot row.
 */
export async function refreshStatisticSnapshot() {
  const orders = await prisma.order.findMany();
  const byStatus = {};
  const byClothingType = {};
  let totalRevenue = 0;
  let completed = 0;
  let delayed = 0;

  for (const o of orders) {
    byStatus[o.productionStatus] = (byStatus[o.productionStatus] || 0) + 1;
    totalRevenue += o.totalRevenue || 0;
    if (["completed", "ready_to_pack", "ready_for_pickup", "delivered"].includes(o.productionStatus)) completed += 1;
    if (isOrderDelayed(o)) delayed += 1;
  }

  const items = await prisma.orderItem.findMany();
  for (const item of items) {
    const t = item.clothingType || "unknown";
    byClothingType[t] = (byClothingType[t] || 0) + (item.quantity || 0);
  }

  const data = {
    totalOrders: orders.length,
    completedOrders: completed,
    delayedOrders: delayed,
    totalRevenue,
    byStatus,
    byClothingType,
    lastComputedAt: new Date()
  };

  await prisma.statisticSnapshot.upsert({
    where: { key: "global" },
    create: { key: "global", ...data },
    update: data
  });
}
