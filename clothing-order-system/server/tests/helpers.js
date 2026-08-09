import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import express from "express";
import bcrypt from "bcryptjs";
import { User } from "../src/models/User.js";
import { signToken } from "../src/utils/jwt.js";
import productionRoutes from "../src/routes/production.js";
import orderItemRoutes from "../src/routes/orderItems.js";
import staffRoutes from "../src/routes/staff.js";

let mongod;

export async function connectTestDb() {
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  await mongoose.connect(uri);
  return uri;
}

export async function disconnectTestDb() {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
}

export async function clearDb() {
  const collections = mongoose.connection.collections;
  for (const key of Object.keys(collections)) {
    await collections[key].deleteMany({});
  }
}

/** Mount production-related routes only (sufficient for these tests). */
export function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/production", productionRoutes);
  app.use("/api/order-items", orderItemRoutes);
  app.use("/api/staff", staffRoutes);
  app.use((err, _req, res, _next) => {
    console.error("[test-error]", err);
    res.status(err.status || 500).json({ message: err.message || "Internal Server Error" });
  });
  return app;
}

export async function createUser({ email, name, role = "manager" }) {
  const passwordHash = await bcrypt.hash("password123", 10);
  const user = await User.create({
    email,
    name,
    role,
    passwordHash
  });
  const token = signToken({ sub: String(user._id), role: user.role });
  return { user, token };
}

/** Insert a user with a role outside the schema enum (bypasses Mongoose validation). */
export async function createUserWithRawRole(role) {
  const passwordHash = await bcrypt.hash("password123", 10);
  const result = await mongoose.connection.collection("users").insertOne({
    email: `raw-${role}@test.local`,
    name: `Raw ${role}`,
    role,
    passwordHash,
    createdAt: new Date(),
    updatedAt: new Date()
  });
  const token = signToken({ sub: String(result.insertedId), role });
  return { id: result.insertedId, token, role };
}

export function auth(token) {
  return { Authorization: `Bearer ${token}` };
}
