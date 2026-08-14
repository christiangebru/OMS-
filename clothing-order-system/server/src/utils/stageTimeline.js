import { deriveCurrentStage, nextExpectedStage } from "./stageSequence.js";

export function formatDurationMs(ms) {
  if (ms == null || Number.isNaN(ms)) return null;
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${Math.max(0, mins)}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${m}m`;
}

/**
 * Merge clothing-type stage sequence with checkpoints into a visual timeline.
 * Stages not in the clothing-type map are omitted (embroidery skip, etc.).
 */
export function buildStageStates(checkpoints = [], stageSequence = []) {
  const next = nextExpectedStage(checkpoints, stageSequence);
  const current = deriveCurrentStage(checkpoints, stageSequence);

  return (stageSequence || []).map((stage) => {
    const cp = checkpoints.find((c) => c.stage === stage);
    if (!cp) {
      return {
        stage,
        status: stage === next ? "next" : "waiting",
        checkedInAt: null,
        checkedOutAt: null,
        durationMs: null,
        open: false,
        isCurrent: false
      };
    }

    const open = Boolean(cp.checkedInAt && !cp.checkedOutAt);
    const durationMs =
      cp.checkedInAt && cp.checkedOutAt
        ? new Date(cp.checkedOutAt) - new Date(cp.checkedInAt)
        : open
          ? Date.now() - new Date(cp.checkedInAt).getTime()
          : null;

    return {
      stage,
      status: open ? "in_progress" : "completed",
      checkedInAt: cp.checkedInAt,
      checkedOutAt: cp.checkedOutAt || null,
      durationMs,
      open,
      isCurrent: current === stage,
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
