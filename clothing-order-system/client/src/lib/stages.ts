import type { ClothingTypeConfig, ProductionStage } from "./types";
import { PRODUCTION_STAGES } from "./types";

export function clothingTypeKey(type: string) {
  return String(type || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

export function stageSequenceFor(type: string, configs: ClothingTypeConfig[] = []): ProductionStage[] {
  const key = clothingTypeKey(type);
  const cfg = configs.find(
    (c) => c.key === key || c.label.toLowerCase() === String(type || "").trim().toLowerCase()
  );
  if (cfg?.stageSequence?.length) return cfg.stageSequence;
  return PRODUCTION_STAGES.filter((s) => s !== "EMBROIDERY");
}

export function measureSummary(m?: {
  gender?: string;
  vest?: string;
  height?: string;
  breast?: string;
  waist?: string;
  shoulder?: string;
  arm?: string;
  chest?: string;
} | null) {
  if (!m) return "";
  return [
    m.chest && `chest ${m.chest}`,
    m.breast && `bust ${m.breast}`,
    m.waist && `waist ${m.waist}`,
    m.shoulder && `shoulder ${m.shoulder}`,
    m.arm && `sleeve ${m.arm}`,
    m.height && `height ${m.height}`,
    m.vest && `vest ${m.vest}`
  ]
    .filter(Boolean)
    .join(" · ");
}
