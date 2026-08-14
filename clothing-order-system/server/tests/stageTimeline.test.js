import { describe, it, expect } from "@jest/globals";
import { buildStageStates } from "../src/utils/stageTimeline.js";
import { SKIP_EMBROIDERY_SEQUENCE, FULL_STAGE_SEQUENCE } from "../src/constants/production.js";

describe("buildStageStates", () => {
  it("always returns the full production sequence", () => {
    const stages = buildStageStates([], SKIP_EMBROIDERY_SEQUENCE);
    expect(stages.map((s) => s.stage)).toEqual(FULL_STAGE_SEQUENCE);
  });

  it("marks embroidery skipped when the clothing type omits it", () => {
    const stages = buildStageStates([], SKIP_EMBROIDERY_SEQUENCE);
    const embroidery = stages.find((s) => s.stage === "EMBROIDERY");
    expect(embroidery.status).toBe("skipped");
    expect(stages.find((s) => s.stage === "RECEIVED").status).toBe("next");
    expect(stages.find((s) => s.stage === "CUTTING").status).toBe("waiting");
  });

  it("marks overdue next stages as blocked", () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const stages = buildStageStates([], SKIP_EMBROIDERY_SEQUENCE, { dueDate: yesterday });
    expect(stages.find((s) => s.stage === "RECEIVED").status).toBe("blocked");
    expect(stages.find((s) => s.stage === "EMBROIDERY").status).toBe("skipped");
  });

  it("shows in-progress duration and completed worker wait", () => {
    const t0 = new Date(Date.now() - 3 * 60 * 60 * 1000);
    const t1 = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const stages = buildStageStates(
      [
        {
          id: "cp1",
          stage: "RECEIVED",
          checkedInAt: t0,
          checkedOutAt: t1
        }
      ],
      SKIP_EMBROIDERY_SEQUENCE
    );
    const received = stages.find((s) => s.stage === "RECEIVED");
    const cutting = stages.find((s) => s.stage === "CUTTING");
    expect(received.status).toBe("completed");
    expect(received.durationMs).toBeGreaterThan(0);
    expect(cutting.status).toBe("next");
    expect(cutting.waitingMs).toBeGreaterThan(0);
  });
});
