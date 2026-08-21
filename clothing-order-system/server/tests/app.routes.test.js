import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import request from "supertest";
import { connectTestDb, disconnectTestDb, createTestApp } from "./helpers.js";

/**
 * Guard against dashboard/production routers being dropped from the test app mount
 * (mirrors the production mount prefixes in src/index.js).
 */
describe("app route registration", () => {
  let app;

  beforeAll(async () => {
    await connectTestDb();
    app = createTestApp();
  });

  afterAll(async () => {
    await disconnectTestDb();
  });

  it.each([
    ["/api/dashboard/operations"],
    ["/api/dashboard/business"],
    ["/api/production/floor"],
    ["/api/production/queue"],
    ["/api/production/queue?lite=1"],
    ["/api/order-groups"],
    ["/api/production/workstations"]
  ])("registers %s (auth required, not Express 404)", async (path) => {
    const res = await request(app).get(path);
    expect(res.status).not.toBe(404);
    expect(res.status).toBe(401);
    expect(res.headers["content-type"]).toMatch(/json/);
  });
});
