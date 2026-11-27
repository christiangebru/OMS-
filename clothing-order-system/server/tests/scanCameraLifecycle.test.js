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

import { stopMediaTracks, stopVideoStreams, shouldAcceptScan } from "../../client/src/lib/scanCamera.js";

describe("camera release", () => {
  const track = () => ({ readyState: "live", stop() { this.readyState = "ended"; } });

  it("stops every live track so the camera light goes off", () => {
    const tracks = [track(), track()];
    expect(stopMediaTracks({ getTracks: () => tracks })).toBe(2);
    expect(tracks.every((t) => t.readyState === "ended")).toBe(true);
    expect(stopMediaTracks({ getTracks: () => tracks })).toBe(0);
    expect(stopMediaTracks(null)).toBe(0);
  });

  it("stops streams found on video elements and detaches them", () => {
    const t = track();
    const video = { srcObject: { getTracks: () => [t] } };
    expect(stopVideoStreams({ querySelectorAll: () => [video] })).toBe(1);
    expect(video.srcObject).toBeNull();
  });
});

describe("repeat scans", () => {
  it("ignores the same code for a moment, then accepts it again", () => {
    const last = { code: "ORD-1001-1", at: 1000 };
    expect(shouldAcceptScan(last, "ORD-1001-1", 1500)).toBe(false);
    expect(shouldAcceptScan(last, "ORD-1001-1", 3100)).toBe(true);
    expect(shouldAcceptScan(last, "ORD-1001-2", 1100)).toBe(true);
    expect(shouldAcceptScan(null, "ORD-1001-1", 0)).toBe(true);
  });
});
