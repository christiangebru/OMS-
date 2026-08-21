import { Router } from "express";
import { body, query, param, validationResult } from "express-validator";
import { prisma } from "../db/prisma.js";
import { s } from "../utils/serialize.js";
import { requireAuth } from "../middleware/auth.js";
import { ProductionStage, stagesForUserRole } from "../constants/production.js";
import { requireCapability } from "../middleware/permissions.js";
import { DEFAULT_TENANT_ID } from "../config/tenant.js";
import { resolveItemByBarcode, buildScanDetails } from "../utils/scanDetails.js";
import { resolveStageSequence, validateCheckIn } from "../utils/stageSequence.js";
import { syncOrderStatusFromItems } from "../utils/syncOrderFromStages.js";
import { rankStaffForAssignment } from "../utils/assignmentScore.js";
import { hydrateOrder } from "../utils/orderHydrate.js";
import { buildProductionQueue } from "../utils/productionBoard.js";
import { renderBarcodePng } from "../utils/barcode.js";
import { isRecordId } from "../utils/recordId.js";
import { WORKSTATION_STAGES } from "../constants/production.js";

const router = Router();
router.use(requireAuth);

async function assertStaffForStage(staffId, stage, { requireOnDuty = true } = {}, client = prisma) {
  const staff = await client.staff.findFirst({
    where: { id: staffId, tenantId: DEFAULT_TENANT_ID, active: true }
  });
  if (!staff) {
    throw Object.assign(new Error("Staff not found or inactive"), { status: 400 });
  }
  if (requireOnDuty && staff.status === "OFF_DUTY") {
    throw Object.assign(
      new Error(`${staff.name} is off duty and cannot take this stage.`),
      { status: 400 }
    );
  }
  const skill = await client.staffSkill.findFirst({ where: { staffId: staff.id, stage } });
  if (!skill) {
    throw Object.assign(
      new Error(`Worker is not assigned to this stage: ${staff.name} is not skilled for ${stage}`),
      { status: 400 }
    );
  }
  return staff;
}

async function refreshStaffPresence(staffId, client = prisma) {
  const staff = await client.staff.findUnique({ where: { id: staffId } });
  if (!staff || staff.status === "OFF_DUTY") return;
  const open = await client.stageCheckpoint.count({
    where: { checkedInByStaffId: staffId, checkedOutAt: null }
  });
  const next = open > 0 ? "BUSY" : "AVAILABLE";
  if (staff.status !== next) {
    await client.staff.update({ where: { id: staffId }, data: { status: next } });
  }
}

async function upsertAssignment(tx, { staffId, orderItemId, stage, suggestedStaffId, followedSuggestion, userId }) {
  await tx.staffAssignment.updateMany({
    where: { orderItemId, stage, completedAt: null, staffId: { not: staffId } },
    data: { completedAt: new Date() }
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
      assignedAt: new Date(),
      completedAt: null,
      suggestedStaffId: suggestedStaffId || null,
      followedSuggestion: Boolean(followedSuggestion),
      queuePosition: activeForStaff
    }
  });
}

router.post(
  "/scan",
  body("barcodeValue").trim().notEmpty(),
  body("stage").isIn(ProductionStage),
  body("staffId").custom(isRecordId),
  body("notes").optional().isString(),
  body("adminOverride").optional().isBoolean(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    try {
      const item = await resolveItemByBarcode(req.body.barcodeValue);
      const stage = req.body.stage;
      const notes = req.body.notes || "";
      const adminOverride = Boolean(req.body.adminOverride);
      const userRole = req.user?.role;
      const staffId = req.body.staffId;

      if (adminOverride && !["admin", "manager"].includes(userRole)) {
        return res.status(403).json({ message: "Only admin/manager can override stage sequence" });
      }

      const { stageSequence } = await resolveStageSequence(item.clothingType);

      const openAtStage = await prisma.stageCheckpoint.findFirst({
        where: { orderItemId: item.id, stage, checkedOutAt: null }
      });

      let action;
      let checkpoint;

      if (openAtStage) {
        // Check-out
        const staff = await assertStaffForStage(staffId, stage, { requireOnDuty: false });
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
            where: { orderItemId: item.id, stage, completedAt: null },
            data: { completedAt: new Date() }
          });
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
              notes: `Checked out of ${stage} by ${staff.name}`,
              metadata: { stage, staffId, itemId: item.id, barcodeValue: item.barcodeValue }
            }
          });
          return cp;
        });
        await refreshStaffPresence(staffId);
        action = "check_out";
      } else {
        // Check-in
        const alreadyHere = await prisma.stageCheckpoint.findFirst({
          where: { orderItemId: item.id, stage, checkedOutAt: null }
        });
        if (alreadyHere) {
          return res.status(400).json({
            message: `This garment is already checked into ${stage}`
          });
        }

        const validation = await validateCheckIn(item.id, stage, stageSequence, {
          adminOverride
        });
        if (!validation.ok) {
          return res.status(400).json({ message: validation.message });
        }

        const staff = await assertStaffForStage(staffId, stage, { requireOnDuty: true });

        const otherOpen = await prisma.stageCheckpoint.findFirst({
          where: {
            checkedInByStaffId: staffId,
            checkedOutAt: null,
            orderItemId: { not: item.id }
          },
          include: { orderItem: true }
        });
        if (otherOpen && !adminOverride) {
          return res.status(400).json({
            message: `${staff.name} is already working on ${otherOpen.orderItem?.orderId || "another garment"} (${otherOpen.stage}). Scan that item out first.`
          });
        }

        checkpoint = await prisma.$transaction(async (tx) => {
          const cp = await tx.stageCheckpoint.create({
            data: {
              orderItemId: item.id,
              stage,
              checkedInAt: new Date(),
              checkedInByStaffId: staffId,
              notes
            }
          });
          await upsertAssignment(tx, {
            staffId,
            orderItemId: item.id,
            stage,
            userId: req.user.id
          });
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
              notes: `Checked in to ${stage} — ${staff.name}`,
              metadata: { stage, staffId, itemId: item.id, barcodeValue: item.barcodeValue }
            }
          });
          return cp;
        });
        await refreshStaffPresence(staffId);
        action = "check_in";
      }

      const orderDoc = await prisma.order.findUnique({ where: { id: item.order } });
      const scanDetails = await buildScanDetails(item.id);
      const orderHydrated = orderDoc
        ? await hydrateOrder(orderDoc, { includeCheckpoints: false })
        : null;

      res.json({
        ok: true,
        action,
        message: action === "check_in" ? `Checked in to ${stage}` : `Checked out of ${stage}`,
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

/** Preview scan details by barcode without mutating */
router.get("/barcode.png", query("value").trim().notEmpty(), async (req, res) => {
  try {
    const png = await renderBarcodePng(req.query.value, { scale: 2, height: 10, includetext: true });
    res.set("Cache-Control", "private, max-age=86400");
    res.type("image/png").send(png);
  } catch {
    res.status(400).json({ message: "Could not render barcode" });
  }
});

router.get("/lookup", query("barcodeValue").trim().notEmpty(), async (req, res) => {
  try {
    const item = await resolveItemByBarcode(req.query.barcodeValue);
    const scanDetails = await buildScanDetails(item);
    res.json({ scanDetails });
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
  const workstations = WORKSTATION_STAGES.map((stage) => {
    const workers = staff.filter((st) => st.skills.some((sk) => sk.stage === stage));
    return {
      stage,
      label: `${stage.charAt(0)}${stage.slice(1).toLowerCase()} workstation`,
      workers: workers.map((st) => ({
        _id: st.id,
        name: st.name,
        role: st.role,
        status: st.status,
        queuedCount: st.assignments.filter((a) => a.stage === stage).length
      }))
    };
  });
  res.json({ workstations });
});

export default router;
