import { v4 as uuidv4 } from "uuid";
import bwipjs from "bwip-js";

export function generateOrderBarcodeValue(orderId) {
  return `ORD-${String(orderId).replace(/^ORD-/i, "")}`.toUpperCase();
}

/**
 * Short, stable garment barcode.
 * Sequential orders: ORD-1001-1
 * Legacy / non-numeric order ids: G{tail}-01
 * One-arg legacy call with a 24-char item id: G{last6}
 */
export function generateItemBarcodeValue(orderIdOrItemId, index = 1) {
  const raw = String(orderIdOrItemId || "").trim();
  const n = Math.max(1, Number(index) || 1);
  if (/^ORD-\d+$/i.test(raw)) {
    return `${raw.toUpperCase()}-${n}`;
  }
  if (arguments.length === 1 && /^[a-f0-9]{24}$/i.test(raw)) {
    return `G${raw.slice(-6).toUpperCase()}`;
  }
  const tail = raw.replace(/^ORD-/i, "").replace(/-/g, "").slice(-4).toUpperCase() || "X";
  return `G${tail}-${String(n).padStart(2, "0")}`;
}

export function generateUniqueBarcode(prefix = "BC") {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${uuidv4().slice(0, 8).toUpperCase()}`;
}

export async function ensureUniqueItemBarcode(client, orderId, index, itemId) {
  let value = generateItemBarcodeValue(orderId, index);
  const clash = await client.orderItem.findFirst({
    where: { barcodeValue: { equals: value, mode: "insensitive" } }
  });
  if (clash) {
    const extra = String(itemId || uuidv4()).replace(/-/g, "").slice(-3).toUpperCase();
    value = `${value}-${extra}`;
  }
  return value;
}

/**
 * Render Code128 barcode as PNG Buffer.
 */
export async function renderBarcodePng(text, opts = {}) {
  return bwipjs.toBuffer({
    bcid: "code128",
    text: String(text),
    scale: opts.scale || 3,
    height: opts.height || 12,
    includetext: opts.includetext !== false,
    textxalign: "center"
  });
}
