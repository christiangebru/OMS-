import type { QueueItem, Staff } from "@/lib/types";
import { stageLabel } from "@/lib/format";

/**
 * Floor / Distribution share one picture: WHERE each garment physically is.
 *
 *   new       not received yet (still at the office/showroom)
 *   storage   with the manager, waiting to be given to the next station
 *   <STAGE>   at a station (checked in)
 *   OFF_SITE  with an outside person
 *
 * A garment made as separate parts (WR, UB, LB…) shows as ONE card per place,
 * with its parts inside. The garment itself is not shown while its parts do
 * the work (`waiting_parts`), nor are parts already done (`ready_for_assembly`).
 */
export type BoardGroup = {
  key: string;
  place: string;
  /** The garment row when present (else the first part). */
  lead: QueueItem;
  rows: QueueItem[];
  isParts: boolean;
  title: string;
  code: string;
  partsTotal: number;
  partsReady: number;
};

const NOT_SHOWN = new Set(["waiting_parts", "ready_for_assembly"]);

export const STATIONS = ["SEWING_CUTTING", "DESIGN", "EMBROIDERY", "FINAL_SEWING", "FINISHING"];
/** Floor columns, left to right. */
export const PLACES = ["new", "storage", ...STATIONS, "OFF_SITE"];

export function placeLabel(place: string) {
  if (place === "new") return "Not received";
  if (place === "storage") return "With manager";
  if (place === "done") return "Finished";
  return stageLabel(place);
}

export function itemCode(item: QueueItem) {
  return item.labelBarcode || item.barcodeValue;
}

/** "ORD-1003-1-WR" → "ORD-1003-1" (the garment's code). */
function garmentCodeOf(part: QueueItem) {
  const code = itemCode(part);
  return part.partCode ? code.replace(new RegExp(`-${part.partCode}$`), "") : code;
}

function placeOf(row: QueueItem) {
  if (row.place) return row.place;
  if (row.inProgress) return row.openStage || row.currentStage || "storage";
  return "storage";
}

export function groupBoard(items: QueueItem[]): BoardGroup[] {
  const byId = new Map(items.map((i) => [i.itemId, i]));
  const groups = new Map<string, BoardGroup>();
  for (const row of items) {
    if (NOT_SHOWN.has(row.boardStatus)) continue;
    const place = placeOf(row);
    if (place === "done") continue;
    const isPart = row.itemKind === "part" && Boolean(row.parentItemId);
    const parent = isPart ? byId.get(row.parentItemId!) : undefined;
    const key = isPart ? `${row.parentItemId}:${place}` : row.itemId;
    const existing = groups.get(key);
    if (existing) {
      existing.rows.push(row);
      continue;
    }
    groups.set(key, {
      key,
      place,
      lead: parent || row,
      rows: [row],
      isParts: isPart,
      title: parent?.clothingType || row.clothingType,
      code: isPart ? (parent ? itemCode(parent) : garmentCodeOf(row)) : itemCode(row),
      partsTotal: parent?.parts?.total || 0,
      partsReady: parent?.parts?.ready || 0
    });
  }
  for (const g of groups.values()) {
    g.rows.sort((a, b) => (a.partCode || "").localeCompare(b.partCode || ""));
  }
  return [...groups.values()];
}

/** Next step for a group waiting with the manager (or new). */
export function nextStepOf(g: BoardGroup) {
  return g.rows[0].nextStage;
}

/** Worker currently holding it (at a station) or planned for its next step. */
export function workerOf(g: BoardGroup) {
  const names = [...new Set(g.rows.map((r) => r.assignment?.staff?.name).filter(Boolean))];
  return names.join(", ");
}

/** Overdue first, then RUSH/VIP, then the nearest due date. */
export function byUrgency(a: BoardGroup, b: BoardGroup) {
  const rank = (g: BoardGroup) => (g.lead.overdue ? 0 : g.lead.priority && g.lead.priority !== "NORMAL" ? 1 : 2);
  return (
    rank(a) - rank(b) ||
    new Date(a.lead.requiredCompletionDate || 0).getTime() - new Date(b.lead.requiredCompletionDate || 0).getTime()
  );
}

const LEGACY: Record<string, string> = { CUTTING: "SEWING_CUTTING", SEWING: "SEWING_CUTTING" };

/** Can this worker do `stage`? (legacy CUTTING/SEWING skills count as sewing & cutting) */
export function canDo(staff: Staff, stage: string) {
  return (staff.skills || []).some((sk) => sk === stage || LEGACY[sk] === stage);
}
