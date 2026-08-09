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
  });
});
