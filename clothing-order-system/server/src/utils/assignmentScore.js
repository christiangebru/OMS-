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

function buildReason({ staff, skillMatch, stageSkill, priority, daysLeft }) {
  const reasons = [];
  if (staff.status === "AVAILABLE") {
    reasons.push({ ok: true, code: "available", label: "Available" });
  } else {
    reasons.push({
      ok: false,
      code: "availability",
      label: staff.status === "BUSY" ? "Currently busy" : staff.status.replace("_", " ")
    });
  }

  if (skillMatch >= 0.75) {
    reasons.push({ ok: true, code: "skill", label: `Stage skill ${stageSkill}/5 — strong match` });
  } else if (skillMatch >= 0.5) {
    reasons.push({ ok: true, code: "skill", label: `Stage skill ${stageSkill}/5` });
  } else {
    reasons.push({ ok: false, code: "skill", label: `Skill ${stageSkill}/5 — gap for this difficulty` });
  }

  const active = staff._activeCount || 0;
  if (active === 0) {
    reasons.push({ ok: true, code: "workload", label: "No active assignments" });
  } else if (active <= 2) {
    reasons.push({ ok: true, code: "workload", label: `Low workload (${active} active)` });
  } else {
    reasons.push({ ok: false, code: "workload", label: `${active} active assignments` });
  }

  if (daysLeft != null) {
    if (daysLeft < 0) {
      reasons.push({
        ok: false,
        code: "due",
        label: `${Math.abs(Math.ceil(daysLeft))}d overdue`
      });
    } else if (daysLeft <= 2) {
      reasons.push({ ok: false, code: "due", label: `${Math.ceil(daysLeft)} days left — urgent` });
    } else {
      reasons.push({ ok: true, code: "due", label: `${Math.ceil(daysLeft)} days until due` });
    }
  }

  if (priority === "VIP" || priority === "RUSH") {
    reasons.push({ ok: true, code: "priority", label: `${priority} order` });
  }

  const dueCapacity =
    daysLeft != null && daysLeft < 0
      ? "Overdue — needs fastest available worker"
      : active <= 2 && staff.status === "AVAILABLE"
        ? "Can take this deadline"
        : "Workload may delay this deadline";

  const dueBit =
    daysLeft != null && daysLeft < 0
      ? "Overdue"
      : daysLeft != null && daysLeft <= 2
        ? "Due soon"
        : daysLeft != null
          ? `${Math.ceil(daysLeft)}d until due`
          : dueCapacity;

  const summary = [
    stageSkill >= 4 ? `High Skill ${stageSkill}/5` : `Skill ${stageSkill}/5`,
    active === 0 ? "Low workload" : `${active} active`,
    staff.status === "AVAILABLE" ? "Available" : staff.status.replace("_", " ").toLowerCase(),
    dueBit
  ].join(" · ");

  return {
    reason: reasons.map((r) => r.label).join(" · "),
    reasons,
    summary
  };
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
    select: { staffId: true, level: true }
  });
  const staffIds = [...new Set(skilled.map((sk) => sk.staffId))];
  const stageSkillByStaff = new Map(skilled.map((sk) => [sk.staffId, sk.level || 3]));
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
      const stageSkill = stageSkillByStaff.get(staff.id) || staff.skillLevel || 3;
      const skill = skillMatchScore(item.difficultyLevel, stageSkill);
      const avail = availabilityScore(active);
      const rankedScore =
        w.urgency * u + w.skillMatch * skill + w.availability * avail + w.priority * p;

      const built = buildReason({
        staff,
        skillMatch: skill,
        stageSkill,
        priority: order.priority,
        daysLeft
      });

      return {
        staff: {
          _id: staff.id,
          name: staff.name,
          phone: staff.phone,
          role: staff.role,
          status: staff.status,
          skillLevel: stageSkill,
          activeAssignmentCount: active
        },
        scores: {
          urgencyScore: Number(u.toFixed(3)),
          skillMatchScore: Number(skill.toFixed(3)),
          availabilityScore: Number(avail.toFixed(3)),
          priorityScore: Number(p.toFixed(3)),
          rankedScore: Number(rankedScore.toFixed(4))
        },
        reason: built.reason,
        reasons: built.reasons,
        summary: built.summary
      };
    })
    .sort((a, b) => b.scores.rankedScore - a.scores.rankedScore);

  return { item, order, rankings };
}
