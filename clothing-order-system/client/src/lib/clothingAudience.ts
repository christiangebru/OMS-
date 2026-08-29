import type { ClothingAudience, ItemSetChoice, SizeCategory } from "@/lib/types";
import type { MeasurementCategory, MeasureScope } from "@/lib/measurementSchema";

export type { ClothingAudience, ItemSetChoice };

export const CLOTHING_AUDIENCE_OPTIONS: Array<{
  id: ClothingAudience;
  label: string;
  hint: string;
}> = [
  { id: "men", label: "Men's clothing", hint: "Shirt, trouser, or both" },
  { id: "women", label: "Women's clothing", hint: "Main garment plus belt or netela" },
  { id: "kids_boy", label: "Kids (boy) clothing", hint: "Same options as men" },
  { id: "kids_girl", label: "Kids (girls) clothing", hint: "Same options as women" }
];

export const MALE_SET_OPTIONS: Array<{ id: "shirt" | "trouser" | "both"; label: string }> = [
  { id: "shirt", label: "Shirt only" },
  { id: "trouser", label: "Trouser only" },
  { id: "both", label: "Both shirt + trouser" }
];

export const FEMALE_ACCESSORY_OPTIONS: Array<{ id: "belt" | "netela"; label: string }> = [
  { id: "belt", label: "Belt" },
  { id: "netela", label: "Netela" }
];

export function isMaleAudience(audience?: string | null): audience is "men" | "kids_boy" {
  return audience === "men" || audience === "kids_boy";
}

export function isFemaleAudience(audience?: string | null): audience is "women" | "kids_girl" {
  return audience === "women" || audience === "kids_girl";
}

export function audienceLabel(id?: string | null): string {
  return CLOTHING_AUDIENCE_OPTIONS.find((o) => o.id === id)?.label || "";
}

export function audienceShortLabel(id?: string | null): string {
  switch (id) {
    case "men":
      return "Men";
    case "women":
      return "Women";
    case "kids_boy":
      return "Kids (boy)";
    case "kids_girl":
      return "Kids (girls)";
    default:
      return "";
  }
}

export function audienceMeasureCategory(id: ClothingAudience): MeasurementCategory {
  return isMaleAudience(id) ? "male" : "female";
}

export function audienceSize(id: ClothingAudience): SizeCategory {
  return id === "kids_boy" || id === "kids_girl" ? "kids" : "adult";
}

export function audienceItemGender(id: ClothingAudience): "male" | "female" | "kids" {
  if (id === "kids_boy" || id === "kids_girl") return "kids";
  return id === "men" ? "male" : "female";
}

export function measureScopeForSet(choice?: ItemSetChoice | "" | null): MeasureScope {
  if (choice === "shirt") return "upper";
  if (choice === "trouser") return "lower";
  if (choice === "both") return "all";
  if (choice === "belt" || choice === "netela") return "none";
  return "all";
}

export function maleSetHelper(choice: "shirt" | "trouser" | "both"): string {
  if (choice === "shirt") return "This will create a shirt item only.";
  if (choice === "trouser") return "This will create a trouser item only.";
  return "This will create a shirt item and a trouser item.";
}
