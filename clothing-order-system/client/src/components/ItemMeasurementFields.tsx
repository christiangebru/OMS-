import type { OrderItem } from "@/lib/types";

const MALE_FIELDS = [
  ["chest", "Chest"],
  ["waist", "Waist"],
  ["shoulder", "Shoulder"],
  ["arm", "Sleeve"],
  ["height", "Height"]
] as const;

const FEMALE_FIELDS = [
  ["breast", "Bust"],
  ["waist", "Waist"],
  ["vest", "Hip / vest"],
  ["shoulder", "Shoulder"],
  ["arm", "Sleeve"],
  ["height", "Length / height"]
] as const;

const CHILD_FIELDS = [
  ["height", "Height"],
  ["chest", "Chest"],
  ["waist", "Waist"],
  ["shoulder", "Shoulder"],
  ["arm", "Sleeve"]
] as const;

type Gender = "female" | "male" | "kids";

function fieldsFor(gender: Gender, size?: string) {
  if (size === "baby" || size === "kids" || gender === "kids") return CHILD_FIELDS;
  if (gender === "male") return MALE_FIELDS;
  return FEMALE_FIELDS;
}

export function ItemMeasurementFields({
  item,
  onChange
}: {
  item: OrderItem;
  onChange: (measurements: NonNullable<OrderItem["measurements"]>) => void;
}) {
  const gender = (item.measurements?.gender || "female") as Gender;
  const fields = fieldsFor(gender, item.size);

  return (
    <div className="rounded-xl border border-line p-4">
      <h3 className="mb-3 text-sm font-semibold text-ink">Measurements</h3>
      <div className="mb-3 grid gap-3 sm:grid-cols-2">
        <div>
          <label className="ui-label" htmlFor={`gender-${item._id || "new"}`}>
            Category
          </label>
          <select
            id={`gender-${item._id || "new"}`}
            value={gender}
            onChange={(e) =>
              onChange({
                gender: e.target.value as Gender,
                ...item.measurements
              })
            }
            className="ui-input"
          >
            <option value="male">Male</option>
            <option value="female">Female</option>
            <option value="kids">Child / baby</option>
          </select>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {fields.map(([key, label]) => (
          <div key={key}>
            <label className="ui-label">{label}</label>
            <input
              inputMode="decimal"
              placeholder="cm"
              value={item.measurements?.[key] || ""}
              onChange={(e) =>
                onChange({
                  gender,
                  ...item.measurements,
                  [key]: e.target.value
                })
              }
              className="ui-input"
            />
          </div>
        ))}
      </div>
    </div>
  );
}
