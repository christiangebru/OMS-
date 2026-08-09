import { describe, it, expect, beforeAll, afterAll, beforeEach } from "@jest/globals";
import mongoose from "mongoose";
import {
  connectTestDb,
  disconnectTestDb,
  clearDb
} from "./helpers.js";
import { migrateOrders, seedClothingTypes } from "../src/scripts/migrate-phase1.js";
import { normalizePhone } from "../src/utils/migrateHelpers.js";
import { Customer } from "../src/models/Customer.js";
import { DEFAULT_TENANT_ID } from "../src/config/tenant.js";

describe("migrate:phase1 phone dedupe behavior", () => {
  beforeAll(async () => {
    await connectTestDb();
  });

  afterAll(async () => {
    await disconnectTestDb();
  });

  beforeEach(async () => {
    await clearDb();
  });

  it("normalizePhone strips non-digit/+ but does not canonicalize country codes", () => {
    expect(normalizePhone("0911232770")).toBe("0911232770");
    expect(normalizePhone("+251911232770")).toBe("+251911232770");
    expect(normalizePhone("091-123-2770")).toBe("0911232770");
    expect(normalizePhone("+251 911 232 770")).toBe("+251911232770");
    // Document: these two formats remain unequal after normalize
    expect(normalizePhone("0911232770")).not.toBe(normalizePhone("+251911232770"));
  });

  it("creates SEPARATE customers for 091… vs +251… (no semantic dedupe)", async () => {
    const orders = mongoose.connection.collection("orders");
    await orders.insertMany([
      {
        orderId: "ORD-LEGACY-A",
        customerName: "Same Person",
        customerPhone: "0911232770",
        items: [],
        requiredCompletionDate: new Date(),
        productionStatus: "pending",
        totalRevenue: 0,
        // Unique placeholder — legacy rows may lack barcodes; index forbids duplicate nulls
        barcodeValue: "LEGACY-TMP-A",
        barcodeGeneratedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        orderId: "ORD-LEGACY-B",
        customerName: "Same Person",
        customerPhone: "+251911232770",
        items: [],
        requiredCompletionDate: new Date(),
        productionStatus: "pending",
        totalRevenue: 0,
        barcodeValue: "LEGACY-TMP-B",
        barcodeGeneratedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ]);

    await seedClothingTypes();
    await migrateOrders();

    const customers = await Customer.find({ tenantId: DEFAULT_TENANT_ID }).sort({ phone: 1 });
    const phones = customers.map((c) => c.phone);

    // ACTUAL BEHAVIOR: exact-string match after normalizePhone only → 2 customers
    expect(customers).toHaveLength(2);
    expect(phones).toEqual(expect.arrayContaining(["0911232770", "+251911232770"]));

    const ordersAfter = await orders.find({}).toArray();
    const customerIds = ordersAfter.map((o) => String(o.customerId));
    expect(new Set(customerIds).size).toBe(2);
  });

  it("DOES dedupe when phones normalize to the identical string", async () => {
    const orders = mongoose.connection.collection("orders");
    await orders.insertMany([
      {
        orderId: "ORD-LEGACY-C",
        customerName: "Ali",
        customerPhone: "091-123-2770",
        items: [],
        requiredCompletionDate: new Date(),
        productionStatus: "pending",
        totalRevenue: 0,
        barcodeValue: "LEGACY-TMP-C",
        barcodeGeneratedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        orderId: "ORD-LEGACY-D",
        customerName: "Ali Updated",
        customerPhone: "0911232770",
        items: [],
        requiredCompletionDate: new Date(),
        productionStatus: "pending",
        totalRevenue: 0,
        barcodeValue: "LEGACY-TMP-D",
        barcodeGeneratedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ]);

    await seedClothingTypes();
    await migrateOrders();

    const customers = await Customer.find({ phone: "0911232770" });
    expect(customers).toHaveLength(1);

    const ordersAfter = await orders.find({}).toArray();
    expect(new Set(ordersAfter.map((o) => String(o.customerId))).size).toBe(1);
  });
});
