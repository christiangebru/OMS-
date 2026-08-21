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
import { seedClothingTypes, seedOrderWithItem, createStaff } from "./fixtures.js";
import { prisma } from "../src/db/prisma.js";
import { generateItemBarcodeValue } from "../src/utils/barcode.js";

describe("multi-assignment queues, scan flow, groups, barcodes", () => {
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
      email: "ops@queue.test",
      name: "Manager",
      role: "manager"
    });
    token = u.token;
  });

  it("allows a worker to hold multiple queued assignments without being blocked", async () => {
    const first = await seedOrderWithItem({ clothingType: "thobe" });
    const second = await seedOrderWithItem({ clothingType: "shirt" });
    const third = await seedOrderWithItem({ clothingType: "pants" });

    for (const row of [first, second, third]) {
      const res = await request(app)
        .post("/api/production/assignments")
        .set(auth(token))
        .send({ staffId: first.staff.id, orderItemId: row.item.id, stage: "RECEIVED" });
      expect(res.status).toBe(201);
    }

    const open = await prisma.staffAssignment.findMany({
      where: { staffId: first.staff.id, completedAt: null }
    });
    expect(open).toHaveLength(3);

    const wl = await request(app)
      .get(`/api/staff/${first.staff.id}/workload`)
      .set(auth(token));
    expect(wl.status).toBe(200);
    expect(wl.body.activeAssignmentCount).toBe(3);
    expect(wl.body.queue.queuedAll || wl.body.queue.queued).toBeTruthy();
    expect(wl.body.queue.nowWorking).toHaveLength(0);
    expect((wl.body.queue.queued?.length || 0) + (wl.body.queue.upNext ? 1 : 0)).toBe(3);
  });

  it("distinguishes active work from queued work after scan in", async () => {
    const { item, staff } = await seedOrderWithItem({ clothingType: "thobe" });
    const extra = await seedOrderWithItem({ clothingType: "shirt" });

    await request(app)
      .post("/api/production/assignments")
      .set(auth(token))
      .send({ staffId: staff.id, orderItemId: item.id, stage: "RECEIVED" });
    await request(app)
      .post("/api/production/assignments")
      .set(auth(token))
      .send({ staffId: staff.id, orderItemId: extra.item.id, stage: "RECEIVED" });

    const cin = await request(app)
      .post("/api/production/scan")
      .set(auth(token))
      .send({ barcodeValue: item.barcodeValue, stage: "RECEIVED", staffId: staff.id });
    expect(cin.status).toBe(200);
    expect(cin.body.action).toBe("check_in");

    const wl = await request(app).get(`/api/staff/${staff.id}/workload`).set(auth(token));
    expect(wl.body.queue.nowWorking.length).toBe(1);
    expect(wl.body.queue.nowWorking[0].item._id).toBe(item.id);
    expect((wl.body.queue.queued?.length || 0) + (wl.body.queue.upNext ? 1 : 0)).toBe(1);
  });

  it("scan out completes the stage and lookup shows the next stage/worker", async () => {
    const { item, staff } = await seedOrderWithItem({ clothingType: "thobe" });
    const sewer = await createStaff({
      name: "Abebe",
      stages: ["SEWING", "CUTTING", "RECEIVED"]
    });

    await request(app)
      .post("/api/production/assignment-chain")
      .set(auth(token))
      .send({
        orderItemId: item.id,
        path: [
          { stage: "RECEIVED", staffId: staff.id },
          { stage: "CUTTING", staffId: staff.id },
          { stage: "SEWING", staffId: sewer.id }
        ]
      });

    const cin = await request(app)
      .post("/api/production/scan")
      .set(auth(token))
      .send({ barcodeValue: item.barcodeValue, stage: "RECEIVED", staffId: staff.id });
    expect(cin.status).toBe(200);

    const cout = await request(app)
      .post("/api/production/scan")
      .set(auth(token))
      .send({ barcodeValue: item.barcodeValue, stage: "RECEIVED", staffId: staff.id });
    expect(cout.status).toBe(200);
    expect(cout.body.action).toBe("check_out");

    const lookup = await request(app)
      .get("/api/production/lookup")
      .query({ barcodeValue: item.barcodeValue })
      .set(auth(token));
    expect(lookup.status).toBe(200);
    expect(lookup.body.scanDetails.timing.nextExpectedStage).toBe("CUTTING");
    expect(lookup.body.scanDetails.production.assignmentChain).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stage: "SEWING",
          staff: expect.objectContaining({ name: "Abebe" })
        })
      ])
    );
    expect(lookup.body.scanDetails.production.managerCommand).toEqual(expect.any(String));
  });

  it("looks up simplified and legacy barcodes", async () => {
    const created = await request(app)
      .post("/api/orders")
      .set(auth(token))
      .send({
        customerName: "Chris",
        customerPhone: "0911223344",
        requiredCompletionDate: "2027-08-28",
        items: [
          {
            clothingCode: "SH",
            clothingType: "Shirt",
            fabricType: "Cotton",
            color: "White",
            quantity: 1,
            neckType: "oval",
            handType: "normal",
            size: "adult",
            measurements: { gender: "male" }
          }
        ]
      });
    expect(created.status).toBe(201);
    const barcode = created.body.items[0].barcodeValue;
    expect(barcode).toMatch(/^ORD-\d+-1$/);

    const lookup = await request(app)
      .get("/api/production/lookup")
      .query({ barcodeValue: barcode })
      .set(auth(token));
    expect(lookup.status).toBe(200);
    expect(lookup.body.scanDetails.item.barcodeValue).toBe(barcode);

    const orderLookup = await request(app)
      .get("/api/production/lookup")
      .query({ barcodeValue: created.body.orderId })
      .set(auth(token));
    expect(orderLookup.status).toBe(200);

    const missing = await request(app)
      .get("/api/production/lookup")
      .query({ barcodeValue: "NO-SUCH-CODE" })
      .set(auth(token));
    expect(missing.status).toBe(404);
    expect(missing.body.message).toMatch(/not found/i);

    const legacyValue = "ITM-LEGACYCODE01";
    await prisma.orderItem.update({
      where: { id: created.body.items[0]._id },
      data: { barcodeValue: legacyValue }
    });
    const legacy = await request(app)
      .get("/api/production/lookup")
      .query({ barcodeValue: legacyValue })
      .set(auth(token));
    expect(legacy.status).toBe(200);
    expect(generateItemBarcodeValue("ORD-1001", 1)).toBe("ORD-1001-1");
  });

  it("creates a group, adds a later order, and lists independent members", async () => {
    const group = await request(app)
      .post("/api/order-groups")
      .set(auth(token))
      .send({
        name: "St. Joseph Graduation 2027",
        responsibleName: "Christian",
        responsiblePhone: "+2519000000",
        sharedDueDate: "2027-08-28",
        sharedPriority: "VIP",
        notes: "School event"
      });
    expect(group.status).toBe(201);

    const first = await request(app)
      .post("/api/orders")
      .set(auth(token))
      .send({
        customerName: "Christian",
        customerPhone: "0911000001",
        requiredCompletionDate: "2027-09-01",
        groupId: group.body._id,
        useGroupDueDate: true,
        useGroupPriority: true,
        items: [
          {
            clothingCode: "SH",
            clothingType: "Shirt",
            fabricType: "Cotton",
            color: "White",
            quantity: 1,
            neckType: "oval",
            handType: "normal",
            size: "adult",
            measurements: { gender: "male" }
          }
        ]
      });
    expect(first.status).toBe(201);
    expect(first.body.group._id).toBe(group.body._id);
    expect(new Date(first.body.requiredCompletionDate).toISOString().startsWith("2027-08-28")).toBe(
      true
    );
    expect(first.body.priority).toBe("VIP");

    const later = await request(app)
      .post("/api/orders")
      .set(auth(token))
      .send({
        customerName: "Daniel",
        customerPhone: "0911000002",
        requiredCompletionDate: "2027-10-15",
        groupId: group.body._id,
        useGroupDueDate: false,
        items: [
          {
            clothingCode: "SU",
            clothingType: "Suit",
            fabricType: "Wool",
            color: "Black",
            quantity: 1,
            neckType: "oval",
            handType: "normal",
            size: "adult",
            measurements: { gender: "male" }
          }
        ]
      });
    expect(later.status).toBe(201);
    expect(later.body.group._id).toBe(group.body._id);
    expect(new Date(later.body.requiredCompletionDate).toISOString().startsWith("2027-10-15")).toBe(
      true
    );
    expect(later.body._id).not.toBe(first.body._id);

    const detail = await request(app)
      .get(`/api/order-groups/${group.body._id}`)
      .set(auth(token));
    expect(detail.status).toBe(200);
    expect(detail.body.orders).toHaveLength(2);

    await request(app)
      .delete(`/api/order-groups/${group.body._id}/orders/${later.body.orderId}`)
      .set(auth(token));
    const after = await request(app)
      .get(`/api/order-groups/${group.body._id}`)
      .set(auth(token));
    expect(after.body.orders).toHaveLength(1);
  });

  it("keeps legacy UUID-style order ids accessible", async () => {
    const { order } = await seedOrderWithItem({ clothingType: "thobe" });
    expect(order.orderId).toMatch(/^ORD-TEST-/);
    const res = await request(app).get(`/api/orders/${order.orderId}`).set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.orderId).toBe(order.orderId);
  });

  it("accepts legacy cuid-shaped staff ids (assigned is not a validator reject)", async () => {
    const { isRecordId } = await import("../src/utils/recordId.js");
    expect(isRecordId("a1b2c3d4e5f6a1b2c3d4e5f6")).toBe(true);
    expect(isRecordId("cmss2mw18000bitdiibds60ug")).toBe(true);
    expect(isRecordId("not-an-id")).toBe(false);

    const staff = await prisma.staff.create({
      data: {
        id: "cmss2mw18000bitdiibds60ug",
        tenantId: "default",
        name: "Yusuf",
        phone: "0900111222",
        role: "TAILOR",
        status: "AVAILABLE",
        skillLevel: 3,
        active: true
      }
    });
    const res = await request(app).get(`/api/staff/${staff.id}`).set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Yusuf");
    const wl = await request(app).get(`/api/staff/${staff.id}/workload`).set(auth(token));
    expect(wl.status).toBe(200);
  });
});
