import { v4 as uuidv4 } from "uuid";
import { prisma } from "../db/prisma.js";

/**
 * Short shop-floor order numbers: ORD-1001, ORD-1002, …
 * Legacy ORD-<time>-<uuid> values remain valid unique keys.
 */
export async function generateOrderId(client = prisma) {
  const rows = await client.$queryRaw`
    SELECT COALESCE(MAX(CAST(substring("orderId" FROM 5) AS INTEGER)), 1000) AS n
    FROM orders
    WHERE "orderId" ~ '^ORD-[0-9]+$'
  `;
  const n = Number(rows?.[0]?.n ?? 1000) + 1;
  if (!Number.isFinite(n) || n < 1001) {
    return `ORD-${1001 + Math.floor(Math.random() * 90)}`;
  }
  return `ORD-${n}`;
}

/** Fallback unique id used only if sequential insert collides. */
export function generateOrderIdFallback() {
  return `ORD-${Date.now().toString(36).toUpperCase()}-${uuidv4().slice(0, 8).toUpperCase()}`;
}

/**
 * Estimated completion = createdAt + max(productionDays among items) days
 */
export function computeEstimatedCompletion(createdAt, items) {
  const days = Math.max(1, ...items.map((i) => Number(i.productionDays) || 3));
  const d = new Date(createdAt);
  d.setDate(d.getDate() + days);
  return d;
}

export function isOrderDelayed(order) {
  const terminal = ["completed", "delivered"];
  if (terminal.includes(order.productionStatus)) return false;
  const ref = order.estimatedProductionCompletion || order.requiredCompletionDate;
  return new Date() > new Date(ref);
}
