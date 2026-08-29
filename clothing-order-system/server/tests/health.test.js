import { describe, expect, it } from "@jest/globals";
import express from "express";
import request from "supertest";
import { healthLivenessHandler, readinessHandler } from "../src/routes/health.js";
import { requireAuth } from "../src/middleware/auth.js";

function appWith(method, path, handler) {
  const app = express();
  app[method](path, handler);
  return app;
}

describe("GET /health (liveness)", () => {
  it("returns 200 with dbConnected false when checkDb fails", async () => {
    const app = appWith(
      "get",
      "/health",
      healthLivenessHandler(async () => {
        throw new Error("db down");
      })
    );
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, db: "postgresql", dbConnected: false });
  });

  it("returns 200 with dbConnected true when checkDb succeeds", async () => {
    const app = appWith("get", "/health", healthLivenessHandler(async () => true));
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, db: "postgresql", dbConnected: true });
  });

  it("is public: no Authorization header, even when /api routes require auth", async () => {
    const app = express();
    app.get("/health", healthLivenessHandler(async () => true));
    app.get("/ready", readinessHandler(async () => true));
    app.get("/api/auth/me", requireAuth, (_req, res) => res.json({ user: { id: "x" } }));

    const health = await request(app).get("/health");
    expect(health.status).toBe(200);
    expect(health.body.ok).toBe(true);
    expect(health.headers["www-authenticate"]).toBeUndefined();

    const ready = await request(app).get("/ready");
    expect(ready.status).toBe(200);

    const me = await request(app).get("/api/auth/me");
    expect(me.status).toBe(401);
  });
});

describe("GET /ready", () => {
  it("returns 503 when checkDb fails", async () => {
    const app = appWith(
      "get",
      "/ready",
      readinessHandler(async () => {
        throw new Error("db down");
      })
    );
    const res = await request(app).get("/ready");
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ ok: false, db: "postgresql", dbConnected: false });
  });

  it("returns 200 when checkDb succeeds", async () => {
    const app = appWith("get", "/ready", readinessHandler(async () => true));
    const res = await request(app).get("/ready");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, db: "postgresql", dbConnected: true });
  });
});
