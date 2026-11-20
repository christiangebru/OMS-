import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import request from "supertest";
import { connectTestDb, disconnectTestDb, createTestApp } from "./helpers.js";

describe("GET /api/version and /version", () => {
  let app;
  const originalEnv = { ...process.env };

  beforeAll(async () => {
    await connectTestDb();
    app = createTestApp();
  });

  afterAll(async () => {
    await disconnectTestDb();
    process.env = originalEnv;
  });

  it("returns commit and branch without authentication or secret leaks", async () => {
    process.env.RENDER_GIT_COMMIT = "abcdef1234567890abcdef1234567890abcdef12";
    process.env.RENDER_GIT_BRANCH = "main";

    const res = await request(app).get("/api/version");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      commit: "abcdef1234567890abcdef1234567890abcdef12",
      branch: "main"
    });
    // Ensure no sensitive env keys are exposed
    expect(res.body.DATABASE_URL).toBeUndefined();
    expect(res.body.JWT_SECRET).toBeUndefined();

    const rootRes = await request(app).get("/version");
    expect(rootRes.status).toBe(200);
    expect(rootRes.body.commit).toBe("abcdef1234567890abcdef1234567890abcdef12");
  });
});
