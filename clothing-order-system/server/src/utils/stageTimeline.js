import { deriveCurrentStage, nextExpectedStage } from "./stageSequence.js";
import { FULL_STAGE_SEQUENCE, WORKSTATION_STAGES } from "../constants/production.js";
import { findCheckpoint, aliasesForStage, canonicalStage } from "./productionModel.js";
import { completedOffSiteTrips, openOffSiteCheckpoint, offSiteWindows } from "./offSite.js";

export function formatDurationMs(ms) {
  if (ms == null || Number.isNaN(ms)) return null;
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${Math.max(0, mins)}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${m}m`;
}

function waitingMs(from, until) {
  if (!from) return null;
  const start = new Date(from).getTime();
  const end = until ? new Date(until).getTime() : Date.now();
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return Math.max(0, end - start);
}

function assignmentForStage(assignments, stage) {
  const aliases = aliasesForStage(stage);
  return (
    assignments.find((a) => aliases.includes(a.stage) && !a.completedAt) ||
    assignments.find((a) => aliases.includes(a.stage)) ||
    null
  );
}

/**
 * Merge clothing-type stage sequence with checkpoints into a visual timeline.
 * Always returns the canonical production sequence so skipped stages remain visible.
 */
export function buildStageStates(checkpoints = [], stageSequence = [], options = {}) {
  const sequence = stageSequence?.length ? stageSequence : FULL_STAGE_SEQUENCE;
  const inSequence = new Set(sequence.map((s) => canonicalStage(s) || s));
  const offSiteStages = options.offSiteStages || [];
  const next = nextExpectedStage(checkpoints, sequence, offSiteStages);
  const current = deriveCurrentStage(checkpoints, sequence, offSiteStages);
  const due = options.dueDate ? new Date(options.dueDate) : null;
  const overdueOrder = due ? due.getTime() < Date.now() : false;
  const assignment = options.assignment || null;
  const assignments =
    Array.isArray(options.assignments) && options.assignments.length
      ? options.assignments
      : assignment
        ? [assignment]
        : [];
  const windows = offSiteWindows(sequence, offSiteStages);
  const tripsDone = completedOffSiteTrips(checkpoints).length;
  const openOff = openOffSiteCheckpoint(checkpoints);

  let lastCompletedAt = null;

  return FULL_STAGE_SEQUENCE.map((stage) => {
    const canon = canonicalStage(stage) || stage;
    if (!inSequence.has(canon) && !sequence.includes(stage)) {
      return {
        stage,
        status: "skipped",
        checkedInAt: null,
        checkedOutAt: null,
        durationMs: null,
        waitingMs: null,
        open: false,
        isCurrent: false,
        overdue: false,
        assigned: false,
        assignedTo: null,
        offSite: false
      };
    }

    const winIdx = windows.findIndex((w) => w.stages.some((s) => canonicalStage(s) === canon || s === stage));
    const offSiteWork = winIdx >= 0;
    if (offSiteWork) {
      const windowDone = tripsDone > winIdx;
      const windowActive = Boolean(openOff) && tripsDone === winIdx;
      if (windowDone || windowActive) {
        const offCp = windowActive
          ? openOff
          : completedOffSiteTrips(checkpoints)[winIdx] || null;
        return {
          stage,
          status: windowActive ? "off_site" : "completed",
          checkedInAt: offCp?.checkedInAt || null,
          checkedOutAt: offCp?.checkedOutAt || null,
          durationMs: null,
          waitingMs: null,
          open: windowActive,
          isCurrent: windowActive,
          overdue: overdueOrder && windowActive,
          assigned: false,
          assignedTo: null,
          offSite: true,
          notes: windowActive ? "Off-site" : "Completed off-site"
        };
      }
      if (next === "OFF_SITE" && tripsDone === winIdx && !openOff) {
        const first = windows[winIdx].stages[0];
        const isFirst = (canonicalStage(first) || first) === canon || first === stage;
        return {
          stage,
          status: isFirst ? "next" : "waiting",
          checkedInAt: null,
          checkedOutAt: null,
          durationMs: null,
          waitingMs: waitingMs(lastCompletedAt, null),
          open: false,
          isCurrent: false,
          overdue: overdueOrder && isFirst,
          assigned: false,
          assignedTo: null,
          offSite: true,
          notes: "Send off-site"
        };
      }
    }

    const cp = findCheckpoint(checkpoints, stage);
    const stageAsg = assignmentForStage(assignments, stage);
    const assignedHere = Boolean(stageAsg);
    const assignedTo = assignedHere
      ? stageAsg.staff?.name || stageAsg.staffName || null
      : null;

    if (!cp) {
      const status = (canonicalStage(stage) || stage) === (canonicalStage(next) || next) ? "next" : "waiting";
      const blocked = overdueOrder && (status === "next" || status === "waiting");
      const row = {
        stage,
        status: blocked ? "blocked" : status,
        checkedInAt: null,
        checkedOutAt: null,
        durationMs: null,
        waitingMs: waitingMs(lastCompletedAt, null),
        open: false,
        isCurrent: false,
        overdue: overdueOrder && status === "next",
        assigned: assignedHere,
        assignedTo,
        handoverStatus: assignedHere ? handoverStatus(stageAsg) : null
      };
      return row;
    }

    const open = Boolean(cp.checkedInAt && !cp.checkedOutAt);
    const durationMs =
      cp.checkedInAt && cp.checkedOutAt
        ? new Date(cp.checkedOutAt) - new Date(cp.checkedInAt)
        : open
          ? Date.now() - new Date(cp.checkedInAt).getTime()
          : null;

    const wait = waitingMs(lastCompletedAt, cp.checkedInAt);
    if (cp.checkedOutAt) lastCompletedAt = cp.checkedOutAt;

    return {
      stage,
      status: open ? "in_progress" : "completed",
      checkedInAt: cp.checkedInAt,
      checkedOutAt: cp.checkedOutAt || null,
      durationMs,
      waitingMs: wait,
      open,
      isCurrent: (canonicalStage(current) || current) === canon,
      overdue: overdueOrder && open,
      assigned: assignedHere,
      assignedTo,
      handoverStatus: assignedHere ? handoverStatus(stageAsg) : null,
      notes: cp.notes || "",
      checkpointId: cp.id
    };
  });
}

function handoverStatus(assignment) {
  if (!assignment) return null;
  if (assignment.receivedAt) return "received";
  if (assignment.distributedAt) return "handed_over";
  return "assigned";
}

export function inferScanAction(checkpoints, nextStage) {
  const open = checkpoints.find((c) => c.checkedInAt && !c.checkedOutAt);
  if (open) {
    return { action: "check_out", stage: open.stage, openCheckpoint: open };
  }
  return { action: "check_in", stage: nextStage, openCheckpoint: null };
}

const WORK_STAGES = new Set([
  ...WORKSTATION_STAGES,
  "PACKAGING",
  "SHOWROOM",
  "READY",
  "OFF_SITE"
]);

/**
 * Scanner is the physical hand-off. Assign first, then scan in — no separate distribute/receive.
 * Off-site is a location scan, not a workstation.
 */
export function inferNextAction({
  checkpoints = [],
  assignment,
  nextStage,
  currentStage,
  location,
  returnStage
}) {
  const deliveredDone = checkpoints.some((c) => c.stage === "DELIVERED" && c.checkedOutAt);
  if (deliveredDone || currentStage === "DELIVERED") {
    return { code: "done", label: "Delivered", stage: "DELIVERED" };
  }
  const open = checkpoints.find((c) => c.checkedInAt && !c.checkedOutAt);
  if (open?.stage === "OFF_SITE" || location === "off_site") {
    return {
      code: "check_out",
      label: "Scan in from off-site",
      stage: "OFF_SITE",
      returnStage: returnStage || nextStage
    };
  }
  if (open) {
    return { code: "check_out", label: "Scan out", stage: open.stage };
  }
  if (nextStage === "OFF_SITE") {
    return { code: "check_in", label: "Scan out to off-site", stage: "OFF_SITE" };
  }
  if (!assignment && WORK_STAGES.has(nextStage) && nextStage !== "OFF_SITE") {
    return { code: "assign", label: "Assign worker", stage: nextStage };
  }
  if (nextStage === "PACKAGING") {
    return { code: "check_in", label: "Scan in to pack", stage: "PACKAGING" };
  }
  if (nextStage === "DELIVERED") {
    return { code: "check_in", label: "Mark delivered", stage: "DELIVERED" };
  }
  if (nextStage === "SHOWROOM" || nextStage === "READY") {
    return { code: "check_in", label: "Move to showroom", stage: nextStage };
  }
  if (assignment?.staff) {
    return {
      code: "check_in",
      label: `Scan in to ${String(nextStage || assignment.stage).toLowerCase().replace(/_/g, " ")} — ${assignment.staff.name}`,
      stage: nextStage || assignment.stage
    };
  }
  return { code: "check_in", label: "Scan in", stage: nextStage };
}

/**
 * UNASSIGNED = waiting. After workers are assigned = RECEIVED (manager state).
 * Scan-in = in_progress. Assigned ≠ busy.
 */
export function boardStatusFrom({ checkpoints = [], assignment, location }) {
  if (location === "off_site" || checkpoints.some((c) => c.stage === "OFF_SITE" && c.checkedInAt && !c.checkedOutAt)) {
    return "off_site";
  }
  const inProgress = checkpoints.some((c) => c.checkedInAt && !c.checkedOutAt);
  if (inProgress) return "in_progress";
  if (!assignment) return "waiting";
  return "received";
}
