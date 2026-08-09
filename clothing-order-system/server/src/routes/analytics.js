import { Router } from "express";
import { Order } from "../models/Order.js";
import { OrderItem } from "../models/OrderItem.js";
import { StageCheckpoint } from "../models/StageCheckpoint.js";
import { requireAuth } from "../middleware/auth.js";
import { deriveCurrentStage, resolveStageSequence } from "../utils/stageSequence.js";
import { ProductionStage } from "../constants/production.js";

const router = Router();
router.use(requireAuth);

/** Revenue by month (from order creation month, using totalRevenue) */
router.get("/revenue-trend", async (_req, res) => {
  const agg = await Order.aggregate([
    {
      $group: {
        _id: {
          y: { $year: "$createdAt" },
          m: { $month: "$createdAt" }
        },
        revenue: { $sum: "$totalRevenue" },
        count: { $sum: 1 }
      }
    },
    { $sort: { "_id.y": 1, "_id.m": 1 } },
    { $limit: 24 }
  ]);
  const points = agg.map((row) => ({
    period: `${row._id.y}-${String(row._id.m).padStart(2, "0")}`,
    revenue: row.revenue,
    orders: row.count
  }));
  res.json(points);
});

router.get("/status-distribution", async (_req, res) => {
  const agg = await Order.aggregate([
    { $group: { _id: "$productionStatus", count: { $sum: 1 } } },
    { $sort: { count: -1 } }
  ]);
  res.json(agg.map((r) => ({ status: r._id, count: r.count })));
});

router.get("/top-clothing-types", async (_req, res) => {
  const agg = await OrderItem.aggregate([
    {
      $group: {
        _id: "$clothingType",
        units: { $sum: "$quantity" },
        revenue: { $sum: "$lineTotal" }
      }
    },
    { $sort: { units: -1 } },
    { $limit: 10 }
  ]);
  res.json(
    agg.map((r) => ({
      clothingType: r._id,
      units: r.units,
      revenue: r.revenue
    }))
  );
});

/** Item counts by current production stage */
router.get("/stage-distribution", async (_req, res) => {
  const items = await OrderItem.find().select("_id clothingType").lean();
  const itemIds = items.map((i) => i._id);
  const checkpoints = itemIds.length
    ? await StageCheckpoint.find({ orderItemId: { $in: itemIds } }).lean()
    : [];

  const byItem = new Map();
  for (const cp of checkpoints) {
    const k = String(cp.orderItemId);
    if (!byItem.has(k)) byItem.set(k, []);
    byItem.get(k).push(cp);
  }

  const counts = Object.fromEntries(ProductionStage.map((s) => [s, 0]));
  counts.UNSTARTED = 0;

  for (const item of items) {
    const cps = byItem.get(String(item._id)) || [];
    const { stageSequence } = await resolveStageSequence(item.clothingType);
    const stage = deriveCurrentStage(cps, stageSequence);
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
