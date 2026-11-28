import { Router } from "express";
import { body, query, param, validationResult } from "express-validator";
import { prisma } from "../db/prisma.js";
import { s } from "../utils/serialize.js";
import { requireAuth } from "../middleware/auth.js";
import { ProductionStage, stagesForUserRole } from "../constants/production.js";
import { requireCapability } from "../middleware/permissions.js";
import { DEFAULT_TENANT_ID } from "../config/tenant.js";
import { buildScanDetails, resolveScanTarget, buildOrderScanDetails } from "../utils/scanDetails.js";
import { resolveStageSequence, validateCheckIn, nextExpectedStage } from "../utils/stageSequence.js";
import { syncOrderStatusFromItems } from "../utils/syncOrderFromStages.js";
import { rankStaffForAssignment } from "../utils/assignmentScore.js";
import { hydrateOrder } from "../utils/orderHydrate.js";
import { buildProductionQueue } from "../utils/productionBoard.js";
import { renderBarcodePng, renderBarcodeSvg } from "../utils/barcode.js";
import { isRecordId } from "../utils/recordId.js";
import { CANONICAL_WORKSTATION_STAGES, stageAliases } from "../constants/production.js";
import {
  parentReadyForAssembly,
  skillStagesFor,
  assemblyStage,
  canonicalStage,
  stepStageNames,
  findCheckpoint,
  isGarmentCompleteStage
} from "../utils/productionModel.js";
import { resolveRequestedStage } from "../utils/stageSequence.js";
import { OFF_SITE_STAGE, openOffSiteCheckpoint, pendingOffSiteWindow, offSiteWindows } from "../utils/offSite.js";
import { packOrder, deliverPackedOrder, packagingMessage } from "../utils/orderPack.js";
import { itemOffSiteStages } from "../utils/offSite.js";

const router = Router();

const WORKSTATION_LABELS = {
  SEWING_CUTTING: "Sewing & cutting",
  EMBROIDERY: "Embroidery",
  FINAL_SEWING: "Final sewing",
  FINISHING: "Finishing"
};
router.use(requireAuth);

/** Stages that are a location or order step, not a workstation: no worker or skill needed. */
const STAFF_OPTIONAL_STAGES = new Set(["RECEIVED", "OFF_SITE", "SHOWROOM", "READY", "PACKAGING", "DELIVERED"]);

/** Open checkpoints at these never count as a worker's active garment. */
const NOT_WORKSTATION_WORK = ["RECEIVED", "OFF_SITE"];

function staffOptionalFor(stage) {
  return STAFF_OPTIONAL_STAGES.has(stage) || STAFF_OPTIONAL_STAGES.has(canonicalStage(stage));
}

async function assertStaffForStage(staffId, stage, { requireOnDuty = true } = {}, client = prisma) {
  if (!staffId) {
    if (staffOptionalFor(stage)) return null;
    throw Object.assign(new Error(`Choose the worker for ${stage}.`), { status: 400 });
  }
  const staff = await client.staff.findFirst({
    where: { id: staffId, tenantId: DEFAULT_TENANT_ID, active: true }
  });
  if (!staff) {
    throw Object.assign(new Error("Staff not found or inactive"), { status: 400 });
  }
  if (requireOnDuty && staff.status === "OFF_DUTY" && !staffOptionalFor(stage)) {
    throw Object.assign(
      new Error(`${staff.name} is off duty and cannot take this stage.`),
      { status: 400 }
    );
  }
  if (staffOptionalFor(stage)) return staff;
  const skill = await client.staffSkill.findFirst({
    where: { staffId: staff.id, stage: { in: skillStagesFor(stage) } }
  });
  if (!skill) {
    throw Object.assign(
      new Error(`Worker is not assigned to this stage: ${staff.name} is not skilled for ${stage}`),
      { status: 400 }
    );
  }
  return staff;
}

/** BUSY = actively on a workstation garment. Off-site trips never make a worker busy. */
async function refreshStaffPresence(staffId, client = prisma) {
  if (!staffId) return;
  const staff = await client.staff.findUnique({ where: { id: staffId } });
  if (!staff || staff.status === "OFF_DUTY") return;
  const open = await client.stageCheckpoint.count({
    where: { checkedInByStaffId: staffId, checkedOutAt: null, stage: { notIn: NOT_WORKSTATION_WORK } }
  });
  const next = open > 0 ? "BUSY" : "AVAILABLE";
  if (staff.status !== next) {
    await client.staff.update({ where: { id: staffId }, data: { status: next } });
  }
}

async function upsertAssignment(tx, { staffId, orderItemId, stage, suggestedStaffId, followedSuggestion, userId }) {
  // Handing a stage to someone else closes the old assignment as reassigned,
  // not as finished work.
  const now = new Date();
  await tx.staffAssignment.updateMany({
    where: { orderItemId, stage, completedAt: null, staffId: { not: staffId } },
    data: { completedAt: now, reassignedAt: now }
  });
  const existing = await tx.staffAssignment.findFirst({
    where: { orderItemId, stage, staffId, completedAt: null }
  });
  if (existing) return existing;
  const activeForStaff = await tx.staffAssignment.count({
    where: { staffId, completedAt: null }
  });
  return tx.staffAssignment.create({
    data: {
      staffId,
      orderItemId,
      stage,
      assignedAt: now,
      completedAt: null,
      suggestedStaffId: suggestedStaffId || null,
      followedSuggestion: Boolean(followedSuggestion),
      queuePosition: activeForStaff
    }
  });
}

/**
 * When a garment is assembled from its parts, its own earlier stages were done
 * on the parts. Record them as closed on the garment (notes say so), so its
 * route continues from final sewing instead of starting over.
 */
async function recordStagesDoneOnParts(tx, itemId, stageSequence, offSiteStages, assembleAt) {
  const cps = await tx.stageCheckpoint.findMany({ where: { orderItemId: itemId } });
  const prior = stageSequence.slice(0, Math.max(0, stageSequence.indexOf(assembleAt)));
  const now = new Date();
  const windows = offSiteWindows(stageSequence, offSiteStages, cps).filter((w) =>
    w.stages.every((st) => prior.includes(st))
  );
  const tripsDone = cps.filter((c) => c.stage === OFF_SITE_STAGE).length;
  for (const w of windows.slice(tripsDone)) {
    await tx.stageCheckpoint.create({
      data: {
        orderItemId: itemId,
        stage: OFF_SITE_STAGE,
        checkedInAt: now,
        checkedOutAt: now,
        coveredStages: w.stages,
        notes: "Done on parts"
      }
    });
  }
  const offSet = new Set(windows.flatMap((w) => w.stages));
  for (const st of prior) {
    if (offSet.has(st) || findCheckpoint(cps, st, stageSequence)) continue;
    await tx.stageCheckpoint.create({
      data: { orderItemId: itemId, stage: st, checkedInAt: now, checkedOutAt: now, notes: "Done on parts" }
    });
  }
}

function offSiteTripData(body) {
  const clip = (v, n) => String(v || "").trim().slice(0, n);
  const due = body.expectedReturnAt ? new Date(body.expectedReturnAt) : null;
  return {
    offSiteHandlerName: clip(body.offSiteHandlerName, 120),
    offSiteHandlerPhone: clip(body.offSiteHandlerPhone, 40),
    expectedReturnAt: due && !Number.isNaN(due.getTime()) ? due : null
  };
}

const optionalId = { nullable: true, checkFalsy: true };

router.post(
  "/scan",
  body("barcodeValue").trim().notEmpty(),
  body("stage").isIn(ProductionStage),
  body("staffId").optional(optionalId).custom(isRecordId),
  body("notes").optional().isString(),
  body("adminOverride").optional().isBoolean(),
  body("offSiteFor").optional(optionalId).isIn(ProductionStage),
  body("offSiteHandlerName").optional({ nullable: true }).isString().isLength({ max: 120 }),
  body("offSiteHandlerPhone").optional({ nullable: true }).isString().isLength({ max: 40 }),
  body("expectedReturnAt").optional(optionalId).isISO8601(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    try {
      const target = await resolveScanTarget(req.body.barcodeValue);
      const notes = req.body.notes || "";
      const adminOverride = Boolean(req.body.adminOverride);
      const userRole = req.user?.role;
      const staffId = req.body.staffId || null;

      if (adminOverride && !["admin", "manager"].includes(userRole)) {
        return res.status(403).json({ message: "Only admin/manager can override stage sequence" });
      }

      if (target.kind === "order") {
        const order = target.order;
        const requested = req.body.stage;
        const canon = canonicalStage(requested);
        if (canon === "PACKAGING") {
          await assertStaffForStage(staffId, "PACKAGING", { requireOnDuty: true });
          const packed = await prisma.$transaction(async (tx) => {
            const fresh = await tx.order.findUnique({ where: { id: order.id } });
            return packOrder(fresh, { userId: req.user.id, staffId, notes }, tx);
          });
          const scanDetails = await buildOrderScanDetails(packed);
          const orderHydrated = await hydrateOrder(packed, { includeCheckpoints: false });
          return res.json({
            ok: true,
            action: "pack",
            scanKind: "order",
            message: "Packed — ready for pickup / delivery",
            checkpoint: null,
            scanDetails,
            order: orderHydrated
          });
        }
        if (canon === "DELIVERED" || canon === "SHOWROOM" || requested === "READY") {
          await assertStaffForStage(staffId, "DELIVERED", { requireOnDuty: false });
          const delivered = await prisma.$transaction(async (tx) => {
            const fresh = await tx.order.findUnique({ where: { id: order.id } });
            return deliverPackedOrder(fresh, { userId: req.user.id, staffId, notes }, tx);
          });
          const scanDetails = await buildOrderScanDetails(delivered);
          const orderHydrated = await hydrateOrder(delivered, { includeCheckpoints: false });
          return res.json({
            ok: true,
            action: "deliver",
            scanKind: "order",
            message: "Ready for pickup / delivered",
            checkpoint: null,
            scanDetails,
            order: orderHydrated
          });
        }
        return res.status(400).json({
          message: `Scan garment barcodes (ORD-n-i) for production stages. ${packagingMessage(order.orderId)}`
        });
      }

      const item = target.item;
      const { stageSequence, offSiteStages: typeOffSite } = await resolveStageSequence(item.clothingType, item.clothingCode, item.skipStages);
      let offSiteStages = itemOffSiteStages(item, typeOffSite);
      const stage = resolveRequestedStage(req.body.stage, [...stageSequence, OFF_SITE_STAGE]);

      if (
        ["PACKAGING", "DELIVERED"].includes(canonicalStage(stage)) &&
        !adminOverride
      ) {
        const orderRow = await prisma.order.findUnique({ where: { id: item.order } });
        return res.status(400).json({
          message: packagingMessage(orderRow?.orderId)
        });
      }

      // Same route step under any of its names (legacy CUTTING/SEWING/READY
      // checkpoints count as their atelier step) — never open a second one.
      const stepNames = stepStageNames(stage, [...stageSequence, OFF_SITE_STAGE]);
      const openAtStage = await prisma.stageCheckpoint.findFirst({
        where: { orderItemId: item.id, stage: { in: stepNames }, checkedOutAt: null }
      });

      let action;
      let checkpoint;
      let actor = null;

      if (openAtStage) {
        // Check-out (for OFF_SITE: the garment came back)
        actor = await assertStaffForStage(staffId, stage, { requireOnDuty: false });
        const actorName = actor?.name || req.user?.name || "manager";
        checkpoint = await prisma.$transaction(async (tx) => {
          const cp = await tx.stageCheckpoint.update({
            where: { id: openAtStage.id },
            data: {
              checkedOutAt: new Date(),
              checkedOutByStaffId: staffId,
              ...(notes
                ? { notes: [openAtStage.notes, notes].filter(Boolean).join(" | ") }
                : {})
            }
          });
          await tx.staffAssignment.updateMany({
            where: { orderItemId: item.id, stage: { in: stepNames }, completedAt: null },
            data: { completedAt: new Date() }
          });
          if (stage === "FINAL_SEWING" || (stage === "FINISHING" && !stageSequence.includes("FINAL_SEWING"))) {
            const now = new Date();
            await tx.orderItem.update({ where: { id: item.id }, data: { assembledAt: now } });
            await tx.orderItem.updateMany({
              where: { parentItemId: item.id },
              data: { assembledAt: now }
            });
          }
          await syncOrderStatusFromItems(item.order, req.user.id, tx);
          const orderRow = await tx.order.findUnique({ where: { id: item.order } });
          await tx.productionLog.create({
            data: {
              orderId: orderRow?.orderId || item.orderId,
              mongoOrderId: item.order,
              userId: req.user.id,
              action: "scan_out",
              fromStatus: stage,
              toStatus: stage,
              notes:
                stage === OFF_SITE_STAGE
                  ? `Returned from off-site${openAtStage.offSiteHandlerName ? ` (${openAtStage.offSiteHandlerName})` : ""}`
                  : `Checked out of ${stage} by ${actorName}`,
              metadata: { stage, staffId, itemId: item.id, barcodeValue: item.barcodeValue }
            }
          });
          return cp;
        });
        await refreshStaffPresence(staffId);
        action = "check_out";
      } else {
        // Check-in (for OFF_SITE: the garment leaves the shop)
        let routeChange = null;
        if (stage === OFF_SITE_STAGE && req.body.offSiteFor) {
          const cps = await prisma.stageCheckpoint.findMany({ where: { orderItemId: item.id } });
          const sendFor = resolveRequestedStage(req.body.offSiteFor, stageSequence);
          if (!stageSequence.includes(sendFor) || isGarmentCompleteStage(sendFor)) {
            return res.status(400).json({ message: `${sendFor} cannot be sent off-site.` });
          }
          const next = nextExpectedStage(cps, stageSequence, offSiteStages);
          if (next !== OFF_SITE_STAGE) {
            if (next !== sendFor) {
              return res.status(400).json({
                message: `Only the next stage (${next}) can be sent off-site.`
              });
            }
            offSiteStages = [...offSiteStages, sendFor];
            routeChange = offSiteStages;
          }
        }

        // Assembly (final sewing) of a garment that was made as separate parts:
        // allowed once every part has finished its own route.
        const assembleAt = assemblyStage(stageSequence);
        let assemblingFromParts = false;
        if (assembleAt && stage === assembleAt && !item.parentItemId) {
          const parts = await prisma.orderItem.findMany({ where: { parentItemId: item.id } });
          if (parts.length) {
            const partCps = await prisma.stageCheckpoint.findMany({
              where: { orderItemId: { in: parts.map((p) => p.id) } }
            });
            const byPart = new Map();
            for (const cp of partCps) {
              if (!byPart.has(cp.orderItemId)) byPart.set(cp.orderItemId, []);
              byPart.get(cp.orderItemId).push(cp);
            }
            if (parentReadyForAssembly(parts, byPart, stageSequence)) {
              assemblingFromParts = true;
            } else if (!adminOverride) {
              return res.status(400).json({
                message: "Parts are not ready for assembly. Finish each part's stages first."
              });
            }
          }
        }

        const validation = await validateCheckIn(item.id, stage, stageSequence, {
          adminOverride,
          offSiteStages,
          priorDoneByParts: assemblingFromParts
        });
        if (!validation.ok) {
          return res.status(400).json({ message: validation.message });
        }
        if (validation.alreadyOpen) {
          return res.status(400).json({
            message: `This garment is already checked into ${validation.checkpoint?.stage || stage}`
          });
        }

        const goingOffSite = stage === OFF_SITE_STAGE;
        actor = await assertStaffForStage(staffId, stage, { requireOnDuty: true });
        // The worker on an off-site trip is the outside person, not a staff
        // record, so an off-site scan never ties up a registered worker.
        const workerId = goingOffSite ? null : staffId;

        if (workerId) {
          const otherOpen = await prisma.stageCheckpoint.findFirst({
            where: {
              checkedInByStaffId: workerId,
              checkedOutAt: null,
              stage: { notIn: NOT_WORKSTATION_WORK },
              orderItemId: { not: item.id }
            },
            include: { orderItem: true }
          });
          if (otherOpen && !adminOverride) {
            return res.status(400).json({
              message: `${actor.name} is already working on ${otherOpen.orderItem?.orderId || "another garment"} (${otherOpen.stage}). Scan that item out first.`
            });
          }
        }

        const trip = goingOffSite ? offSiteTripData(req.body) : {};
        if (goingOffSite) {
          const cpsNow = await prisma.stageCheckpoint.findMany({ where: { orderItemId: item.id } });
          trip.coveredStages = pendingOffSiteWindow(cpsNow, stageSequence, offSiteStages)?.stages || [];
        }
        checkpoint = await prisma.$transaction(async (tx) => {
          if (routeChange) {
            await tx.orderItem.update({
              where: { id: item.id },
              data: { offSiteStages: routeChange, offSiteRouteCustom: true }
            });
          }
          if (validation.closeOffSite) {
            const openOff = await tx.stageCheckpoint.findFirst({
              where: { orderItemId: item.id, stage: OFF_SITE_STAGE, checkedOutAt: null }
            });
            if (openOff) {
              await tx.stageCheckpoint.update({
                where: { id: openOff.id },
                data: {
                  checkedOutAt: new Date(),
                  checkedOutByStaffId: staffId,
                  notes: [openOff.notes, notes, "Returned from off-site"].filter(Boolean).join(" | ")
                }
              });
            }
          }
          if (assemblingFromParts) {
            await recordStagesDoneOnParts(tx, item.id, stageSequence, offSiteStages, stage);
          }
          const cp = await tx.stageCheckpoint.create({
            data: {
              orderItemId: item.id,
              stage,
              checkedInAt: new Date(),
              checkedInByStaffId: workerId,
              notes,
              ...trip
            }
          });
          if (workerId) {
            await upsertAssignment(tx, {
              staffId: workerId,
              orderItemId: item.id,
              stage,
              userId: req.user.id
            });
            await tx.staffAssignment.updateMany({
              where: { orderItemId: item.id, stage, staffId: workerId, completedAt: null },
              data: {
                distributedAt: new Date(),
                receivedAt: new Date(),
                distributedByUserId: req.user.id
              }
            });
          }
          await syncOrderStatusFromItems(item.order, req.user.id, tx);
          const orderRow = await tx.order.findUnique({ where: { id: item.order } });
          await tx.productionLog.create({
            data: {
              orderId: orderRow?.orderId || item.orderId,
              mongoOrderId: item.order,
              userId: req.user.id,
              action: "scan_in",
              fromStatus: stage,
              toStatus: stage,
              notes: goingOffSite
                ? `Sent off-site${trip.offSiteHandlerName ? ` with ${trip.offSiteHandlerName}` : ""}${routeChange ? ` for ${req.body.offSiteFor}` : ""}`
                : `Checked in to ${stage} — ${actor?.name || req.user?.name || "manager"}`,
              metadata: {
                stage,
                staffId: workerId,
                itemId: item.id,
                barcodeValue: item.barcodeValue,
                ...(goingOffSite ? { offSiteFor: req.body.offSiteFor || null, ...trip } : {})
              }
            }
          });
          return cp;
        });
        await refreshStaffPresence(workerId);
        action = "check_in";
      }

      const orderDoc = await prisma.order.findUnique({ where: { id: item.order } });
      const scanDetails = await buildScanDetails(item.id);
      const orderHydrated = orderDoc
        ? await hydrateOrder(orderDoc, { includeCheckpoints: false })
        : null;

      const offSiteOut = action === "check_in" && stage === OFF_SITE_STAGE;
      const offSiteIn = action === "check_out" && stage === OFF_SITE_STAGE;
      const message = offSiteOut
        ? "Sent off-site"
        : offSiteIn
          ? "Back from off-site"
          : action === "check_in"
            ? `Checked in to ${stage}`
            : `Checked out of ${stage}`;

      res.json({
        ok: true,
        action,
        scanKind: "item",
        message,
        checkpoint: s(checkpoint),
        scanDetails,
        order: orderHydrated
      });
    } catch (e) {
      if (e.status) return res.status(e.status).json({ message: e.message });
      throw e;
    }
  }
);

/**
 * Change one garment's off-site route for a stage it has not reached yet:
 * offSite=true sends that stage out, offSite=false keeps it in the shop.
 * The clothing type's off-site stages stay a default only.
 */
router.post(
  "/items/:id/off-site-route",
  requireCapability("distribution"),
  param("id").custom(isRecordId),
  body("stage").isIn(ProductionStage),
  body("offSite").isBoolean(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const item = await prisma.orderItem.findUnique({ where: { id: req.params.id } });
    if (!item) return res.status(404).json({ message: "Order item not found" });

    const { stageSequence, offSiteStages: typeOffSite } = await resolveStageSequence(item.clothingType, item.clothingCode, item.skipStages);
    const current = itemOffSiteStages(item, typeOffSite);
    const stage = resolveRequestedStage(req.body.stage, stageSequence);
    const wantOffSite = req.body.offSite === true || req.body.offSite === "true";

    if (!stageSequence.includes(stage) || isGarmentCompleteStage(stage)) {
      return res.status(400).json({ message: `${stage} is not an off-site-able step for this garment.` });
    }
    const cps = await prisma.stageCheckpoint.findMany({ where: { orderItemId: item.id } });
    if (openOffSiteCheckpoint(cps)) {
      return res.status(400).json({ message: "Garment is off-site now. Change the route after it returns." });
    }
    // Only steps the garment has not reached can change.
    const next = nextExpectedStage(cps, stageSequence, current);
    const pending = pendingOffSiteWindow(cps, stageSequence, current);
    const frontier =
      next === OFF_SITE_STAGE && pending?.stages?.length
        ? stageSequence.indexOf(pending.stages[0])
        : stageSequence.indexOf(next);
    if (frontier < 0 || stageSequence.indexOf(stage) < frontier || findCheckpoint(cps, stage, stageSequence)) {
      return res.status(400).json({ message: `${stage} is already done or in progress.` });
    }

    const has = current.includes(stage);
    if (has === wantOffSite) {
      return res.json({ ok: true, offSiteStages: current, scanDetails: await buildScanDetails(item.id) });
    }
    const updatedStages = wantOffSite ? [...current, stage] : current.filter((st) => st !== stage);
    await prisma.$transaction(async (tx) => {
      await tx.orderItem.update({
        where: { id: item.id },
        data: { offSiteStages: updatedStages, offSiteRouteCustom: true }
      });
      const orderRow = await tx.order.findUnique({ where: { id: item.order } });
      await tx.productionLog.create({
        data: {
          orderId: orderRow?.orderId || item.orderId,
          mongoOrderId: item.order,
          userId: req.user.id,
          action: "off_site_route",
          notes: wantOffSite ? `${stage} will be done off-site` : `${stage} will be done in shop`,
          metadata: { itemId: item.id, stage, offSite: wantOffSite, offSiteStages: updatedStages }
        }
      });
    });
    res.json({ ok: true, offSiteStages: updatedStages, scanDetails: await buildScanDetails(item.id) });
  }
);

router.get(
  "/suggest-assignment",
  requireCapability("distribution"),
  query("orderItemId").custom(isRecordId),
  query("stage").isIn(ProductionStage),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    try {
      const result = await rankStaffForAssignment(req.query.orderItemId, req.query.stage);
      res.json({
        orderItemId: req.query.orderItemId,
        stage: req.query.stage,
        rankings: result.rankings
      });
    } catch (e) {
      if (e.status) return res.status(e.status).json({ message: e.message });
      throw e;
    }
  }
);

router.post(
  "/assignments",
  requireCapability("distribution"),
  body("staffId").custom(isRecordId),
  body("orderItemId").custom(isRecordId),
  body("stage").isIn(ProductionStage),
  body("suggestedStaffId").optional({ nullable: true, checkFalsy: true }).custom(isRecordId),
  body("followedSuggestion").optional().isBoolean(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    try {
      await assertStaffForStage(req.body.staffId, req.body.stage, { requireOnDuty: true });

      const assignment = await prisma.$transaction(async (tx) => {
        const created = await upsertAssignment(tx, {
          staffId: req.body.staffId,
          orderItemId: req.body.orderItemId,
          stage: req.body.stage,
          suggestedStaffId: req.body.suggestedStaffId,
          followedSuggestion: req.body.followedSuggestion,
          userId: req.user.id
        });
        const orderItem = await tx.orderItem.findUnique({ where: { id: req.body.orderItemId } });
        if (orderItem) {
          const orderRow = await tx.order.findUnique({ where: { id: orderItem.order } });
          await tx.productionLog.create({
            data: {
              orderId: orderRow?.orderId || orderItem.orderId,
              mongoOrderId: orderItem.order,
              userId: req.user.id,
              action: "assignment",
              notes: `Assigned ${req.body.stage}`,
              metadata: {
                stage: req.body.stage,
                staffId: req.body.staffId,
                itemId: req.body.orderItemId
              }
            }
          });
        }
        return created;
      });

      res.status(201).json(s(assignment));
    } catch (e) {
      if (e.status) return res.status(e.status).json({ message: e.message });
      throw e;
    }
  }
);

router.get("/barcode.svg", query("value").trim().notEmpty(), async (req, res) => {
  try {
    const svg = renderBarcodeSvg(req.query.value);
    res.set("Cache-Control", "private, max-age=86400");
    res.type("image/svg+xml").send(svg);
  } catch {
    res.status(400).json({ message: "Could not render barcode" });
  }
});

router.get("/barcode.png", query("value").trim().notEmpty(), async (req, res) => {
  try {
    const png = await renderBarcodePng(req.query.value);
    res.set("Cache-Control", "private, max-age=86400");
    res.type("image/png").send(png);
  } catch {
    res.status(400).json({ message: "Could not render barcode" });
  }
});

router.get("/lookup", query("barcodeValue").trim().notEmpty(), async (req, res) => {
  try {
    const target = await resolveScanTarget(req.query.barcodeValue);
    if (target.kind === "order") {
      const scanDetails = await buildOrderScanDetails(target.order);
      return res.json({ scanKind: "order", scanDetails });
    }
    const scanDetails = await buildScanDetails(target.item);
    res.json({ scanKind: "item", scanDetails });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ message: e.message });
    throw e;
  }
});

router.get("/queue", requireCapability("distribution"), async (req, res) => {
  const includeRecommendations = String(req.query.lite || "") !== "1";
  const board = await buildProductionQueue({ includeRecommendations });
  res.json(board);
});

router.get("/floor", requireCapability("scan"), async (req, res) => {
  const stages = stagesForUserRole(req.user.role);
  const board = await buildProductionQueue({ includeRecommendations: false });
  if (!stages) {
    return res.json({
      stages: [],
      role: req.user.role,
      items: board.items || []
    });
  }
  const items = (board.items || []).filter((row) => {
    const active = row.inProgress ? row.openStage : row.nextStage;
    return stages.includes(active) || stages.includes(row.currentStage);
  });
  res.json({
    stages,
    role: req.user.role,
    items
  });
});

router.post(
  "/assignments/:id/distribute",
  requireCapability("distribution"),
  param("id").custom(isRecordId),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const assignment = await prisma.staffAssignment.findUnique({
      where: { id: req.params.id }
    });
    if (!assignment || assignment.completedAt) {
      return res.status(404).json({ message: "Active assignment not found" });
    }
    const updated = await prisma.staffAssignment.update({
      where: { id: assignment.id },
      data: {
        distributedAt: new Date(),
        distributedByUserId: req.user.id
      }
    });
    res.json(s(updated));
  }
);

router.post(
  "/assignments/:id/receive",
  param("id").custom(isRecordId),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const assignment = await prisma.staffAssignment.findUnique({
      where: { id: req.params.id }
    });
    if (!assignment || assignment.completedAt) {
      return res.status(404).json({ message: "Active assignment not found" });
    }
    const updated = await prisma.staffAssignment.update({
      where: { id: assignment.id },
      data: {
        receivedAt: new Date(),
        distributedAt: assignment.distributedAt || new Date(),
        distributedByUserId: assignment.distributedByUserId || req.user.id
      }
    });
    res.json(s(updated));
  }
);

/** Pre-assign the full production path for a garment. */
router.post(
  "/assignment-chain",
  requireCapability("distribution"),
  body("orderItemId").custom(isRecordId),
  body("path").isArray({ min: 1 }),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const item = await prisma.orderItem.findUnique({ where: { id: req.body.orderItemId } });
    if (!item) return res.status(404).json({ message: "Order item not found" });

    try {
      const created = [];
      await prisma.$transaction(async (tx) => {
        for (const step of req.body.path) {
          if (!step?.staffId || !ProductionStage.includes(step.stage)) {
            throw Object.assign(new Error("Each path step needs stage and staffId"), { status: 400 });
          }
          await assertStaffForStage(step.staffId, step.stage, { requireOnDuty: true }, tx);
          const asg = await upsertAssignment(tx, {
            staffId: step.staffId,
            orderItemId: item.id,
            stage: step.stage,
            followedSuggestion: Boolean(step.followedSuggestion),
            suggestedStaffId: step.suggestedStaffId,
            userId: req.user.id
          });
          created.push(asg);
        }
        const orderRow = await tx.order.findUnique({ where: { id: item.order } });
        await tx.productionLog.create({
          data: {
            orderId: orderRow?.orderId || item.orderId,
            mongoOrderId: item.order,
            userId: req.user.id,
            action: "assignment_chain",
            notes: `Production path set (${req.body.path.length} stages)`,
            metadata: { itemId: item.id, path: req.body.path }
          }
        });
      });
      const details = await buildScanDetails(item.id);
      res.status(201).json({ ok: true, assignments: created.map(s), scanDetails: details });
    } catch (e) {
      if (e.status) return res.status(e.status).json({ message: e.message });
      throw e;
    }
  }
);

router.post(
  "/queue/reorder",
  requireCapability("distribution"),
  body("staffId").custom(isRecordId),
  body("assignmentIds").isArray({ min: 1 }),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const ids = req.body.assignmentIds.map(String);
    await prisma.$transaction(
      ids.map((id, index) =>
        prisma.staffAssignment.updateMany({
          where: { id, staffId: req.body.staffId, completedAt: null },
          data: { queuePosition: index }
        })
      )
    );
    res.json({ ok: true, staffId: req.body.staffId, assignmentIds: ids });
  }
);

router.get("/workstations", requireCapability("scan"), async (_req, res) => {
  const staff = await prisma.staff.findMany({
    where: { tenantId: DEFAULT_TENANT_ID, active: true },
    include: { skills: true, assignments: { where: { completedAt: null } } }
  });
  const workstations = CANONICAL_WORKSTATION_STAGES.map((stage) => {
    const names = stageAliases(stage);
    const workers = staff.filter((st) => st.skills.some((sk) => names.includes(sk.stage)));
    return {
      stage,
      label: `${WORKSTATION_LABELS[stage] || stage} workstation`,
      workers: workers.map((st) => ({
        _id: st.id,
        name: st.name,
        role: st.role,
        status: st.status,
        queuedCount: st.assignments.filter((a) => names.includes(a.stage)).length
      }))
    };
  });
  res.json({ workstations });
});

export default router;
