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
import { seedClothingTypes, seedOrderWithItem, createStaff } from "./fixtures.js";
import { prisma } from "../src/db/prisma.js";
import { stageAliases, skillStageVariants, stepStageNames } from "../src/constants/production.js";
import { findCheckpoint, skillStagesFor } from "../src/utils/productionModel.js";
import { nextExpectedStage } from "../src/utils/stageSequence.js";

const done = (stage, at = 1) => ({
  stage,
  checkedInAt: new Date(at),
  checkedOutAt: new Date(at + 1)
});

describe("stage rulebook (pure)", () => {
  it("folds legacy names into the atelier stage, and keeps legacy steps apart", () => {
    expect(stageAliases("SEWING_CUTTING")).toEqual(["SEWING_CUTTING", "CUTTING", "SEWING"]);
    expect(stageAliases("SEWING")).toEqual(["SEWING", "SEWING_CUTTING"]);
    expect(stageAliases("CUTTING")).toEqual(["CUTTING", "SEWING_CUTTING"]);
    expect(stageAliases("SHOWROOM")).toEqual(["SHOWROOM", "READY"]);
  });

  it("treats Final sewing as its own work: no sewing & cutting skill qualifies", () => {
    expect(skillStageVariants("FINAL_SEWING")).toEqual(["FINAL_SEWING"]);
    expect(skillStagesFor("FINAL_SEWING")).toEqual(["FINAL_SEWING"]);
  });

  it("uses one rule for skills, checkpoints and assignments", () => {
    for (const stage of ["SEWING_CUTTING", "CUTTING", "SEWING", "FINAL_SEWING", "SHOWROOM", "READY"]) {
      expect(skillStagesFor(stage)).toEqual(skillStageVariants(stage));
    }
  });

  it("does not let a legacy CUTTING checkpoint complete a separate SEWING step", () => {
    const legacyRoute = ["CUTTING", "SEWING", "FINISHING", "READY"];
    expect(nextExpectedStage([done("CUTTING")], legacyRoute)).toBe("SEWING");
    expect(stepStageNames("SEWING", legacyRoute)).toEqual(["SEWING", "SEWING_CUTTING"]);
  });

  it("counts a legacy CUTTING checkpoint as the atelier Sewing & cutting step", () => {
    const route = ["SEWING_CUTTING", "FINAL_SEWING", "FINISHING", "SHOWROOM"];
    expect(nextExpectedStage([done("CUTTING")], route)).toBe("FINAL_SEWING");
  });

  it("findCheckpoint prefers the open, then the latest attempt", () => {
    const first = done("FINISHING", 1);
    const redo = { stage: "FINISHING", checkedInAt: new Date(10), checkedOutAt: null };
    expect(findCheckpoint([first, redo], "FINISHING")).toBe(redo);
    const redoDone = done("FINISHING", 10);
    expect(findCheckpoint([first, redoDone], "FINISHING")).toBe(redoDone);
  });
});

describe("stage rulebook (API)", () => {
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

  it("checks out a garment opened under a legacy name instead of opening a second checkpoint", async () => {
    const { item, staff } = await seedOrderWithItem({ clothingType: "thobe" });
    await prisma.stageCheckpoint.create({
      data: {
        orderItemId: item._id,
        stage: "CUTTING",
        checkedInAt: new Date(),
        checkedInByStaffId: staff._id
      }
    });

    const res = await request(app)
      .post("/api/production/scan")
      .set(auth(token))
      .send({ barcodeValue: item.barcodeValue, stage: "SEWING_CUTTING", staffId: staff._id });

    expect(res.status).toBe(200);
    expect(res.body.action).toBe("check_out");
    const cps = await prisma.stageCheckpoint.findMany({ where: { orderItemId: item._id } });
    expect(cps).toHaveLength(1);
    expect(cps[0].checkedOutAt).not.toBeNull();
  });

  it("does not suggest or accept a Sewing & cutting worker for Final sewing", async () => {
    const { item } = await seedOrderWithItem({ clothingType: "thobe" });
    const prep = await createStaff({ name: "Prep Only", stages: ["SEWING_CUTTING", "SEWING"] });
    await createStaff({ name: "Final Sewer", stages: ["FINAL_SEWING"] });

    const suggest = await request(app)
      .get("/api/production/suggest-assignment")
      .query({ orderItemId: item._id, stage: "FINAL_SEWING" })
      .set(auth(token));
    expect(suggest.status).toBe(200);
    const names = suggest.body.rankings.map((r) => r.staff.name);
    expect(names).toContain("Final Sewer");
    expect(names).not.toContain("Prep Only");

    const assign = await request(app)
      .post("/api/production/assignments")
      .set(auth(token))
      .send({ staffId: prep._id || prep.id, orderItemId: item._id, stage: "FINAL_SEWING" });
    expect(assign.status).toBe(400);
  });

  it("lists legacy-skilled workers under the atelier workstation", async () => {
    await createStaff({ name: "Old Cutter", stages: ["CUTTING"] });
    const res = await request(app).get("/api/production/workstations").set(auth(token));
    expect(res.status).toBe(200);
    const stages = res.body.workstations.map((w) => w.stage);
    expect(stages).toEqual(["SEWING_CUTTING", "DESIGN", "EMBROIDERY", "FINAL_SEWING", "FINISHING"]);
    const prep = res.body.workstations.find((w) => w.stage === "SEWING_CUTTING");
    expect(prep.label).toBe("Sewing & cutting workstation");
    expect(prep.workers.map((w) => w.name)).toContain("Old Cutter");
  });
});
