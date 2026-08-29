import "express-async-errors";
import express from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../src/db/prisma.js";
import { signToken } from "../src/utils/jwt.js";
import { newId } from "../src/utils/ids.js";
import productionRoutes from "../src/routes/production.js";
import orderItemRoutes from "../src/routes/orderItems.js";
import staffRoutes from "../src/routes/staff.js";
import dashboardRoutes from "../src/routes/dashboard.js";
import orderGroupRoutes from "../src/routes/orderGroups.js";
import orderRoutes from "../src/routes/orders.js";
import uploadRoutes from "../src/routes/upload.js";

export { prisma };

export async function connectTestDb() {
  await prisma.$connect();
  return process.env.DATABASE_URL;
}

export async function disconnectTestDb() {
  await prisma.$disconnect();
}

export async function clearDb() {
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE
      "staff_assignments","stage_checkpoints","order_item_images","order_items","orders",
      "order_groups","measurements","production_logs","staff_skills","staff","customers","users",
      "clothing_type_configs","statistic_snapshots"
     RESTART IDENTITY CASCADE`
  );
}

/** Mount production-related routes only (sufficient for these tests). */
export function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/production", productionRoutes);
  app.use("/api/order-items", orderItemRoutes);
  app.use("/api/staff", staffRoutes);
  app.use("/api/dashboard", dashboardRoutes);
  app.use("/api/order-groups", orderGroupRoutes);
  app.use("/api/orders", orderRoutes);
  app.use("/api/upload", uploadRoutes);
  app.use((err, _req, res, _next) => {
    console.error("[test-error]", err);
    res.status(err.status || 500).json({ message: err.message || "Internal Server Error" });
  });
  return app;
}

export async function createUser({ email, name, role = "manager" }) {
  const passwordHash = await bcrypt.hash("password123", 10);
  const user = await prisma.user.create({
    data: { id: newId(), email, name, role, passwordHash }
  });
  const token = signToken({ sub: user.id, role: user.role });
  return { user, token };
}

/** Create a user with an arbitrary (non-standard) role. */
export async function createUserWithRawRole(role) {
  const passwordHash = await bcrypt.hash("password123", 10);
  const user = await prisma.user.create({
    data: { id: newId(), email: `raw-${role}@test.local`, name: `Raw ${role}`, role, passwordHash }
  });
  const token = signToken({ sub: user.id, role });
  return { id: user.id, token, role };
}

export function auth(token) {
  return { Authorization: `Bearer ${token}` };
}
