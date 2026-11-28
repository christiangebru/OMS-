import { describe, it, expect, beforeAll, afterAll, beforeEach } from "@jest/globals";
import request from "supertest";
import { connectTestDb, disconnectTestDb, clearDb, createTestApp, createUser, auth } from "./helpers.js";
import { seedClothingTypes, createStaff } from "./fixtures.js";
import { prisma } from "../src/db/prisma.js";

const base = { fabricType: "Wool", color: "White", neckType: "oval", handType: "normal", size: "adult" };

describe("real production routes", () => {
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

  const createOrder = (items, extra = {}) =>
    request(app)
      .post("/api/orders")
      .set(auth(token))
      .send({ customerName: "Almaz", customerPhone: "0911000111", requiredCompletionDate: "2027-01-15", items, ...extra });
  const lookup = (code) =>
    request(app).get("/api/production/lookup").query({ barcodeValue: code }).set(auth(token));
  const scan = (barcodeValue, stage, staffId) =>
    request(app).post("/api/production/scan").set(auth(token)).send({ barcodeValue, stage, staffId });

  it("full-embroidery dress: embroidery is in-house by default", async () => {
    const res = await createOrder([{ ...base, clothingCode: "WOMENS_DRESS", clothingType: "Dress — full embroidery" }]);
    expect(res.status).toBe(201);
    const l = await lookup(res.body.items[0].labelBarcode || res.body.items[0].barcodeValue);
    expect(l.body.scanDetails.timing.stageSequence).toEqual([
      "SEWING_CUTTING",
      "EMBROIDERY",
      "FINAL_SEWING",
      "FINISHING",
      "SHOWROOM"
    ]);
    expect(l.body.scanDetails.production.offSiteStages).toEqual([]);
  });

  it("shirt: off-site cutting, in-house embroidery, off-site final sewing, in-house finishing", async () => {
    const res = await createOrder([{ ...base, clothingCode: "SHIRT", clothingType: "Shirt", setChoice: "shirt" }]);
    expect(res.status).toBe(201);
    const garment = res.body.items.find((i) => i.itemKind !== "part");
    const sent = await prisma.orderItem.findUnique({ where: { id: garment._id } });
    expect(sent.offSiteStages).toEqual(["SEWING_CUTTING", "FINAL_SEWING"]);
  });

  it("upper-body-only dress: wrist and upper body get embroidery, lower body skips it", async () => {
    const res = await createOrder(
      [{ ...base, clothingCode: "DRESS", clothingType: "Dress — upper body embroidery only", selectedPartCodes: ["WR", "UB", "LB"] }],
      { partLabelMode: "all" }
    );
    expect(res.status).toBe(201);
    const parts = res.body.items.filter((i) => i.itemKind === "part");
    expect(parts.map((p) => p.partCode).sort()).toEqual(["LB", "UB", "WR"]);
    const byCode = Object.fromEntries(parts.map((p) => [p.partCode, p]));

    const lb = await lookup(byCode.LB.labelBarcode);
    expect(lb.body.scanDetails.timing.stageSequence).not.toContain("EMBROIDERY");
    const ub = await lookup(byCode.UB.labelBarcode);
    expect(ub.body.scanDetails.timing.stageSequence).toContain("EMBROIDERY");

    // Assembly: parts on their own routes, then the dress goes into final sewing.
    const worker = await createStaff({ name: "All", stages: ["SEWING_CUTTING", "EMBROIDERY", "FINAL_SEWING"] });
    const wid = worker._id;
    const run = async (code, stages) => {
      for (const st of stages) {
        expect((await scan(code, st, wid)).status).toBe(200);
        expect((await scan(code, st, wid)).status).toBe(200);
      }
    };
    await run(byCode.WR.labelBarcode, ["SEWING_CUTTING", "EMBROIDERY"]);
    await run(byCode.UB.labelBarcode, ["SEWING_CUTTING", "EMBROIDERY"]);
    await run(byCode.LB.labelBarcode, ["SEWING_CUTTING"]);
    const dress = res.body.items.find((i) => i.itemKind !== "part");
    const tryAssemble = await scan(dress.labelBarcode || dress.barcodeValue, "FINAL_SEWING", wid);
    expect(tryAssemble.status).toBe(200);
    expect(tryAssemble.body.action).toBe("check_in");
    // Assembled: the dress continues from final sewing, it does not start over.
    expect((await scan(dress.labelBarcode || dress.barcodeValue, "FINAL_SEWING", wid)).status).toBe(200);
    const after = await lookup(dress.labelBarcode || dress.barcodeValue);
    expect(after.body.scanDetails.timing.nextExpectedStage).toBe("FINISHING");
  });

  describe("trouser made by an outside maker", () => {
    async function trouserOrder() {
      const res = await createOrder([
        {
          ...base,
          clothingCode: "PANTS",
          clothingType: "Trouser",
          setChoice: "trouser",
          measurements: { gender: "male", waist: "82", inseam: "104" }
        }
      ]);
      expect(res.status).toBe(201);
      return res.body;
    }

    it("can be ordered alone, keeps the trouser length, and is waiting to be sent", async () => {
      const order = await trouserOrder();
      const item = order.items[0];
      expect(item.measurements.inseam).toBe("104");
      expect(item.outsourced).toBe(true);
      expect(item.awaitingMaker).toBe(true);

      const list = await request(app).get("/api/off-site").set(auth(token));
      expect(list.status).toBe(200);
      expect(list.body.away).toHaveLength(0);
      expect(list.body.toSend).toHaveLength(1);
      const row = list.body.toSend[0];
      expect(row.code).toBe(`${order.orderId}-1`);
      expect(row.message).toContain(`${order.orderId}-1 · Almaz · Trouser`);
      expect(row.message).toContain("Waist 82");
      expect(row.message).toContain("Trouser length 104");
      expect(row.message).toContain(`Please write ${order.orderId}-1 on the garment.`);
    });

    it("send → away with the maker → back complete, order ready to pack", async () => {
      const order = await trouserOrder();
      const id = order.items[0]._id;

      const sent = await request(app)
        .post(`/api/off-site/items/${id}/send`)
        .set(auth(token))
        .send({ offSiteHandlerName: "Abebe", expectedReturnAt: "2027-01-10" });
      expect(sent.status).toBe(200);
      expect(sent.body.row.trip.handlerName).toBe("Abebe");

      const again = await request(app).post(`/api/off-site/items/${id}/send`).set(auth(token)).send({});
      expect(again.status).toBe(400);

      const list = await request(app).get("/api/off-site").set(auth(token));
      expect(list.body.toSend).toHaveLength(0);
      expect(list.body.away).toHaveLength(1);
      expect(list.body.away[0].trip.handlerName).toBe("Abebe");

      const back = await request(app).post(`/api/off-site/items/${id}/back`).set(auth(token)).send({});
      expect(back.status).toBe(200);
      expect(back.body.completed).toBe(true);
      expect(back.body.code).toBe(`${order.orderId}-1`);

      const reload = await request(app).get(`/api/orders/${order.orderId}`).set(auth(token));
      expect(reload.body.productionStatus).toBe("ready_to_pack");
      expect(reload.body.items[0].awaitingMaker).toBe(false);

      const notAway = await request(app).post(`/api/off-site/items/${id}/back`).set(auth(token)).send({});
      expect(notAway.status).toBe(400);
    });

    it("waits for the trouser before a shirt + trouser order can be packed", async () => {
      const res = await createOrder([
        { ...base, clothingCode: "SHIRT", clothingType: "Shirt", setChoice: "both" },
        { ...base, clothingCode: "PANTS", clothingType: "Trouser", setChoice: "both" }
      ]);
      expect(res.status).toBe(201);
      const trouser = res.body.items.find((i) => i.clothingType === "Trouser");
      expect(trouser.awaitingMaker).toBe(true);
      const shirt = res.body.items.find((i) => i.clothingType === "Shirt");
      expect(shirt.outsourced).toBe(false);
    });
  });

  describe("netela and fringe twisting (kuchet)", () => {
    const netela = (code, label) => ({ ...base, clothingCode: code, clothingType: label, setChoice: "netela" });

    it("embroidered netela: embroidery and finishing in-house, then fringe twisting off-site", async () => {
      const res = await createOrder([netela("NETELA", "Netela — embroidered")]);
      expect(res.status).toBe(201);
      const item = res.body.items[0];
      expect(item.outsourced).toBe(false);
      const l = await lookup(item.labelBarcode || item.barcodeValue);
      expect(l.body.scanDetails.timing.stageSequence).toEqual(["EMBROIDERY", "FINISHING", "FRINGE_TWISTING", "SHOWROOM"]);

      const worker = await createStaff({ name: "Emb", stages: ["EMBROIDERY", "FINISHING"] });
      for (const st of ["EMBROIDERY", "FINISHING"]) {
        expect((await scan(item.labelBarcode, st, worker._id)).status).toBe(200);
        expect((await scan(item.labelBarcode, st, worker._id)).status).toBe(200);
      }
      // Fringe twisting can't be moved in-shop.
      const after = await lookup(item.labelBarcode);
      expect(after.body.scanDetails.timing.nextExpectedStage).toBe("OFF_SITE");
      expect(after.body.scanDetails.production.offSiteOptions.plannedStages).toEqual([]);
      const keep = await request(app)
        .post(`/api/production/items/${item._id}/off-site-route`)
        .set(auth(token))
        .send({ stage: "FRINGE_TWISTING", offSite: false });
      expect(keep.status).toBe(400);

      const list = await request(app).get("/api/off-site").set(auth(token));
      expect(list.body.toSend).toHaveLength(1);
      expect(list.body.toSend[0].offSiteFor).toEqual(["FRINGE_TWISTING"]);
      expect(list.body.toSend[0].message).toContain("Work: Fringe twisting (kuchet)");
      expect(list.body.toSend[0].message).not.toContain("Sizes");

      const id = item._id;
      expect((await request(app).post(`/api/off-site/items/${id}/send`).set(auth(token)).send({ offSiteHandlerName: "Tsehay" })).status).toBe(200);
      const back = await request(app).post(`/api/off-site/items/${id}/back`).set(auth(token)).send({});
      expect(back.body.completed).toBe(true);
    });

    it("tilet netela without embroidery only goes out for fringe twisting", async () => {
      const res = await createOrder([netela("NETELA_TILET", "Netela — tilet, no embroidery")]);
      expect(res.status).toBe(201);
      const item = res.body.items[0];
      expect(item.outsourced).toBe(true);
      expect(item.awaitingMaker).toBe(true);
      const list = await request(app).get("/api/off-site").set(auth(token));
      expect(list.body.toSend[0].message).toContain("Work: Fringe twisting (kuchet)");
    });

    it("tilet with embroidery follows the embroidered route", async () => {
      const res = await createOrder([netela("NETELA_TILET_EMBROIDERED", "Netela — tilet with embroidery")]);
      expect(res.status).toBe(201);
      const l = await lookup(res.body.items[0].labelBarcode);
      expect(l.body.scanDetails.timing.stageSequence).toEqual(["EMBROIDERY", "FINISHING", "FRINGE_TWISTING", "SHOWROOM"]);
    });
  });

  describe("production board", () => {
    const queue = async () => (await request(app).get("/api/production/queue?lite=1").set(auth(token))).body;

    it("a garment made as parts waits for them, then appears at final sewing", async () => {
      const res = await createOrder(
        [{ ...base, clothingCode: "DRESS", clothingType: "Dress — upper body embroidery only", selectedPartCodes: ["WR", "UB", "LB"] }],
        { partLabelMode: "all" }
      );
      const dress = res.body.items.find((i) => i.itemKind !== "part");
      const parts = res.body.items.filter((i) => i.itemKind === "part");
      let q = await queue();
      let row = q.items.find((r) => r.itemId === dress._id);
      expect(row.boardStatus).toBe("waiting_parts");
      expect(row.parts).toMatchObject({ total: 3, ready: 0 });
      expect(q.summary.itemsWaiting).toBe(3); // the parts, not the dress
      expect(q.summary.itemsWaitingForParts).toBe(1);

      const worker = await createStaff({ name: "All", stages: ["SEWING_CUTTING", "EMBROIDERY", "FINAL_SEWING"] });
      for (const p of parts) {
        const stages = p.partCode === "LB" ? ["SEWING_CUTTING"] : ["SEWING_CUTTING", "EMBROIDERY"];
        for (const st of stages) {
          await scan(p.labelBarcode, st, worker._id);
          await scan(p.labelBarcode, st, worker._id);
        }
      }
      q = await queue();
      row = q.items.find((r) => r.itemId === dress._id);
      expect(row.boardStatus).toBe("waiting");
      expect(row.nextStage).toBe("FINAL_SEWING");
      expect(q.items.filter((r) => r.parentItemId === dress._id).every((r) => r.boardStatus === "ready_for_assembly")).toBe(true);
      expect(q.byStage.FINAL_SEWING.items.map((r) => r.itemId)).toEqual([dress._id]);
    });

    it("a garment whose next step is off-site is 'to send', not unassigned", async () => {
      await createOrder([{ ...base, clothingCode: "NETELA_TILET", clothingType: "Netela — tilet, no embroidery", setChoice: "netela" }]);
      const q = await queue();
      expect(q.items[0].boardStatus).toBe("to_send");
      expect(q.summary.itemsToSend).toBe(1);
      expect(q.summary.itemsWaiting).toBe(0);
    });
  });
});
