import { afterAll, beforeAll, beforeEach, describe, expect, it } from "@jest/globals";
import express from "express";
import request from "supertest";
import { connectTestDb, disconnectTestDb, clearDb, createUser, auth } from "./helpers.js";
import authRoutes from "../src/routes/auth.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/auth", authRoutes);
  app.use((err, _req, res, _next) => {
    res.status(err.status || 500).json({ message: err.message || "Internal Server Error" });
  });
  return app;
}

describe("GET /api/auth/me", () => {
  let app;

  beforeAll(async () => {
    await connectTestDb();
    app = buildApp();
  });

  afterAll(async () => {
    await disconnectTestDb();
  });

  beforeEach(async () => {
    await clearDb();
  });

  it("returns 401 without a token", async () => {
    const res = await request(app).get("/api/auth/me");
    expect(res.status).toBe(401);
  });

  it("returns the authenticated user for a valid token", async () => {
    const { user, token } = await createUser({
      email: "me@test.local",
      name: "Me",
      role: "admin"
    });
    const res = await request(app).get("/api/auth/me").set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({
      id: user.id,
      email: user.email,
      name: user.name,
      role: "admin"
    });
  });
});
