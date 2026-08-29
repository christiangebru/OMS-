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
    where: { productionStatus: { notIn: ["completed", "ready_to_pack", "ready_for_pickup", "delivered"] } }
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
      !["completed", "ready_to_pack", "ready_for_pickup", "delivered"].includes(o.productionStatus)
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
    })),
    needsAssignment: board.items
      .filter((i) => i.boardStatus === "waiting")
      .slice(0, 8)
      .map((i) => ({
        itemId: i.itemId,
        orderId: i.orderId,
        clothingType: i.clothingType,
        customerName: i.customer?.name || "—",
        nextStage: i.nextStage,
        barcodeValue: i.barcodeValue,
        daysRemaining: i.daysRemaining,
        overdue: i.overdue
      })),
    recentlyReceived: board.items
      .filter((i) => i.boardStatus === "received")
      .slice(0, 8)
      .map((i) => ({
        itemId: i.itemId,
        orderId: i.orderId,
        clothingType: i.clothingType,
        customerName: i.customer?.name || "—",
        nextStage: i.nextStage,
        workerName: i.assignment?.staff?.name || null,
        barcodeValue: i.barcodeValue
      })),
    waitingAtWorkstation: board.items
      .filter((i) => i.boardStatus === "distributed" || i.boardStatus === "assigned")
      .slice(0, 12)
      .map((i) => ({
        itemId: i.itemId,
        orderId: i.orderId,
        clothingType: i.clothingType,
        customerName: i.customer?.name || "—",
        nextStage: i.nextStage,
        workerName: i.assignment?.staff?.name || null,
        barcodeValue: i.barcodeValue,
        boardStatus: i.boardStatus
      })),
    workerQueues: (board.staff.workers || []).map((st) => ({
      _id: st._id,
      name: st.name,
      queued: st.activeAssignmentCount || 0,
      status: st.status
    }))
  });
});

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function parseRange(query) {
  const now = new Date();
  const range = query.range || "month";
  let from;
  let to = new Date(now);
  to.setHours(23, 59, 59, 999);
  if (query.from && query.to) {
    from = startOfDay(query.from);
    to = new Date(query.to);
    to.setHours(23, 59, 59, 999);
    return { from, to, range: "custom" };
  }
  if (range === "today") {
    from = startOfDay(now);
  } else if (range === "week") {
    from = startOfDay(now);
    from.setDate(from.getDate() - 6);
  } else {
    from = startOfDay(now);
    from.setDate(1);
  }
  return { from, to, range };
}

function bucketKey(date, range) {
  const d = new Date(date);
  if (range === "today") {
    return `${String(d.getHours()).padStart(2, "0")}:00`;
  }
  if (range === "week") {
    return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  }
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

router.get("/business", requireCapability("dashboard"), async (req, res) => {
  try {
    const { from, to, range } = parseRange(req.query);
    const [ordersInRange, allOpen, customersInRange, customerCount, logs, checkpointsToday] =
      await Promise.all([
        prisma.order.findMany({
          where: { createdAt: { gte: from, lte: to } },
          include: { customer: true, items: true }
        }),
        prisma.order.findMany({
          where: { productionStatus: { notIn: ["delivered"] } },
          select: {
            totalAgreedPrice: true,
            depositPaid: true,
            productionStatus: true,
            customerId: true
          }
        }),
        prisma.customer.findMany({
          where: { createdAt: { gte: from, lte: to } },
          select: { id: true }
        }),
        prisma.customer.count(),
        prisma.productionLog.findMany({
          orderBy: { createdAt: "desc" },
          take: 20,
          include: { user: { select: { id: true, name: true } } }
        }),
        prisma.stageCheckpoint.findMany({
          where: { checkedOutAt: { gte: startOfDay(new Date()), lte: to } },
          select: { id: true, stage: true, checkedInAt: true, checkedOutAt: true }
        })
      ]);

    const revenue = ordersInRange.reduce((sum, o) => sum + (o.totalRevenue || o.totalAgreedPrice || 0), 0);
    const orderCount = ordersInRange.length;
    const aov = orderCount ? revenue / orderCount : 0;
    const outstanding = allOpen.reduce(
      (sum, o) => sum + Math.max(0, (o.totalAgreedPrice || 0) - (o.depositPaid || 0)),
      0
    );
    const ready = allOpen.filter((o) =>
      ["completed", "ready_to_pack", "ready_for_pickup"].includes(o.productionStatus)
    ).length;

    const trendMap = new Map();
    for (const o of ordersInRange) {
      const key = bucketKey(o.createdAt, range);
      const e = trendMap.get(key) || { period: key, revenue: 0, orders: 0 };
      e.revenue += o.totalRevenue || o.totalAgreedPrice || 0;
      e.orders += 1;
      trendMap.set(key, e);
    }
    const trend = [...trendMap.values()];

    const statusMap = new Map();
    for (const o of ordersInRange) {
      statusMap.set(o.productionStatus, (statusMap.get(o.productionStatus) || 0) + 1);
    }
    const statusDistribution = [...statusMap.entries()].map(([status, count]) => ({ status, count }));

    const paidCount = ordersInRange.filter(
      (o) => Math.max(0, (o.totalAgreedPrice || 0) - (o.depositPaid || 0)) === 0
    ).length;
    const unpaidCount = orderCount - paidCount;

    const customerRev = new Map();
    for (const o of ordersInRange) {
      const id = o.customerId;
      const e = customerRev.get(id) || {
        customerId: id,
        name: o.customer?.name || "—",
        revenue: 0,
        orders: 0
      };
      e.revenue += o.totalRevenue || o.totalAgreedPrice || 0;
      e.orders += 1;
      customerRev.set(id, e);
    }
    const topCustomers = [...customerRev.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 8);

    const durations = checkpointsToday
      .filter((c) => c.checkedInAt && c.checkedOutAt)
      .map((c) => new Date(c.checkedOutAt) - new Date(c.checkedInAt))
      .filter((d) => d > 0);
    const avgStageTurnaroundMs = durations.length
      ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
      : null;

    res.json({
      range,
      from,
      to,
      organization: "Atelier OMS",
      kpis: {
        revenue,
        orders: orderCount,
        customers: customersInRange.length,
        totalCustomers: customerCount,
        averageOrderValue: aov,
        outstanding,
        ready
      },
      trend,
      statusDistribution,
      payment: {
        paid: paidCount,
        outstanding: unpaidCount,
        outstandingAmount: ordersInRange.reduce(
          (sum, o) => sum + Math.max(0, (o.totalAgreedPrice || 0) - (o.depositPaid || 0)),
          0
        )
      },
      topCustomers,
      completedToday: checkpointsToday.length,
      avgStageTurnaroundMs,
      activity: logs.map((log) => ({
        _id: log.id,
        action: log.action,
        orderId: log.orderId,
        notes: log.notes,
        createdAt: log.createdAt,
        userName: log.user?.name || null,
        metadata: log.metadata || null
      }))
    });
  } catch (err) {
    console.error("[dashboard/business]", err);
    res.status(500).json({ message: err.message || "Business dashboard query failed" });
  }
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
