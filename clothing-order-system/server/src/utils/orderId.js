import { v4 as uuidv4 } from "uuid";

export function generateOrderId() {
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
