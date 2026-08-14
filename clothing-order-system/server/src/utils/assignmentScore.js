import { prisma } from "../db/prisma.js";
import { ASSIGNMENT_WEIGHTS } from "../config/assignmentWeights.js";
import { DEFAULT_TENANT_ID } from "../config/tenant.js";

function clamp01(n) {
  return Math.max(0, Math.min(1, n));
}

function urgencyScore(requiredCompletionDate) {
  if (!requiredCompletionDate) return 0.5;
  const due = new Date(requiredCompletionDate);
  const now = new Date();
  const days = (due.getTime() - now.getTime()) / (24 * 60 * 60 * 1000);
  if (days <= 0) return 1;
  if (days >= 14) return 0.15;
  return clamp01(1 - days / 14);
}

function skillMatchScore(difficultyLevel, skillLevel) {
  const d = Number(difficultyLevel) || 3;
  const s = Number(skillLevel) || 3;
  return clamp01(1 - Math.abs(d - s) / 4);
}

function availabilityScore(activeCount) {
  const n = Number(activeCount) || 0;
  return clamp01(1 / (1 + n));
}

function priorityScore(priority) {
  if (priority === "VIP") return 1;
  if (priority === "RUSH") return 0.75;
  return 0.25;
}

function buildReason({ staff, skillMatch, priority, daysLeft }) {
  const parts = [];
  if (staff.status === "AVAILABLE") parts.push("Available");
  else parts.push(staff.status.replace("_", " "));
  if (skillMatch >= 0.75) parts.push("skill match");
  else if (skillMatch < 0.5) parts.push("skill gap");
  if (daysLeft != null) {
    if (daysLeft < 0) parts.push(`${Math.abs(Math.ceil(daysLeft))}d overdue`);
    else parts.push(`${Math.ceil(daysLeft)} days left`);
  }
  if (priority === "RUSH" || priority === "VIP") parts.push(priority);
  if ((staff._activeCount || 0) > 0) parts.push(`${staff._activeCount} active jobs`);
  return parts.join(" · ");
}

/**
 * Rank eligible staff for orderItem + stage.
 */
export async function rankStaffForAssignment(orderItemId, stage) {
  const item = await prisma.orderItem.findUnique({ where: { id: orderItemId } });
  if (!item) throw Object.assign(new Error("Order item not found"), { status: 404 });

  const order = await prisma.order.findUnique({ where: { id: item.order } });
  if (!order) throw Object.assign(new Error("Order not found"), { status: 404 });

  const skilled = await prisma.staffSkill.findMany({
    where: { stage },
    select: { staffId: true }
  });
  const staffIds = [...new Set(skilled.map((sk) => sk.staffId))];
  if (!staffIds.length) return { item, order, rankings: [] };

  const staffList = await prisma.staff.findMany({
    where: {
      id: { in: staffIds },
      tenantId: DEFAULT_TENANT_ID,
      active: true,
      status: { not: "OFF_DUTY" }
    }
  });

  const activeCounts = staffList.length
    ? await prisma.staffAssignment.groupBy({
        by: ["staffId"],
        where: { staffId: { in: staffList.map((s) => s.id) }, completedAt: null },
        _count: { _all: true }
      })
    : [];
  const countMap = new Map(activeCounts.map((r) => [r.staffId, r._count._all]));

  const due = order.requiredCompletionDate ? new Date(order.requiredCompletionDate) : null;
  const daysLeft = due ? (due.getTime() - Date.now()) / (24 * 60 * 60 * 1000) : null;

  const u = urgencyScore(order.requiredCompletionDate);
  const p = priorityScore(order.priority);
  const w = ASSIGNMENT_WEIGHTS;

  const rankings = staffList
    .map((staff) => {
      const active = countMap.get(staff.id) || 0;
      staff._activeCount = active;
      const skill = skillMatchScore(item.difficultyLevel, staff.skillLevel);
      const avail = availabilityScore(active);
      const rankedScore =
        w.urgency * u + w.skillMatch * skill + w.availability * avail + w.priority * p;

      return {
        staff: {
          _id: staff.id,
          name: staff.name,
          phone: staff.phone,
          role: staff.role,
          status: staff.status,
          skillLevel: staff.skillLevel,
          activeAssignmentCount: active
        },
        scores: {
          urgencyScore: Number(u.toFixed(3)),
          skillMatchScore: Number(skill.toFixed(3)),
          availabilityScore: Number(avail.toFixed(3)),
          priorityScore: Number(p.toFixed(3)),
          rankedScore: Number(rankedScore.toFixed(4))
        },
        reason: buildReason({
          staff,
          skillMatch: skill,
          priority: order.priority,
          daysLeft
        })
      };
    })
    .sort((a, b) => b.scores.rankedScore - a.scores.rankedScore);

  return { item, order, rankings };
}
