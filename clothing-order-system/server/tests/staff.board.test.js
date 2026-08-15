import { describe, it, expect, beforeAll, afterAll, beforeEach } from "@jest/globals";
import request from "supertest";
import {
  connectTestDb,
  disconnectTestDb,
  clearDb,
  createTestApp,
  createUser,
  auth
} from "./helpers.js";
import { seedClothingTypes, seedOrderWithItem } from "./fixtures.js";

describe("GET /api/staff workforce board", () => {
  let app;
  let token;

  beforeAll(async () => {
    await connectTestDb();
    app = createTestApp();
  });

  afterAll(async () => {
    await disconnectTestDb();
  });

  beforeEach(async () => {
    await clearDb();
    await seedClothingTypes();
    const u = await createUser({
      email: "mgr@staff-board.test",
      name: "Manager",
      role: "manager"
    });
    token = u.token;
  });

  it("includes workload, strongest stage, and idle presence", async () => {
    const { staff } = await seedOrderWithItem({ clothingType: "thobe" });
    const res = await request(app).get("/api/staff").set(auth(token));
    expect(res.status).toBe(200);
    const row = res.body.find((s) => s._id === staff.id || s.name === staff.name);
    expect(row).toBeTruthy();
    expect(row.activeAssignmentCount).toBe(0);
    expect(row.completedAssignmentCount).toBe(0);
    expect(row.presence).toBe("idle");
    expect(row.strongestStage).toBeTruthy();
    expect(row.skillDetails?.length).toBeGreaterThan(0);
  });

  it("marks presence assigned after a manager assigns a garment", async () => {
    const { item, staff } = await seedOrderWithItem({ clothingType: "thobe" });
    const assigned = await request(app)
      .post("/api/production/assignments")
      .set(auth(token))
      .send({ staffId: staff.id, orderItemId: item.id, stage: "RECEIVED" });
    expect(assigned.status).toBe(201);

    const res = await request(app).get("/api/staff").set(auth(token));
    const row = res.body.find((s) => s._id === staff.id);
    expect(row.activeAssignmentCount).toBe(1);
    expect(row.presence).toBe("assigned");
    expect(row.currentGarment?.barcodeValue).toBe(item.barcodeValue);
  });
});
