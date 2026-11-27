import { Component, useCallback, useEffect, useId, useRef, useState, type ErrorInfo, type ReactNode } from "react";
import { createScannerLifecycle, shouldAcceptScan, stopVideoStreams } from "@/lib/scanCamera";
import { Button } from "./ui/Button";
import clsx from "clsx";

type ScanConfig = { fps: number; aspectRatio?: number; disableFlip?: boolean };

type Html5Scanner = {
  isScanning?: boolean;
  start: (
    camera: string | { facingMode: string },
    config: ScanConfig,
    onSuccess: (decoded: string) => void,
    onFailure: () => void
  ) => Promise<void>;
  stop: () => Promise<void>;
  clear: () => void;
};

type Html5Ctor = (new (
  elementId: string,
  config?: { formatsToSupport?: number[]; verbose?: boolean; experimentalFeatures?: { useBarCodeDetectorIfSupported?: boolean } }
) => Html5Scanner) & {
  getCameras?: () => Promise<Array<{ id: string }>>;
};

/** Code 128 is what our labels print; QR kept for any QR stickers. */
const FORMATS = { QR_CODE: 0, CODE_128: 5 };

class CameraBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(error: Error) {
    return { error: error.message || "Camera view failed" };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[scanner]", error, info.componentStack);
  }
  render() {
    if (this.state.error) {
      return (
        <div className="flex aspect-[4/3] items-center justify-center bg-black px-6 text-center text-sm text-white/80">
          {this.state.error}
        </div>
      );
    }
    return this.props.children;
  }
}

async function startWithCameraFallback(
  Html5Qrcode: Html5Ctor,
  scanner: Html5Scanner,
  config: ScanConfig,
  onDecoded: (decoded: string) => void
) {
  const silent = () => {};
  try {
    await scanner.start({ facingMode: "environment" }, config, onDecoded, silent);
    return;
  } catch {
    /* try user-facing, then enumerated cameras */
  }
  try {
    await scanner.start({ facingMode: "user" }, config, onDecoded, silent);
    return;
  } catch {
    /* enumerated */
  }
  const cameras = typeof Html5Qrcode.getCameras === "function" ? await Html5Qrcode.getCameras() : [];
  if (!cameras?.length) {
    throw new Error("No camera available");
  }
  await scanner.start(cameras[0].id, config, onDecoded, silent);
}

/** Short beep + vibration so a read is noticed without looking at the screen. */
function signalRead() {
  try {
    navigator.vibrate?.(60);
  } catch {
    /* unsupported */
  }
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 1400;
    gain.gain.value = 0.06;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.09);
    osc.onended = () => void ctx.close();
  } catch {
    /* audio blocked */
  }
}

export function CameraScanPane({ onDecoded }: { onDecoded: (code: string) => void }) {
  const reactId = useId().replace(/:/g, "");
  const hostId = `scan-host-${reactId}`;
  const hostRef = useRef<HTMLDivElement | null>(null);
  const scannerRef = useRef<Html5Scanner | null>(null);
  const lifeRef = useRef(createScannerLifecycle());
  const lastScanRef = useRef<{ code: string; at: number } | null>(null);
  const onDecodedRef = useRef(onDecoded);
  onDecodedRef.current = onDecoded;
  const pausedByHideRef = useRef(false);

  const [cameraOn, setCameraOn] = useState(false);
  const [status, setStatus] = useState("Opening camera…");
  const [failed, setFailed] = useState(false);
  const [lastRead, setLastRead] = useState<{ code: string; at: number } | null>(null);

  /** Stop the library and, no matter what, the camera tracks themselves. */
  const stopOwnedScanner = useCallback(async (scanner: Html5Scanner | null) => {
    stopVideoStreams(hostRef.current);
    if (!scanner) return;
    try {
      if (scanner.isScanning) await scanner.stop();
    } catch {
      /* already stopped */
    }
    stopVideoStreams(hostRef.current);
    try {
      scanner.clear();
    } catch {
      /* host may already be empty */
    }
  }, []);

  const stopCamera = useCallback(async () => {
    lifeRef.current.invalidate();
    const scanner = scannerRef.current;
    scannerRef.current = null;
    await stopOwnedScanner(scanner);
    if (lifeRef.current.isMounted()) {
      setCameraOn(false);
      setStatus("Camera off");
    }
  }, [stopOwnedScanner]);

  const startCamera = useCallback(async () => {
    if (!hostRef.current) return;
    const token = lifeRef.current.beginStart();
    setFailed(false);
    setStatus("Starting camera…");
    let scanner: Html5Scanner | null = null;
    try {
      const { Html5Qrcode } = (await import("html5-qrcode")) as unknown as { Html5Qrcode: Html5Ctor };
      if (!lifeRef.current.isCurrent(token) || !hostRef.current) return;
      scanner = new Html5Qrcode(hostId, {
        formatsToSupport: [FORMATS.CODE_128, FORMATS.QR_CODE],
        verbose: false,
        experimentalFeatures: { useBarCodeDetectorIfSupported: true }
      });
      scannerRef.current = scanner;
      // No qrbox: the whole picture is scanned and the library draws no box
      // of its own, so the single guide below is the only one on screen.
      await startWithCameraFallback(Html5Qrcode, scanner, { fps: 12, disableFlip: true }, (decoded) => {
        const now = Date.now();
        if (!shouldAcceptScan(lastScanRef.current, decoded, now)) return;
        lastScanRef.current = { code: decoded, at: now };
        setLastRead({ code: decoded, at: now });
        signalRead();
        onDecodedRef.current(decoded);
      });
      if (!lifeRef.current.isCurrent(token)) {
        // Page was left (or Stop pressed) while the camera was starting.
        await stopOwnedScanner(scanner);
        if (scannerRef.current === scanner) scannerRef.current = null;
        return;
      }
      setCameraOn(true);
      setStatus("Point at the barcode");
    } catch {
      await stopOwnedScanner(scanner);
      if (scannerRef.current === scanner) scannerRef.current = null;
      if (!lifeRef.current.isCurrent(token)) return;
      setCameraOn(false);
      setFailed(true);
      setStatus("Camera unavailable");
    }
  }, [hostId, stopOwnedScanner]);

  useEffect(() => {
    const life = createScannerLifecycle();
    lifeRef.current = life;
    const host = hostRef.current;
    const t = window.setTimeout(() => {
      void startCamera();
    }, 40);

    // Turn the camera off while the tab is hidden; back on when visible.
    const onVisibility = () => {
      if (document.hidden) {
        if (scannerRef.current) {
          pausedByHideRef.current = true;
          void stopCamera();
        }
      } else if (pausedByHideRef.current) {
        pausedByHideRef.current = false;
        void startCamera();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.clearTimeout(t);
      document.removeEventListener("visibilitychange", onVisibility);
      life.unmount();
      // Leaving the Scanner page: release the camera immediately.
      stopVideoStreams(host);
      const scanner = scannerRef.current;
      scannerRef.current = null;
      void stopOwnedScanner(scanner);
    };
  }, [startCamera, stopCamera, stopOwnedScanner]);

  const flash = lastRead && Date.now() - lastRead.at < 1500;
  useEffect(() => {
    if (!lastRead) return;
    const id = window.setTimeout(() => setLastRead((r) => (r && r.at === lastRead.at ? { ...r } : r)), 1600);
    return () => window.clearTimeout(id);
  }, [lastRead]);

  return (
    <CameraBoundary>
      <section className="overflow-hidden rounded-control border border-line bg-ink">
        <div className="flex items-center justify-between gap-3 px-4 py-3 text-white">
          <div className="flex items-center gap-2">
            <span
              className={clsx("h-2.5 w-2.5 rounded-full", cameraOn ? "bg-emerald-400" : failed ? "bg-red-400" : "bg-white/30")}
              aria-hidden
            />
            <div>
              <p className="text-sm font-semibold">Camera</p>
              <p className="text-[11px] text-white/60">{status}</p>
            </div>
          </div>
          {cameraOn ? (
            <Button type="button" size="sm" variant="secondary" onClick={() => void stopCamera()}>
              Turn off
            </Button>
          ) : (
            <Button type="button" size="sm" onClick={() => void startCamera()}>
              {failed ? "Retry camera" : "Turn on"}
            </Button>
          )}
        </div>
        <div className="relative aspect-[4/3] max-h-[70vh] w-full overflow-hidden bg-black">
          {/* html5-qrcode owns this node; overlays are siblings, never children. */}
          <div
            ref={hostRef}
            id={hostId}
            className="scan-host absolute inset-0"
          />
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-4 px-6">
            <div
              className={clsx(
                "scan-guide relative aspect-[2.4/1] w-[78%] max-w-md transition-colors",
                flash ? "scan-guide--hit" : cameraOn ? "" : "opacity-40"
              )}
            >
              <span className="scan-corner left-0 top-0 border-l-4 border-t-4" />
              <span className="scan-corner right-0 top-0 border-r-4 border-t-4" />
              <span className="scan-corner bottom-0 left-0 border-b-4 border-l-4" />
              <span className="scan-corner bottom-0 right-0 border-b-4 border-r-4" />
              {cameraOn && !flash && <span className="scan-line" />}
            </div>
            <p
              className={clsx(
                "rounded-full px-3 py-1 text-xs font-medium",
                flash ? "bg-emerald-500 text-white" : "bg-black/50 text-white/85"
              )}
              aria-live="polite"
            >
              {flash
                ? `Read ${lastRead?.code}`
                : cameraOn
                  ? "Hold the label 10–20 cm away, barcode inside the box"
                  : failed
                    ? "Camera could not start — type the code on the right"
                    : status}
            </p>
          </div>
        </div>
      </section>
    </CameraBoundary>
  );
}
