import { Router } from "express";
import { Order } from "../models/Order.js";
import { Customer } from "../models/Customer.js";
import { StatisticSnapshot } from "../models/StatisticSnapshot.js";
import { ProductionLog } from "../models/ProductionLog.js";
import { requireAuth } from "../middleware/auth.js";
import { isOrderDelayed } from "../utils/orderId.js";

const router = Router();
router.use(requireAuth);

const LOW_DAYS_THRESHOLD = 2;

function daysBetween(a, b) {
  const ms = 24 * 60 * 60 * 1000;
  return Math.ceil((b.getTime() - a.getTime()) / ms);
}

router.get("/summary", async (_req, res) => {
  const snap = await StatisticSnapshot.findOne({ key: "global" }).lean();
  if (!snap || !snap.lastComputedAt) {
    return res.json({
      totalOrders: 0,
      completedOrders: 0,
      delayedOrders: 0,
      totalRevenue: 0,
      byStatus: {},
      byClothingType: {},
      mostOrderedClothingType: null
    });
  }
  const entries = Object.entries(snap.byClothingType || {});
  entries.sort((a, b) => b[1] - a[1]);
  const mostOrderedClothingType = entries.length
    ? { type: entries[0][0], quantity: entries[0][1] }
    : null;

  res.json({
    totalOrders: snap.totalOrders,
    completedOrders: snap.completedOrders,
    delayedOrders: snap.delayedOrders,
    totalRevenue: snap.totalRevenue,
    byStatus: snap.byStatus,
    byClothingType: snap.byClothingType,
    mostOrderedClothingType
  });
});

router.get("/notifications", async (_req, res) => {
  const orders = await Order.find({
    productionStatus: { $nin: ["completed", "delivered"] }
  }).lean();

  const customerIds = [...new Set(orders.map((o) => String(o.customerId)).filter(Boolean))];
  const customers = await Customer.find({ _id: { $in: customerIds } }).lean();
  const nameById = new Map(customers.map((c) => [String(c._id), c.name]));

  const now = new Date();
  const delayed = [];
  const lowTime = [];

  for (const o of orders) {
    const customerName = nameById.get(String(o.customerId)) || "—";
    if (isOrderDelayed(o)) {
      delayed.push({
        orderId: o.orderId,
        customerName,
        reason: "Past estimated or required completion while not finished",
        requiredCompletionDate: o.requiredCompletionDate,
        estimatedProductionCompletion: o.estimatedProductionCompletion
      });
    }
    const due = new Date(o.requiredCompletionDate);
    const d = daysBetween(now, due);
    if (
      d >= 0 &&
      d <= LOW_DAYS_THRESHOLD &&
      !["completed", "delivered"].includes(o.productionStatus)
    ) {
      lowTime.push({
        orderId: o.orderId,
        customerName,
        daysRemaining: d,
        requiredCompletionDate: o.requiredCompletionDate
      });
    }
  }

  res.json({ delayed, lowProductionTime: lowTime, thresholdDays: LOW_DAYS_THRESHOLD });
});

router.get("/production-logs", async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const logs = await ProductionLog.find()
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate("userId", "name email")
    .lean();
  res.json(logs);
});

export default router;
