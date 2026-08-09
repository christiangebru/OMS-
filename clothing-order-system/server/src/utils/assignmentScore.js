import { Staff } from "../models/Staff.js";
import { StaffSkill } from "../models/StaffSkill.js";
import { StaffAssignment } from "../models/StaffAssignment.js";
import { Order } from "../models/Order.js";
import { OrderItem } from "../models/OrderItem.js";
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

function buildReason({ staff, urgency, skillMatch, availability, priority, daysLeft }) {
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
  const item = await OrderItem.findById(orderItemId).lean();
  if (!item) throw Object.assign(new Error("Order item not found"), { status: 404 });

  const order = await Order.findById(item.order).lean();
  if (!order) throw Object.assign(new Error("Order not found"), { status: 404 });

  const skilled = await StaffSkill.find({ stage }).select("staffId").lean();
  const staffIds = skilled.map((s) => s.staffId);
  if (!staffIds.length) return { item, order, rankings: [] };

  const staffList = await Staff.find({
    _id: { $in: staffIds },
    tenantId: DEFAULT_TENANT_ID,
    active: true,
    status: { $ne: "OFF_DUTY" }
  }).lean();

  const activeCounts = await StaffAssignment.aggregate([
    { $match: { staffId: { $in: staffList.map((s) => s._id) }, completedAt: null } },
    { $group: { _id: "$staffId", count: { $sum: 1 } } }
  ]);
  const countMap = new Map(activeCounts.map((r) => [String(r._id), r.count]));

  const due = order.requiredCompletionDate ? new Date(order.requiredCompletionDate) : null;
  const daysLeft = due
    ? (due.getTime() - Date.now()) / (24 * 60 * 60 * 1000)
    : null;

  const u = urgencyScore(order.requiredCompletionDate);
  const p = priorityScore(order.priority);
  const w = ASSIGNMENT_WEIGHTS;

  const rankings = staffList
    .map((staff) => {
      const active = countMap.get(String(staff._id)) || 0;
      staff._activeCount = active;
      const skill = skillMatchScore(item.difficultyLevel, staff.skillLevel);
      const avail = availabilityScore(active);
      const rankedScore =
        w.urgency * u + w.skillMatch * skill + w.availability * avail + w.priority * p;

      return {
        staff: {
          _id: staff._id,
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
          urgency: u,
          skillMatch: skill,
          availability: avail,
          priority: order.priority,
          daysLeft
        })
      };
    })
    .sort((a, b) => b.scores.rankedScore - a.scores.rankedScore);

  return { item, order, rankings };
}
