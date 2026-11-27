import { describe, it, expect, beforeAll, afterAll, beforeEach } from "@jest/globals";
import request from "supertest";
import { connectTestDb, disconnectTestDb, clearDb, createTestApp, createUser, auth } from "./helpers.js";
import { seedClothingTypes } from "./fixtures.js";
import { prisma } from "../src/db/prisma.js";

const item = (over = {}) => ({
  clothingCode: "WOMENS_DRESS",
  clothingType: "Dress (embroidered)",
  fabricType: "Menen (cotton)",
  color: "White",
  innerFabricColor: "Beige",
  quantity: 1,
  neckType: "oval",
  handType: "normal",
  size: "adult",
  unitPrice: 2500,
  ...over
});

describe("order entry", () => {
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
    token = (await createUser({ email: "r@test.local", name: "Desk", role: "reception" })).token;
  });

  const create = (items) =>
    request(app)
      .post("/api/orders")
      .set(auth(token))
      .send({ customerName: "Almaz", customerPhone: "0911777666", requiredCompletionDate: "2027-01-15", items });

  it("saves and returns the inner fabric (Geber) colour", async () => {
    const res = await create([item()]);
    expect(res.status).toBe(201);
    expect(res.body.items[0].innerFabricColor).toBe("Beige");
    const lookup = await request(app)
      .get("/api/production/lookup")
      .query({ barcodeValue: res.body.items[0].barcodeValue })
      .set(auth(token));
    expect(lookup.body.scanDetails.item.innerFabricColor).toBe("Beige");
  });

  it("uses common type names and hides retired types", async () => {
    const types = await prisma.clothingTypeConfig.findMany();
    const byKey = Object.fromEntries(types.map((t) => [t.key, t]));
    expect(byKey.dress.label).toBe("Dress");
    expect(byKey.womens_dress.label).toBe("Dress (embroidered)");
    expect(byKey.shirt.label).toBe("Shirt");
    expect(byKey.pants.label).toBe("Trouser");
    for (const k of ["abaya", "abaya_embroidered", "thobe", "thobe_embroidered", "kids_garment"]) {
      expect(byKey[k].active).toBe(false);
    }
  });

  it("keeps old garments on their route after the type is renamed (matched by code)", async () => {
    // Saved before the rename as "Men's shirt"; the type is now labelled "Shirt".
    const res = await create([item({ clothingCode: "SHIRT", clothingType: "Men's shirt", innerFabricColor: "" })]);
    expect(res.status).toBe(201);
    const lookup = await request(app)
      .get("/api/production/lookup")
      .query({ barcodeValue: res.body.items[0].barcodeValue })
      .set(auth(token));
    // Shirt route (with embroidery and its planned off-site trip), not the fallback route.
    expect(lookup.body.scanDetails.timing.stageSequence).toContain("EMBROIDERY");
    expect(lookup.body.scanDetails.timing.nextExpectedStage).toBe("OFF_SITE");
  });
});
