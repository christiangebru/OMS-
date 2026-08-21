import { v4 as uuidv4 } from "uuid";
import bwipjs from "bwip-js";

export function generateOrderBarcodeValue(orderId) {
  return `ORD-${String(orderId).replace(/^ORD-/i, "")}`.toUpperCase();
}

export function isSimpleItemBarcode(value) {
  return /^ORD-\d+-\d+$/i.test(String(value || "").trim());
}

export function sequentialOrderNumber(orderId) {
  const m = String(orderId || "").trim().match(/^ORD-(\d+)$/i);
  return m ? Number(m[1]) : null;
}

/**
 * Human-facing garment code for labels and verbal handoff.
 * Never uses UUIDs, CUIDs, or ITM-* as the printed identity.
 * Stored barcodeValue remains the lookup key for legacy rows.
 */
export function operationalItemBarcode(orderId, index = 1, storedBarcode) {
  const n = Math.max(1, Number(index) || 1);
  if (isSimpleItemBarcode(storedBarcode)) return String(storedBarcode).trim().toUpperCase();
  const seq = sequentialOrderNumber(orderId);
  if (seq) return `ORD-${seq}-${n}`;
  const digits = String(orderId || "").replace(/\D/g, "").slice(-4);
  if (digits) return `ORD-${Number(digits)}-${n}`;
  const tail = String(orderId || "")
    .replace(/^ORD-/i, "")
    .replace(/-/g, "")
    .slice(-4)
    .toUpperCase();
  return `ORD-${tail || "X"}-${n}`;
}

/**
 * Short, stable garment barcode for NEW items: ORD-1001-1
 */
export function generateItemBarcodeValue(orderIdOrItemId, index = 1) {
  return operationalItemBarcode(orderIdOrItemId, index);
}

export function generateUniqueBarcode(prefix = "BC") {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${uuidv4().slice(0, 8).toUpperCase()}`;
}

export async function ensureUniqueItemBarcode(client, orderId, index, _itemId) {
  let n = Math.max(1, Number(index) || 1);
  for (let i = 0; i < 40; i += 1) {
    const value = operationalItemBarcode(orderId, n);
    const clash = await client.orderItem.findFirst({
      where: { barcodeValue: { equals: value, mode: "insensitive" } }
    });
    if (!clash) return value;
    n += 1;
  }
  return operationalItemBarcode(orderId, n);
}

/**
 * Compact Code128 for physical garment labels.
 */
export async function renderBarcodePng(text, opts = {}) {
  const value = String(text);
  return bwipjs.toBuffer({
    bcid: "code128",
    text: value,
    scale: opts.scale || 2,
    height: opts.height || 8,
    includetext: opts.includetext !== false,
    textxalign: "center",
    textsize: opts.textsize || 8,
    paddingwidth: 4,
    paddingheight: 2
  });
}
