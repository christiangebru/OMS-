import { Router } from "express";
import { prisma } from "../db/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { deriveCurrentStage, resolveStageSequence } from "../utils/stageSequence.js";
import { ProductionStage } from "../constants/production.js";

const router = Router();
router.use(requireAuth);

/** Revenue by month (from order creation month, using totalRevenue) */
router.get("/revenue-trend", async (_req, res) => {
  const orders = await prisma.order.findMany({
    select: { createdAt: true, totalRevenue: true }
  });
  const map = new Map();
  for (const o of orders) {
    const y = o.createdAt.getFullYear();
    const m = o.createdAt.getMonth() + 1;
    const key = `${y}-${String(m).padStart(2, "0")}`;
    const e = map.get(key) || { revenue: 0, orders: 0 };
    e.revenue += o.totalRevenue || 0;
    e.orders += 1;
    map.set(key, e);
  }
  const points = [...map.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .slice(0, 24)
    .map(([period, v]) => ({ period, revenue: v.revenue, orders: v.orders }));
  res.json(points);
});

router.get("/status-distribution", async (_req, res) => {
  const agg = await prisma.order.groupBy({
    by: ["productionStatus"],
    _count: { _all: true }
  });
  res.json(
    agg
      .map((r) => ({ status: r.productionStatus, count: r._count._all }))
      .sort((a, b) => b.count - a.count)
  );
});

router.get("/top-clothing-types", async (_req, res) => {
  const agg = await prisma.orderItem.groupBy({
    by: ["clothingType"],
    _sum: { quantity: true, lineTotal: true }
  });
  res.json(
    agg
      .map((r) => ({
        clothingType: r.clothingType,
        units: r._sum.quantity || 0,
        revenue: r._sum.lineTotal || 0
      }))
      .sort((a, b) => b.units - a.units)
      .slice(0, 10)
  );
});

/** Item counts by current production stage */
router.get("/stage-distribution", async (_req, res) => {
  const items = await prisma.orderItem.findMany({ select: { id: true, clothingType: true } });
  const itemIds = items.map((i) => i.id);
  const checkpoints = itemIds.length
    ? await prisma.stageCheckpoint.findMany({ where: { orderItemId: { in: itemIds } } })
    : [];

  const byItem = new Map();
  for (const cp of checkpoints) {
    const k = cp.orderItemId;
    if (!byItem.has(k)) byItem.set(k, []);
    byItem.get(k).push(cp);
  }

  const counts = Object.fromEntries(ProductionStage.map((st) => [st, 0]));
  counts.UNSTARTED = 0;

  for (const item of items) {
    const cps = byItem.get(item.id) || [];
    const { stageSequence, offSiteStages } = await resolveStageSequence(item.clothingType);
    const stage = deriveCurrentStage(cps, stageSequence, item.offSiteStages?.length ? item.offSiteStages : offSiteStages);
    if (!stage) counts.UNSTARTED += 1;
    else counts[stage] = (counts[stage] || 0) + 1;
  }

  res.json(
    Object.entries(counts)
      .filter(([, count]) => count > 0)
      .map(([stage, count]) => ({ stage, count }))
      .sort((a, b) => b.count - a.count)
  );
});

export default router;
