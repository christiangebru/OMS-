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

describe("production queue and distribution", () => {
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
      email: "mgr@queue.test",
      name: "Manager",
      role: "manager"
    });
    token = u.token;
  });

  it("places an unstarted item in RECEIVED waiting", async () => {
    const { item } = await seedOrderWithItem({ clothingType: "thobe" });
    const res = await request(app).get("/api/production/queue").set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.summary.itemsWaiting).toBeGreaterThanOrEqual(1);
    const found = res.body.items.find((r) => r.itemId === item.id || r.barcodeValue === item.barcodeValue);
    expect(found).toBeTruthy();
    expect(found.nextStage).toBe("RECEIVED");
    expect(found.boardStatus).toBe("waiting");
    expect(found.recommended?.staff?._id || found.recommended?.staff?.name).toBeTruthy();
    expect(found.recommended.summary).toEqual(expect.any(String));
  });

  it("assign then distribute then receive", async () => {
    const { item, staff } = await seedOrderWithItem({ clothingType: "thobe" });

    const suggest = await request(app)
      .get("/api/production/suggest-assignment")
      .query({ orderItemId: item.id, stage: "RECEIVED" })
      .set(auth(token));
    expect(suggest.status).toBe(200);
    expect(Array.isArray(suggest.body.rankings[0]?.reasons)).toBe(true);

    const assigned = await request(app)
      .post("/api/production/assignments")
      .set(auth(token))
      .send({
        staffId: staff.id,
        orderItemId: item.id,
        stage: "RECEIVED",
        followedSuggestion: true,
        suggestedStaffId: staff.id
      });
    expect(assigned.status).toBe(201);

    const afterAssign = await request(app).get("/api/production/queue").set(auth(token));
    const row = afterAssign.body.items.find((r) => r.itemId === item.id);
    expect(row.boardStatus).toBe("assigned");
    expect(row.assignment._id).toBe(assigned.body._id);

    const dist = await request(app)
      .post(`/api/production/assignments/${assigned.body._id}/distribute`)
      .set(auth(token));
    expect(dist.status).toBe(200);
    expect(dist.body.distributedAt).toBeTruthy();

    const recv = await request(app)
      .post(`/api/production/assignments/${assigned.body._id}/receive`)
      .set(auth(token));
    expect(recv.status).toBe(200);
    expect(recv.body.receivedAt).toBeTruthy();

    const afterRecv = await request(app).get("/api/production/queue").set(auth(token));
    const received = afterRecv.body.items.find((r) => r.itemId === item.id);
    expect(received.boardStatus).toBe("received");
    expect(afterRecv.body.summary.itemsReceived).toBeGreaterThanOrEqual(1);
  });

  it("reassign closes the previous open assignment", async () => {
    const { item, staff } = await seedOrderWithItem({ clothingType: "thobe" });
    const other = await prisma.staff.create({
      data: {
        tenantId: "default",
        name: "Second Cutter",
        phone: "0900000002",
        role: "CUTTER",
        status: "AVAILABLE",
        skillLevel: 3,
        skills: { create: [{ stage: "RECEIVED" }, { stage: "CUTTING" }] }
      }
    });

    const first = await request(app)
      .post("/api/production/assignments")
      .set(auth(token))
      .send({ staffId: staff.id, orderItemId: item.id, stage: "RECEIVED" });
    expect(first.status).toBe(201);

    const second = await request(app)
      .post("/api/production/assignments")
      .set(auth(token))
      .send({ staffId: other.id, orderItemId: item.id, stage: "RECEIVED" });
    expect(second.status).toBe(201);

    const open = await prisma.staffAssignment.findMany({
      where: { orderItemId: item.id, stage: "RECEIVED", completedAt: null }
    });
    expect(open).toHaveLength(1);
    expect(open[0].staffId).toBe(other.id);
  });

  it("renders a PNG barcode for an item code", async () => {
    const { item } = await seedOrderWithItem({ clothingType: "thobe" });
    const res = await request(app)
      .get("/api/production/barcode.png")
      .query({ value: item.barcodeValue })
      .set(auth(token));
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/image\/png/);
    expect(res.body.length).toBeGreaterThan(40);
  });
});
