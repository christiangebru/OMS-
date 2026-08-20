import { describe, expect, it } from "@jest/globals";
import express from "express";
import request from "supertest";
import { healthLivenessHandler, readinessHandler } from "../src/routes/health.js";

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
