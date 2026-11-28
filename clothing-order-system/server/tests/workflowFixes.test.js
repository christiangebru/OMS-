import { describe, it, expect, beforeAll, afterAll, beforeEach } from "@jest/globals";
import request from "supertest";
import express from "express";
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
import { compareSchema } from "../src/utils/schemaCheck.js";
import { readinessHandler } from "../src/routes/health.js";
import authRoutes from "../src/routes/auth.js";

const scan = (app, token, body) =>
  request(app).post("/api/production/scan").set(auth(token)).send(body);

describe("workflow fixes", () => {
  let app;
  let token;
  let adminToken;
  let admin;

  beforeAll(async () => {
    await connectTestDb();
    app = createTestApp();
    app.use("/api/auth", authRoutes);
  });

  afterAll(async () => {
    await disconnectTestDb();
  });

  beforeEach(async () => {
    await clearDb();
    await seedClothingTypes();
    token = (await createUser({ email: "m@test.local", name: "Manager", role: "manager" })).token;
    const a = await createUser({ email: "owner@test.local", name: "Owner", role: "admin" });
    adminToken = a.token;
    admin = a.user;
  });

  describe("off-site trips", () => {
    it("sends the next stage off-site with a free-text handler, without tying up a worker", async () => {
      const { item, staff } = await seedOrderWithItem({ clothingType: "thobe" });
      const sent = await scan(app, token, {
        barcodeValue: item.barcodeValue,
        stage: "OFF_SITE",
        offSiteFor: "SEWING_CUTTING",
        offSiteHandlerName: "Abebe (outside tailor)",
        offSiteHandlerPhone: "0911223344",
        expectedReturnAt: "2030-01-15"
      });
      expect(sent.status).toBe(200);
      expect(sent.body.message).toBe("Sent off-site");
      const trip = sent.body.scanDetails.production.offSiteTrip;
      expect(trip.handlerName).toBe("Abebe (outside tailor)");
      expect(trip.handlerPhone).toBe("0911223344");
      expect(sent.body.scanDetails.production.location).toContain("with Abebe (outside tailor)");

      const cp = await prisma.stageCheckpoint.findFirst({ where: { orderItemId: item._id, stage: "OFF_SITE" } });
      expect(cp.checkedInByStaffId).toBeNull();
      const fresh = await prisma.orderItem.findUnique({ where: { id: item._id } });
      expect(fresh.offSiteRouteCustom).toBe(true);
      expect(fresh.offSiteStages).toContain("SEWING_CUTTING");

      // The registered worker is free to start something else meanwhile.
      const { item: other } = await seedOrderWithItem({ clothingType: "thobe" });
      const busy = await scan(app, token, { barcodeValue: other.barcodeValue, stage: "SEWING_CUTTING", staffId: staff._id });
      expect(busy.status).toBe(200);

      // Comes back: no worker needed, route continues at Final sewing.
      const back = await scan(app, token, { barcodeValue: item.barcodeValue, stage: "OFF_SITE" });
      expect(back.status).toBe(200);
      expect(back.body.message).toBe("Back from off-site");
      expect(back.body.scanDetails.timing.nextExpectedStage).toBe("FINAL_SEWING");
    });

    it("treats a second off-site stage right after a finished trip as a new trip", async () => {
      const { item } = await seedOrderWithItem({ clothingType: "thobe" });
      const bc = item.barcodeValue;
      expect((await scan(app, token, { barcodeValue: bc, stage: "OFF_SITE", offSiteFor: "SEWING_CUTTING" })).status).toBe(200);
      expect((await scan(app, token, { barcodeValue: bc, stage: "OFF_SITE" })).status).toBe(200);

      // Final sewing sits right after Sewing & cutting; it must not merge into the finished trip.
      const second = await scan(app, token, {
        barcodeValue: bc,
        stage: "OFF_SITE",
        offSiteFor: "FINAL_SEWING",
        offSiteHandlerName: "Second vendor"
      });
      expect(second.status).toBe(200);
      expect(second.body.scanDetails.production.offSiteTrip.coveredStages).toEqual(["FINAL_SEWING"]);

      const back = await scan(app, token, { barcodeValue: bc, stage: "OFF_SITE" });
      expect(back.status).toBe(200);
      expect(back.body.scanDetails.timing.nextExpectedStage).toBe("FINISHING");
      const trips = await prisma.stageCheckpoint.findMany({
        where: { orderItemId: item._id, stage: "OFF_SITE" },
        orderBy: { checkedInAt: "asc" }
      });
      expect(trips.map((t) => t.coveredStages)).toEqual([["SEWING_CUTTING"], ["FINAL_SEWING"]]);
    });

    it("still sends adjacent planned off-site stages as one trip (trousers)", async () => {
      const { item } = await seedOrderWithItem({ clothingType: "pants" });
      const sent = await scan(app, token, { barcodeValue: item.barcodeValue, stage: "OFF_SITE" });
      expect(sent.status).toBe(200);
      expect(sent.body.scanDetails.production.offSiteTrip.coveredStages).toEqual([
        "SEWING_CUTTING",
        "FINAL_SEWING",
        "FINISHING"
      ]);
      const back = await scan(app, token, { barcodeValue: item.barcodeValue, stage: "OFF_SITE" });
      expect(back.body.scanDetails.timing.nextExpectedStage).toBe("SHOWROOM");
    });

    it("only lets the next stage be sent off-site", async () => {
      const { item } = await seedOrderWithItem({ clothingType: "thobe" });
      const res = await scan(app, token, {
        barcodeValue: item.barcodeValue,
        stage: "OFF_SITE",
        offSiteFor: "FINISHING"
      });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/Only the next stage/);
    });

    it("keeps a planned off-site stage in the shop for one garment", async () => {
      const { item } = await seedOrderWithItem({ clothingType: "shirt" });
      const lookup = await request(app)
        .get("/api/production/lookup")
        .query({ barcodeValue: item.barcodeValue })
        .set(auth(token));
      expect(lookup.body.scanDetails.timing.nextExpectedStage).toBe("OFF_SITE");
      expect(lookup.body.scanDetails.production.offSiteOptions.plannedStages).toEqual(["SEWING_CUTTING"]);

      const keep = await request(app)
        .post(`/api/production/items/${item._id}/off-site-route`)
        .set(auth(token))
        .send({ stage: "SEWING_CUTTING", offSite: false });
      expect(keep.status).toBe(200);
      expect(keep.body.scanDetails.timing.nextExpectedStage).toBe("SEWING_CUTTING");
      const fresh = await prisma.orderItem.findUnique({ where: { id: item._id } });
      expect(fresh.offSiteStages).not.toContain("SEWING_CUTTING");
      expect(fresh.offSiteRouteCustom).toBe(true);
    });

    it("an empty custom route means all in shop, not the clothing type default", async () => {
      const { item } = await seedOrderWithItem({ clothingType: "shirt" });
      await prisma.orderItem.update({
        where: { id: item._id },
        data: { offSiteStages: [], offSiteRouteCustom: true }
      });
      const lookup = await request(app)
        .get("/api/production/lookup")
        .query({ barcodeValue: item.barcodeValue })
        .set(auth(token));
      expect(lookup.body.scanDetails.timing.nextExpectedStage).toBe("SEWING_CUTTING");
    });

    it("rejects route changes for steps already done", async () => {
      const { item, staff } = await seedOrderWithItem({ clothingType: "thobe" });
      await scan(app, token, { barcodeValue: item.barcodeValue, stage: "SEWING_CUTTING", staffId: staff._id });
      await scan(app, token, { barcodeValue: item.barcodeValue, stage: "SEWING_CUTTING", staffId: staff._id });
      const res = await request(app)
        .post(`/api/production/items/${item._id}/off-site-route`)
        .set(auth(token))
        .send({ stage: "SEWING_CUTTING", offSite: true });
      expect(res.status).toBe(400);
    });
  });

  describe("staff only where a workstation needs one", () => {
    it("still requires a worker for workstation stages", async () => {
      const { item } = await seedOrderWithItem({ clothingType: "thobe" });
      const res = await scan(app, token, { barcodeValue: item.barcodeValue, stage: "SEWING_CUTTING" });
      expect(res.status).toBe(400);
    });

    it("moves a finished garment to the showroom without a showroom skill", async () => {
      const { item, staff } = await seedOrderWithItem({ clothingType: "belt" });
      for (const stage of ["SEWING_CUTTING", "FINISHING"]) {
        expect((await scan(app, token, { barcodeValue: item.barcodeValue, stage, staffId: staff._id })).status).toBe(200);
        expect((await scan(app, token, { barcodeValue: item.barcodeValue, stage, staffId: staff._id })).status).toBe(200);
      }
      const show = await scan(app, token, { barcodeValue: item.barcodeValue, stage: "SHOWROOM" });
      expect(show.status).toBe(200);
      expect(show.body.action).toBe("check_in");
    });

    it("drops non-workstation stages from saved skills instead of storing them", async () => {
      const created = await request(app)
        .post("/api/staff")
        .set(auth(token))
        .send({ name: "Ayele", phone: "0911555000", role: "TAILOR", skills: ["FINISHING", "SHOWROOM", "OFF_SITE"] });
      expect(created.status).toBe(201);
      expect(created.body.skills).toEqual(["FINISHING"]);
    });
  });

  describe("reassignment is not completion", () => {
    it("marks the replaced assignment reassigned and keeps it out of completed counts", async () => {
      const { item } = await seedOrderWithItem({ clothingType: "thobe" });
      const first = await createStaff({ name: "First", stages: ["SEWING_CUTTING"] });
      const second = await createStaff({ name: "Second", stages: ["SEWING_CUTTING"] });
      for (const s of [first, second]) {
        const r = await request(app)
          .post("/api/production/assignments")
          .set(auth(token))
          .send({ staffId: s._id, orderItemId: item._id, stage: "SEWING_CUTTING" });
        expect(r.status).toBe(201);
      }
      const old = await prisma.staffAssignment.findFirst({ where: { staffId: first._id } });
      expect(old.completedAt).not.toBeNull();
      expect(old.reassignedAt).not.toBeNull();

      const workload = await request(app).get(`/api/staff/${first._id}/workload`).set(auth(token));
      expect(workload.status).toBe(200);
      expect(JSON.stringify(workload.body)).toMatch(/"completedCount":0|"completedAssignmentCount":0/);
      const board = await request(app).get("/api/staff").set(auth(token));
      const row = board.body.find((s) => s._id === first._id);
      expect(row.completedAssignmentCount).toBe(0);
    });
  });

  describe("logins managed by owners", () => {
    it("lets an owner add a reception login that can then sign in", async () => {
      const add = await request(app)
        .post("/api/users")
        .set(auth(adminToken))
        .send({ email: "Desk@Test.local", name: "Front desk", role: "reception", password: "desk-pass-1" });
      expect(add.status).toBe(201);
      expect(add.body.passwordHash).toBeUndefined();
      expect(add.body.email).toBe("desk@test.local");

      const login = await request(app)
        .post("/api/auth/login")
        .send({ email: "desk@test.local", password: "desk-pass-1" });
      expect(login.status).toBe(200);
      expect(login.body.user.role).toBe("reception");
    });

    it("refuses worker roles and duplicate emails", async () => {
      const worker = await request(app)
        .post("/api/users")
        .set(auth(adminToken))
        .send({ email: "t@test.local", name: "T", role: "tailor", password: "12345678" });
      expect(worker.status).toBe(400);
      const dup = await request(app)
        .post("/api/users")
        .set(auth(adminToken))
        .send({ email: "m@test.local", name: "M", role: "manager", password: "12345678" });
      expect(dup.status).toBe(409);
    });

    it("is owner-only", async () => {
      const res = await request(app).get("/api/users").set(auth(token));
      expect(res.status).toBe(403);
    });

    it("switching a login off blocks sign-in and existing sessions", async () => {
      const list = await request(app).get("/api/users").set(auth(adminToken));
      const manager = list.body.find((u) => u.email === "m@test.local");
      const off = await request(app)
        .patch(`/api/users/${manager._id}`)
        .set(auth(adminToken))
        .send({ active: false });
      expect(off.status).toBe(200);
      expect((await request(app).get("/api/production/queue").set(auth(token))).status).toBe(401);
      const login = await request(app).post("/api/auth/login").send({ email: "m@test.local", password: "password123" });
      expect(login.status).toBe(401);
    });

    it("never removes the last owner, or your own owner access", async () => {
      const self = await request(app)
        .patch(`/api/users/${admin.id}`)
        .set(auth(adminToken))
        .send({ role: "manager" });
      expect(self.status).toBe(400);
    });

    it("resets a password", async () => {
      const list = await request(app).get("/api/users").set(auth(adminToken));
      const manager = list.body.find((u) => u.email === "m@test.local");
      const res = await request(app)
        .patch(`/api/users/${manager._id}`)
        .set(auth(adminToken))
        .send({ password: "brand-new-pass" });
      expect(res.status).toBe(200);
      const login = await request(app).post("/api/auth/login").send({ email: "m@test.local", password: "brand-new-pass" });
      expect(login.status).toBe(200);
    });
  });

  describe("/ready checks the schema", () => {
    it("reports missing columns and unapplied migrations", () => {
      const result = compareSchema({
        expected: { orders: ["id", "notes"] },
        actualRows: [{ table_name: "orders", column_name: "id" }],
        localMigrations: ["a_init", "b_notes"],
        appliedRows: [{ migration_name: "a_init", finished_at: new Date(), rolled_back_at: null }]
      });
      expect(result.ok).toBe(false);
      expect(result.missingColumns).toEqual(["orders.notes"]);
      expect(result.pendingMigrations).toEqual(["b_notes"]);
    });

    it("flags a migration that started but never finished", () => {
      const result = compareSchema({
        expected: {},
        actualRows: [],
        localMigrations: ["a_init"],
        appliedRows: [{ migration_name: "a_init", finished_at: null, rolled_back_at: null }]
      });
      expect(result.failedMigrations).toEqual(["a_init"]);
      expect(result.ok).toBe(false);
    });

    it("returns 503 when the schema does not match, 200 when it does", async () => {
      const bad = express().get(
        "/ready",
        readinessHandler(async () => true, async () => ({ ok: false, missingColumns: ["orders.notes"] }))
      );
      const r1 = await request(bad).get("/ready");
      expect(r1.status).toBe(503);
      expect(r1.body.schema.missingColumns).toEqual(["orders.notes"]);

      const real = express().get("/ready", readinessHandler());
      const r2 = await request(real).get("/ready");
      expect(r2.status).toBe(200);
      expect(r2.body.schema.ok).toBe(true);
    });
  });
});
