import { Router } from "express";
import { body, query, validationResult } from "express-validator";
import { prisma } from "../db/prisma.js";
import { s } from "../utils/serialize.js";
import { requireAuth } from "../middleware/auth.js";
import { ProductionStage } from "../constants/production.js";
import { DEFAULT_TENANT_ID } from "../config/tenant.js";
import { resolveItemByBarcode, buildScanDetails } from "../utils/scanDetails.js";
import { resolveStageSequence, validateCheckIn } from "../utils/stageSequence.js";
import { syncOrderStatusFromItems } from "../utils/syncOrderFromStages.js";
import { rankStaffForAssignment } from "../utils/assignmentScore.js";
import { hydrateOrder } from "../utils/orderHydrate.js";

const router = Router();
router.use(requireAuth);

async function assertStaffForStage(staffId, stage, { requireAvailable = true } = {}, client = prisma) {
  const staff = await client.staff.findFirst({
    where: { id: staffId, tenantId: DEFAULT_TENANT_ID, active: true }
  });
  if (!staff) {
    throw Object.assign(new Error("Staff not found or inactive"), { status: 400 });
  }
  if (requireAvailable && staff.status !== "AVAILABLE") {
    throw Object.assign(
      new Error(`Staff ${staff.name} is ${staff.status}. Only AVAILABLE staff can check in.`),
      { status: 400 }
    );
  }
  const skill = await client.staffSkill.findFirst({ where: { staffId: staff.id, stage } });
  if (!skill) {
    throw Object.assign(new Error(`Staff ${staff.name} is not skilled for stage ${stage}`), {
      status: 400
    });
  }
  return staff;
}

router.post(
  "/scan",
  body("barcodeValue").trim().notEmpty(),
  body("stage").isIn(ProductionStage),
  body("staffId").isMongoId(),
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
        await assertStaffForStage(staffId, stage, { requireAvailable: false });
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
            where: { orderItemId: item.id, stage, staffId, completedAt: null },
            data: { completedAt: new Date() }
          });
          // Complete any remaining active assignment for this item+stage regardless of staff
          await tx.staffAssignment.updateMany({
            where: { orderItemId: item.id, stage, completedAt: null },
            data: { completedAt: new Date() }
          });
          await syncOrderStatusFromItems(item.order, req.user.id, tx);
          return cp;
        });
        action = "check_out";
      } else {
        // Check-in
        const validation = await validateCheckIn(item.id, stage, stageSequence, {
          adminOverride
        });
        if (!validation.ok) {
          return res.status(400).json({ message: validation.message });
        }

        await assertStaffForStage(staffId, stage, { requireAvailable: true });

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
          await syncOrderStatusFromItems(item.order, req.user.id, tx);
          return cp;
        });
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
  query("orderItemId").isMongoId(),
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
  body("staffId").isMongoId(),
  body("orderItemId").isMongoId(),
  body("stage").isIn(ProductionStage),
  body("suggestedStaffId").optional({ nullable: true }).isMongoId(),
  body("followedSuggestion").optional().isBoolean(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    try {
      await assertStaffForStage(req.body.staffId, req.body.stage, { requireAvailable: false });

      const assignment = await prisma.$transaction(async (tx) => {
        const created = await tx.staffAssignment.create({
          data: {
            staffId: req.body.staffId,
            orderItemId: req.body.orderItemId,
            stage: req.body.stage,
            assignedAt: new Date(),
            completedAt: null,
            suggestedStaffId: req.body.suggestedStaffId || null,
            followedSuggestion: Boolean(req.body.followedSuggestion)
          }
        });
        await tx.staff.update({ where: { id: req.body.staffId }, data: { status: "BUSY" } });
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

export default router;
