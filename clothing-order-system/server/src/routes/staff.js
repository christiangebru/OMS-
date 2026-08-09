import { Router } from "express";
import { body, param, query, validationResult } from "express-validator";
import { Staff } from "../models/Staff.js";
import { StaffSkill } from "../models/StaffSkill.js";
import { StaffAssignment } from "../models/StaffAssignment.js";
import { StageCheckpoint } from "../models/StageCheckpoint.js";
import { requireAuth } from "../middleware/auth.js";
import { DEFAULT_TENANT_ID } from "../config/tenant.js";
import { StaffRole, StaffStatus, ProductionStage } from "../constants/production.js";

const router = Router();
router.use(requireAuth);

async function withSkills(staffLean) {
  const skills = await StaffSkill.find({ staffId: staffLean._id }).lean();
  return { ...staffLean, skills: skills.map((s) => s.stage) };
}

router.get(
  "/",
  query("role").optional().isIn(StaffRole),
  query("status").optional().isIn(StaffStatus),
  query("includeInactive").optional().isIn(["true", "false", "1", "0"]),
  query("stage").optional().isIn(ProductionStage),
  async (req, res) => {
    const filter = { tenantId: DEFAULT_TENANT_ID };
    if (req.query.role) filter.role = req.query.role;
    if (req.query.status) filter.status = req.query.status;
    const includeInactive =
      req.query.includeInactive === "true" || req.query.includeInactive === "1";
    if (!includeInactive) filter.active = true;

    let staff = await Staff.find(filter).sort({ name: 1 }).lean();

    if (req.query.stage) {
      const skilled = await StaffSkill.find({ stage: req.query.stage })
        .select("staffId")
        .lean();
      const allowed = new Set(skilled.map((s) => String(s.staffId)));
      staff = staff.filter((s) => allowed.has(String(s._id)));
    }

    const withSk = await Promise.all(staff.map(withSkills));
    res.json(withSk);
  }
);

router.get("/:id/workload", param("id").isMongoId(), async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const staff = await Staff.findOne({
    _id: req.params.id,
    tenantId: DEFAULT_TENANT_ID
  }).lean();
  if (!staff) return res.status(404).json({ message: "Staff not found" });

  const activeCount = await StaffAssignment.countDocuments({
    staffId: staff._id,
    completedAt: null
  });

  const recentCompletions = await StaffAssignment.find({
    staffId: staff._id,
    completedAt: { $ne: null }
  })
    .sort({ completedAt: -1 })
    .limit(20)
    .lean();

  const checkpoints = await StageCheckpoint.find({
    $or: [{ checkedInByStaffId: staff._id }, { checkedOutByStaffId: staff._id }],
    checkedInAt: { $ne: null },
    checkedOutAt: { $ne: null }
  })
    .sort({ checkedOutAt: -1 })
    .limit(50)
    .lean();

  const durations = checkpoints
    .map((c) => new Date(c.checkedOutAt) - new Date(c.checkedInAt))
    .filter((d) => d > 0);
  const avgStageDurationMs = durations.length
    ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
    : null;

  res.json({
    staffId: staff._id,
    name: staff.name,
    activeAssignmentCount: activeCount,
    recentCompletions,
    averageStageDurationMs: avgStageDurationMs,
    completedCheckpointSample: checkpoints.length
  });
});

router.get("/:id", param("id").isMongoId(), async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const staff = await Staff.findOne({
    _id: req.params.id,
    tenantId: DEFAULT_TENANT_ID
  }).lean();
  if (!staff) return res.status(404).json({ message: "Staff not found" });
  res.json(await withSkills(staff));
});

router.post(
  "/",
  body("name").trim().notEmpty(),
  body("phone").trim().notEmpty(),
  body("role").isIn(StaffRole),
  body("status").optional().isIn(StaffStatus),
  body("skillLevel").optional().isInt({ min: 1, max: 5 }),
  body("skills").optional().isArray(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const skills = (req.body.skills || []).filter((s) => ProductionStage.includes(s));
    const staff = await Staff.create({
      tenantId: DEFAULT_TENANT_ID,
      name: req.body.name.trim(),
      phone: String(req.body.phone).trim(),
      role: req.body.role,
      status: req.body.status || "AVAILABLE",
      skillLevel: req.body.skillLevel || 3,
      active: true
    });

    if (skills.length) {
      await StaffSkill.insertMany(
        skills.map((stage) => ({ staffId: staff._id, stage })),
        { ordered: false }
      ).catch(() => {});
    }

    res.status(201).json(await withSkills(staff.toObject()));
  }
);

router.patch(
  "/:id",
  param("id").isMongoId(),
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

    const staff = await Staff.findOne({
      _id: req.params.id,
      tenantId: DEFAULT_TENANT_ID
    });
    if (!staff) return res.status(404).json({ message: "Staff not found" });

    if (req.body.name) staff.name = req.body.name.trim();
    if (req.body.phone) staff.phone = String(req.body.phone).trim();
    if (req.body.role) staff.role = req.body.role;
    if (req.body.status) staff.status = req.body.status;
    if (req.body.skillLevel !== undefined) staff.skillLevel = req.body.skillLevel;
    if (req.body.active !== undefined) staff.active = Boolean(req.body.active);
    await staff.save();

    if (Array.isArray(req.body.skills)) {
      const skills = req.body.skills.filter((s) => ProductionStage.includes(s));
      await StaffSkill.deleteMany({ staffId: staff._id });
      if (skills.length) {
        await StaffSkill.insertMany(skills.map((stage) => ({ staffId: staff._id, stage })));
      }
    }

    res.json(await withSkills(staff.toObject()));
  }
);

router.post("/:id/deactivate", param("id").isMongoId(), async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const staff = await Staff.findOne({
    _id: req.params.id,
    tenantId: DEFAULT_TENANT_ID
  });
  if (!staff) return res.status(404).json({ message: "Staff not found" });

  staff.active = false;
  staff.status = "OFF_DUTY";
  await staff.save();
  res.json(await withSkills(staff.toObject()));
});

export default router;
