import {
  FULL_STAGE_SEQUENCE,
  SKIP_EMBROIDERY_SEQUENCE
} from "../constants/production.js";

export const DEFAULT_CLOTHING_TYPE_SEEDS = [
  {
    key: "thobe_embroidered",
    label: "Thobe (embroidered)",
    stageSequence: [...FULL_STAGE_SEQUENCE],
    includesEmbroidery: true
  },
  {
    key: "thobe",
    label: "Thobe",
    stageSequence: [...SKIP_EMBROIDERY_SEQUENCE],
    includesEmbroidery: false
  },
  {
    key: "pants",
    label: "Pants",
    stageSequence: [...SKIP_EMBROIDERY_SEQUENCE],
    includesEmbroidery: false
  },
  {
    key: "shirt",
    label: "Shirt",
    stageSequence: [...SKIP_EMBROIDERY_SEQUENCE],
    includesEmbroidery: false
  },
  {
    key: "abaya_embroidered",
    label: "Abaya (embroidered)",
    stageSequence: [...FULL_STAGE_SEQUENCE],
    includesEmbroidery: true
  },
  {
    key: "abaya",
    label: "Abaya",
    stageSequence: [...SKIP_EMBROIDERY_SEQUENCE],
    includesEmbroidery: false
  }
];

export function normalizePhone(phone) {
  return String(phone || "")
    .replace(/[^\d+]/g, "")
    .trim();
}
