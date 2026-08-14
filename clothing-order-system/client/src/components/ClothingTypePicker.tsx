import type { ClothingTypeConfig } from "@/lib/types";
import clsx from "clsx";

export function ClothingTypePicker({
  types,
  value,
  onChange
}: {
  types: ClothingTypeConfig[];
  value: string;
  onChange: (type: ClothingTypeConfig | { label: string; key: string }) => void;
}) {
  const match = types.find(
    (t) => t.label.toLowerCase() === value.toLowerCase() || t.key === value.toLowerCase().replace(/\s+/g, "_")
  );

  return (
    <div>
      <p className="ui-label">Garment</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {types.map((t) => (
          <button
            key={t._id}
            type="button"
            onClick={() => onChange(t)}
            className={clsx(
              "rounded-control border px-3 py-2 text-sm font-medium",
              match?.key === t.key
                ? "border-accent bg-accent-soft text-accent"
                : "border-line bg-surface text-ink-muted hover:text-ink"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      <input
        className="ui-input mt-2"
        value={value}
        onChange={(e) => onChange({ label: e.target.value, key: e.target.value })}
        placeholder="Or type a custom garment…"
        required
        aria-label="Clothing type"
      />
    </div>
  );
}
