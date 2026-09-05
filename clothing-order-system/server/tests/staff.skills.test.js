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
import { createStaff } from "./fixtures.js";

describe("PATCH /api/staff/:id skills", () => {
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
