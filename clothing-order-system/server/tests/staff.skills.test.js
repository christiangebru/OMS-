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

  it("persists atelier skill names and canonicalizes legacy aliases", async () => {
    const staff = await createStaff({ name: "Skill Worker" });
    const res = await request(app)
      .patch(`/api/staff/${staff.id}`)
      .set(auth(token))
      .send({
        skills: [
          { stage: "SEWING_CUTTING", level: 4 },
          { stage: "FINAL_SEWING", level: 5 },
          { stage: "OFF_SITE", level: 3 },
          { stage: "READY", level: 2 }
        ]
      });

    expect(res.status).toBe(200);
    expect(res.body.skillDetails).toEqual(expect.arrayContaining([
      { stage: "SEWING_CUTTING", level: 4 },
      { stage: "FINAL_SEWING", level: 5 },
      { stage: "OFF_SITE", level: 3 },
      { stage: "SHOWROOM", level: 2 }
    ]));
    const persisted = await prisma.staffSkill.findMany({ where: { staffId: staff.id } });
    expect(persisted.map((skill) => skill.stage)).toEqual(expect.arrayContaining([
      "SEWING_CUTTING", "FINAL_SEWING", "OFF_SITE", "SHOWROOM"
    ]));
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
