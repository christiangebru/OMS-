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

describe("GET /api/order-items/:id/scan-details", () => {
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
      email: "scan-details@test.local",
      name: "Manager",
      role: "manager"
    });
    token = u.token;
  });

  it("does not error when no group code, prices unset, and single item (no siblings)", async () => {
    // Omit totalAgreedPrice / depositPaid so they stay at schema defaults (0)
    // groupCode "", only one item
    const { item, order } = await seedOrderWithItem({
      clothingType: "shirt",
      groupCode: ""
    });

    // Ensure price fields were not explicitly set beyond defaults
    expect(order.totalAgreedPrice).toBe(0);
    expect(order.depositPaid).toBe(0);
    expect(order.groupCode).toBe("");

    const res = await request(app)
      .get(`/api/order-items/${item._id}/scan-details`)
      .set(auth(token));

    expect(res.status).toBe(200);
    expect(res.body.customer).toBeTruthy();
    expect(res.body.customer.name).toBe("Test Customer");
    expect(res.body.item._id).toBe(String(item._id));
    expect(res.body.group.groupCode).toBe("");
    expect(res.body.group.otherOrdersSharingGroup).toBe(0);
    expect(res.body.pricing.totalAgreedPrice).toBe(0);
    expect(res.body.pricing.depositPaid).toBe(0);
    expect(res.body.pricing.balanceRemaining).toBe(0);
    expect(res.body.order.siblingItems).toHaveLength(1);
    expect(res.body.order.siblingItems[0].isCurrent).toBe(true);
    expect(res.body.timing).toBeTruthy();
    expect(res.body.timing.stageSequence).toEqual(expect.any(Array));
    expect(res.body.production.boardStatus).toBe("waiting");
    expect(res.body.production.nextAction).toEqual(
      expect.objectContaining({ code: expect.any(String), label: expect.any(String), stage: expect.any(String) })
    );
  });

  it("resolves ORD-n-i to the garment, not a part row, and parent after assembly", async () => {
    const created = await request(app)
      .post("/api/orders")
      .set(auth(token))
      .send({
        customerName: "Scan Parts",
        customerPhone: `09${Date.now().toString().slice(-8)}`,
        requiredCompletionDate: "2027-09-01",
        partLabelMode: "all",
        items: [
          {
            clothingCode: "WD-1",
            clothingType: "Women's dress",
            fabricType: "Cotton",
            color: "White",
            quantity: 1,
            unitPrice: 100,
            neckType: "oval",
            handType: "normal",
            size: "adult",
            measurements: { gender: "female" }
          }
        ]
      });
    expect(created.status).toBe(201);
    const garment = created.body.items.find((it) => it.itemKind !== "part");
    const part = created.body.items.find((it) => it.itemKind === "part");
    expect(garment).toBeTruthy();
    expect(part).toBeTruthy();

    const byOp = await request(app)
      .get(`/api/production/lookup?barcodeValue=${encodeURIComponent(garment.barcodeValue)}`)
      .set(auth(token));
    expect(byOp.status).toBe(200);
    expect(byOp.body.scanDetails.item._id).toBe(garment._id);

    const byPart = await request(app)
      .get(`/api/production/lookup?barcodeValue=${encodeURIComponent(part.barcodeValue)}`)
      .set(auth(token));
    expect(byPart.status).toBe(200);
    expect(byPart.body.scanDetails.item._id).toBe(part._id);

    await prisma.orderItem.update({
      where: { id: part._id },
      data: { assembledAt: new Date() }
    });
    const after = await request(app)
      .get(`/api/production/lookup?barcodeValue=${encodeURIComponent(part.barcodeValue)}`)
      .set(auth(token));
    expect(after.status).toBe(200);
    expect(after.body.scanDetails.item._id).toBe(garment._id);
  });
});
