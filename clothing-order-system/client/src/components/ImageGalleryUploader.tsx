import { useRef, useState } from "react";
import {
  imageUrlFromPath,
  uploadImage,
  uploadOrderItemImages,
  patchOrderItemImage,
  deleteOrderItemImage,
  ApiError
} from "@/lib/api";
import type { OrderItemImage } from "@/lib/types";
import clsx from "clsx";

const CATEGORIES = [
  "front",
  "back",
  "side",
  "detail",
  "inspiration",
  "reference",
  "sleeve",
  "collar",
  "embroidery",
  "fabric",
  "design",
  "customer",
  "other"
];

type Props = {
  images: OrderItemImage[];
  onChange: (images: OrderItemImage[]) => void;
  orderItemId?: string;
  onError?: (msg: string) => void;
};

export function ImageGalleryUploader({ images, onChange, orderItemId, onError }: Props) {
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const captionTimers = useRef<Record<string, number>>({});

  async function persistPatch(img: OrderItemImage, data: Partial<OrderItemImage>) {
    if (!orderItemId || !img._id) return;
    try {
      await patchOrderItemImage(orderItemId, img._id, {
        caption: data.caption,
        category: data.category,
        sortOrder: data.sortOrder
      });
    } catch (e) {
      onError?.(e instanceof ApiError ? e.message : "Could not update image");
    }
  }

  async function onAdd(files: FileList | File[] | null) {
    if (!files || (files as FileList).length === 0) return;
    setBusy(true);
    try {
      const list = Array.from(files as FileList);
      if (orderItemId) {
        const created = (await uploadOrderItemImages(orderItemId, list)) as OrderItemImage[];
        onChange([...images, ...created]);
      } else {
        const uploaded: OrderItemImage[] = [];
        for (const file of list) {
          const { path } = await uploadImage(file);
          uploaded.push({
            imageUrl: path,
            caption: "",
            category: "other",
            sortOrder: images.length + uploaded.length
          });
        }
        onChange([...images, ...uploaded]);
      }
    } catch (e) {
      onError?.(e instanceof ApiError ? e.message : "Image upload failed");
    } finally {
      setBusy(false);
    }
  }

  async function removeAt(index: number) {
    const img = images[index];
    if (orderItemId && img?._id) {
      try {
        await deleteOrderItemImage(orderItemId, img._id);
      } catch (e) {
        onError?.(e instanceof ApiError ? e.message : "Could not remove image");
        return;
      }
    }
    onChange(images.filter((_, i) => i !== index).map((item, i) => ({ ...item, sortOrder: i })));
  }

  function patch(index: number, data: Partial<OrderItemImage>, persist = true) {
    const next = images.map((img, i) => (i === index ? { ...img, ...data } : img));
    onChange(next);
    const img = next[index];
    if (!persist || !orderItemId || !img._id) return;
    if (data.caption !== undefined) {
      const key = img._id;
      window.clearTimeout(captionTimers.current[key]);
      captionTimers.current[key] = window.setTimeout(() => {
        persistPatch(img, { caption: data.caption });
      }, 400);
      return;
    }
    persistPatch(img, data);
  }

  async function move(index: number, dir: -1 | 1) {
    const nextIndex = index + dir;
    if (nextIndex < 0 || nextIndex >= images.length) return;
    const copy = [...images];
    const [item] = copy.splice(index, 1);
    copy.splice(nextIndex, 0, item);
    const ordered = copy.map((img, i) => ({ ...img, sortOrder: i }));
    onChange(ordered);
    if (!orderItemId) return;
    await Promise.all(
      ordered
        .filter((img) => img._id)
        .map((img) => persistPatch(img, { sortOrder: img.sortOrder }))
    );
  }

  return (
    <div>
      <p className="ui-label">Reference images</p>
      <p className="mt-1 text-xs text-ink-muted">Drop files or add photos, then tag Front / Back / Detail.</p>
      <div
        className={clsx(
          "mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4",
          dragOver && "rounded-lg ring-2 ring-accent"
        )}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          onAdd(e.dataTransfer.files);
        }}
      >
        {images.map((img, i) => (
          <div key={img._id || `${img.imageUrl}-${i}`} className="overflow-hidden rounded-lg border border-line bg-surface">
            <img
              src={imageUrlFromPath(img.imageUrl)}
              alt={img.caption || img.category || "Reference"}
              className="h-24 w-full cursor-zoom-in object-cover"
              onClick={() => setPreview(img.imageUrl)}
            />
            <div className="space-y-1 p-2">
              <select
                value={img.category || "other"}
                onChange={(e) => patch(i, { category: e.target.value })}
                className="w-full rounded-control border border-line px-1 py-1 text-[11px] capitalize"
                aria-label="Image category"
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <input
                value={img.caption || ""}
                onChange={(e) => patch(i, { caption: e.target.value })}
                placeholder="Note"
                className="w-full rounded-control border border-line px-2 py-1 text-xs"
              />
              <div className="flex justify-between text-[11px]">
                <span className="flex gap-1">
                  <button type="button" onClick={() => move(i, -1)} className="text-ink-muted hover:text-ink">
                    ←
                  </button>
                  <button type="button" onClick={() => move(i, 1)} className="text-ink-muted hover:text-ink">
                    →
                  </button>
                </span>
                <button type="button" onClick={() => removeAt(i)} className="font-medium text-red-700">
                  Remove
                </button>
              </div>
            </div>
          </div>
        ))}
        <label className="flex h-24 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-line text-xs font-medium text-ink-muted hover:bg-canvas">
          {busy ? "Uploading…" : "Add files"}
          <input
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            disabled={busy}
            onChange={(e) => onAdd(e.target.files)}
          />
        </label>
        <label className="flex h-24 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-line text-xs font-medium text-ink-muted hover:bg-canvas sm:hidden">
          Take photo
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            disabled={busy}
            onChange={(e) => onAdd(e.target.files)}
          />
        </label>
      </div>
      {preview && (
        <button
          type="button"
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 p-4"
          onClick={() => setPreview(null)}
          aria-label="Close preview"
        >
          <img src={imageUrlFromPath(preview)} alt="" className="max-h-full max-w-full rounded-lg object-contain" />
        </button>
      )}
    </div>
  );
}
