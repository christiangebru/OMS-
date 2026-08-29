import { prisma } from "../db/prisma.js";

/**
 * Short shop-floor order numbers: ORD-1001, ORD-1002, …
 * Legacy ORD-<time>-<uuid> values remain valid unique keys.
 */
export async function nextSequentialOrderNumber(client = prisma) {
  const rows = await client.$queryRaw`
    SELECT COALESCE(MAX(CAST(substring("orderId" FROM 5) AS INTEGER)), 1000) AS n
    FROM orders
    WHERE "orderId" ~ '^ORD-[0-9]+$'
  `;
  const n = Number(rows?.[0]?.n ?? 1000) + 1;
  if (!Number.isFinite(n) || n < 1001) return 1001;
  return n;
}

export async function generateOrderId(client = prisma) {
  const n = await nextSequentialOrderNumber(client);
  return `ORD-${n}`;
}

/** Numeric-only fallback if a sequential insert collides. Never UUID. */
export async function generateOrderIdFallback(client = prisma) {
  const n = await nextSequentialOrderNumber(client);
  return `ORD-${n + Math.floor(Math.random() * 7) + 1}`;
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
  const terminal = ["completed", "ready_to_pack", "delivered"];
  if (terminal.includes(order.productionStatus)) return false;
  const ref = order.estimatedProductionCompletion || order.requiredCompletionDate;
  return new Date() > new Date(ref);
}
