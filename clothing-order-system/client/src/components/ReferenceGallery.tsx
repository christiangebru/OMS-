import { useState } from "react";
import { imageUrlFromPath } from "@/lib/api";
import type { OrderItemImage } from "@/lib/types";
import clsx from "clsx";

const CATEGORY_ORDER = [
  "front",
  "back",
  "side",
  "detail",
  "fabric",
  "embroidery",
  "inspiration",
  "reference",
  "design",
  "sleeve",
  "collar",
  "customer",
  "other"
];

export function ReferenceGallery({ images }: { images: OrderItemImage[] }) {
  const [preview, setPreview] = useState<OrderItemImage | null>(null);
  if (!images?.length) {
    return <p className="text-sm text-ink-muted">No reference images.</p>;
  }

  const sorted = [...images].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  const groups = CATEGORY_ORDER.map((cat) => ({
    cat,
    items: sorted.filter((img) => (img.category || "other") === cat)
  })).filter((g) => g.items.length);
  const leftover = sorted.filter((img) => !CATEGORY_ORDER.includes(img.category || "other"));
  if (leftover.length) groups.push({ cat: "other", items: leftover });

  return (
    <>
      <div className="space-y-4">
        {groups.map((g) => (
          <div key={g.cat}>
            {groups.length > 1 && <p className="ui-label mb-2 capitalize">{g.cat}</p>}
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {g.items.map((img) => (
                <button
                  key={img._id || img.imageUrl}
                  type="button"
                  onClick={() => setPreview(img)}
                  className="group text-left"
                >
                  <img
                    src={imageUrlFromPath(img.imageUrl)}
                    alt={img.caption || img.category || "Reference"}
                    className="aspect-square w-full rounded-control object-cover"
                  />
                  {(img.caption || img.category) && (
                    <span className="mt-1 block truncate text-[11px] capitalize text-ink-muted">
                      {img.caption || img.category}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      {preview && (
        <button
          type="button"
          className="fixed inset-0 z-50 flex flex-col bg-ink/90 p-4"
          onClick={() => setPreview(null)}
          aria-label="Close preview"
        >
          <img
            src={imageUrlFromPath(preview.imageUrl)}
            alt={preview.caption || preview.category || ""}
            className="mx-auto max-h-[88vh] max-w-full object-contain"
          />
          <p className={clsx("mt-3 text-center text-sm text-white/80")}>
            {[preview.category, preview.caption].filter(Boolean).join(" · ") || "Reference"} · tap to close
          </p>
        </button>
      )}
    </>
  );
}
