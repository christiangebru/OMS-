import { Component, useCallback, useEffect, useId, useRef, useState, type ErrorInfo, type ReactNode } from "react";
import { createScannerLifecycle } from "@/lib/scanCamera";
import { Button } from "./ui/Button";

type Html5Scanner = {
  isScanning?: boolean;
  start: (
    camera: string | { facingMode: string },
    config: { fps: number; qrbox: { width: number; height: number } },
    onSuccess: (decoded: string) => void,
    onFailure: () => void
  ) => Promise<void>;
  stop: () => Promise<void>;
  clear: () => void;
};

type Html5Ctor = (new (elementId: string) => Html5Scanner) & {
  getCameras?: () => Promise<Array<{ id: string }>>;
};

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
        <div className="flex min-h-[320px] items-center justify-center bg-black px-6 text-center text-sm text-white/80 sm:min-h-[480px]">
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
  config: { fps: number; qrbox: { width: number; height: number } },
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

export function CameraScanPane({ onDecoded }: { onDecoded: (code: string) => void }) {
  const reactId = useId().replace(/:/g, "");
  const hostId = `scan-host-${reactId}`;
  const hostRef = useRef<HTMLDivElement | null>(null);
  const scannerRef = useRef<Html5Scanner | null>(null);
  const lifeRef = useRef(createScannerLifecycle());
  const lastScanRef = useRef("");
  const onDecodedRef = useRef(onDecoded);
  onDecodedRef.current = onDecoded;

  const [cameraOn, setCameraOn] = useState(false);
  const [status, setStatus] = useState("Opening camera…");
  const [failed, setFailed] = useState(false);

  const stopOwnedScanner = useCallback(async (scanner: Html5Scanner | null) => {
    if (!scanner) return;
    try {
      if (scanner.isScanning) await scanner.stop();
    } catch {
      /* already stopped */
    }
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
      setStatus("Camera idle");
    }
  }, [stopOwnedScanner]);

  const startCamera = useCallback(async () => {
    if (!hostRef.current) return;
    const token = lifeRef.current.beginStart();
    setFailed(false);
    setStatus("Starting camera…");
    let scanner: Html5Scanner | null = null;
    try {
      const { Html5Qrcode } = (await import("html5-qrcode")) as { Html5Qrcode: Html5Ctor };
      if (!lifeRef.current.isCurrent(token) || !hostRef.current) return;
      scanner = new Html5Qrcode(hostId);
      scannerRef.current = scanner;
      await startWithCameraFallback(
        Html5Qrcode,
        scanner,
        { fps: 10, qrbox: { width: 260, height: 140 } },
        (decoded) => {
          if (!decoded || decoded === lastScanRef.current) return;
          lastScanRef.current = decoded;
          onDecodedRef.current(decoded);
        }
      );
      if (!lifeRef.current.isCurrent(token)) {
        await stopOwnedScanner(scanner);
        if (scannerRef.current === scanner) scannerRef.current = null;
        return;
      }
      setCameraOn(true);
      setStatus("Live — hold the label in the frame");
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
    const t = window.setTimeout(() => {
      void startCamera();
    }, 40);
    return () => {
      window.clearTimeout(t);
      life.unmount();
      const scanner = scannerRef.current;
      scannerRef.current = null;
      void stopOwnedScanner(scanner);
    };
  }, [startCamera, stopOwnedScanner]);

  return (
    <CameraBoundary>
      <section className="overflow-hidden border border-line bg-ink">
        <div className="flex items-center justify-between px-4 py-3 text-white">
          <div>
            <p className="text-sm font-semibold">Scanner</p>
            <p className="text-[11px] text-white/60">{status}</p>
          </div>
          {cameraOn ? (
            <Button type="button" size="sm" variant="secondary" onClick={() => void stopCamera()}>
              Stop
            </Button>
          ) : failed ? (
            <Button type="button" size="sm" onClick={() => void startCamera()}>
              Retry camera
            </Button>
          ) : null}
        </div>
        <div className="relative min-h-[320px] overflow-hidden bg-black sm:min-h-[480px] lg:min-h-[560px]">
          <div
            ref={hostRef}
            id={hostId}
            className="absolute inset-0 [&_video]:h-full [&_video]:w-full [&_video]:object-cover"
          />
          {!cameraOn && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-8 text-center">
              <div>
                <div className="mx-auto mb-6 h-40 w-64 rounded-sm border-2 border-dashed border-white/30" />
                <p className="text-sm text-white/70">
                  {failed ? "Camera could not start. Type the barcode on the right." : "Opening camera…"}
                </p>
              </div>
            </div>
          )}
          {cameraOn && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/25">
              <div className="h-36 w-56 border-2 border-white/80" />
            </div>
          )}
        </div>
      </section>
    </CameraBoundary>
  );
}
