import type { QueueItem } from "@/lib/types";

/**
 * Floor / Distribution grouping.
 *
 * A garment made as separate parts (WR, UB, LB…) shows as ONE card per stage,
 * with its parts inside, instead of one card per part. The garment itself is
 * not work until its parts are ready (`waiting_parts`), and a part whose own
 * stages are done waits to be joined (`ready_for_assembly`): neither is shown
 * as work on its own.
 */
export type BoardGroup = {
  key: string;
  stage: string;
  /** The garment row when present (else the first part). */
  lead: QueueItem;
  /** Rows doing the work in this group: the garment, or its parts at this stage. */
  rows: QueueItem[];
  isParts: boolean;
  title: string;
  code: string;
  /** Parts summary of the garment (all stages), when it is made as parts. */
  partsTotal: number;
  partsReady: number;
};

const NOT_WORK = new Set(["waiting_parts", "ready_for_assembly"]);

export function stageOf(item: QueueItem) {
  return item.inProgress || item.boardStatus === "in_progress" || item.boardStatus === "off_site"
    ? item.openStage || item.currentStage || item.nextStage
    : item.nextStage;
}

export function itemCode(item: QueueItem) {
  return item.labelBarcode || item.barcodeValue;
}

/** "ORD-1003-1-WR" → "ORD-1003-1" (the garment's code). */
function garmentCodeOf(part: QueueItem) {
  const code = itemCode(part);
  return part.partCode ? code.replace(new RegExp(`-${part.partCode}$`), "") : code;
}

export function groupBoard(items: QueueItem[]): BoardGroup[] {
  const byId = new Map(items.map((i) => [i.itemId, i]));
  const groups = new Map<string, BoardGroup>();
  for (const row of items) {
    if (NOT_WORK.has(row.boardStatus)) continue;
    const stage = stageOf(row) || "";
    const parent = row.itemKind === "part" && row.parentItemId ? byId.get(row.parentItemId) : undefined;
    const isPart = row.itemKind === "part" && Boolean(row.parentItemId);
    const key = isPart ? `${row.parentItemId}:${stage}` : row.itemId;
    const existing = groups.get(key);
    if (existing) {
      existing.rows.push(row);
      continue;
    }
    groups.set(key, {
      key,
      stage,
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

/** Status of a group: the most urgent of its rows. */
export function groupStatus(g: BoardGroup): QueueItem["boardStatus"] {
  const order: QueueItem["boardStatus"][] = [
    "waiting",
    "to_send",
    "received",
    "assigned",
    "distributed",
    "off_site",
    "in_progress"
  ];
  for (const st of order) if (g.rows.some((r) => r.boardStatus === st)) return st;
  return g.rows[0].boardStatus;
}

/** Overdue first, then RUSH/VIP, then the nearest due date. */
export function byUrgency(a: BoardGroup, b: BoardGroup) {
  const rank = (g: BoardGroup) => (g.lead.overdue ? 0 : g.lead.priority && g.lead.priority !== "NORMAL" ? 1 : 2);
  return (
    rank(a) - rank(b) ||
    new Date(a.lead.requiredCompletionDate || 0).getTime() - new Date(b.lead.requiredCompletionDate || 0).getTime()
  );
}
