import { describe, it, expect, beforeAll, afterAll, beforeEach } from "@jest/globals";
import request from "supertest";
import {
  connectTestDb,
  disconnectTestDb,
  clearDb,
  createTestApp,
  createUser,
  auth,
  prisma
} from "./helpers.js";
import { createStaff, seedOrderWithItem } from "./fixtures.js";
import { rankStaffForAssignment } from "../src/utils/assignmentScore.js";
import { buildScanDetails } from "../src/utils/scanDetails.js";

describe("Staff skills contract & legacy compatibility", () => {
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
    token = (await createUser({ email: "staff-skills@test.local", name: "Manager", role: "manager" })).token;
  });

  it("returns Sewing & cutting in the canonical form used by the staff UI", async () => {
    const staff = await createStaff({ name: "Skill Worker" });
    const res = await request(app)
      .patch(`/api/staff/${staff.id}`)
      .set(auth(token))
      .send({
        skills: [
          { stage: "SEWING_CUTTING", level: 4 },
          { stage: "EMBROIDERY", level: 5 },
          { stage: "FINISHING", level: 3 }
        ]
      });

    expect(res.status).toBe(200);
    expect(res.body.skillDetails).toEqual(expect.arrayContaining([
      { stage: "SEWING_CUTTING", level: 4 },
      { stage: "EMBROIDERY", level: 5 },
      { stage: "FINISHING", level: 3 }
    ]));
    expect(res.body.skills).toEqual(expect.arrayContaining(["SEWING_CUTTING", "EMBROIDERY", "FINISHING"]));
    const persisted = await prisma.staffSkill.findMany({ where: { staffId: staff.id } });
    expect(persisted.map((skill) => skill.stage)).toEqual(expect.arrayContaining([
      "SEWING_CUTTING", "EMBROIDERY", "FINISHING"
    ]));
  });

  it("canonicalizes legacy CUTTING and SEWING inputs and legacy stored rows", async () => {
    const staff = await createStaff({ name: "Legacy Worker" });
    await prisma.staffSkill.createMany({
      data: [
        { staffId: staff.id, stage: "CUTTING", level: 2 },
        { staffId: staff.id, stage: "SEWING", level: 4 }
      ]
    });

    const read = await request(app).get(`/api/staff/${staff.id}`).set(auth(token));
    expect(read.status).toBe(200);
    expect(read.body.skillDetails).toContainEqual({ stage: "SEWING_CUTTING", level: 4 });
    expect(read.body.skills).toContain("SEWING_CUTTING");
    expect(read.body.skills).not.toEqual(expect.arrayContaining(["CUTTING", "SEWING"]));

    const saved = await request(app)
      .patch(`/api/staff/${staff.id}`)
      .set(auth(token))
      .send({ skills: [{ stage: "CUTTING", level: 3 }, { stage: "SEWING", level: 5 }] });
    expect(saved.status).toBe(200);
    expect(saved.body.skillDetails).toEqual([{ stage: "SEWING_CUTTING", level: 5 }]);
    const persisted = await prisma.staffSkill.findMany({ where: { staffId: staff.id } });
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toMatchObject({ stage: "SEWING_CUTTING", level: 5 });
  });

  it("recognizes legacy CUTTING and SEWING records when filtering GET /api/staff?stage=SEWING_CUTTING", async () => {
    const cutter = await createStaff({ name: "Legacy Cutter", stages: [] });
    await prisma.staffSkill.create({ data: { staffId: cutter.id, stage: "CUTTING", level: 3 } });

    const tailor = await createStaff({ name: "Legacy Tailor", stages: [] });
    await prisma.staffSkill.create({ data: { staffId: tailor.id, stage: "SEWING", level: 4 } });

    const modern = await createStaff({ name: "Modern Worker", stages: ["SEWING_CUTTING"] });
    const embroiderer = await createStaff({ name: "Embroiderer Only", stages: ["EMBROIDERY"] });

    const res = await request(app)
      .get("/api/staff?stage=SEWING_CUTTING")
      .set(auth(token));

    expect(res.status).toBe(200);
    const returnedIds = res.body.map((s) => s._id);
    expect(returnedIds).toContain(cutter.id);
    expect(returnedIds).toContain(tailor.id);
    expect(returnedIds).toContain(modern.id);
    expect(returnedIds).not.toContain(embroiderer.id);

    // Legacy queries also find workers eligible for cutting
    const cuttingRes = await request(app)
      .get("/api/staff?stage=CUTTING")
      .set(auth(token));
    expect(cuttingRes.status).toBe(200);
    const cuttingIds = cuttingRes.body.map((s) => s._id);
    expect(cuttingIds).toContain(cutter.id);
    expect(cuttingIds).toContain(modern.id);
    expect(cuttingIds).not.toContain(tailor.id);
  });

  it("ranks staff with legacy CUTTING or SEWING skills for SEWING_CUTTING assignments and preserves highest level", async () => {
    const { item } = await seedOrderWithItem();

    const dualWorker = await createStaff({ name: "Dual Legacy Worker", stages: [] });
    await prisma.staffSkill.createMany({
      data: [
        { staffId: dualWorker.id, stage: "CUTTING", level: 2 },
        { staffId: dualWorker.id, stage: "SEWING", level: 5 }
      ]
    });

    const { rankings } = await rankStaffForAssignment(item.id, "SEWING_CUTTING");
    const found = rankings.find((r) => r.staff._id === dualWorker.id);
    expect(found).toBeDefined();
    // Highest level (5) should be retained, not overwritten by 2
    expect(found.staff.skillLevel).toBe(5);
  });

  it("deduplicates workstation workers when staff has multiple legacy aliases", async () => {
    const { item } = await seedOrderWithItem();
    const dualWorker = await createStaff({ name: "Dual Worker", stages: [] });
    await prisma.staffSkill.createMany({
      data: [
        { staffId: dualWorker.id, stage: "CUTTING", level: 3 },
        { staffId: dualWorker.id, stage: "SEWING", level: 4 }
      ]
    });

    const details = await buildScanDetails(item.id);
    const workers = details.production.workstation.workers;
    const workerOccurrences = workers.filter((w) => w._id === dualWorker.id);
    expect(workerOccurrences).toHaveLength(1);
  });

  it("rejects unknown skill stages without replacing existing skills", async () => {
    const staff = await createStaff({ name: "Safe Worker", stages: ["EMBROIDERY"] });
    const res = await request(app)
      .patch(`/api/staff/${staff.id}`)
      .set(auth(token))
      .send({ skills: [{ stage: "NOT_A_STAGE", level: 3 }] });

    expect(res.status).toBe(400);
    expect(res.body.rejectedStages).toEqual(["NOT_A_STAGE"]);
    const persisted = await prisma.staffSkill.findMany({ where: { staffId: staff.id } });
    expect(persisted.map((skill) => skill.stage)).toEqual(["EMBROIDERY"]);
  });
});
