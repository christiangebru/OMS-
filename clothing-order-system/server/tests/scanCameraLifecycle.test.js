import { describe, it, expect } from "@jest/globals";
import { createScannerLifecycle, scannerHostContract } from "../../client/src/lib/scanCamera.js";

describe("scanner lifecycle", () => {
  it("does not apply results from a stale camera start after unmount", () => {
    const life = createScannerLifecycle();
    const token = life.beginStart();
    expect(life.isCurrent(token)).toBe(true);
    life.unmount();
    expect(life.isMounted()).toBe(false);
    expect(life.isCurrent(token)).toBe(false);
  });

  it("invalidates in-flight starts on retry so cleanup cannot race the new camera", () => {
    const life = createScannerLifecycle();
    const first = life.beginStart();
    life.invalidate();
    const second = life.beginStart();
    expect(life.isCurrent(first)).toBe(false);
    expect(life.isCurrent(second)).toBe(true);
  });

  it("keeps the html5-qrcode host empty of React children", () => {
    expect(scannerHostContract()).toEqual({
      reactChildrenInsideHost: false,
      overlayIsSibling: true,
      clearMayOnlyEmptyHost: true
    });
  });
});
