import { prisma } from "../db/prisma.js";
import { ProductionStage } from "../constants/production.js";
import { DEFAULT_TENANT_ID } from "../config/tenant.js";
import { deriveCurrentStage, nextExpectedStage, resolveStageSequence } from "./stageSequence.js";
import { rankStaffForAssignment } from "./assignmentScore.js";
import { s } from "./serialize.js";
import { operationalItemBarcode, operationalPartBarcode } from "./barcode.js";
import {
  assemblyStage,
  findCheckpoint,
  isPartReadyForAssembly,
  isTopLevelItem,
  stageMatchesStep
} from "./productionModel.js";
import { itemOffSiteStages, offSiteTripSummary } from "./offSite.js";

function daysUntil(date) {
  if (!date) return null;
  return (new Date(date).getTime() - Date.now()) / (24 * 60 * 60 * 1000);
}

/** Rows that are not work at any stage right now (shown inside their garment). */
const NOT_ON_A_STAGE = new Set(["waiting_parts", "ready_for_assembly"]);

function assignmentState(assignment) {
  if (!assignment) return "waiting";
  return "received";
}

/**
 * Operational board: active garments grouped by next expected stage.
 */
export async function buildProductionQueue({ includeRecommendations = true } = {}) {
  const orders = await prisma.order.findMany({
    where: { productionStatus: { notIn: ["delivered", "ready_for_pickup"] } },
    include: { customer: true, items: true }
  });

  const items = orders.flatMap((o) => o.items.map((item) => ({ item, order: o })));
  const itemIds = items.map(({ item }) => item.id);

  const [checkpoints, openAssignments, allAssignments] = await Promise.all([
    itemIds.length
      ? prisma.stageCheckpoint.findMany({ where: { orderItemId: { in: itemIds } } })
      : [],
    itemIds.length
      ? prisma.staffAssignment.findMany({
          where: { orderItemId: { in: itemIds }, completedAt: null },
          include: { staff: true }
        })
      : [],
    itemIds.length
      ? prisma.staffAssignment.findMany({
          where: { orderItemId: { in: itemIds } },
          include: { staff: true },
          orderBy: { assignedAt: "asc" }
        })
      : []
  ]);

  const cpByItem = new Map();
  for (const cp of checkpoints) {
    if (!cpByItem.has(cp.orderItemId)) cpByItem.set(cp.orderItemId, []);
    cpByItem.get(cp.orderItemId).push(cp);
  }
  const asgByItemStage = new Map();
  for (const a of openAssignments) {
    asgByItemStage.set(`${a.orderItemId}:${a.stage}`, a);
  }
  const chainByItem = new Map();
  for (const a of allAssignments) {
    if (!chainByItem.has(a.orderItemId)) chainByItem.set(a.orderItemId, []);
    chainByItem.get(a.orderItemId).push(a);
  }

  const partsByParent = new Map();
  for (const { item } of items) {
    if (item.itemKind !== "part" || !item.parentItemId) continue;
    if (!partsByParent.has(item.parentItemId)) partsByParent.set(item.parentItemId, []);
    partsByParent.get(item.parentItemId).push(item);
  }

  const seqCache = new Map();
  async function seqFor(clothingType, clothingCode, skipStages = []) {
    const cacheKey = `${clothingType}|${clothingCode || ""}|${(skipStages || []).join(",")}`;
    if (!seqCache.has(cacheKey)) {
      seqCache.set(cacheKey, await resolveStageSequence(clothingType, clothingCode, skipStages));
    }
    return seqCache.get(cacheKey);
  }

  const rows = [];
  for (const { item, order } of items) {
    const seqInfo = await seqFor(item.clothingType, item.clothingCode, item.skipStages);
    const cps = cpByItem.get(item.id) || [];
    const offStages = itemOffSiteStages(item, seqInfo.offSiteStages);
    const currentStage = deriveCurrentStage(cps, seqInfo.stageSequence, offStages);
    let nextStage = nextExpectedStage(cps, seqInfo.stageSequence, offStages);
    const open = cps.find((c) => c.checkedInAt && !c.checkedOutAt);
    const days = daysUntil(order.requiredCompletionDate);
    const overdue = days != null && days < 0;
    const inProgress = Boolean(open);

    // Garment made as separate parts: the parts do the early stages; the
    // garment itself only starts at assembly, once every part is ready.
    const parts = item.itemKind === "part" ? [] : (partsByParent.get(item.id) || []).filter((p) => !p.assembledAt);
    let partSummary = null;
    let waitingForParts = false;
    if (parts.length && !cps.length) {
      const partStates = [];
      for (const p of parts) {
        const pSeq = (await seqFor(p.clothingType, p.clothingCode, p.skipStages)).stageSequence;
        const pCps = cpByItem.get(p.id) || [];
        const ready = isPartReadyForAssembly(pCps, pSeq);
        const pOpen = pCps.find((c) => c.checkedInAt && !c.checkedOutAt);
        partStates.push({
          itemId: p.id,
          partCode: p.partCode || "",
          ready,
          stage: ready ? null : pOpen?.stage || nextExpectedStage(pCps, pSeq, itemOffSiteStages(p, seqInfo.offSiteStages)),
          inProgress: Boolean(pOpen)
        });
      }
      partSummary = { total: partStates.length, ready: partStates.filter((p) => p.ready).length, parts: partStates };
      const assembleAt = assemblyStage(seqInfo.stageSequence);
      if (partSummary.ready === partSummary.total && assembleAt) {
        nextStage = offStages.includes(assembleAt) ? "OFF_SITE" : assembleAt;
      } else {
        waitingForParts = true;
      }
    }
    // A part whose own stages are done waits to be joined into the garment.
    const readyForAssembly =
      item.itemKind === "part" && !inProgress && isPartReadyForAssembly(cps, seqInfo.stageSequence);

    const assignment = asgByItemStage.get(`${item.id}:${nextStage}`) || null;
    let boardStatus = "waiting";
    if (inProgress && open?.stage === "OFF_SITE") boardStatus = "off_site";
    else if (inProgress) boardStatus = "in_progress";
    else if (waitingForParts) boardStatus = "waiting_parts";
    else if (readyForAssembly) boardStatus = "ready_for_assembly";
    else if (nextStage === "OFF_SITE") boardStatus = "to_send";
    else if (assignment) boardStatus = assignmentState(assignment);

    const siblings = [...(order.items || [])]
      .filter((x) => isTopLevelItem(x) || x.id === item.id)
      .sort((a, b) => (a.itemIndex || 0) - (b.itemIndex || 0) || new Date(a.createdAt) - new Date(b.createdAt));
    const itemIndex = item.itemIndex || Math.max(1, siblings.findIndex((it) => it.id === item.id) + 1);
    if (item.itemKind === "part" && item.assembledAt) continue;
    const chainAsg = chainByItem.get(item.id) || [];
    const itemOff = itemOffSiteStages(item, seqInfo.offSiteStages);
    const path = seqInfo.stageSequence
      .filter((s) => s !== "DELIVERED")
      .map((stage) => {
        const a =
          chainAsg.filter((x) => stageMatchesStep(x.stage, stage, seqInfo.stageSequence)).at(-1) || null;
        const cp = findCheckpoint(cps, stage, seqInfo.stageSequence);
        let status = "waiting";
        if (cp?.checkedOutAt) status = "completed";
        else if (cp && !cp.checkedOutAt) status = "in_progress";
        else if (a && !a.completedAt) status = "assigned";
        return {
          stage,
          status,
          staffName: a?.staff?.name || null,
          offSite: itemOff.includes(stage)
        };
      });

    rows.push({
      itemId: item.id,
      barcodeValue: item.barcodeValue,
      labelBarcode:
        item.itemKind === "part"
          ? operationalPartBarcode(order.orderId, itemIndex, item.partCode, item.barcodeValue)
          : operationalItemBarcode(order.orderId, itemIndex, item.barcodeValue),
      itemKind: item.itemKind || "garment",
      partCode: item.partCode || "",
      parentItemId: item.parentItemId || null,
      offSiteStages: item.offSiteStages || [],
      assembledAt: item.assembledAt || null,
      clothingType: item.clothingType,
      clothingCode: item.clothingCode,
      fabricType: item.fabricType,
      color: item.color,
      innerFabricColor: item.innerFabricColor || "",
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
      location: open?.stage === "OFF_SITE" ? "off_site" : "in_shop",
      offSite: open?.stage === "OFF_SITE",
      offSiteTrip: open?.stage === "OFF_SITE" ? offSiteTripSummary(open) : null,
      stageSequence: seqInfo.stageSequence,
      inProgress,
      openStage: open?.stage || null,
      boardStatus,
      parts: partSummary,
      readyForAssembly,
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
        : null,
      path
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
    const stageRows = rows.filter(
      (r) => !NOT_ON_A_STAGE.has(r.boardStatus) && (r.inProgress ? r.openStage : r.nextStage) === stage
    );
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
    return d < startOfDay && !["completed", "ready_to_pack", "ready_for_pickup", "delivered"].includes(o.productionStatus);
  }).length;
  const ready = uniqueOrders.filter((o) =>
    ["completed", "ready_to_pack", "ready_for_pickup"].includes(o.productionStatus)
  ).length;
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
      itemsAway: rows.filter((r) => r.boardStatus === "off_site").length,
      itemsToSend: rows.filter((r) => r.boardStatus === "to_send").length,
      itemsWaitingForParts: rows.filter((r) => r.boardStatus === "waiting_parts").length,
      overdueItems: rows.filter((r) => r.overdue).length,
      todayCreated,
      dueToday,
      overdueOrders,
      inProduction,
      ready
    },
    staff: staffSummary,
    byStage,
    items: rows
  };
}
