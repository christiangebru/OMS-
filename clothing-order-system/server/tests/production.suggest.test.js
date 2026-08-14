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

describe("GET /api/production/suggest-assignment", () => {
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
    const u = await createUser({
      email: "mgr@suggest.test",
      name: "Manager",
      role: "manager"
    });
    token = u.token;
  });

  it("never includes OFF_DUTY staff", async () => {
    const { item } = await seedOrderWithItem({ clothingType: "thobe" });
    await createStaff({
      name: "Off Duty Pro",
      skillLevel: 5,
      status: "OFF_DUTY",
      stages: ["CUTTING"]
    });
    await createStaff({
      name: "Available Pro",
      skillLevel: 3,
      status: "AVAILABLE",
      stages: ["CUTTING"]
    });

    const res = await request(app)
      .get("/api/production/suggest-assignment")
      .query({ orderItemId: String(item._id), stage: "CUTTING" })
      .set(auth(token));

    expect(res.status).toBe(200);
    const names = res.body.rankings.map((r) => r.staff.name);
    expect(names).not.toContain("Off Duty Pro");
    expect(names).toContain("Available Pro");
  });

  it("never includes staff without matching StaffSkill for the stage", async () => {
    const { item } = await seedOrderWithItem({ clothingType: "thobe" });
    await createStaff({
      name: "Cutter Only",
      skillLevel: 5,
      status: "AVAILABLE",
      stages: ["CUTTING"]
    });
    await createStaff({
      name: "Sewer Only",
      skillLevel: 5,
      status: "AVAILABLE",
      stages: ["SEWING"]
    });

    const res = await request(app)
      .get("/api/production/suggest-assignment")
      .query({ orderItemId: String(item._id), stage: "SEWING" })
      .set(auth(token));

    expect(res.status).toBe(200);
    const names = res.body.rankings.map((r) => r.staff.name);
    expect(names).toContain("Sewer Only");
    expect(names).not.toContain("Cutter Only");
  });

  it("higher skillLevel ranks above lower when closer to difficulty (difficulty=5)", async () => {
    // skillMatch = 1 - |difficulty - skill| / 4
    // difficulty 5: skill 5 → 1.0, skill 2 → 0.25 — higher skill ranks higher
    const { item } = await seedOrderWithItem({
      clothingType: "thobe",
      difficultyLevel: 5,
      daysUntilDue: 7,
      priority: "NORMAL"
    });
    const high = await createStaff({
      name: "High Skill",
      skillLevel: 5,
      status: "AVAILABLE",
      stages: ["CUTTING"]
    });
    const low = await createStaff({
      name: "Low Skill",
      skillLevel: 2,
      status: "AVAILABLE",
      stages: ["CUTTING"]
    });

    const res = await request(app)
      .get("/api/production/suggest-assignment")
      .query({ orderItemId: String(item._id), stage: "CUTTING" })
      .set(auth(token));

    expect(res.status).toBe(200);
    // Filter to only our two staff (seed also creates Floor Worker with cutting skill)
    const ours = res.body.rankings.filter((r) =>
      ["High Skill", "Low Skill"].includes(r.staff.name)
    );
    expect(ours.length).toBe(2);
    expect(ours[0].staff.name).toBe("High Skill");
    expect(ours[0].scores.skillMatchScore).toBeGreaterThan(ours[1].scores.skillMatchScore);
    expect(ours[0].scores.rankedScore).toBeGreaterThan(ours[1].scores.rankedScore);
    expect(String(ours[0].staff._id)).toBe(String(high._id));
    expect(String(ours[1].staff._id)).toBe(String(low._id));
  });

  it("active StaffAssignment lowers availabilityScore / rank", async () => {
    const { item } = await seedOrderWithItem({
      clothingType: "thobe",
      difficultyLevel: 3,
      daysUntilDue: 7,
      priority: "NORMAL"
    });
    const busy = await createStaff({
      name: "Will Be Busy",
      skillLevel: 3,
      status: "AVAILABLE",
      stages: ["CUTTING"]
    });
    const free = await createStaff({
      name: "Stays Free",
      skillLevel: 3,
      status: "AVAILABLE",
      stages: ["CUTTING"]
    });

    const before = await request(app)
      .get("/api/production/suggest-assignment")
      .query({ orderItemId: String(item._id), stage: "CUTTING" })
      .set(auth(token));

    const beforeBusy = before.body.rankings.find((r) => r.staff.name === "Will Be Busy");
    const beforeFree = before.body.rankings.find((r) => r.staff.name === "Stays Free");
    expect(beforeBusy.scores.availabilityScore).toBe(beforeFree.scores.availabilityScore);

    await prisma.staffAssignment.create({
      data: {
        staffId: busy._id,
        orderItemId: item._id,
        stage: "CUTTING",
        assignedAt: new Date(),
        completedAt: null,
        followedSuggestion: false
      }
    });

    const after = await request(app)
      .get("/api/production/suggest-assignment")
      .query({ orderItemId: String(item._id), stage: "CUTTING" })
      .set(auth(token));

    const afterBusy = after.body.rankings.find((r) => r.staff.name === "Will Be Busy");
    const afterFree = after.body.rankings.find((r) => r.staff.name === "Stays Free");

    expect(afterBusy.scores.availabilityScore).toBeLessThan(afterFree.scores.availabilityScore);
    expect(afterBusy.scores.rankedScore).toBeLessThan(afterFree.scores.rankedScore);
    expect(afterBusy.staff.activeAssignmentCount).toBe(1);

    const freeIdx = after.body.rankings.findIndex((r) => r.staff.name === "Stays Free");
    const busyIdx = after.body.rankings.findIndex((r) => r.staff.name === "Will Be Busy");
    expect(freeIdx).toBeLessThan(busyIdx);
    expect(String(free._id)).toBeTruthy();
  });
});
