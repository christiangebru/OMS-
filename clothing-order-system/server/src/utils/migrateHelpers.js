import {
  CANONICAL_GARMENT_SEQUENCE,
  SKIP_EMBROIDERY_SEQUENCE
} from "../constants/production.js";

const EMBROIDERY_SEQ = [...CANONICAL_GARMENT_SEQUENCE];
const PLAIN_SEQ = [...SKIP_EMBROIDERY_SEQUENCE];
const NETELA_EMBROIDERED_SEQ = ["EMBROIDERY", "FINISHING", "FRINGE_TWISTING", "SHOWROOM"];

export const DEFAULT_CLOTHING_TYPE_SEEDS = [
  {
    key: "dress",
    label: "Dress — upper body embroidery only",
    stageSequence: EMBROIDERY_SEQ,
    includesEmbroidery: true,
    itemKind: "garment",
    partCodes: ["WR", "UB", "LB"],
    // In-house embroidery by default; the lower body has no embroidery.
    offSiteStages: [],
    partSkipStages: { LB: ["EMBROIDERY"] },
    compactLabel: false,
    measurementProfile: "female"
  },
  {
    key: "womens_dress",
    label: "Dress — full embroidery",
    stageSequence: EMBROIDERY_SEQ,
    includesEmbroidery: true,
    itemKind: "garment",
    partCodes: ["WR", "UB", "LB"],
    // Embroidery in-house by default; off-site is optional per garment.
    offSiteStages: [],
    compactLabel: false,
    measurementProfile: "female"
  },
  {
    key: "thobe_embroidered",
    active: false,
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
    active: false,
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
    active: false,
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
    active: false,
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
    label: "Shirt",
    stageSequence: EMBROIDERY_SEQ,
    includesEmbroidery: true,
    itemKind: "garment",
    partCodes: ["WR", "BD"],
    // Cut/prepare off-site → back for embroidery → out again to finish → re-enter at finishing.
    offSiteStages: ["SEWING_CUTTING", "FINAL_SEWING"],
    compactLabel: false,
    measurementProfile: "male"
  },
  {
    key: "pants",
    label: "Trouser",
    stageSequence: ["SEWING_CUTTING", "FINAL_SEWING", "FINISHING", "SHOWROOM"],
    includesEmbroidery: false,
    itemKind: "garment",
    partCodes: [],
    // Made entirely by an outside maker (own material); comes back complete.
    offSiteStages: ["SEWING_CUTTING", "FINAL_SEWING", "FINISHING"],
    compactLabel: false,
    measurementProfile: "male"
  },
  {
    key: "kids_garment",
    active: false,
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
  // Netela: plain fabric bought, embroidered and finished in-house, then the
  // edges go out for fringe twisting (kuchet).
  {
    key: "netela",
    label: "Netela — embroidered",
    stageSequence: NETELA_EMBROIDERED_SEQ,
    includesEmbroidery: true,
    itemKind: "accessory",
    partCodes: [],
    offSiteStages: ["FRINGE_TWISTING"],
    compactLabel: true,
    measurementProfile: "none"
  },
  // Tilet fabric (woven border, matches the dress): only fringe twisting, off-site.
  {
    key: "netela_tilet",
    label: "Netela — tilet, no embroidery",
    stageSequence: ["FRINGE_TWISTING", "SHOWROOM"],
    includesEmbroidery: false,
    itemKind: "accessory",
    partCodes: [],
    offSiteStages: ["FRINGE_TWISTING"],
    compactLabel: true,
    measurementProfile: "none"
  },
  // Plain tilet with a design embroidered on top: same route as embroidered.
  {
    key: "netela_tilet_embroidered",
    label: "Netela — tilet with embroidery",
    stageSequence: NETELA_EMBROIDERED_SEQ,
    includesEmbroidery: true,
    itemKind: "accessory",
    partCodes: [],
    offSiteStages: ["FRINGE_TWISTING"],
    compactLabel: true,
    measurementProfile: "none"
  }
];

export function normalizePhone(phone) {
  return String(phone || "")
    .replace(/[^\d+]/g, "")
    .trim();
}
