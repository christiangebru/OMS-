import { Router } from "express";
import { prisma } from "../db/prisma.js";
import { s } from "../utils/serialize.js";
import { requireAuth } from "../middleware/auth.js";
import { requireCapability } from "../middleware/permissions.js";
import { isOrderDelayed } from "../utils/orderId.js";
import { buildProductionQueue } from "../utils/productionBoard.js";

const router = Router();
router.use(requireAuth);

const LOW_DAYS_THRESHOLD = 2;

function daysBetween(a, b) {
  const ms = 24 * 60 * 60 * 1000;
  return Math.ceil((b.getTime() - a.getTime()) / ms);
}

router.get("/summary", async (_req, res) => {
  const snap = await prisma.statisticSnapshot.findUnique({ where: { key: "global" } });
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
  const orders = await prisma.order.findMany({
    where: { productionStatus: { notIn: ["completed", "delivered"] } }
  });

  const customerIds = [...new Set(orders.map((o) => o.customerId).filter(Boolean))];
  const customers = customerIds.length
    ? await prisma.customer.findMany({ where: { id: { in: customerIds } } })
    : [];
  const nameById = new Map(customers.map((c) => [c.id, c.name]));

  const now = new Date();
  const delayed = [];
  const lowTime = [];

  for (const o of orders) {
    const customerName = nameById.get(o.customerId) || "—";
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

router.get("/operations", requireCapability("dashboard"), async (_req, res) => {
  let board;
  try {
    board = await buildProductionQueue({ includeRecommendations: false });
  } catch (err) {
    console.error("[dashboard/operations]", err);
    return res.status(500).json({ message: err.message || "Operations query failed" });
  }
  res.json({
    today: {
      orders: board.summary.todayCreated,
      dueToday: board.summary.dueToday,
      overdue: board.summary.overdueOrders,
      inProduction: board.summary.inProduction,
      ready: board.summary.ready
    },
    production: Object.fromEntries(
      Object.entries(board.byStage).map(([stage, v]) => [
        stage,
        {
            waiting: v.waiting,
            assigned: v.assigned,
            distributed: v.distributed,
            received: v.received || 0,
            inProgress: v.inProgress,
            total: v.items.length
        }
      ])
    ),
    distribution: {
      unassigned: board.summary.itemsWaiting,
      awaitingDistribution: board.summary.itemsAssigned,
      handedOver: board.summary.itemsDistributed,
      received: board.summary.itemsReceived || 0,
      assigned: board.summary.itemsAssigned + board.summary.itemsDistributed + (board.summary.itemsReceived || 0),
      inProgress: board.summary.itemsInProgress
    },
    staff: {
      available: board.staff.available,
      busy: board.staff.busy,
      unavailable: board.staff.unavailable,
      overloaded: board.staff.overloaded
    },
    urgent: board.items
      .filter((i) => i.overdue || (i.daysRemaining != null && i.daysRemaining <= 2))
      .sort((a, b) => (a.daysRemaining ?? 99) - (b.daysRemaining ?? 99))
      .slice(0, 12)
      .map((i) => ({
        orderId: i.orderId,
        itemId: i.itemId,
        clothingType: i.clothingType,
        customerName: i.customer?.name || "—",
        nextStage: i.nextStage,
        priority: i.priority,
        daysRemaining: i.daysRemaining,
        overdue: i.overdue,
        boardStatus: i.boardStatus,
        workerName: i.assignment?.staff?.name || null,
        barcodeValue: i.barcodeValue
      })),
    floor: board.items.map((i) => ({
      itemId: i.itemId,
      barcodeValue: i.barcodeValue,
      clothingType: i.clothingType,
      clothingCode: i.clothingCode,
      customerName: i.customer?.name || "—",
      orderId: i.orderId,
      stage: i.inProgress ? i.openStage : i.nextStage,
      boardStatus: i.boardStatus,
      workerName: i.assignment?.staff?.name || null,
      overdue: i.overdue,
      priority: i.priority,
      daysRemaining: i.daysRemaining
    }))
  });
});

router.get("/production-logs", async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const logs = await prisma.productionLog.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { user: { select: { id: true, name: true, email: true } } }
  });
  res.json(
    logs.map((log) => {
      const { user, ...rest } = log;
      return {
        ...s(rest),
        userId: user ? { _id: user.id, name: user.name, email: user.email } : rest.userId
      };
    })
  );
});

export default router;
