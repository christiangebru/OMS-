import { describe, it, expect, beforeAll, afterAll, beforeEach } from "@jest/globals";
import "express-async-errors";
import express from "express";
import request from "supertest";
import { connectTestDb, disconnectTestDb, clearDb, auth, createUserWithRawRole } from "./helpers.js";
import { seedClothingTypes } from "./fixtures.js";
import authRoutes from "../src/routes/auth.js";
import orderRoutes from "../src/routes/orders.js";
import customerRoutes from "../src/routes/customers.js";
import { prisma } from "../src/db/prisma.js";
import { findClothingTypeConfig } from "../src/utils/clothingTypeConfig.js";

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
    expect(res.body.items[0].barcodeValue).toMatch(/^ORD-\d+-\d+$/);
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
    expect(res.body.items[0].barcodeValue).toMatch(/^ORD-\d+-\d+$/);
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
    barcodes.forEach((b) => expect(b).toMatch(/^ORD-\d+-\d+$/));
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

  it("validates men's shirt / trouser / both garment sets", async () => {
    const shirt = { ...validItem, clothingCode: "SHIRT", clothingType: "Shirt", quantity: 1 };
    const trouser = { ...validItem, clothingCode: "PANT", clothingType: "Trousers", quantity: 1 };

    const both = await request(app)
      .post("/api/orders")
      .set(auth(token))
      .send({
        customerName: "Mens Both",
        customerPhone: "5558880001",
        requiredCompletionDate: "2027-06-01",
        mensGarmentSet: "both",
        items: [shirt, trouser]
      });
    expect(both.status).toBe(201);
    expect(both.body.items).toHaveLength(2);

    const shirtOnly = await request(app)
      .post("/api/orders")
      .set(auth(token))
      .send({
        customerName: "Mens Shirt",
        customerPhone: "5558880002",
        requiredCompletionDate: "2027-06-01",
        mensGarmentSet: "shirt",
        items: [shirt]
      });
    expect(shirtOnly.status).toBe(201);
    expect(shirtOnly.body.items).toHaveLength(1);
    expect(shirtOnly.body.items[0].clothingType).toMatch(/shirt/i);

    const bad = await request(app)
      .post("/api/orders")
      .set(auth(token))
      .send({
        customerName: "Mens Bad",
        customerPhone: "5558880003",
        requiredCompletionDate: "2027-06-01",
        mensGarmentSet: "shirt",
        items: [shirt, trouser]
      });
    expect(bad.status).toBe(400);
  });

  it("updates header fields without replacing garments or wiping production history", async () => {
    const created = await request(app)
      .post("/api/orders")
      .set(auth(token))
      .send({
        customerName: "Header Edit",
        customerPhone: "5559990001",
        requiredCompletionDate: "2027-07-01",
        depositPaid: 10,
        items: [validItem]
      });
    expect(created.status).toBe(201);
    const itemId = created.body.items[0]._id;
    await prisma.stageCheckpoint.create({
      data: {
        orderItemId: itemId,
        stage: "SEWING_CUTTING",
        checkedInAt: new Date()
      }
    });

    const headerOnly = await request(app)
      .put(`/api/orders/${created.body.orderId}`)
      .set(auth(token))
      .send({
        requiredCompletionDate: "2027-08-15",
        depositPaid: 40,
        notes: "Rush for wedding",
        totalAgreedPrice: 120
      });
    expect(headerOnly.status).toBe(200);
    expect(headerOnly.body.items).toHaveLength(1);
    expect(headerOnly.body.items[0]._id).toBe(itemId);
    expect(headerOnly.body.depositPaid).toBe(40);
    expect(headerOnly.body.notes).toBe("Rush for wedding");
    const cp = await prisma.stageCheckpoint.findMany({ where: { orderItemId: itemId } });
    expect(cp).toHaveLength(1);

    const replace = await request(app)
      .put(`/api/orders/${created.body.orderId}`)
      .set(auth(token))
      .send({
        replaceItems: true,
        items: [{ ...validItem, clothingCode: "NEW" }]
      });
    expect(replace.status).toBe(409);
    expect(replace.body.message).toMatch(/production history/i);
  });

  it("upserts existing garments by id without cascade-deleting checkpoints", async () => {
    const created = await request(app)
      .post("/api/orders")
      .set(auth(token))
      .send({
        customerName: "Upsert Edit",
        customerPhone: "5559990002",
        requiredCompletionDate: "2027-07-01",
        items: [validItem]
      });
    const itemId = created.body.items[0]._id;
    await prisma.stageCheckpoint.create({
      data: {
        orderItemId: itemId,
        stage: "SEWING_CUTTING",
        checkedInAt: new Date(),
        checkedOutAt: new Date()
      }
    });

    const updated = await request(app)
      .put(`/api/orders/${created.body.orderId}`)
      .set(auth(token))
      .send({
        items: [
          {
            _id: itemId,
            ...validItem,
            unitPrice: 80,
            notes: "Hem shorter"
          }
        ]
      });
    expect(updated.status).toBe(200);
    expect(updated.body.items[0]._id).toBe(itemId);
    expect(updated.body.items[0].unitPrice).toBe(80);
    expect(updated.body.items[0].notes).toBe("Hem shorter");
    const cp = await prisma.stageCheckpoint.count({ where: { orderItemId: itemId } });
    expect(cp).toBe(1);
  });

  it("creates optional part labels ORD-n-i-XX when requested at order create", async () => {
    const res = await request(app)
      .post("/api/orders")
      .set(auth(token))
      .send({
        customerName: "Part Labels",
        customerPhone: "5559990003",
        requiredCompletionDate: "2027-09-01",
        partLabelMode: "all",
        items: [
          {
            ...validItem,
            clothingType: "Women's dress",
            clothingCode: "WD-1",
            measurements: { gender: "female" }
          }
        ]
      });
    expect(res.status).toBe(201);
    const garments = res.body.items.filter((it) => it.itemKind !== "part");
    const parts = res.body.items.filter((it) => it.itemKind === "part");
    expect(garments).toHaveLength(1);
    expect(parts.length).toBeGreaterThanOrEqual(2);
    expect(garments[0].barcodeValue).toMatch(/^ORD-\d+-1$/);
    parts.forEach((p) => {
      expect(p.barcodeValue).toMatch(/^ORD-\d+-1-[A-Z]{2}$/);
      expect(p.parentItemId).toBe(garments[0]._id);
    });
  });

  it("persists audience and setChoice and allows mixed categories on one order", async () => {
    const res = await request(app)
      .post("/api/orders")
      .set(auth(token))
      .send({
        customerName: "Mixed Category",
        customerPhone: "5558881001",
        requiredCompletionDate: "2027-10-01",
        items: [
          {
            ...validItem,
            clothingCode: "KEMIS",
            clothingType: "kemis",
            audience: "women",
            setChoice: "garment",
            measurements: { gender: "female" }
          },
          {
            ...validItem,
            clothingCode: "SHIRT",
            clothingType: "Men's shirt",
            audience: "men",
            setChoice: "shirt",
            measurements: { gender: "male", chest: "98" }
          },
          {
            ...validItem,
            clothingCode: "BELT",
            clothingType: "Belt",
            itemKind: "accessory",
            audience: "women",
            setChoice: "belt"
          }
        ]
      });
    expect(res.status).toBe(201);
    const top = res.body.items.filter((it) => it.itemKind !== "part");
    expect(top).toHaveLength(3);
    const kemis = top.find((it) => it.clothingType === "kemis");
    const shirt = top.find((it) => /shirt/i.test(it.clothingType));
    const belt = top.find((it) => it.clothingType === "Belt");
    expect(kemis.audience).toBe("women");
    expect(kemis.setChoice).toBe("garment");
    expect(kemis.itemKind).toBe("garment");
    expect(shirt.audience).toBe("men");
    expect(shirt.setChoice).toBe("shirt");
    expect(shirt.offSiteStages).toEqual(expect.arrayContaining(["SEWING_CUTTING", "FINAL_SEWING"]));
    expect(belt.itemKind).toBe("accessory");
    expect(belt.audience).toBe("women");
    expect(belt.setChoice).toBe("belt");
    expect(res.body.items.filter((it) => it.parentItemId === belt._id)).toHaveLength(0);
    expect(kemis.barcodeValue).toMatch(/^ORD-\d+-1$/);
    expect(shirt.barcodeValue).toMatch(/^ORD-\d+-2$/);
    expect(belt.barcodeValue).toMatch(/^ORD-\d+-3$/);
  });

  it("stores kids boy/girl as kids size with an explicit audience", async () => {
    const res = await request(app)
      .post("/api/orders")
      .set(auth(token))
      .send({
        customerName: "Kids Mix",
        customerPhone: "5558881002",
        requiredCompletionDate: "2027-10-02",
        items: [
          {
            ...validItem,
            clothingCode: "SHIRT",
            clothingType: "Men's shirt",
            size: "kids",
            audience: "kids_boy",
            setChoice: "both",
            measurements: { gender: "kids", chest: "60" }
          },
          {
            ...validItem,
            clothingCode: "PANT",
            clothingType: "Men's trouser",
            size: "kids",
            audience: "kids_boy",
            setChoice: "both",
            measurements: { gender: "kids", waist: "50" }
          },
          {
            ...validItem,
            clothingCode: "NETELA",
            clothingType: "Netela",
            itemKind: "accessory",
            size: "kids",
            audience: "kids_girl",
            setChoice: "netela"
          }
        ]
      });
    expect(res.status).toBe(201);
    const top = res.body.items.filter((it) => it.itemKind !== "part");
    const boyShirt = top.find((it) => it.setChoice === "both" && /shirt/i.test(it.clothingType));
    const girlAcc = top.find((it) => it.clothingType === "Netela");
    expect(boyShirt.size).toBe("kids");
    expect(boyShirt.audience).toBe("kids_boy");
    expect(boyShirt.measurements.gender).toBe("kids");
    expect(girlAcc.audience).toBe("kids_girl");
    expect(girlAcc.itemKind).toBe("accessory");
    expect(girlAcc.size).toBe("kids");
  });

  it("resolves Men's shirt / Men's trouser labels to clothing type configs", async () => {
    const shirt = await findClothingTypeConfig(prisma, "Men's shirt", "SHIRT");
    const trouser = await findClothingTypeConfig(prisma, "Men's trouser", "PANTS");
    expect(shirt?.key).toBe("shirt");
    expect(trouser?.key).toBe("pants");
  });

  it("rejects unknown audience values", async () => {
    const res = await request(app)
      .post("/api/orders")
      .set(auth(token))
      .send({
        customerName: "Bad Audience",
        customerPhone: "5558881003",
        requiredCompletionDate: "2027-10-03",
        items: [{ ...validItem, audience: "toddler" }]
      });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/audience/i);
  });
});
