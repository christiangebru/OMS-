import {
  CANONICAL_GARMENT_SEQUENCE,
  SKIP_EMBROIDERY_SEQUENCE
} from "../constants/production.js";

const EMBROIDERY_SEQ = [...CANONICAL_GARMENT_SEQUENCE];
const PLAIN_SEQ = [...SKIP_EMBROIDERY_SEQUENCE];

export const DEFAULT_CLOTHING_TYPE_SEEDS = [
  {
    key: "womens_dress",
    label: "Women's dress",
    stageSequence: EMBROIDERY_SEQ,
    includesEmbroidery: true,
    itemKind: "garment",
    partCodes: ["WR", "UB", "LB"],
    offSiteStages: ["EMBROIDERY"],
    compactLabel: false,
    measurementProfile: "female"
  },
  {
    key: "thobe_embroidered",
    label: "Thobe (embroidered)",
    stageSequence: EMBROIDERY_SEQ,
    includesEmbroidery: true,
    itemKind: "garment",
    partCodes: ["WR", "UB", "LB"],
    offSiteStages: ["EMBROIDERY"],
    compactLabel: false,
    measurementProfile: "male"
  },
  {
    key: "thobe",
    label: "Thobe",
    stageSequence: PLAIN_SEQ,
    includesEmbroidery: false,
    itemKind: "garment",
    partCodes: ["WR", "UB", "LB"],
    offSiteStages: [],
    compactLabel: false,
    measurementProfile: "male"
  },
  {
    key: "abaya_embroidered",
    label: "Abaya (embroidered)",
    stageSequence: EMBROIDERY_SEQ,
    includesEmbroidery: true,
    itemKind: "garment",
    partCodes: ["WR", "UB", "LB"],
    offSiteStages: ["EMBROIDERY"],
    compactLabel: false,
    measurementProfile: "female"
  },
  {
    key: "abaya",
    label: "Abaya",
    stageSequence: PLAIN_SEQ,
    includesEmbroidery: false,
    itemKind: "garment",
    partCodes: ["WR", "UB", "LB"],
    offSiteStages: [],
    compactLabel: false,
    measurementProfile: "female"
  },
  {
    key: "shirt",
    label: "Men's shirt",
    stageSequence: EMBROIDERY_SEQ,
    includesEmbroidery: true,
    itemKind: "garment",
    partCodes: ["WR", "BD"],
    offSiteStages: ["EMBROIDERY", "FINAL_SEWING"],
    compactLabel: false,
    measurementProfile: "male"
  },
  {
    key: "pants",
    label: "Men's trouser",
    stageSequence: ["SEWING_CUTTING", "FINAL_SEWING", "FINISHING", "SHOWROOM"],
    includesEmbroidery: false,
    itemKind: "garment",
    partCodes: [],
    offSiteStages: ["SEWING_CUTTING", "FINAL_SEWING"],
    compactLabel: false,
    measurementProfile: "male"
  },
  {
    key: "kids_garment",
    label: "Kids garment",
    stageSequence: PLAIN_SEQ,
    includesEmbroidery: false,
    itemKind: "garment",
    partCodes: ["WR", "BD"],
    offSiteStages: [],
    compactLabel: false,
    measurementProfile: "kids"
  },
  {
    key: "belt",
    label: "Belt",
    stageSequence: ["SEWING_CUTTING", "FINISHING", "SHOWROOM"],
    includesEmbroidery: false,
    itemKind: "accessory",
    partCodes: [],
    offSiteStages: [],
    compactLabel: true,
    measurementProfile: "none"
  },
  {
    key: "tiara_crown",
    label: "Tiara / crown",
    stageSequence: ["FINISHING", "SHOWROOM"],
    includesEmbroidery: false,
    itemKind: "accessory",
    partCodes: [],
    offSiteStages: [],
    compactLabel: true,
    measurementProfile: "none"
  },
  {
    key: "netela",
    label: "Netela",
    stageSequence: ["EMBROIDERY", "FINISHING", "SHOWROOM"],
    includesEmbroidery: true,
    itemKind: "accessory",
    partCodes: [],
    offSiteStages: ["EMBROIDERY"],
    compactLabel: true,
    measurementProfile: "none"
  }
];

export function normalizePhone(phone) {
  return String(phone || "")
    .replace(/[^\d+]/g, "")
    .trim();
}
