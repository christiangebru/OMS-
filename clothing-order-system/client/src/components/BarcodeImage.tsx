import { useEffect, useState } from "react";
import { apiBaseUrl, authToken } from "@/lib/api";
import clsx from "clsx";

export function BarcodeImage({
  value,
  className = "barcode-mark",
  showValue = false
}: {
  value: string;
  className?: string;
  showValue?: boolean;
}) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!value) return;
    let objectUrl: string | null = null;
    let cancelled = false;

    async function load() {
      const token = authToken();
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const base = apiBaseUrl();
      try {
        const svgRes = await fetch(
          `${base}/api/production/barcode.svg?value=${encodeURIComponent(value)}`,
          { headers }
        );
        if (svgRes.ok && !cancelled) {
          const svg = await svgRes.text();
          if (!svg.includes("<svg")) throw new Error("not svg");
          objectUrl = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
          if (!cancelled) setSrc(objectUrl);
          return;
        }
      } catch {
        /* fall through to PNG */
      }
      try {
        const pngRes = await fetch(
          `${base}/api/production/barcode.png?value=${encodeURIComponent(value)}`,
          { headers }
        );
        if (!pngRes.ok || cancelled) return;
        const blob = await pngRes.blob();
        objectUrl = URL.createObjectURL(blob);
        if (!cancelled) setSrc(objectUrl);
      } catch {
        /* keep text fallback */
      }
    }

    void load();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [value]);

  if (!src) {
    return <span className="font-mono text-xs tracking-widest text-ink">{value}</span>;
  }

  return (
    <span className="block">
      <img
        src={src}
        alt=""
        className={clsx("barcode-mark", className)}
      />
      {showValue ? (
        <span className="mt-1 block text-center font-mono text-xs tracking-[0.16em] text-ink">{value}</span>
      ) : null}
    </span>
  );
}
