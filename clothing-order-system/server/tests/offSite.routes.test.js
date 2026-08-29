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

async function scan(app, token, barcode, stage, staffId) {
  return request(app)
    .post("/api/production/scan")
    .set(auth(token))
    .send({ barcodeValue: barcode, stage, staffId });
}

describe("off-site as a first-class scan location", () => {
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
    const manager = await createUser({
      email: "offsite@test.local",
      name: "Manager",
      role: "manager"
    });
    token = manager.token;
  });

  it("embroidery route: in-shop cutting → off-site → return at final sewing", async () => {
    const { item, staff } = await seedOrderWithItem({ clothingType: "thobe_embroidered" });
    const id = String(staff._id);
    const bc = item.barcodeValue;

    expect((await scan(app, token, bc, "SEWING_CUTTING", id)).status).toBe(200);
    expect((await scan(app, token, bc, "SEWING_CUTTING", id)).status).toBe(200);

    const shopEmbroidery = await scan(app, token, bc, "EMBROIDERY", id);
    expect(shopEmbroidery.status).toBe(400);
    expect(shopEmbroidery.body.message).toMatch(/off-site/i);

    const out = await scan(app, token, bc, "OFF_SITE", id);
    expect(out.status).toBe(200);
    expect(out.body.action).toBe("check_in");
    expect(out.body.message).toMatch(/off-site/i);
    expect(out.body.scanDetails.production.offSite).toBe(true);
    expect(out.body.scanDetails.production.location).toMatch(/off-site/i);
    expect(out.body.scanDetails.timing.currentStage).toBe("OFF_SITE");

    const back = await scan(app, token, bc, "OFF_SITE", id);
    expect(back.status).toBe(200);
    expect(back.body.action).toBe("check_out");
    expect(back.body.scanDetails.production.offSite).toBe(false);
    expect(back.body.scanDetails.timing.nextExpectedStage).toBe("FINAL_SEWING");

    const finSew = await scan(app, token, bc, "FINAL_SEWING", id);
    expect(finSew.status).toBe(200);
  });

  it("male shirt: off-site cut/prepare → embroidery in shop → off-site finish → return at finishing", async () => {
    const { item, staff } = await seedOrderWithItem({ clothingType: "shirt" });
    const id = String(staff._id);
    const bc = item.barcodeValue;

    const cutInShop = await scan(app, token, bc, "SEWING_CUTTING", id);
    expect(cutInShop.status).toBe(400);
    expect(cutInShop.body.message).toMatch(/off-site/i);

    expect((await scan(app, token, bc, "OFF_SITE", id)).status).toBe(200);
    expect((await scan(app, token, bc, "OFF_SITE", id)).status).toBe(200);

    const emb = await scan(app, token, bc, "EMBROIDERY", id);
    expect(emb.status).toBe(200);
    expect((await scan(app, token, bc, "EMBROIDERY", id)).status).toBe(200);

    expect((await scan(app, token, bc, "OFF_SITE", id)).status).toBe(200);
    const loc = await request(app)
      .get(`/api/production/lookup?barcodeValue=${encodeURIComponent(bc)}`)
      .set(auth(token));
    expect(loc.body.scanDetails.production.offSite).toBe(true);
    expect(loc.body.scanDetails.production.location).toMatch(/off-site/i);

    expect((await scan(app, token, bc, "OFF_SITE", id)).status).toBe(200);
    const after = await request(app)
      .get(`/api/production/lookup?barcodeValue=${encodeURIComponent(bc)}`)
      .set(auth(token));
    expect(after.body.scanDetails.timing.nextExpectedStage).toBe("FINISHING");
    expect(after.body.scanDetails.production.offSite).toBe(false);

    expect((await scan(app, token, bc, "FINISHING", id)).status).toBe(200);
  });

  it("trouser: one off-site sewing trip, then in-shop stages with no second send-out", async () => {
    const { item, staff } = await seedOrderWithItem({ clothingType: "pants" });
    const id = String(staff._id);
    const bc = item.barcodeValue;

    expect((await scan(app, token, bc, "OFF_SITE", id)).status).toBe(200);
    expect((await scan(app, token, bc, "OFF_SITE", id)).status).toBe(200);

    const lookup = await request(app)
      .get(`/api/production/lookup?barcodeValue=${encodeURIComponent(bc)}`)
      .set(auth(token));
    expect(lookup.body.scanDetails.timing.nextExpectedStage).toBe("FINISHING");

    expect((await scan(app, token, bc, "FINISHING", id)).status).toBe(200);
    expect((await scan(app, token, bc, "FINISHING", id)).status).toBe(200);

    const again = await scan(app, token, bc, "OFF_SITE", id);
    expect(again.status).toBe(400);
  });

  it("manager can still assign while a garment is off-site", async () => {
    const { item, staff } = await seedOrderWithItem({ clothingType: "thobe_embroidered" });
    const id = String(staff._id);
    await scan(app, token, item.barcodeValue, "SEWING_CUTTING", id);
    await scan(app, token, item.barcodeValue, "SEWING_CUTTING", id);
    await scan(app, token, item.barcodeValue, "OFF_SITE", id);

    const asg = await request(app)
      .post("/api/production/assignments")
      .set(auth(token))
      .send({ staffId: id, orderItemId: item._id, stage: "FINAL_SEWING" });
    expect(asg.status).toBe(201);
  });
});
