import { Router } from "express";
import { body, param, query, validationResult } from "express-validator";
import { prisma } from "../db/prisma.js";
import { s, sMany } from "../utils/serialize.js";
import { requireAuth } from "../middleware/auth.js";
import { requireCapability } from "../middleware/permissions.js";
import { DEFAULT_TENANT_ID } from "../config/tenant.js";
import { StaffRole, StaffStatus, ProductionStage } from "../constants/production.js";
import { attachStaffBoard } from "../utils/staffBoard.js";
import { decorateQueueRow, splitWorkerQueue } from "../utils/workerQueue.js";
import { isRecordId } from "../utils/recordId.js";

const router = Router();
router.use(requireAuth);

async function withSkills(staff) {
  const skills = await prisma.staffSkill.findMany({ where: { staffId: staff.id } });
  return {
    ...s(staff),
    skills: skills.map((sk) => sk.stage),
    skillDetails: skills.map((sk) => ({ stage: sk.stage, level: sk.level || 3 }))
  };
}

function normalizeSkillInputs(raw, fallbackLevel = 3) {
  const out = [];
  for (const sk of raw || []) {
    if (typeof sk === "string" && ProductionStage.includes(sk)) {
      out.push({ stage: sk, level: fallbackLevel });
    } else if (sk && typeof sk === "object" && ProductionStage.includes(sk.stage)) {
      const level = Math.min(5, Math.max(1, Number(sk.level) || fallbackLevel));
      out.push({ stage: sk.stage, level });
    }
  }
  return out;
}

router.get(
  "/",
  query("role").optional().isIn(StaffRole),
  query("status").optional().isIn(StaffStatus),
  query("includeInactive").optional().isIn(["true", "false", "1", "0"]),
  query("stage").optional().isIn(ProductionStage),
  async (req, res) => {
    const where = { tenantId: DEFAULT_TENANT_ID };
    if (req.query.role) where.role = req.query.role;
    if (req.query.status) where.status = req.query.status;
    const includeInactive =
      req.query.includeInactive === "true" || req.query.includeInactive === "1";
    if (!includeInactive) where.active = true;

    let staff = await prisma.staff.findMany({ where, orderBy: { name: "asc" } });

    if (req.query.stage) {
      const skilled = await prisma.staffSkill.findMany({
        where: { stage: req.query.stage },
        select: { staffId: true }
      });
      const allowed = new Set(skilled.map((sk) => sk.staffId));
      staff = staff.filter((st) => allowed.has(st.id));
    }

    const withSk = await Promise.all(staff.map(withSkills));
    res.json(await attachStaffBoard(prisma, withSk));
  }
);

router.get("/:id/workload", param("id").custom(isRecordId), async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const staff = await prisma.staff.findFirst({
    where: { id: req.params.id, tenantId: DEFAULT_TENANT_ID }
  });
  if (!staff) return res.status(404).json({ message: "Staff not found" });

  const active = await prisma.staffAssignment.findMany({
    where: { staffId: staff.id, completedAt: null },
    include: { orderItem: true }
  });
  const activeCount = active.length;

  const completedCount = await prisma.staffAssignment.count({
    where: { staffId: staff.id, completedAt: { not: null } }
  });

  const recentCompletions = await prisma.staffAssignment.findMany({
    where: { staffId: staff.id, completedAt: { not: null } },
    include: { orderItem: true },
    orderBy: { completedAt: "desc" },
    take: 20
  });

  const orderIds = [...new Set(active.map((a) => a.orderItem.order).filter(Boolean))];
  const orders = orderIds.length
    ? await prisma.order.findMany({
        where: { id: { in: orderIds } },
        include: { customer: true }
      })
    : [];
  const orderById = new Map(orders.map((o) => [o.id, o]));
  const now = new Date();
  const overdueItems = active.filter((a) => {
    const o = orderById.get(a.orderItem.order);
    if (!o) return false;
    return (
      o.requiredCompletionDate < now && !["completed", "ready_to_pack", "delivered"].includes(o.productionStatus)
    );
  });

  const checkpoints = await prisma.stageCheckpoint.findMany({
    where: {
      OR: [{ checkedInByStaffId: staff.id }, { checkedOutByStaffId: staff.id }],
      checkedOutAt: { not: null }
    },
    orderBy: { checkedOutAt: "desc" },
    take: 50
  });

  const durations = checkpoints
    .map((c) => new Date(c.checkedOutAt) - new Date(c.checkedInAt))
    .filter((d) => d > 0);
  const avgStageDurationMs = durations.length
    ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
    : null;

  const openNow = await prisma.stageCheckpoint.findMany({
    where: { checkedInByStaffId: staff.id, checkedOutAt: null },
    include: { orderItem: true }
  });

  const assignedItems = active.map((a) => {
    const o = orderById.get(a.orderItem.order);
    return decorateQueueRow(a, o, {
      item: {
        _id: a.orderItem.id,
        clothingType: a.orderItem.clothingType,
        barcodeValue: a.orderItem.barcodeValue,
        orderId: a.orderItem.orderId
      },
      due: o?.requiredCompletionDate || null,
      customerName: o?.customer?.name || null,
      orderItemId: a.orderItem.id
    });
  });

  const completedRows = recentCompletions.slice(0, 12).map((a) => ({
    assignmentId: a.id,
    stage: a.stage,
    completedAt: a.completedAt,
    item: a.orderItem
      ? {
          _id: a.orderItem.id,
          clothingType: a.orderItem.clothingType,
          barcodeValue: a.orderItem.barcodeValue,
          orderId: a.orderItem.orderId
        }
      : null
  }));

  const queue = splitWorkerQueue({
    assignments: assignedItems,
    openCheckpoints: openNow
  });

  res.json({
    staffId: staff.id,
    name: staff.name,
    activeAssignmentCount: activeCount,
    completedAssignmentCount: completedCount,
    overdueAssignmentCount: overdueItems.length,
    recentCompletions: sMany(recentCompletions),
    averageStageDurationMs: avgStageDurationMs,
    completedCheckpointSample: checkpoints.length,
    assignedItems,
    queue: {
      nowWorking: queue.nowWorking,
      upNext: queue.upNext,
      queued: queue.queued,
      completed: completedRows
    }
  });
});

router.get("/:id", param("id").custom(isRecordId), async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const staff = await prisma.staff.findFirst({
    where: { id: req.params.id, tenantId: DEFAULT_TENANT_ID }
  });
  if (!staff) return res.status(404).json({ message: "Staff not found" });
  res.json(await withSkills(staff));
});

router.post(
  "/",
  requireCapability("staff.write"),
  body("name").trim().notEmpty(),
  body("phone").trim().notEmpty(),
  body("role").isIn(StaffRole),
  body("status").optional().isIn(StaffStatus),
  body("skillLevel").optional().isInt({ min: 1, max: 5 }),
  body("skills").optional().isArray(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const skills = normalizeSkillInputs(req.body.skills, req.body.skillLevel || 3);
    const staff = await prisma.staff.create({
      data: {
        tenantId: DEFAULT_TENANT_ID,
        name: req.body.name.trim(),
        phone: String(req.body.phone).trim(),
        role: req.body.role,
        status: req.body.status || "AVAILABLE",
        skillLevel: req.body.skillLevel || 3,
        active: true
      }
    });

    if (skills.length) {
      await prisma.staffSkill.createMany({
        data: skills.map((sk) => ({ staffId: staff.id, stage: sk.stage, level: sk.level })),
        skipDuplicates: true
      });
    }

    res.status(201).json(await withSkills(staff));
  }
);

router.patch(
  "/:id",
  requireCapability("staff.write"),
  param("id").custom(isRecordId),
  body("name").optional().trim().notEmpty(),
  body("phone").optional().trim().notEmpty(),
  body("role").optional().isIn(StaffRole),
  body("status").optional().isIn(StaffStatus),
  body("skillLevel").optional().isInt({ min: 1, max: 5 }),
  body("skills").optional().isArray(),
  body("active").optional().isBoolean(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const staff = await prisma.staff.findFirst({
      where: { id: req.params.id, tenantId: DEFAULT_TENANT_ID }
    });
    if (!staff) return res.status(404).json({ message: "Staff not found" });

    const data = {};
    if (req.body.name) data.name = req.body.name.trim();
    if (req.body.phone) data.phone = String(req.body.phone).trim();
    if (req.body.role) data.role = req.body.role;
    if (req.body.status) data.status = req.body.status;
    if (req.body.skillLevel !== undefined) data.skillLevel = req.body.skillLevel;
    if (req.body.active !== undefined) data.active = Boolean(req.body.active);

    const updated = await prisma.staff.update({ where: { id: staff.id }, data });

    if (Array.isArray(req.body.skills)) {
      const skills = normalizeSkillInputs(req.body.skills, updated.skillLevel || 3);
      await prisma.staffSkill.deleteMany({ where: { staffId: staff.id } });
      if (skills.length) {
        await prisma.staffSkill.createMany({
          data: skills.map((sk) => ({ staffId: staff.id, stage: sk.stage, level: sk.level })),
          skipDuplicates: true
        });
      }
    }

    res.json(await withSkills(updated));
  }
);

router.post("/:id/deactivate", requireCapability("staff.write"), param("id").custom(isRecordId), async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const staff = await prisma.staff.findFirst({
    where: { id: req.params.id, tenantId: DEFAULT_TENANT_ID }
  });
  if (!staff) return res.status(404).json({ message: "Staff not found" });

  const updated = await prisma.staff.update({
    where: { id: staff.id },
    data: { active: false, status: "OFF_DUTY" }
  });
  res.json(await withSkills(updated));
});

export default router;
