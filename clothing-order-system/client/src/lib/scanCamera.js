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
