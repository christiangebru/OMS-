import type { OrderItem } from "@/lib/types";
import { itemGenderToCategory, MEASUREMENT_SCHEMAS } from "@/lib/measurementSchema";

const ITEM_VALUE: Record<string, (m: NonNullable<OrderItem["measurements"]>) => string | undefined> = {
  chest: (m) => m.chest,
  bust: (m) => m.breast || m.chest,
  waist: (m) => m.waist,
  hip: (m) => m.vest,
  shoulder: (m) => m.shoulder,
  sleeveLength: (m) => m.arm,
  height: (m) => m.height,
  dressLength: (m) => m.height,
  neck: () => undefined,
  armhole: () => undefined,
  inseam: () => undefined
};

type SpecItem = {
  clothingType: string;
  fabricType?: string;
  color?: string;
  size?: string;
  neckType?: string;
  handType?: string;
  notes?: string;
  measurements?: OrderItem["measurements"];
};

export function SpecSheet({ item }: { item: SpecItem }) {
  const category = itemGenderToCategory(item.measurements?.gender, item.size);
  const groups = MEASUREMENT_SCHEMAS[category]
    .map((group) => ({
      ...group,
      rows: group.fields
        .map((f) => {
          const raw = item.measurements ? ITEM_VALUE[f.key]?.(item.measurements) : undefined;
          return raw ? { label: f.label, value: raw, unit: f.unit } : null;
        })
        .filter(Boolean) as Array<{ label: string; value: string; unit: string }>
    }))
    .filter((g) => g.rows.length);

  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
        <Fact label="Type" value={item.clothingType} />
        <Fact label="Fabric" value={item.fabricType || "—"} />
        <Fact label="Color" value={item.color || "—"} />
        <Fact label="Size" value={item.size || "—"} />
        <Fact label="Neck" value={item.neckType || "—"} />
        <Fact label="Sleeve" value={item.handType || "—"} />
      </dl>
      {item.notes && <p className="text-sm text-ink-muted">{item.notes}</p>}
      {groups.length ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {groups.map((g) => (
            <div key={g.id}>
              <p className="ui-label">{g.label}</p>
              <ul className="mt-2 space-y-1">
                {g.rows.map((row) => (
                  <li key={row.label} className="flex justify-between gap-3 text-sm">
                    <span className="text-ink-muted">{row.label}</span>
                    <span className="tabular font-medium text-ink">
                      {row.value}
                      <span className="ml-1 text-[11px] font-normal text-ink-faint">{row.unit}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-ink-muted">No measurements recorded for this garment.</p>
      )}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="ui-label">{label}</dt>
      <dd className="mt-1 capitalize text-ink">{value}</dd>
    </div>
  );
}
