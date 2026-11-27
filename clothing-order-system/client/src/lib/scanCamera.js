/**
 * Generation-token lifecycle for html5-qrcode.
 * Prevents StrictMode / navigation races from stopping a newer scanner
 * or calling setState after unmount.
 */
export function createScannerLifecycle() {
  let generation = 0;
  let mounted = true;

  return {
    beginStart() {
      generation += 1;
      return generation;
    },
    isCurrent(token) {
      return mounted && token === generation;
    },
    invalidate() {
      generation += 1;
    },
    unmount() {
      mounted = false;
      generation += 1;
    },
    isMounted() {
      return mounted;
    }
  };
}

export function scannerHostContract() {
  return {
    reactChildrenInsideHost: false,
    overlayIsSibling: true,
    clearMayOnlyEmptyHost: true
  };
}

/**
 * Switch the camera off at the source. html5-qrcode's stop() can fail or be
 * skipped (start still pending, host already removed on navigation), which
 * leaves the camera light on; stopping the tracks always releases it.
 */
export function stopMediaTracks(stream) {
  if (!stream || typeof stream.getTracks !== "function") return 0;
  let stopped = 0;
  for (const track of stream.getTracks()) {
    try {
      if (track.readyState !== "ended") {
        track.stop();
        stopped += 1;
      }
    } catch {
      /* already released */
    }
  }
  return stopped;
}

/** Stop every camera stream attached to <video> elements inside `root`. */
export function stopVideoStreams(root) {
  if (!root || typeof root.querySelectorAll !== "function") return 0;
  let stopped = 0;
  for (const video of root.querySelectorAll("video")) {
    stopped += stopMediaTracks(video.srcObject);
    try {
      video.srcObject = null;
    } catch {
      /* ignore */
    }
  }
  return stopped;
}

/**
 * Accept a decoded code unless it is the same code read again within
 * `windowMs` (the camera reads one label many times a second). The same label
 * can be scanned again after the window, e.g. to scan a garment back out.
 */
export function shouldAcceptScan(last, code, now, windowMs = 2000) {
  if (!code) return false;
  if (!last || last.code !== code) return true;
  return now - last.at >= windowMs;
}
