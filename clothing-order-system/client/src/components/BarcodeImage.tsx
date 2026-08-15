import { useEffect, useState } from "react";
import { apiBaseUrl, authToken } from "@/lib/api";

export function BarcodeImage({
  value,
  className = "h-12 w-full object-contain"
}: {
  value: string;
  className?: string;
}) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!value) return;
    let objectUrl: string | null = null;
    let cancelled = false;
    (async () => {
      try {
        const token = authToken();
        const res = await fetch(
          `${apiBaseUrl()}/api/production/barcode.png?value=${encodeURIComponent(value)}`,
          { headers: token ? { Authorization: `Bearer ${token}` } : {} }
        );
        if (!res.ok || cancelled) return;
        const blob = await res.blob();
        objectUrl = URL.createObjectURL(blob);
        if (!cancelled) setSrc(objectUrl);
      } catch {
        /* keep text fallback */
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [value]);

  if (!src) {
    return <span className="font-mono text-xs tracking-widest text-ink">{value}</span>;
  }
  return <img src={src} alt={value} className={className} />;
}
