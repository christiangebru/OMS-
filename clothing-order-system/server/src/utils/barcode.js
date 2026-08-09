import { v4 as uuidv4 } from "uuid";
import bwipjs from "bwip-js";

export function generateOrderBarcodeValue(orderId) {
  return `ORD-${String(orderId).replace(/^ORD-/, "")}`;
}

export function generateItemBarcodeValue(itemId) {
  const id = itemId ? String(itemId) : uuidv4().replace(/-/g, "").slice(0, 12);
  return `ITM-${id.toUpperCase().slice(-16)}`;
}

export function generateUniqueBarcode(prefix = "BC") {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${uuidv4().slice(0, 8).toUpperCase()}`;
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
