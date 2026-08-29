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
import { prisma } from "../src/db/prisma.js";

async function completeGarment(app, token, item, staffId, stages) {
  for (const stage of stages) {
    const cin = await request(app)
      .post("/api/production/scan")
      .set(auth(token))
      .send({ barcodeValue: item.barcodeValue, stage, staffId });
    expect(cin.status).toBe(200);
    const cout = await request(app)
      .post("/api/production/scan")
      .set(auth(token))
      .send({ barcodeValue: item.barcodeValue, stage, staffId });
    expect(cout.status).toBe(200);
  }
}

describe("order-barcode packing", () => {
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
    const manager = await createUser({
      email: "pack@test.local",
      name: "Manager",
      role: "manager"
    });
    token = manager.token;
  });

  async function sequentialOrder(extra = {}) {
    const seeded = await seedOrderWithItem({ clothingType: "thobe", ...extra });
    const n = `ORD-${9000 + Math.floor(Math.random() * 900)}`;
    await prisma.order.update({
      where: { id: seeded.order._id },
      data: { orderId: n, barcodeValue: n }
    });
    await prisma.orderItem.updateMany({
      where: { order: seeded.order._id },
      data: { orderId: n }
    });
    return { ...seeded, orderCode: n };
  }

  it("rejects packing an incomplete order via ORD-n", async () => {
    const { orderCode, staff } = await sequentialOrder({ extraItems: [{ clothingCode: "SIB" }] });
    const res = await request(app)
      .post("/api/production/scan")
      .set(auth(token))
      .send({ barcodeValue: orderCode, stage: "PACKAGING", staffId: String(staff._id) });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/cannot pack|not complete/i);
  });

  it("rejects packing via a leftover garment barcode", async () => {
    const { item, staff } = await sequentialOrder();
    await completeGarment(app, token, item, String(staff._id), [
      "SEWING_CUTTING",
      "FINAL_SEWING",
      "FINISHING",
      "SHOWROOM"
    ]);
    const res = await request(app)
      .post("/api/production/scan")
      .set(auth(token))
      .send({ barcodeValue: item.barcodeValue, stage: "PACKAGING", staffId: String(staff._id) });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/order barcode/i);
  });

  it("packs only when every top-level garment is complete, then ready for pickup", async () => {
    const { order, item, siblings, staff, orderCode } = await sequentialOrder({
      extraItems: [{ clothingCode: "SIB" }]
    });
    const staffId = String(staff._id);
    const stages = ["SEWING_CUTTING", "FINAL_SEWING", "FINISHING", "SHOWROOM"];
    await completeGarment(app, token, item, staffId, stages);

    const mid = await request(app)
      .post("/api/production/scan")
      .set(auth(token))
      .send({ barcodeValue: orderCode, stage: "PACKAGING", staffId });
    expect(mid.status).toBe(400);

    await completeGarment(app, token, siblings[0], staffId, stages);

    const lookup = await request(app)
      .get(`/api/production/lookup?barcodeValue=${encodeURIComponent(orderCode)}`)
      .set(auth(token));
    expect(lookup.status).toBe(200);
    expect(lookup.body.scanKind).toBe("order");
    expect(lookup.body.scanDetails.production.actionStage).toBe("PACKAGING");

    const packed = await request(app)
      .post("/api/production/scan")
      .set(auth(token))
      .send({ barcodeValue: orderCode, stage: "PACKAGING", staffId });
    expect(packed.status).toBe(200);
    expect(packed.body.action).toBe("pack");
    expect(packed.body.scanDetails.order.productionStatus).toBe("ready_for_pickup");

    const row = await prisma.order.findUnique({ where: { id: order._id } });
    expect(row.packedAt).toBeInstanceOf(Date);
    expect(row.productionStatus).toBe("ready_for_pickup");

    const delivered = await request(app)
      .post("/api/production/scan")
      .set(auth(token))
      .send({ barcodeValue: orderCode, stage: "DELIVERED", staffId });
    expect(delivered.status).toBe(200);
    expect(delivered.body.action).toBe("deliver");
    const done = await prisma.order.findUnique({ where: { id: order._id } });
    expect(done.productionStatus).toBe("delivered");
  });
});
