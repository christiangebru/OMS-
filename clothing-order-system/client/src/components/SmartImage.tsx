import { useState } from "react";
import { imageUrlFromPath } from "@/lib/api";
import clsx from "clsx";

export function SmartImage({
  src,
  alt,
  className,
  onOpen
}: {
  src?: string | null;
  alt: string;
  className?: string;
  onOpen?: () => void;
}) {
  const [failed, setFailed] = useState(false);
  const url = src ? imageUrlFromPath(src) : "";

  if (!url) {
    return (
      <div className={clsx("flex items-center justify-center bg-canvas text-[11px] text-ink-muted", className)}>
        No image
      </div>
    );
  }

  if (failed) {
    return (
      <div className={clsx("flex flex-col items-center justify-center bg-canvas px-2 text-center", className)}>
        <span className="text-[11px] font-medium text-red-800">Could not load image</span>
        <span className="mt-0.5 break-all text-[10px] text-ink-faint">{url}</span>
      </div>
    );
  }

  const img = (
    <img
      src={url}
      alt={alt}
      className={clsx("bg-canvas", className)}
      onError={() => setFailed(true)}
    />
  );

  if (!onOpen) return img;
  return (
    <button type="button" onClick={onOpen} className="block w-full text-left">
      {img}
    </button>
  );
}
