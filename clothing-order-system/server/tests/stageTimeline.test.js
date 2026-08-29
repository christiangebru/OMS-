import { describe, it, expect } from "@jest/globals";
import { buildStageStates } from "../src/utils/stageTimeline.js";
import { SKIP_EMBROIDERY_SEQUENCE, FULL_STAGE_SEQUENCE } from "../src/constants/production.js";

describe("buildStageStates", () => {
  it("always returns the full production sequence", () => {
    const stages = buildStageStates([], SKIP_EMBROIDERY_SEQUENCE);
    expect(stages.map((s) => s.stage)).toEqual(FULL_STAGE_SEQUENCE);
  });

  it("marks embroidery skipped when the clothing type omits it", async () => {
    const stages = buildStageStates([], SKIP_EMBROIDERY_SEQUENCE);
    const embroidery = stages.find((s) => s.stage === "EMBROIDERY");
    expect(embroidery.status).toBe("skipped");
    expect(stages.find((s) => s.stage === "RECEIVED").status).toBe("skipped");
    expect(stages.find((s) => s.stage === "SEWING_CUTTING").status).toBe("next");
  });

  it("marks overdue next stages as blocked", () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const stages = buildStageStates([], SKIP_EMBROIDERY_SEQUENCE, { dueDate: yesterday });
    expect(stages.find((s) => s.stage === "SEWING_CUTTING").status).toBe("blocked");
    expect(stages.find((s) => s.stage === "EMBROIDERY").status).toBe("skipped");
  });

  it("shows in-progress duration and completed worker wait", () => {
    const t0 = new Date(Date.now() - 3 * 60 * 60 * 1000);
    const t1 = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const stages = buildStageStates(
      [
        {
          id: "cp1",
          stage: "SEWING_CUTTING",
          checkedInAt: t0,
          checkedOutAt: t1
        }
      ],
      SKIP_EMBROIDERY_SEQUENCE
    );
    const sewing = stages.find((s) => s.stage === "SEWING_CUTTING");
    const next = stages.find((s) => s.stage === "FINAL_SEWING");
    expect(sewing.status).toBe("completed");
    expect(sewing.durationMs).toBeGreaterThan(0);
    expect(next.status).toBe("next");
    expect(next.waitingMs).toBeGreaterThan(0);
  });
});
