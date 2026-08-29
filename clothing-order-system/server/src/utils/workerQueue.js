/**
 * Worker queue ranking. ASSIGNED ≠ BUSY.
 * A worker may have many queued assignments and exactly one active (checked-in) garment.
 */

function daysUntil(date) {
  if (!date) return null;
  return (new Date(date).getTime() - Date.now()) / (24 * 60 * 60 * 1000);
}

export function queuePriorityReason({ overdue, daysRemaining, priority, queuePosition }) {
  if (queuePosition != null) return "Priority: manager queue order";
  if (overdue) return "Priority: overdue";
  if (priority === "VIP") return "Priority: VIP";
  if (daysRemaining != null && daysRemaining < 1) return "Priority: due today";
  if (priority === "RUSH") return "Priority: rush";
  if (daysRemaining != null) return "Priority: earliest due date";
  return "Priority: assignment time";
}

export function compareQueueItems(a, b) {
  const posA = a.queuePosition;
  const posB = b.queuePosition;
  if (posA != null || posB != null) {
    if (posA == null) return 1;
    if (posB == null) return -1;
    if (posA !== posB) return posA - posB;
  }
  if (Boolean(a.overdue) !== Boolean(b.overdue)) return a.overdue ? -1 : 1;
  const pr = (p) => (p === "VIP" ? 0 : p === "RUSH" ? 1 : 2);
  const prDiff = pr(a.priority) - pr(b.priority);
  if (prDiff !== 0) return prDiff;
  const da = a.daysRemaining ?? 9999;
  const db = b.daysRemaining ?? 9999;
  if (da !== db) return da - db;
  const aa = new Date(a.assignedAt || 0).getTime();
  const ab = new Date(b.assignedAt || 0).getTime();
  return aa - ab;
}

export function decorateQueueRow(assignment, order, extra = {}) {
  const days = daysUntil(order?.requiredCompletionDate);
  const overdue =
    days != null &&
    days < 0 &&
    !["completed", "ready_to_pack", "delivered"].includes(order?.productionStatus || "");
  const row = {
    assignmentId: assignment.id,
    stage: assignment.stage,
    assignedAt: assignment.assignedAt,
    distributedAt: assignment.distributedAt,
    receivedAt: assignment.receivedAt,
    completedAt: assignment.completedAt,
    queuePosition: assignment.queuePosition,
    daysRemaining: days != null ? Number(days.toFixed(1)) : null,
    overdue,
    priority: order?.priority || "NORMAL",
    ...extra
  };
  row.priorityReason = queuePriorityReason(row);
  return row;
}

/**
 * Split a worker's assignments into now / upNext / queued / completed.
 */
export function splitWorkerQueue({ assignments = [], openCheckpoints = [] }) {
  const openItemIds = new Set(
    openCheckpoints.map((cp) => cp.orderItemId || cp.orderItem?.id).filter(Boolean)
  );
  const nowWorking = [];
  const queued = [];
  const completed = [];

  for (const row of assignments) {
    if (row.completedAt) {
      completed.push(row);
      continue;
    }
    const itemId = row.orderItemId || row.item?._id || row.item?.id;
    const openHere = openCheckpoints.find(
      (cp) =>
        (cp.orderItemId || cp.orderItem?.id) === itemId &&
        (!row.stage || cp.stage === row.stage)
    );
    if (openHere || openItemIds.has(itemId)) {
      nowWorking.push(row);
    } else {
      queued.push(row);
    }
  }

  nowWorking.sort(compareQueueItems);
  queued.sort(compareQueueItems);
  completed.sort((a, b) => new Date(b.completedAt || 0) - new Date(a.completedAt || 0));

  return {
    nowWorking,
    upNext: queued[0] || null,
    queued: queued.slice(1),
    queuedAll: queued,
    completed
  };
}
