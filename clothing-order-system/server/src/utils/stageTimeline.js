import { deriveCurrentStage, nextExpectedStage } from "./stageSequence.js";
import { FULL_STAGE_SEQUENCE } from "../constants/production.js";

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

/**
 * Merge clothing-type stage sequence with checkpoints into a visual timeline.
 * Always returns the full production sequence so skipped stages (e.g. embroidery)
 * remain visible rather than disappearing.
 */
export function buildStageStates(checkpoints = [], stageSequence = [], options = {}) {
  const sequence = stageSequence?.length ? stageSequence : FULL_STAGE_SEQUENCE;
  const inSequence = new Set(sequence);
  const next = nextExpectedStage(checkpoints, sequence);
  const current = deriveCurrentStage(checkpoints, sequence);
  const due = options.dueDate ? new Date(options.dueDate) : null;
  const overdueOrder = due ? due.getTime() < Date.now() : false;
  const assignment = options.assignment || null;

  let lastCompletedAt = null;

  return FULL_STAGE_SEQUENCE.map((stage) => {
    if (!inSequence.has(stage)) {
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
        assignedTo: null
      };
    }

    const cp = checkpoints.find((c) => c.stage === stage);
    const assignedHere = Boolean(assignment && assignment.stage === stage && !assignment.completedAt);
    const assignedTo = assignedHere
      ? assignment.staff?.name || assignment.staffName || null
      : null;

    if (!cp) {
      const status = stage === next ? "next" : "waiting";
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
        assignedTo
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
      isCurrent: current === stage,
      overdue: overdueOrder && open,
      assigned: assignedHere,
      assignedTo,
      notes: cp.notes || "",
      checkpointId: cp.id
    };
  });
}

export function inferScanAction(checkpoints, nextStage) {
  const open = checkpoints.find((c) => c.checkedInAt && !c.checkedOutAt);
  if (open) {
    return { action: "check_out", stage: open.stage, openCheckpoint: open };
  }
  return { action: "check_in", stage: nextStage, openCheckpoint: null };
}
