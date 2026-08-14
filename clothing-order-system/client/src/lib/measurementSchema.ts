export type MeasurementCategory = "male" | "female" | "child" | "baby";

export type MeasurementField = {
  key: string;
  label: string;
  unit: string;
  /** maps onto the customer Measurement columns vs JSON `fields` */
  store: "column" | "fields";
  column?: "chest" | "waist" | "hip" | "shoulder" | "sleeveLength" | "inseam" | "neck";
};

export type MeasurementGroup = {
  id: string;
  label: string;
  fields: MeasurementField[];
};

export const MEASUREMENT_SCHEMAS: Record<MeasurementCategory, MeasurementGroup[]> = {
  male: [
    {
      id: "upper",
      label: "Upper body",
      fields: [
        { key: "chest", label: "Chest", unit: "cm", store: "column", column: "chest" },
        { key: "shoulder", label: "Shoulder", unit: "cm", store: "column", column: "shoulder" },
        { key: "neck", label: "Neck", unit: "cm", store: "column", column: "neck" }
      ]
    },
    {
      id: "sleeves",
      label: "Sleeves",
      fields: [{ key: "sleeveLength", label: "Sleeve", unit: "cm", store: "column", column: "sleeveLength" }]
    },
    {
      id: "lower",
      label: "Lower body",
      fields: [
        { key: "waist", label: "Waist", unit: "cm", store: "column", column: "waist" },
        { key: "inseam", label: "Trouser / inseam", unit: "cm", store: "column", column: "inseam" }
      ]
    }
  ],
  female: [
    {
      id: "upper",
      label: "Upper body",
      fields: [
        { key: "bust", label: "Bust", unit: "cm", store: "column", column: "chest" },
        { key: "shoulder", label: "Shoulder", unit: "cm", store: "column", column: "shoulder" },
        { key: "armhole", label: "Armhole", unit: "cm", store: "fields" }
      ]
    },
    {
      id: "sleeves",
      label: "Sleeves",
      fields: [{ key: "sleeveLength", label: "Sleeve", unit: "cm", store: "column", column: "sleeveLength" }]
    },
    {
      id: "lower",
      label: "Lower body",
      fields: [
        { key: "waist", label: "Waist", unit: "cm", store: "column", column: "waist" },
        { key: "hip", label: "Hip", unit: "cm", store: "column", column: "hip" }
      ]
    },
    {
      id: "length",
      label: "Length",
      fields: [{ key: "dressLength", label: "Garment length", unit: "cm", store: "fields" }]
    }
  ],
  child: [
    {
      id: "body",
      label: "Body",
      fields: [
        { key: "height", label: "Height", unit: "cm", store: "fields" },
        { key: "chest", label: "Chest", unit: "cm", store: "column", column: "chest" },
        { key: "waist", label: "Waist", unit: "cm", store: "column", column: "waist" },
        { key: "shoulder", label: "Shoulder", unit: "cm", store: "column", column: "shoulder" },
        { key: "sleeveLength", label: "Sleeve", unit: "cm", store: "column", column: "sleeveLength" }
      ]
    }
  ],
  baby: [
    {
      id: "body",
      label: "Body",
      fields: [
        { key: "height", label: "Length / height", unit: "cm", store: "fields" },
        { key: "chest", label: "Chest", unit: "cm", store: "column", column: "chest" },
        { key: "waist", label: "Waist", unit: "cm", store: "column", column: "waist" }
      ]
    }
  ]
};

export function categoryToItemGender(category: MeasurementCategory): "male" | "female" | "kids" {
  if (category === "male") return "male";
  if (category === "female") return "female";
  return "kids";
}

export function itemGenderToCategory(gender?: string, size?: string): MeasurementCategory {
  if (size === "baby") return "baby";
  if (gender === "kids" || size === "kids") return "child";
  if (gender === "male") return "male";
  return "female";
}

export function valuesToItemMeasurements(
  category: MeasurementCategory,
  values: Record<string, string>
) {
  return {
    gender: categoryToItemGender(category),
    chest: values.chest || values.bust || "",
    breast: values.bust || "",
    waist: values.waist || "",
    shoulder: values.shoulder || "",
    arm: values.sleeveLength || "",
    height: values.height || values.dressLength || "",
    vest: values.hip || ""
  };
}

export function valuesToCustomerMeasurementBody(
  category: MeasurementCategory,
  values: Record<string, string>,
  notes = ""
) {
  const body: Record<string, unknown> = { category, notes, fields: {} as Record<string, number> };
  for (const group of MEASUREMENT_SCHEMAS[category]) {
    for (const field of group.fields) {
      const raw = values[field.key];
      if (!raw) continue;
      const num = Number(raw);
      if (Number.isNaN(num)) continue;
      if (field.store === "column" && field.column) body[field.column] = num;
      else (body.fields as Record<string, number>)[field.key] = num;
    }
  }
  return body;
}
