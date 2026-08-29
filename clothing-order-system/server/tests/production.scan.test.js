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
import { prisma } from "../src/db/prisma.js";

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
        stage: "SEWING_CUTTING",
        staffId: String(staff._id)
      });

    expect(res.status).toBe(200);
    expect(res.body.action).toBe("check_in");
    expect(res.body.checkpoint).toBeTruthy();
    expect(res.body.checkpoint.checkedInAt).toBeTruthy();
    expect(res.body.checkpoint.checkedOutAt).toBeFalsy();

    const cp = await prisma.stageCheckpoint.findUnique({ where: { id: res.body.checkpoint._id } });
    expect(cp).toBeTruthy();
    expect(cp.stage).toBe("SEWING_CUTTING");
    expect(cp.checkedInAt).toBeInstanceOf(Date);
    expect(cp.checkedOutAt).toBeNull();
    expect(String(cp.checkedInByStaffId)).toBe(String(staff._id));

    const asg = await prisma.staffAssignment.findFirst({
      where: { orderItemId: item.id, stage: "SEWING_CUTTING", completedAt: null }
    });
    expect(asg.receivedAt).toBeTruthy();
    expect(asg.distributedAt).toBeTruthy();
  });

  it("successful check-out on open checkpoint sets checkedOutAt", async () => {
    const { item, staff } = await seedOrderWithItem({ clothingType: "thobe" });

    await request(app)
      .post("/api/production/scan")
      .set(auth(managerToken))
      .send({
        barcodeValue: item.barcodeValue,
        stage: "SEWING_CUTTING",
        staffId: String(staff._id)
      });

    const res = await request(app)
      .post("/api/production/scan")
      .set(auth(managerToken))
      .send({
        barcodeValue: item.barcodeValue,
        stage: "SEWING_CUTTING",
        staffId: String(staff._id)
      });

    expect(res.status).toBe(200);
    expect(res.body.action).toBe("check_out");
    expect(res.body.checkpoint.checkedOutAt).toBeTruthy();

    const cp = await prisma.stageCheckpoint.findUnique({ where: { id: res.body.checkpoint._id } });
    expect(cp.checkedOutAt).toBeInstanceOf(Date);
    expect(String(cp.checkedOutByStaffId)).toBe(String(staff._id));
  });

  it("rejects sequence violation (FINISHING before SEWING complete) with clear error", async () => {
    const { item, staff } = await seedOrderWithItem({ clothingType: "thobe" });
    await advanceThroughStages(item, staff, ["SEWING_CUTTING"], managerToken);

    const res = await request(app)
      .post("/api/production/scan")
      .set(auth(managerToken))
      .send({
        barcodeValue: item.barcodeValue,
        stage: "FINISHING",
        staffId: String(staff._id)
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/prior stage|FINAL_SEWING|not complete/i);
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

  it("keeps sibling garments on the floor; order is ready_to_pack only when all complete", async () => {
    const { order, item, siblings, staff } = await seedOrderWithItem({
      clothingType: "thobe",
      extraItems: [{ clothingCode: "SIB" }]
    });
    const sibling = siblings[0];

    await advanceThroughStages(item, staff, ["SEWING_CUTTING", "FINAL_SEWING", "FINISHING"], managerToken);
    await request(app)
      .post("/api/production/scan")
      .set(auth(managerToken))
      .send({
        barcodeValue: item.barcodeValue,
        stage: "SHOWROOM",
        staffId: String(staff._id)
      });
    await request(app)
      .post("/api/production/scan")
      .set(auth(managerToken))
      .send({
        barcodeValue: item.barcodeValue,
        stage: "SHOWROOM",
        staffId: String(staff._id)
      });

    const mid = await prisma.order.findUnique({ where: { id: order._id } });
    expect(mid.productionStatus).not.toBe("ready_to_pack");
    expect(mid.productionStatus).not.toBe("delivered");
    expect(["pending", "cutting", "stitching", "finishing"]).toContain(mid.productionStatus);

    const queue = await request(app).get("/api/production/queue").set(auth(managerToken));
    const sibRow = queue.body.items.find((r) => r.itemId === sibling.id);
    expect(sibRow).toBeTruthy();
    expect(sibRow.nextStage).toBe("SEWING_CUTTING");

    await advanceThroughStages(sibling, staff, ["SEWING_CUTTING", "FINAL_SEWING", "FINISHING", "SHOWROOM"], managerToken);

    const updated = await prisma.order.findUnique({ where: { id: order._id } });
    expect(updated.productionStatus).toBe("ready_to_pack");
  });

  it("skip-embroidery clothing types reject EMBROIDERY check-in", async () => {
    const { item, staff } = await seedOrderWithItem({ clothingType: "thobe" });
    await advanceThroughStages(item, staff, ["SEWING_CUTTING"], managerToken);

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
