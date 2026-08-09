import { useState } from "react";
import { imageUrlFromPath, uploadImage, uploadOrderItemImages, ApiError } from "@/lib/api";
import type { OrderItemImage } from "@/lib/types";

type Props = {
  images: OrderItemImage[];
  onChange: (images: OrderItemImage[]) => void;
  /** When item already exists, upload directly to API */
  orderItemId?: string;
  onError?: (msg: string) => void;
};

export function ImageGalleryUploader({ images, onChange, orderItemId, onError }: Props) {
  const [busy, setBusy] = useState(false);

  async function onAdd(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    try {
      const list = Array.from(files);
      if (orderItemId) {
        const created = (await uploadOrderItemImages(orderItemId, list)) as OrderItemImage[];
        onChange([...images, ...created]);
      } else {
        const uploaded: OrderItemImage[] = [];
        for (const file of list) {
          const { path } = await uploadImage(file);
          uploaded.push({ imageUrl: path, caption: "" });
        }
        onChange([...images, ...uploaded]);
      }
    } catch (e) {
      onError?.(e instanceof ApiError ? e.message : "Image upload failed");
    } finally {
      setBusy(false);
    }
  }

  function removeAt(index: number) {
    onChange(images.filter((_, i) => i !== index));
  }

  function setCaption(index: number, caption: string) {
    onChange(images.map((img, i) => (i === index ? { ...img, caption } : img)));
  }

  return (
    <div>
      <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">Reference images</p>
      <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        {images.map((img, i) => (
          <div
            key={img._id || `${img.imageUrl}-${i}`}
            className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700"
          >
            <img
              src={imageUrlFromPath(img.imageUrl)}
              alt={img.caption || "Reference"}
              className="h-24 w-full object-cover"
            />
            <div className="space-y-1 p-2">
              <input
                value={img.caption || ""}
                onChange={(e) => setCaption(i, e.target.value)}
                placeholder="Caption (optional)"
                className="w-full rounded border border-slate-200 px-2 py-1 text-xs dark:border-slate-600 dark:bg-slate-950"
              />
              <button
                type="button"
                onClick={() => removeAt(i)}
                className="text-xs font-semibold text-red-600 hover:underline"
              >
                Remove
              </button>
            </div>
          </div>
        ))}
        <label className="flex h-24 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">
          {busy ? "Uploading…" : "Add images"}
          <input
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            disabled={busy}
            onChange={(e) => onAdd(e.target.files)}
          />
        </label>
      </div>
    </div>
  );
}
