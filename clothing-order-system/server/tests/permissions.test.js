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

describe("role capabilities", () => {
  let app;
  let managerToken;
  let tailorToken;

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
      email: "mgr@perm.test",
      name: "Manager",
      role: "manager"
    });
    const tailor = await createUserWithRawRole("tailor");
    managerToken = manager.token;
    tailorToken = tailor.token;
  });

  it("lets a tailor look up a barcode but not assign work", async () => {
    const { item } = await seedOrderWithItem({ clothingType: "thobe" });

    const lookup = await request(app)
      .get("/api/production/lookup")
      .query({ barcodeValue: item.barcodeValue })
      .set(auth(tailorToken));
    expect(lookup.status).toBe(200);
    expect(lookup.body.scanDetails.item.barcodeValue).toBe(item.barcodeValue);

    const assign = await request(app)
      .post("/api/production/assignments")
      .set(auth(tailorToken))
      .send({
        staffId: item._id,
        orderItemId: item.id,
        stage: "CUTTING"
      });
    expect(assign.status).toBe(403);

    const queue = await request(app).get("/api/production/queue").set(auth(tailorToken));
    expect(queue.status).toBe(403);
  });

  it("lets a manager assign work", async () => {
    const { item, staff } = await seedOrderWithItem({ clothingType: "thobe" });
    const assigned = await request(app)
      .post("/api/production/assignments")
      .set(auth(managerToken))
      .send({
        staffId: staff.id,
        orderItemId: item.id,
        stage: "RECEIVED"
      });
    expect(assigned.status).toBe(201);
  });

  it("lets a tailor read the floor queue but not the manager distribution queue", async () => {
    await seedOrderWithItem({ clothingType: "thobe" });
    const floor = await request(app).get("/api/production/floor").set(auth(tailorToken));
    expect(floor.status).toBe(200);
    expect(Array.isArray(floor.body.items)).toBe(true);
    expect(floor.body.stages).toEqual(["SEWING", "SEWING_CUTTING", "FINAL_SEWING", "OFF_SITE"]);

    const queue = await request(app).get("/api/production/queue").set(auth(tailorToken));
    expect(queue.status).toBe(403);
  });

  it("lets a manager update staff but not delete an order", async () => {
    const { staff, order } = await seedOrderWithItem({ clothingType: "thobe" });
    const patched = await request(app)
      .patch(`/api/staff/${staff.id}`)
      .set(auth(managerToken))
      .send({ name: "Patched Worker" });
    expect(patched.status).toBe(200);
    expect(patched.body.name).toBe("Patched Worker");

    const removed = await request(app)
      .delete(`/api/orders/${encodeURIComponent(order.orderId)}`)
      .set(auth(managerToken));
    expect(removed.status).toBe(403);
  });

  it("blocks a tailor from staff writes", async () => {
    const { staff } = await seedOrderWithItem({ clothingType: "thobe" });
    const patched = await request(app)
      .patch(`/api/staff/${staff.id}`)
      .set(auth(tailorToken))
      .send({ name: "Nope" });
    expect(patched.status).toBe(403);
  });
});
