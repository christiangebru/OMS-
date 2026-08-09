import { describe, it, expect, beforeAll, afterAll, beforeEach } from "@jest/globals";
import request from "supertest";
import {
  connectTestDb,
  disconnectTestDb,
  clearDb,
  createTestApp,
  createUser,
  createUserWithRawRole,
  auth
} from "./helpers.js";
import { seedClothingTypes, seedOrderWithItem } from "./fixtures.js";
import { StageCheckpoint } from "../src/models/StageCheckpoint.js";
import { Order } from "../src/models/Order.js";

describe("POST /api/production/scan", () => {
  let app;
  let managerToken;
  let adminToken;

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
    const manager = await createUser({
      email: "manager@test.local",
      name: "Manager",
      role: "manager"
    });
    const admin = await createUser({
      email: "admin@test.local",
      name: "Admin",
      role: "admin"
    });
    managerToken = manager.token;
    adminToken = admin.token;
  });

  async function advanceThroughStages(item, staff, stages, token) {
    for (const stage of stages) {
      const cin = await request(app)
        .post("/api/production/scan")
        .set(auth(token))
        .send({ barcodeValue: item.barcodeValue, stage, staffId: staff._id });
      expect(cin.status).toBe(200);
      expect(cin.body.action).toBe("check_in");

      const cout = await request(app)
        .post("/api/production/scan")
        .set(auth(token))
        .send({ barcodeValue: item.barcodeValue, stage, staffId: staff._id });
      expect(cout.status).toBe(200);
      expect(cout.body.action).toBe("check_out");
    }
  }

  it("successful check-in creates StageCheckpoint with checkedInAt", async () => {
    const { item, staff } = await seedOrderWithItem({ clothingType: "thobe" });

    const res = await request(app)
      .post("/api/production/scan")
      .set(auth(managerToken))
      .send({
        barcodeValue: item.barcodeValue,
        stage: "RECEIVED",
        staffId: String(staff._id)
      });

    expect(res.status).toBe(200);
    expect(res.body.action).toBe("check_in");
    expect(res.body.checkpoint).toBeTruthy();
    expect(res.body.checkpoint.checkedInAt).toBeTruthy();
    expect(res.body.checkpoint.checkedOutAt).toBeFalsy();

    const cp = await StageCheckpoint.findById(res.body.checkpoint._id);
    expect(cp).toBeTruthy();
    expect(cp.stage).toBe("RECEIVED");
    expect(cp.checkedInAt).toBeInstanceOf(Date);
    expect(cp.checkedOutAt).toBeNull();
    expect(String(cp.checkedInByStaffId)).toBe(String(staff._id));
  });

  it("successful check-out on open checkpoint sets checkedOutAt", async () => {
    const { item, staff } = await seedOrderWithItem({ clothingType: "thobe" });

    await request(app)
      .post("/api/production/scan")
      .set(auth(managerToken))
      .send({
        barcodeValue: item.barcodeValue,
        stage: "RECEIVED",
        staffId: String(staff._id)
      });

    const res = await request(app)
      .post("/api/production/scan")
      .set(auth(managerToken))
      .send({
        barcodeValue: item.barcodeValue,
        stage: "RECEIVED",
        staffId: String(staff._id)
      });

    expect(res.status).toBe(200);
    expect(res.body.action).toBe("check_out");
    expect(res.body.checkpoint.checkedOutAt).toBeTruthy();

    const cp = await StageCheckpoint.findById(res.body.checkpoint._id);
    expect(cp.checkedOutAt).toBeInstanceOf(Date);
    expect(String(cp.checkedOutByStaffId)).toBe(String(staff._id));
  });

  it("rejects sequence violation (FINISHING before SEWING complete) with clear error", async () => {
    const { item, staff } = await seedOrderWithItem({ clothingType: "thobe" });
    await advanceThroughStages(item, staff, ["RECEIVED", "CUTTING"], managerToken);

    const res = await request(app)
      .post("/api/production/scan")
      .set(auth(managerToken))
      .send({
        barcodeValue: item.barcodeValue,
        stage: "FINISHING",
        staffId: String(staff._id)
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/prior stage|SEWING|not complete/i);
  });

  it("adminOverride bypasses sequence for admin", async () => {
    const { item, staff } = await seedOrderWithItem({ clothingType: "thobe" });

    const res = await request(app)
      .post("/api/production/scan")
      .set(auth(adminToken))
      .send({
        barcodeValue: item.barcodeValue,
        stage: "FINISHING",
        staffId: String(staff._id),
        adminOverride: true
      });

    expect(res.status).toBe(200);
    expect(res.body.action).toBe("check_in");
    expect(res.body.checkpoint.stage).toBe("FINISHING");
  });

  it("adminOverride also allowed for manager (actual behavior)", async () => {
    const { item, staff } = await seedOrderWithItem({ clothingType: "thobe" });

    const res = await request(app)
      .post("/api/production/scan")
      .set(auth(managerToken))
      .send({
        barcodeValue: item.barcodeValue,
        stage: "FINISHING",
        staffId: String(staff._id),
        adminOverride: true
      });

    expect(res.status).toBe(200);
    expect(res.body.action).toBe("check_in");
  });

  it("adminOverride rejected for non-admin/non-manager roles", async () => {
    const { item, staff } = await seedOrderWithItem({ clothingType: "thobe" });
    const viewer = await createUserWithRawRole("viewer");

    const res = await request(app)
      .post("/api/production/scan")
      .set(auth(viewer.token))
      .send({
        barcodeValue: item.barcodeValue,
        stage: "FINISHING",
        staffId: String(staff._id),
        adminOverride: true
      });

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/admin\/manager|override/i);
  });

  it("updates Order.productionStatus to furthest stage across items", async () => {
    const { order, item, siblings, staff } = await seedOrderWithItem({
      clothingType: "thobe",
      extraItems: [{ clothingCode: "SIB" }]
    });
    const sibling = siblings[0];

    // Give staff skills already seeded for all stages on primary staff —
    // need skill on all; seedOrderWithItem already does allStages for primary staff.

    await advanceThroughStages(item, staff, ["RECEIVED", "CUTTING"], managerToken);

    // sibling only RECEIVED
    await advanceThroughStages(sibling, staff, ["RECEIVED"], managerToken);

    // Advance primary into SEWING (check-in only) — furthest should be SEWING → stitching
    const res = await request(app)
      .post("/api/production/scan")
      .set(auth(managerToken))
      .send({
        barcodeValue: item.barcodeValue,
        stage: "SEWING",
        staffId: String(staff._id)
      });
    expect(res.status).toBe(200);

    const updated = await Order.findById(order._id);
    expect(updated.productionStatus).toBe("stitching");
  });

  it("skip-embroidery clothing types reject EMBROIDERY check-in", async () => {
    const { item, staff } = await seedOrderWithItem({ clothingType: "thobe" });
    await advanceThroughStages(item, staff, ["RECEIVED", "CUTTING", "SEWING"], managerToken);

    const res = await request(app)
      .post("/api/production/scan")
      .set(auth(managerToken))
      .send({
        barcodeValue: item.barcodeValue,
        stage: "EMBROIDERY",
        staffId: String(staff._id)
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/EMBROIDERY|not in this clothing type/i);
  });
});
