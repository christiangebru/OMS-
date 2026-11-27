import { describe, it, expect, beforeAll, afterAll, beforeEach } from "@jest/globals";
import request from "supertest";
import { connectTestDb, disconnectTestDb, clearDb, createTestApp, createUser, auth } from "./helpers.js";
import { seedClothingTypes, seedOrderWithItem } from "./fixtures.js";
import { normalizeBarcodeInput, legacyOrderTails, operationalItemBarcode } from "../src/utils/barcode.js";

describe("barcode input normalisation (pure)", () => {
  it("accepts what people type", () => {
    expect(normalizeBarcodeInput("1001")).toBe("ORD-1001");
    expect(normalizeBarcodeInput(" 1001-2 ")).toBe("ORD-1001-2");
    expect(normalizeBarcodeInput("ord1001-1")).toBe("ORD-1001-1");
    expect(normalizeBarcodeInput("ORD 1001-1-wr")).toBe("ORD-1001-1-WR");
    expect(normalizeBarcodeInput("itm-0006abc")).toBe("ITM-0006ABC");
  });

  it("knows both short forms of an older order id", () => {
    expect(legacyOrderTails("ORD-MSS2MBAL-6DC16AC0")).toEqual(["6AC0", "6160"]);
  });
});

describe("GET /api/production/lookup", () => {
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
    token = (await createUser({ email: "m@test.local", name: "Manager", role: "manager" })).token;
  });

  const lookup = (v) =>
    request(app).get("/api/production/lookup").query({ barcodeValue: v }).set(auth(token));

  it("finds new-style orders and garments however the number is typed", async () => {
    const res = await request(app)
      .post("/api/orders")
      .set(auth(token))
      .send({
        customerName: "Almaz",
        customerPhone: "0911777666",
        requiredCompletionDate: "2027-01-15",
        items: [
          { clothingCode: "DRESS", clothingType: "Dress", fabricType: "Wool", color: "White", neckType: "oval", handType: "normal", size: "adult" }
        ]
      });
    expect(res.status).toBe(201);
    const n = res.body.orderId.replace("ORD-", "");

    for (const v of [res.body.orderId, n, `ord${n}`, ` ${res.body.orderId.toLowerCase()} `]) {
      const r = await lookup(v);
      expect(r.status).toBe(200);
      expect(r.body.scanKind).toBe("order");
    }
    for (const v of [`${res.body.orderId}-1`, `${n}-1`]) {
      const r = await lookup(v);
      expect(r.status).toBe(200);
      expect(r.body.scanKind).toBe("item");
    }
  });

  it("finds older orders by the short codes the app shows and prints", async () => {
    const { order, item } = await seedOrderWithItem({ clothingType: "dress" });
    const [shown, printedDigits] = legacyOrderTails(order.orderId);

    const byShown = await lookup(`ORD-${shown}`);
    expect(byShown.status).toBe(200);
    expect(byShown.body.scanKind).toBe("order");

    if (printedDigits) {
      const printed = operationalItemBarcode(order.orderId, 1, item.barcodeValue);
      const byLabel = await lookup(printed);
      expect(byLabel.status).toBe(200);
      expect(byLabel.body.scanKind).toBe("item");
      expect(byLabel.body.scanDetails.item._id).toBe(item._id);
    }
    const byShownItem = await lookup(`ORD-${shown}-1`);
    expect(byShownItem.status).toBe(200);
    expect(byShownItem.body.scanDetails.item._id).toBe(item._id);
  });

  it("explains a code that does not exist", async () => {
    const r = await lookup("ORD-9999-1");
    expect(r.status).toBe(404);
    expect(r.body.message).toMatch(/Barcode not found: no order or garment has the code "ORD-9999-1"/);
  });
});
