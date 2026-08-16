import { prisma } from "../db/prisma.js";
import { ProductionStage } from "../constants/production.js";
import { DEFAULT_TENANT_ID } from "../config/tenant.js";
import { deriveCurrentStage, nextExpectedStage, resolveStageSequence } from "./stageSequence.js";
import { rankStaffForAssignment } from "./assignmentScore.js";
import { s } from "./serialize.js";

function daysUntil(date) {
  if (!date) return null;
  return (new Date(date).getTime() - Date.now()) / (24 * 60 * 60 * 1000);
}

function assignmentState(assignment) {
  if (!assignment) return "unassigned";
  if (assignment.receivedAt) return "received";
  if (assignment.distributedAt) return "distributed";
  return "assigned";
}

/**
 * Operational board: active garments grouped by next expected stage.
 */
export async function buildProductionQueue({ includeRecommendations = true } = {}) {
  const orders = await prisma.order.findMany({
    where: { productionStatus: { notIn: ["delivered"] } },
    include: { customer: true, items: true }
  });

  const items = orders.flatMap((o) => o.items.map((item) => ({ item, order: o })));
  const itemIds = items.map(({ item }) => item.id);

  const [checkpoints, assignments] = await Promise.all([
    itemIds.length
      ? prisma.stageCheckpoint.findMany({ where: { orderItemId: { in: itemIds } } })
      : [],
    itemIds.length
      ? prisma.staffAssignment.findMany({
          where: { orderItemId: { in: itemIds }, completedAt: null },
          include: { staff: true }
        })
      : []
  ]);

  const cpByItem = new Map();
  for (const cp of checkpoints) {
    if (!cpByItem.has(cp.orderItemId)) cpByItem.set(cp.orderItemId, []);
    cpByItem.get(cp.orderItemId).push(cp);
  }
  const asgByItemStage = new Map();
  for (const a of assignments) {
    asgByItemStage.set(`${a.orderItemId}:${a.stage}`, a);
  }

  const seqCache = new Map();
  async function seqFor(clothingType) {
    if (!seqCache.has(clothingType)) {
      seqCache.set(clothingType, await resolveStageSequence(clothingType));
    }
    return seqCache.get(clothingType);
  }

  const rows = [];
  for (const { item, order } of items) {
    const seqInfo = await seqFor(item.clothingType);
    const cps = cpByItem.get(item.id) || [];
    const currentStage = deriveCurrentStage(cps, seqInfo.stageSequence);
    const nextStage = nextExpectedStage(cps, seqInfo.stageSequence);
    const open = cps.find((c) => c.checkedInAt && !c.checkedOutAt);
    const assignment = asgByItemStage.get(`${item.id}:${nextStage}`) || null;
    const days = daysUntil(order.requiredCompletionDate);
    const overdue = days != null && days < 0;
    const inProgress = Boolean(open);

    let boardStatus = "waiting";
    if (inProgress) boardStatus = "in_progress";
    else if (assignment) boardStatus = assignmentState(assignment);

    rows.push({
      itemId: item.id,
      barcodeValue: item.barcodeValue,
      clothingType: item.clothingType,
      clothingCode: item.clothingCode,
      fabricType: item.fabricType,
      color: item.color,
      size: item.size,
      difficultyLevel: item.difficultyLevel,
      orderId: order.orderId,
      orderMongoId: order.id,
      productionStatus: order.productionStatus,
      priority: order.priority,
      requiredCompletionDate: order.requiredCompletionDate,
      daysRemaining: days != null ? Number(days.toFixed(1)) : null,
      overdue,
      customer: order.customer
        ? { _id: order.customer.id, name: order.customer.name, phone: order.customer.phone }
        : null,
      currentStage,
      nextStage,
      stageSequence: seqInfo.stageSequence,
      inProgress,
      openStage: open?.stage || null,
      boardStatus,
      assignment: assignment
        ? {
            _id: assignment.id,
            stage: assignment.stage,
            assignedAt: assignment.assignedAt,
            distributedAt: assignment.distributedAt,
            distributedByUserId: assignment.distributedByUserId,
            receivedAt: assignment.receivedAt,
            staff: assignment.staff
              ? {
                  _id: assignment.staff.id,
                  name: assignment.staff.name,
                  role: assignment.staff.role,
                  status: assignment.staff.status,
                  skillLevel: assignment.staff.skillLevel
                }
              : null
          }
        : null
    });
  }

  if (includeRecommendations) {
    const waitingForRecommend = rows.filter((r) => r.boardStatus === "waiting" && !r.inProgress);
    await Promise.all(
      waitingForRecommend.map(async (row) => {
        try {
          const result = await rankStaffForAssignment(row.itemId, row.nextStage);
          const top = result.rankings[0] || null;
          row.recommended = top
            ? {
                staff: top.staff,
                scores: top.scores,
                reason: top.reason,
                reasons: top.reasons || [],
                summary: top.summary || top.reason
              }
            : null;
        } catch {
          row.recommended = null;
        }
      })
    );
  }

  const byStage = {};
  for (const stage of ProductionStage) {
    const stageRows = rows.filter((r) => (r.inProgress ? r.openStage : r.nextStage) === stage);
    byStage[stage] = {
      stage,
      waiting: stageRows.filter((r) => r.boardStatus === "waiting").length,
      assigned: stageRows.filter((r) => r.boardStatus === "assigned").length,
      distributed: stageRows.filter((r) => r.boardStatus === "distributed").length,
      received: stageRows.filter((r) => r.boardStatus === "received").length,
      inProgress: stageRows.filter((r) => r.boardStatus === "in_progress").length,
      items: stageRows
    };
  }

  const staff = await prisma.staff.findMany({
    where: { tenantId: DEFAULT_TENANT_ID, active: true }
  });
  const activeCounts = staff.length
    ? await prisma.staffAssignment.groupBy({
        by: ["staffId"],
        where: { staffId: { in: staff.map((st) => st.id) }, completedAt: null },
        _count: { _all: true }
      })
    : [];
  const countMap = new Map(activeCounts.map((r) => [r.staffId, r._count._all]));

  const staffSummary = {
    available: staff.filter((st) => st.status === "AVAILABLE").length,
    busy: staff.filter((st) => st.status === "BUSY").length,
    unavailable: staff.filter((st) => st.status === "OFF_DUTY").length,
    overloaded: staff.filter((st) => (countMap.get(st.id) || 0) >= 4).length,
    workers: staff.map((st) => ({
      ...s(st),
      activeAssignmentCount: countMap.get(st.id) || 0
    }))
  };

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);

  const uniqueOrders = [...new Map(orders.map((o) => [o.id, o])).values()];
  const todayCreated = uniqueOrders.filter(
    (o) => o.createdAt >= startOfDay && o.createdAt <= endOfDay
  ).length;
  const dueToday = uniqueOrders.filter((o) => {
    const d = new Date(o.requiredCompletionDate);
    return d >= startOfDay && d <= endOfDay && !["delivered"].includes(o.productionStatus);
  }).length;
  const overdueOrders = uniqueOrders.filter((o) => {
    const d = new Date(o.requiredCompletionDate);
    return d < startOfDay && !["completed", "delivered"].includes(o.productionStatus);
  }).length;
  const ready = uniqueOrders.filter((o) => o.productionStatus === "completed").length;
  const inProduction = uniqueOrders.filter((o) =>
    ["cutting", "stitching", "finishing", "pending"].includes(o.productionStatus)
  ).length;

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      itemsWaiting: rows.filter((r) => r.boardStatus === "waiting").length,
      itemsAssigned: rows.filter((r) => r.boardStatus === "assigned").length,
      itemsDistributed: rows.filter((r) => r.boardStatus === "distributed").length,
      itemsReceived: rows.filter((r) => r.boardStatus === "received").length,
      itemsInProgress: rows.filter((r) => r.boardStatus === "in_progress").length,
      overdueItems: rows.filter((r) => r.overdue).length,
      todayCreated,
      dueToday,
      overdueOrders,
      inProduction,
      ready,
      deliveredToday: 0
    },
    staff: staffSummary,
    byStage,
    items: rows
  };
}
