import { describe, it, expect, beforeAll, afterAll, beforeEach } from "@jest/globals";
import "express-async-errors";
import express from "express";
import request from "supertest";
import { connectTestDb, disconnectTestDb, clearDb, auth, createUserWithRawRole } from "./helpers.js";
import { seedClothingTypes } from "./fixtures.js";
import authRoutes from "../src/routes/auth.js";
import orderRoutes from "../src/routes/orders.js";
import customerRoutes from "../src/routes/customers.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/auth", authRoutes);
  app.use("/api/orders", orderRoutes);
  app.use("/api/customers", customerRoutes);
  app.use((err, _req, res, _next) => {
    res.status(err.status || 500).json({ message: err.message || "Internal Server Error" });
  });
  return app;
}

const validItem = {
  clothingCode: "SH-1",
  clothingType: "Shirt",
  fabricType: "Cotton",
  color: "Blue",
  quantity: 2,
  unitPrice: 45,
  neckType: "oval",
  handType: "normal",
  size: "adult",
  measurements: { gender: "male" }
};

describe("Orders API (PostgreSQL/Prisma)", () => {
  let app;
  let token;

  beforeAll(async () => {
    await connectTestDb();
    app = buildApp();
  });

  afterAll(async () => {
    await disconnectTestDb();
  });

  beforeEach(async () => {
    await clearDb();
    await seedClothingTypes();
    // Bootstrap first admin, then use its token.
    const boot = await request(app)
      .post("/api/auth/bootstrap")
      .send({ email: "admin@test.local", password: "password123", name: "Admin" });
    expect(boot.status).toBe(201);
    token = boot.body.token;
  });

  it("bootstrap is disabled once a user exists", async () => {
    const res = await request(app)
      .post("/api/auth/bootstrap")
      .send({ email: "second@test.local", password: "password123", name: "Second" });
    expect(res.status).toBe(403);
  });

  it("rejects unauthenticated order creation", async () => {
    const res = await request(app).post("/api/orders").send({});
    expect(res.status).toBe(401);
  });

  it("creates an order with correct pricing and balance, and persists it", async () => {
    const res = await request(app)
      .post("/api/orders")
      .set(auth(token))
      .send({
        customerName: "Maria Tailor",
        customerPhone: "5559876543",
        requiredCompletionDate: "2027-01-15",
        depositPaid: 30,
        items: [validItem]
      });

    expect(res.status).toBe(201);
    expect(res.body.orderId).toMatch(/^ORD-\d+$/);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.totalRevenue).toBe(90); // 45 * 2
    expect(res.body.totalAgreedPrice).toBe(90); // defaults to revenue
    expect(res.body.balanceRemaining).toBe(60); // 90 - 30
    expect(res.body.items[0]._id).toBeTruthy();
    expect(res.body.items[0].barcodeValue).toMatch(/^ITM-/);
    expect(res.body.customer.name).toBe("Maria Tailor");

    // Reload from a fresh GET to prove persistence in PostgreSQL.
    const reload = await request(app)
      .get(`/api/orders/${res.body.orderId}`)
      .set(auth(token));
    expect(reload.status).toBe(200);
    expect(reload.body._id).toBe(res.body._id);
    expect(reload.body.items).toHaveLength(1);
  });

  it("returns 400 (not 500) for invalid item enum values", async () => {
    const res = await request(app)
      .post("/api/orders")
      .set(auth(token))
      .send({
        customerName: "Bad Enum",
        customerPhone: "5551110000",
        requiredCompletionDate: "2027-01-15",
        items: [{ ...validItem, neckType: "triangle" }]
      });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/neckType/i);
  });

  it("does not create an order when an item is invalid (transactional integrity)", async () => {
    await request(app)
      .post("/api/orders")
      .set(auth(token))
      .send({
        customerName: "No Orphan",
        customerPhone: "5552220000",
        requiredCompletionDate: "2027-01-15",
        items: [{ ...validItem, size: "giant" }]
      });

    const list = await request(app).get("/api/orders").set(auth(token));
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(0);
  });

  it("lists created orders", async () => {
    await request(app)
      .post("/api/orders")
      .set(auth(token))
      .send({
        customerName: "List Me",
        customerPhone: "5553330000",
        requiredCompletionDate: "2027-01-15",
        items: [validItem]
      });

    const list = await request(app).get("/api/orders").set(auth(token));
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].customerName).toBe("List Me");
  });

  it("reuses an existing customer by customerId instead of duplicating", async () => {
    const first = await request(app)
      .post("/api/orders")
      .set(auth(token))
      .send({
        customerName: "Abebe",
        customerPhone: "0911223344",
        requiredCompletionDate: "2027-02-01",
        items: [validItem]
      });
    expect(first.status).toBe(201);
    const customerId = first.body.customer._id;

    const second = await request(app)
      .post("/api/orders")
      .set(auth(token))
      .send({
        customerId,
        requiredCompletionDate: "2027-03-01",
        items: [{ ...validItem, clothingType: "Thobe", clothingCode: "TH-1" }]
      });
    expect(second.status).toBe(201);
    expect(second.body.customer._id).toBe(customerId);

    const profile = await request(app).get(`/api/customers/${customerId}`).set(auth(token));
    expect(profile.status).toBe(200);
    expect(profile.body.orders).toHaveLength(2);
    expect(profile.body.orders[0].items.length).toBeGreaterThan(0);
  });

  it("rejects order creation for a tailor login", async () => {
    const tailor = await createUserWithRawRole("tailor");
    const res = await request(app)
      .post("/api/orders")
      .set(auth(tailor.token))
      .send({
        customerName: "Worker Cannot",
        customerPhone: "5554440000",
        requiredCompletionDate: "2027-01-15",
        items: [validItem]
      });
    expect(res.status).toBe(403);
  });

  it("lets reception create an order", async () => {
    const reception = await createUserWithRawRole("reception");
    const res = await request(app)
      .post("/api/orders")
      .set(auth(reception.token))
      .send({
        customerName: "Reception Client",
        customerPhone: "5555550000",
        requiredCompletionDate: "2027-01-15",
        items: [validItem]
      });
    expect(res.status).toBe(201);
    expect(res.body.items[0].barcodeValue).toMatch(/^ITM-/);
  });

  it("creates one order with multiple garments, each with its own barcode", async () => {
    const res = await request(app)
      .post("/api/orders")
      .set(auth(token))
      .send({
        customerName: "Abebe Multi",
        customerPhone: "5556660000",
        requiredCompletionDate: "2027-04-01",
        depositPaid: 200,
        totalAgreedPrice: 900,
        items: [
          { ...validItem, clothingCode: "SUIT", clothingType: "Suit", unitPrice: 500, quantity: 1 },
          { ...validItem, clothingCode: "SHIRT", clothingType: "Shirt", unitPrice: 250, quantity: 1 },
          { ...validItem, clothingCode: "PANT", clothingType: "Trousers", unitPrice: 150, quantity: 1 }
        ]
      });
    expect(res.status).toBe(201);
    expect(res.body.items).toHaveLength(3);
    const barcodes = res.body.items.map((it) => it.barcodeValue);
    expect(new Set(barcodes).size).toBe(3);
    barcodes.forEach((b) => expect(b).toMatch(/^ITM-/));
    expect(res.body.totalRevenue).toBe(900);
    expect(res.body.balanceRemaining).toBe(700);
  });

  it("finds an order by garment barcode", async () => {
    const created = await request(app)
      .post("/api/orders")
      .set(auth(token))
      .send({
        customerName: "Barcode Find",
        customerPhone: "5557770000",
        requiredCompletionDate: "2027-05-01",
        items: [validItem]
      });
    expect(created.status).toBe(201);
    const barcode = created.body.items[0].barcodeValue;
    expect(created.body.items[0].currentStage).toBeDefined();

    const list = await request(app).get("/api/orders").query({ q: barcode }).set(auth(token));
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].orderId).toBe(created.body.orderId);
  });
});
