import { describe, it, expect } from "@jest/globals";
import {
  effectiveScanSequence,
  nextExpectedStageWithOffSite,
  deriveCurrentStageWithOffSite,
  offSiteWindows,
  garmentLocation
} from "../src/utils/offSite.js";
import { CANONICAL_GARMENT_SEQUENCE } from "../src/constants/production.js";

const EMBROIDERY_SEQ = [...CANONICAL_GARMENT_SEQUENCE];
const SHIRT_SEQ = [...CANONICAL_GARMENT_SEQUENCE];
const PANTS_SEQ = ["SEWING_CUTTING", "FINAL_SEWING", "FINISHING", "SHOWROOM"];

describe("off-site windows and scan sequence", () => {
  it("embroidery jobs: one window covering embroidery, return at final sewing", () => {
    const windows = offSiteWindows(EMBROIDERY_SEQ, ["EMBROIDERY"]);
    expect(windows).toEqual([{ stages: ["EMBROIDERY"], returnStage: "FINAL_SEWING" }]);
    expect(effectiveScanSequence(EMBROIDERY_SEQ, ["EMBROIDERY"])).toEqual([
      "SEWING_CUTTING",
      "OFF_SITE",
      "FINAL_SEWING",
      "FINISHING",
      "SHOWROOM"
    ]);
  });

  it("male shirt: two separate trips (cut/prepare, then finish), return at embroidery then finishing", () => {
    const windows = offSiteWindows(SHIRT_SEQ, ["SEWING_CUTTING", "FINAL_SEWING"]);
    expect(windows).toEqual([
      { stages: ["SEWING_CUTTING"], returnStage: "EMBROIDERY" },
      { stages: ["FINAL_SEWING"], returnStage: "FINISHING" }
    ]);
    expect(effectiveScanSequence(SHIRT_SEQ, ["SEWING_CUTTING", "FINAL_SEWING"])).toEqual([
      "OFF_SITE",
      "EMBROIDERY",
      "OFF_SITE",
      "FINISHING",
      "SHOWROOM"
    ]);
  });

  it("trouser: one sewing trip, then in-shop finishing (no second send-out)", () => {
    const windows = offSiteWindows(PANTS_SEQ, ["SEWING_CUTTING", "FINAL_SEWING"]);
    expect(windows).toHaveLength(1);
    expect(windows[0].returnStage).toBe("FINISHING");
    expect(effectiveScanSequence(PANTS_SEQ, ["SEWING_CUTTING", "FINAL_SEWING"])).toEqual([
      "OFF_SITE",
      "FINISHING",
      "SHOWROOM"
    ]);
  });

  it("open OFF_SITE checkpoint reads as off-site, not an in-shop stage", () => {
    const cps = [
      { stage: "SEWING_CUTTING", checkedInAt: new Date(1), checkedOutAt: new Date(2) },
      { stage: "OFF_SITE", checkedInAt: new Date(3), checkedOutAt: null }
    ];
    expect(garmentLocation(cps)).toBe("off_site");
    expect(deriveCurrentStageWithOffSite(cps, EMBROIDERY_SEQ, ["EMBROIDERY"])).toBe("OFF_SITE");
    expect(nextExpectedStageWithOffSite(cps, EMBROIDERY_SEQ, ["EMBROIDERY"])).toBe("OFF_SITE");
  });
});
