import type { Order, OrderItem } from "./types";
import { labelBarcode } from "./format";

export type LabelKind = "order" | "garment" | "part" | "accessory";

/** One physical sticker. */
export type Label = {
  key: string;
  kind: LabelKind;
  code: string;
  title: string;
  /** Second line: customer, or "of ORD-1002-1 · Dress" for a part. */
  subtitle: string;
  due: string;
  priority: string;
  orderId: string;
  /** Parts only: WR, UB, LB, BD. */
  partCode?: string;
};

export type GarmentGroup = { label: Label; parts: Label[] };

/** Order → garments (each with its parts) + accessories. */
export type OrderLabels = {
  orderId: string;
  customer: string;
  order: Label;
  garments: GarmentGroup[];
  accessories: Label[];
};

const PART_NAMES: Record<string, string> = {
  WR: "Wrist",
  UB: "Upper body",
  LB: "Lower body",
  BD: "Body"
};

export function partName(code?: string) {
  const c = String(code || "").toUpperCase();
  return PART_NAMES[c] || c || "Part";
}

function itemCode(order: Order, it: OrderItem, index: number) {
  return it.labelBarcode || labelBarcode(order.orderId, it.itemIndex || index, it.barcodeValue, it.partCode);
}

export function labelsForOrder(order: Order): OrderLabels {
  const customer = order.customerName || order.customer?.name || "—";
  const base = {
    due: order.requiredCompletionDate,
    priority: order.priority || "NORMAL",
    orderId: order.orderId
  };
  const items = order.items || [];
  const top = items.filter((it) => it.itemKind !== "part" && !it.parentItemId);
  const garments: GarmentGroup[] = [];
  const accessories: Label[] = [];

  top.forEach((it, i) => {
    const code = itemCode(order, it, i + 1);
    if (!code) return;
    const label: Label = {
      ...base,
      key: it._id || code,
      kind: it.itemKind === "accessory" ? "accessory" : "garment",
      code,
      title: it.clothingType,
      subtitle: customer
    };
    if (label.kind === "accessory") {
      accessories.push(label);
      return;
    }
    const parts = items.filter(
      (p) => p.itemKind === "part" && p.parentItemId === it._id && p.printPartLabel !== false
    );
    garments.push({
      label,
      parts: parts
        .map((p, j) => {
          const pc = itemCode(order, p, it.itemIndex || i + 1);
          return {
            ...base,
            key: p._id || pc,
            kind: "part" as const,
            code: pc,
            partCode: String(p.partCode || "").toUpperCase(),
            title: `${partName(p.partCode)} · part ${j + 1} of ${parts.length}`,
            subtitle: `of ${code}`
          };
        })
        .filter((p) => p.code)
    });
  });

  return {
    orderId: order.orderId,
    customer,
    order: {
      ...base,
      key: `order-${order._id}`,
      kind: "order",
      code: order.barcodeValue || order.orderId,
      title: `Order · ${top.length} item${top.length === 1 ? "" : "s"}`,
      subtitle: customer
    },
    garments,
    accessories
  };
}

/** Every sticker of an order, in print order: order, each garment then its parts, accessories. */
export function flattenOrderLabels(g: OrderLabels): Label[] {
  return [g.order, ...g.garments.flatMap((x) => [x.label, ...x.parts]), ...g.accessories];
}

export type PrintMode = "roll" | "sheet";
const MODE_KEY = "oms.labelPrintMode";

export function savedPrintMode(): PrintMode {
  try {
    return localStorage.getItem(MODE_KEY) === "sheet" ? "sheet" : "roll";
  } catch {
    return "roll";
  }
}

export function savePrintMode(mode: PrintMode) {
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    /* private mode */
  }
}
