import { Router } from "express";
import bcrypt from "bcryptjs";
import { body, param, validationResult } from "express-validator";
import { prisma } from "../db/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { requireCapability } from "../middleware/permissions.js";
import { isRecordId } from "../utils/recordId.js";

/**
 * Owner-managed logins. Only owners/admins, managers and reception log in;
 * workers are Staff records, not logins (worker roles stay reserved in code).
 */
const router = Router();
router.use(requireAuth, requireCapability("users.manage"));

export const LOGIN_ROLES = ["admin", "manager", "reception"];
const SALT_ROUNDS = 12;

function publicUser(u) {
  return {
    _id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    active: u.active !== false,
    createdAt: u.createdAt
  };
}

async function activeAdminCount(client = prisma) {
  return client.user.count({ where: { role: "admin", active: true } });
}

router.get("/", async (_req, res) => {
  const users = await prisma.user.findMany({ orderBy: [{ active: "desc" }, { name: "asc" }] });
  res.json(users.map(publicUser));
});

router.post(
  "/",
  body("email").isEmail(),
  body("name").trim().notEmpty(),
  body("role").isIn(LOGIN_ROLES),
  body("password").isLength({ min: 8 }),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const email = String(req.body.email).toLowerCase().trim();
    const exists = await prisma.user.findUnique({ where: { email } });
    if (exists) return res.status(409).json({ message: "A login with this email already exists" });
    const user = await prisma.user.create({
      data: {
        email,
        name: req.body.name.trim(),
        role: req.body.role,
        passwordHash: await bcrypt.hash(req.body.password, SALT_ROUNDS)
      }
    });
    res.status(201).json(publicUser(user));
  }
);

router.patch(
  "/:id",
  param("id").custom(isRecordId),
  body("name").optional().trim().notEmpty(),
  body("role").optional().isIn(LOGIN_ROLES),
  body("password").optional().isLength({ min: 8 }),
  body("active").optional().isBoolean(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user) return res.status(404).json({ message: "Login not found" });

    const data = {};
    if (req.body.name !== undefined) data.name = req.body.name.trim();
    if (req.body.role !== undefined) data.role = req.body.role;
    if (req.body.active !== undefined) data.active = req.body.active === true || req.body.active === "true";
    if (req.body.password) data.passwordHash = await bcrypt.hash(req.body.password, SALT_ROUNDS);

    const self = user.id === req.user.id;
    const losesAdmin =
      user.role === "admin" &&
      user.active !== false &&
      ((data.role && data.role !== "admin") || data.active === false);
    if (self && losesAdmin) {
      return res.status(400).json({ message: "You cannot remove your own owner access." });
    }
    if (losesAdmin && (await activeAdminCount()) <= 1) {
      return res.status(400).json({ message: "At least one active owner/admin login must remain." });
    }

    const updated = await prisma.user.update({ where: { id: user.id }, data });
    res.json(publicUser(updated));
  }
);

export default router;
