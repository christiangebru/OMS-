import { prisma } from "../db/prisma.js";
import { s } from "./serialize.js";
import { balanceRemaining, hydrateOrder } from "./orderHydrate.js";
import {
  deriveCurrentStage,
  nextExpectedStage,
  resolveStageSequence
} from "./stageSequence.js";
import { buildStageStates, inferScanAction, inferNextAction, boardStatusFrom } from "./stageTimeline.js";
import { OFF_SITE_ONLY_STAGES, WORKSTATION_STAGES, skillStageVariants } from "../constants/production.js";
import {
  operationalItemBarcode,
  operationalPartBarcode,
  parseOperationalBarcode,
  normalizeBarcodeInput,
  legacyOrderTails
} from "./barcode.js";
import { storedImagePath } from "./publicImage.js";
import {
  OFF_SITE_STAGE,
  effectiveScanSequence,
  garmentLocation,
  locationLabel,
  openOffSiteCheckpoint,
  pendingOffSiteWindow
} from "./offSite.js";
import { isGarmentCompleteStage, isTopLevelItem, findCheckpoint, stageMatchesStep } from "./productionModel.js";
import { itemOffSiteStages, offSiteTripSummary } from "./offSite.js";

function daysUntil(date) {
  if (!date) return null;
  const ms = new Date(date).getTime() - Date.now();
  return ms / (24 * 60 * 60 * 1000);
}

function staffSummary(staff) {
  if (!staff) return null;
  return {
    _id: staff.id,
    name: staff.name,
    role: staff.role,
    status: staff.status,
    phone: staff.phone || ""
  };
}

function assignmentSummary(asg) {
  if (!asg) return null;
  return {
    _id: asg.id,
    stage: asg.stage,
    assignedAt: asg.assignedAt,
    distributedAt: asg.distributedAt,
    receivedAt: asg.receivedAt,
    completedAt: asg.completedAt,
    queuePosition: asg.queuePosition,
    staff: staffSummary(asg.staff)
  };
}

export function managerCommandFor({
  open,
  currentStage,
  nextStage,
  currentWorker,
  nextWorker,
  assignment,
  location
}) {
  if (location === "off_site" || open?.stage === OFF_SITE_STAGE) {
    const who = open?.offSiteHandlerName ? ` with ${open.offSiteHandlerName}` : "";
    return `Garment is off-site${who}. Scan in when it returns.`;
  }
  if (nextStage === OFF_SITE_STAGE) {
    return "Scan out to off-site.";
  }
  if (open && currentWorker) {
    const nextBit = nextWorker
      ? ` After completion, send to ${titleStage(nextStage)} — ${nextWorker.name}.`
      : nextStage
        ? ` After completion, send to ${titleStage(nextStage)}.`
        : "";
    return `Scan out when ${titleStage(currentStage)} is complete.${nextBit}`;
  }
  if (open) {
    return `Scan out of ${titleStage(currentStage)} when work is complete.`;
  }
  if (assignment && assignment.staff && !open) {
    return `Scan in to ${titleStage(assignment.stage)} — ${assignment.staff.name} (physical hand-off)`;
  }
  if (nextWorker) {
    return `Send to ${titleStage(nextStage)} — ${nextWorker.name}`;
  }
  if (nextStage === "READY") return "Mark this garment ready.";
  if (nextStage === "DELIVERED") return "Mark delivered when the customer collects.";
  if (nextStage) return `Assign ${titleStage(nextStage)}, then scan in.`;
  return "No further production action.";
}

function titleStage(stage) {
  if (!stage) return "the next stage";
  return String(stage)
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function allowedActionsFor({
  checkpoints = [],
  nextStage,
  currentStage,
  assignment,
  nextAssignment,
  canLabels = true,
  location,
  returnStage
}) {
  const actions = [];
  const open = checkpoints.find((c) => c.checkedInAt && !c.checkedOutAt);
  const hasAny = checkpoints.length > 0;
  const deliveredDone = checkpoints.some((c) => c.stage === "DELIVERED" && c.checkedOutAt);

  if (canLabels) actions.push({ code: "print_label", label: "Print / reprint label" });

  if (deliveredDone) {
    actions.push({ code: "view_history", label: "View history" });
    return actions;
  }

  if (open?.stage === OFF_SITE_STAGE || location === "off_site") {
    actions.push({ code: "check_out", label: "Scan in from off-site" });
    actions.push({
      code: "assign",
      label: `Assign ${titleStage(returnStage || nextStage || "return stage")}`
    });
    return actions;
  }

  if (nextStage === OFF_SITE_STAGE) {
    actions.push({ code: "check_in", label: "Scan out to off-site" });
    actions.push({ code: "assign", label: "Assign / view assignment" });
    if (currentStage) actions.push({ code: "view_history", label: "View history" });
    return actions;
  }

  if (!hasAny) {
    actions.push({ code: "assign", label: "Assign / view assignment" });
    actions.push({ code: "start_first", label: "Scan in (physical hand-off)" });
    return actions;
  }

  if (open) {
    actions.push({ code: "check_out", label: `Scan out / complete ${titleStage(open.stage)}` });
    if (assignment?.staff) actions.push({ code: "view_worker", label: "View worker" });
    return actions;
  }

  if (nextStage === "READY" || nextStage === "SHOWROOM") {
    actions.push({ code: "mark_ready", label: "Move to showroom" });
  }
  if (nextStage === "DELIVERED") {
    actions.push({ code: "mark_delivered", label: "Mark delivered" });
    return actions;
  }

  if (nextAssignment?.staff) {
    actions.push({
      code: "send_next",
      label: `Send to ${titleStage(nextStage)} — ${nextAssignment.staff.name}`
    });
    actions.push({ code: "view_next_worker", label: "View next worker" });
  } else if (nextStage) {
    actions.push({ code: "assign", label: `Assign ${titleStage(nextStage)}` });
  }

  if (nextStage) {
    actions.push({
      code: "check_in",
      label: `Scan in to ${titleStage(nextStage)}`
    });
  }

  if (currentStage) actions.push({ code: "view_history", label: "View history" });
  return actions;
}

/**
 * Full scan-detail context for an order item.
 */
export async function buildScanDetails(orderItemIdOrDoc) {
  const item =
    typeof orderItemIdOrDoc === "object" && orderItemIdOrDoc && orderItemIdOrDoc.id
      ? orderItemIdOrDoc
      : await prisma.orderItem.findUnique({ where: { id: orderItemIdOrDoc } });
  if (!item) return null;

  const order = await prisma.order.findUnique({ where: { id: item.order } });
  if (!order) return null;

  const [customer, images, siblings, checkpoints, seqInfo, group] = await Promise.all([
    order.customerId ? prisma.customer.findUnique({ where: { id: order.customerId } }) : null,
    prisma.orderItemImage.findMany({
      where: { orderItemId: item.id },
      orderBy: [{ sortOrder: "asc" }, { uploadedAt: "asc" }]
    }),
    prisma.orderItem.findMany({ where: { order: order.id }, orderBy: { createdAt: "asc" } }),
    prisma.stageCheckpoint.findMany({
      where: { orderItemId: item.id },
      orderBy: { checkedInAt: "asc" }
    }),
    resolveStageSequence(item.clothingType, item.clothingCode, item.skipStages),
    order.groupId ? prisma.orderGroup.findUnique({ where: { id: order.groupId } }) : null
  ]);

  const siblingIds = siblings.map((sib) => sib.id);
  const allCp = siblingIds.length
    ? await prisma.stageCheckpoint.findMany({ where: { orderItemId: { in: siblingIds } } })
    : [];
  const cpByItem = new Map();
  for (const cp of allCp) {
    const k = cp.orderItemId;
    if (!cpByItem.has(k)) cpByItem.set(k, []);
    cpByItem.get(k).push(cp);
  }

  const siblingSource = siblings.filter((sib) => sib.itemKind !== "part" && !sib.parentItemId);
  if (item.itemKind === "part" && !siblingSource.some((s) => s.id === item.id)) {
    siblingSource.push(item);
  }
  const siblingDetails = await Promise.all(
    siblingSource.map(async (sib) => {
      const cps = cpByItem.get(sib.id) || [];
      const seq = await resolveStageSequence(sib.clothingType, sib.clothingCode, sib.skipStages);
      const off = itemOffSiteStages(sib, seq.offSiteStages);
      const idx = sib.itemIndex || 1;
      return {
        _id: sib.id,
        clothingType: sib.clothingType,
        clothingCode: sib.clothingCode,
        itemKind: sib.itemKind || "garment",
        barcodeValue: sib.barcodeValue,
        labelBarcode:
          sib.itemKind === "part"
            ? operationalPartBarcode(order.orderId, idx, sib.partCode, sib.barcodeValue)
            : operationalItemBarcode(order.orderId, idx, sib.barcodeValue),
        currentStage: deriveCurrentStage(cps, seq.stageSequence, off),
        location: garmentLocation(cps),
        isCurrent: sib.id === item.id || (item.parentItemId && sib.id === item.parentItemId)
      };
    })
  );

  let groupOtherOrders = 0;
  let groupOtherItems = 0;
  if (order.groupId || order.groupCode) {
    const groupOrders = await prisma.order.findMany({
      where: order.groupId
        ? { groupId: order.groupId, id: { not: order.id } }
        : { groupCode: order.groupCode, id: { not: order.id } },
      select: { id: true }
    });
    groupOtherOrders = groupOrders.length;
    if (groupOrders.length) {
      groupOtherItems = await prisma.orderItem.count({
        where: { order: { in: groupOrders.map((o) => o.id) } }
      });
    }
  }

  const offSiteStages = itemOffSiteStages(item, seqInfo.offSiteStages);
  const currentStage = deriveCurrentStage(checkpoints, seqInfo.stageSequence, offSiteStages);
  const nextStage = nextExpectedStage(checkpoints, seqInfo.stageSequence, offSiteStages);
  const loc = garmentLocation(checkpoints);
  const pendingWindow = pendingOffSiteWindow(checkpoints, seqInfo.stageSequence, offSiteStages);
  const offSiteLabel = locationLabel(checkpoints, nextStage);
  const days = daysUntil(order.requiredCompletionDate);
  const actionHint = inferScanAction(checkpoints, nextStage);
  const open = checkpoints.find((c) => c.checkedInAt && !c.checkedOutAt);

  const allAssignments = await prisma.staffAssignment.findMany({
    where: { orderItemId: item.id },
    include: { staff: true },
    orderBy: { assignedAt: "asc" }
  });

  const openAssignment =
    allAssignments.find((a) => a.stage === actionHint.stage && !a.completedAt) ||
    allAssignments.find((a) => !a.completedAt && a.stage === (open?.stage || nextStage)) ||
    null;

  const nextAssignment =
    allAssignments.find((a) => a.stage === nextStage && !a.completedAt) ||
    (!open
      ? null
      : allAssignments.find((a) => {
          const idx = seqInfo.stageSequence.indexOf(a.stage);
          const cur = seqInfo.stageSequence.indexOf(open.stage);
          return idx > cur && !a.completedAt;
        })) ||
    null;

  const currentWorkerStaff =
    (open && allAssignments.find((a) => a.stage === open.stage && a.staff)?.staff) ||
    openAssignment?.staff ||
    null;

  const nextWorkerStaff = nextAssignment?.staff || null;

  const stageStates = buildStageStates(checkpoints, seqInfo.stageSequence, {
    dueDate: order.requiredCompletionDate,
    assignment: openAssignment,
    assignments: allAssignments,
    offSiteStages
  });

  const workstationStage = open?.stage || nextStage;
  const workstationWorkers = WORKSTATION_STAGES.includes(workstationStage)
    ? await prisma.staffSkill.findMany({
        where: { stage: { in: skillStageVariants(workstationStage) } },
        include: { staff: true }
      })
    : [];

  const history = checkpoints.map((cp) => {
    const inAsg = allAssignments.find((a) => a.stage === cp.stage);
    return {
      at: cp.checkedInAt,
      action: cp.checkedOutAt ? "scan_out" : "scan_in",
      stage: cp.stage,
      checkedInAt: cp.checkedInAt,
      checkedOutAt: cp.checkedOutAt,
      notes: cp.notes || "",
      staffName: inAsg?.staff?.name || null
    };
  });

  const allowedActions = allowedActionsFor({
    checkpoints,
    nextStage,
    currentStage,
    assignment: openAssignment,
    nextAssignment,
    location: loc,
    returnStage: pendingWindow?.returnStage
  });

  const openTrip = offSiteTripSummary(openOffSiteCheckpoint(checkpoints));
  const tripBits = openTrip
    ? [
        openTrip.handlerName ? `with ${openTrip.handlerName}` : "",
        openTrip.expectedReturnAt
          ? `due back ${new Date(openTrip.expectedReturnAt).toISOString().slice(0, 10)}`
          : ""
      ].filter(Boolean)
    : [];
  const offSiteOptions = {
    // In-shop stage that could go out instead (manager's choice, per garment).
    sendNextStage:
      !open &&
      nextStage &&
      nextStage !== OFF_SITE_STAGE &&
      seqInfo.stageSequence.includes(nextStage) &&
      !isGarmentCompleteStage(nextStage)
        ? nextStage
        : null,
    // Planned off-site stages that could be kept in shop instead.
    plannedStages:
      !open && nextStage === OFF_SITE_STAGE
        ? (pendingWindow?.stages || []).filter((st) => !OFF_SITE_ONLY_STAGES.includes(st))
        : []
  };
  const locationFromOffSite = openTrip
    ? ["Off-site", ...tripBits].join(" · ")
    : offSiteLabel;
  const locationLabelResolved =
    locationFromOffSite ||
    (open
      ? `${titleStage(open.stage)} workstation`
      : currentStage
        ? `${titleStage(currentStage)} complete — waiting ${titleStage(nextStage)}`
        : "Not yet received");

  return {
    scanKind: "item",
    customer: customer
      ? {
          _id: customer.id,
          name: customer.name,
          phone: customer.phone,
          secondaryPhone: customer.secondaryPhone || "",
          email: customer.email || ""
        }
      : null,
    item: {
      _id: item.id,
      clothingCode: item.clothingCode,
      clothingType: item.clothingType,
      fabricType: item.fabricType,
      color: item.color,
      innerFabricColor: item.innerFabricColor || "",
      size: item.size,
      audience: item.audience || "",
      setChoice: item.setChoice || "",
      neckType: item.neckType,
      handType: item.handType,
      notes: item.notes,
      quantity: item.quantity,
      measurements: item.measurements,
      difficultyLevel: item.difficultyLevel,
      unitPrice: item.unitPrice || 0,
      barcodeValue: item.barcodeValue,
      itemKind: item.itemKind || "garment",
      partCode: item.partCode || "",
      parentItemId: item.parentItemId || null,
      assembledAt: item.assembledAt || null,
      offSiteStages: item.offSiteStages || [],
      labelBarcode:
        item.itemKind === "part"
          ? operationalPartBarcode(order.orderId, item.itemIndex || 1, item.partCode, item.barcodeValue)
          : operationalItemBarcode(order.orderId, item.itemIndex || 1, item.barcodeValue),
      images: images.map((img) => s({ ...img, imageUrl: storedImagePath(img.imageUrl) }))
    },
    group: {
      groupCode: order.groupCode || "",
      groupId: order.groupId || null,
      name: group?.name || order.groupCode || "",
      responsibleName: group?.responsibleName || "",
      responsiblePhone: group?.responsiblePhone || "",
      otherOrdersSharingGroup: groupOtherOrders,
      otherItemsSharingGroup: groupOtherItems
    },
    order: {
      orderId: order.orderId,
      _id: order.id,
      productionStatus: order.productionStatus,
      priority: order.priority,
      createdAt: order.createdAt,
      siblingItems: siblingDetails
    },
    pricing: {
      totalAgreedPrice: order.totalAgreedPrice || 0,
      depositPaid: order.depositPaid || 0,
      balanceRemaining: balanceRemaining(order)
    },
    timing: {
      requiredCompletionDate: order.requiredCompletionDate,
      daysRemaining: days != null ? Number(days.toFixed(1)) : null,
      overdue: days != null ? days < 0 : false,
      currentStage,
      nextExpectedStage: nextStage,
      stageSequence: seqInfo.stageSequence
    },
    production: {
      action: actionHint.action,
      actionStage: actionHint.stage,
      boardStatus: boardStatusFrom({ checkpoints, assignment: openAssignment, location: loc }),
      nextAction: inferNextAction({
        checkpoints,
        assignment: openAssignment,
        nextStage,
        currentStage,
        location: loc,
        returnStage: pendingWindow?.returnStage
      }),
      stageStates,
      assignment: assignmentSummary(openAssignment),
      assignmentChain: effectiveScanSequence(seqInfo.stageSequence, offSiteStages, checkpoints).map((stage) => {
        const asg =
          allAssignments.find((a) => stageMatchesStep(a.stage, stage, seqInfo.stageSequence)) || null;
        const cp =
          stage === OFF_SITE_STAGE
            ? openOffSiteCheckpoint(checkpoints) ||
              checkpoints.filter((c) => c.stage === OFF_SITE_STAGE).at(-1)
            : findCheckpoint(checkpoints, stage, seqInfo.stageSequence);
        let status = "waiting";
        if (stage === OFF_SITE_STAGE) {
          if (openOffSiteCheckpoint(checkpoints)) status = "in_progress";
          else if (cp?.checkedOutAt) status = "completed";
        } else if (cp?.checkedOutAt) status = "completed";
        else if (cp && !cp.checkedOutAt) status = "in_progress";
        else if (asg && !asg.completedAt) status = "assigned";
        return {
          stage,
          status,
          staff: staffSummary(asg?.staff),
          assignment: assignmentSummary(asg)
        };
      }),
      workstation: {
        stage: workstationStage,
        label: `${titleStage(workstationStage)} workstation`,
        workers: Array.from(
          new Map(
            workstationWorkers
              .filter((w) => w.staff?.active)
              .map((w) => [w.staff.id, staffSummary(w.staff)])
          ).values()
        )
      },
      currentWorker: staffSummary(currentWorkerStaff),
      nextWorker: staffSummary(nextWorkerStaff),
      nextStage,
      location: locationLabelResolved,
      locationKind: loc,
      offSite: loc === "off_site",
      returnStage: pendingWindow?.returnStage || null,
      offSiteTrip: openTrip,
      offSiteTrips: checkpoints.filter((c) => c.stage === OFF_SITE_STAGE).map(offSiteTripSummary),
      offSiteOptions,
      offSiteStages,
      managerCommand: managerCommandFor({
        open,
        currentStage: open?.stage || currentStage,
        nextStage,
        currentWorker: currentWorkerStaff,
        nextWorker: nextWorkerStaff,
        assignment: openAssignment,
        location: loc
      }),
      allowedActions,
      history
    }
  };
}

async function findGarmentByOperationalIndex(orderId, itemIndex, orderPk = null) {
  const order = orderPk
    ? { id: orderPk, orderId }
    : await prisma.order.findFirst({
        where: { orderId: { equals: orderId, mode: "insensitive" } }
      });
  if (!order) return null;
  const idx = Math.max(1, Number(itemIndex) || 1);
  const byIndex = await prisma.orderItem.findFirst({
    where: {
      order: order.id,
      itemIndex: idx,
      itemKind: { not: "part" },
      parentItemId: null
    }
  });
  if (byIndex) return byIndex;
  const top = await prisma.orderItem.findMany({
    where: { order: order.id, itemKind: { not: "part" }, parentItemId: null },
    orderBy: { createdAt: "asc" }
  });
  return top[idx - 1] || (top.length === 1 ? top[0] : null);
}

/**
 * Older order whose short code (shown or printed) ends in `tail`.
 * Throws 409 when the tail is shared by more than one older order.
 */
async function findLegacyOrderByTail(tail) {
  const t = String(tail || "").toUpperCase();
  if (!t) return null;
  const legacy = await prisma.$queryRaw`
    SELECT id, "orderId" FROM orders WHERE "orderId" !~ '^ORD-[0-9]+$'`;
  const asNumber = /^\d+$/.test(t) ? String(Number(t)) : null;
  const hits = legacy.filter((o) => {
    const tails = legacyOrderTails(o.orderId);
    return tails.includes(t) || (asNumber && tails.includes(asNumber));
  });
  if (hits.length > 1) {
    throw Object.assign(
      new Error(`More than one older order matches ${t}. Scan the label or type the full order number.`),
      { status: 409 }
    );
  }
  return hits.length ? prisma.order.findUnique({ where: { id: hits[0].id } }) : null;
}

function notFound(raw) {
  return Object.assign(
    new Error(`Barcode not found: no order or garment has the code "${String(raw).trim()}". Check the code printed under the barcode (for example ORD-1001 or ORD-1001-1).`),
    { status: 404 }
  );
}

export async function resolveScanTarget(barcodeValue) {
  const raw = String(barcodeValue || "").trim();
  if (!raw) {
    throw Object.assign(new Error("Barcode value is required"), { status: 400 });
  }
  const value = normalizeBarcodeInput(raw);

  const parsed = parseOperationalBarcode(value);
  if (parsed?.kind === "order") {
    const order =
      (await prisma.order.findFirst({
        where: {
          OR: [
            { barcodeValue: { equals: value, mode: "insensitive" } },
            { orderId: { equals: `ORD-${parsed.orderNumber}`, mode: "insensitive" } }
          ]
        }
      })) || (await findLegacyOrderByTail(parsed.orderNumber));
    if (!order) throw notFound(raw);
    return { kind: "order", order };
  }

  // Short code of an older order as the app shows it, e.g. ORD-6AC0.
  const shortLegacy = value.match(/^ORD-([A-Z0-9]{1,8})$/);
  if (shortLegacy) {
    const legacyOrder = await findLegacyOrderByTail(shortLegacy[1]);
    if (legacyOrder) return { kind: "order", order: legacyOrder };
  }

  const itemHit = await prisma.orderItem.findFirst({
    where: { barcodeValue: { equals: value, mode: "insensitive" } }
  });
  if (!itemHit) {
    const orderHit = await prisma.order.findFirst({
      where: {
        OR: [
          { barcodeValue: { equals: value, mode: "insensitive" } },
          { orderId: { equals: value, mode: "insensitive" } }
        ]
      }
    });
    if (orderHit && parsed?.kind !== "item" && parsed?.kind !== "part") {
      return { kind: "order", order: orderHit };
    }
  }

  try {
    const item = await resolveItemByBarcode(value);
    return { kind: "item", item };
  } catch (e) {
    if (e.status === 404) throw notFound(raw);
    throw e;
  }
}

export async function buildOrderScanDetails(orderOrDoc) {
  const order =
    typeof orderOrDoc === "object" && orderOrDoc?.id
      ? orderOrDoc
      : await prisma.order.findUnique({ where: { id: orderOrDoc } });
  if (!order) return null;

  const hydrated = await hydrateOrder(order, { includeCheckpoints: true });
  const garments = (hydrated.items || []).filter((it) => isTopLevelItem(it));
  const incomplete = garments.filter((g) => !isGarmentCompleteStage(g.currentStage));
  const packed = Boolean(order.packedAt) || order.productionStatus === "ready_for_pickup";
  const delivered = order.productionStatus === "delivered";
  const readyToPack = !packed && !delivered && garments.length > 0 && incomplete.length === 0;

  let action = "blocked";
  let actionStage = "PACKAGING";
  let location = "In production";
  let managerCommand = `Cannot pack: ${incomplete.length} garment(s) are not complete. Scan each garment barcode until every piece is in showroom.`;
  const allowedActions = [{ code: "print_label", label: "Print / reprint order label" }];

  if (delivered) {
    action = "done";
    actionStage = "DELIVERED";
    location = "Delivered";
    managerCommand = "This order is delivered.";
    allowedActions.push({ code: "view_history", label: "View history" });
  } else if (packed) {
    action = "check_in";
    actionStage = "DELIVERED";
    location = "Ready for pickup / delivery";
    managerCommand = "Packed. Scan this order barcode to mark pickup / delivery.";
    allowedActions.push({ code: "check_in", label: "Mark pickup / delivery" });
  } else if (readyToPack) {
    action = "check_in";
    actionStage = "PACKAGING";
    location = "Ready to pack";
    managerCommand = "All garments are complete. Scan this order barcode to pack.";
    allowedActions.push({ code: "check_in", label: "Pack order" });
  }

  return {
    scanKind: "order",
    customer: hydrated.customer,
    item: null,
    group: {
      groupCode: order.groupCode || "",
      groupId: order.groupId || null,
      name: hydrated.group?.name || order.groupCode || "",
      responsibleName: hydrated.group?.responsibleName || "",
      responsiblePhone: hydrated.group?.responsiblePhone || "",
      otherOrdersSharingGroup: 0,
      otherItemsSharingGroup: 0
    },
    order: {
      orderId: order.orderId,
      _id: order.id,
      productionStatus: order.productionStatus,
      priority: order.priority,
      createdAt: order.createdAt,
      barcodeValue: order.barcodeValue,
      packedAt: order.packedAt || null,
      siblingItems: garments.map((g) => ({
        _id: g._id,
        clothingType: g.clothingType,
        clothingCode: g.clothingCode,
        itemKind: g.itemKind || "garment",
        barcodeValue: g.barcodeValue,
        labelBarcode: g.labelBarcode,
        currentStage: g.currentStage || null,
        isCurrent: false
      }))
    },
    pricing: {
      totalAgreedPrice: order.totalAgreedPrice || 0,
      depositPaid: order.depositPaid || 0,
      balanceRemaining: hydrated.balanceRemaining
    },
    timing: {
      requiredCompletionDate: order.requiredCompletionDate,
      daysRemaining: null,
      overdue: false,
      currentStage: packed ? "PACKAGING" : readyToPack ? "SHOWROOM" : null,
      nextExpectedStage: delivered ? "DELIVERED" : packed ? "DELIVERED" : "PACKAGING",
      stageSequence: ["PACKAGING", "DELIVERED"]
    },
    production: {
      action,
      actionStage,
      boardStatus: delivered ? "in_progress" : packed ? "received" : readyToPack ? "waiting" : "waiting",
      nextAction: {
        code: delivered ? "done" : action === "blocked" ? "blocked" : "check_in",
        label: delivered
          ? "Delivered"
          : packed
            ? "Mark pickup / delivery"
            : readyToPack
              ? "Pack order"
              : "Cannot pack yet",
        stage: actionStage
      },
      stageStates: [],
      assignment: null,
      assignmentChain: [],
      workstation: { stage: actionStage, label: "Order packing", workers: [] },
      currentWorker: null,
      nextWorker: null,
      nextStage: actionStage,
      location,
      locationKind: "order",
      offSite: false,
      managerCommand,
      allowedActions,
      incompleteItems: incomplete.map((g) => ({
        _id: g._id,
        clothingType: g.clothingType,
        barcodeValue: g.barcodeValue,
        currentStage: g.currentStage || null
      })),
      history: []
    }
  };
}

/**
 * Resolve barcode to OrderItem. Accepts:
 * - stored barcodeValue (including legacy ITM-* / CUID-era codes)
 * - simple operational codes ORD-293-1
 * - part codes ORD-293-1-XX (parent after assembly)
 * - order barcodes / orderIds
 */
export async function resolveItemByBarcode(barcodeValue) {
  const value = String(barcodeValue || "").trim();
  if (!value) {
    throw Object.assign(new Error("Barcode value is required"), { status: 400 });
  }

  const item = await prisma.orderItem.findFirst({
    where: { barcodeValue: { equals: value, mode: "insensitive" } }
  });
  if (item) {
    if (item.itemKind === "part" && item.assembledAt && item.parentItemId) {
      const parent = await prisma.orderItem.findUnique({ where: { id: item.parentItemId } });
      if (parent) return parent;
    }
    return item;
  }

  const simple = value.match(/^ORD-(\d+)-(\d+)$/i);
  const partMatch = value.match(/^ORD-(\d+)-(\d+)-([A-Z]{2,4})$/i);
  if (partMatch) {
    const order = await prisma.order.findFirst({
      where: { orderId: { equals: `ORD-${partMatch[1]}`, mode: "insensitive" } }
    });
    if (order) {
      const idx = Math.max(1, Number(partMatch[2]));
      const code = partMatch[3].toUpperCase();
      const part = await prisma.orderItem.findFirst({
        where: {
          order: order.id,
          partCode: { equals: code, mode: "insensitive" },
          itemIndex: idx,
          itemKind: "part"
        }
      });
      if (part) {
        if (part.assembledAt && part.parentItemId) {
          const parent = await prisma.orderItem.findUnique({ where: { id: part.parentItemId } });
          if (parent) return parent;
        }
        return part;
      }
    }
  }
  if (simple) {
    const found = await findGarmentByOperationalIndex(`ORD-${simple[1]}`, Number(simple[2]));
    if (found) return found;
  }

  // Older orders: labels print ORD-<last 4 digits>-n, the app shows ORD-<last 4>-n.
  const tailForm = value.match(/^ORD-([A-Z0-9]+)-(\d+)$/i);
  if (tailForm) {
    const matchOrder = await findLegacyOrderByTail(tailForm[1]);
    if (matchOrder) {
      const found = await findGarmentByOperationalIndex(matchOrder.orderId, Number(tailForm[2]), matchOrder.id);
      if (found) return found;
    }
  }

  const order = await prisma.order.findFirst({
    where: {
      OR: [
        { barcodeValue: { equals: value, mode: "insensitive" } },
        { orderId: { equals: value, mode: "insensitive" } }
      ]
    }
  });
  if (!order) {
    throw Object.assign(new Error("Barcode not found"), { status: 404 });
  }

  const items = await prisma.orderItem.findMany({
    where: { order: order.id, itemKind: { not: "part" }, parentItemId: null },
    orderBy: [{ itemIndex: "asc" }, { createdAt: "asc" }]
  });
  if (!items.length) {
    throw Object.assign(new Error("Barcode not found"), { status: 404 });
  }
  if (items.length === 1) return items[0];

  const itemIds = items.map((i) => i.id);
  const checkpoints = await prisma.stageCheckpoint.findMany({
    where: { orderItemId: { in: itemIds } }
  });
  const open = checkpoints.find((c) => c.checkedInAt && !c.checkedOutAt);
  if (open) {
    const match = items.find((i) => i.id === open.orderItemId);
    if (match) return match;
  }
  return items[0];
}
