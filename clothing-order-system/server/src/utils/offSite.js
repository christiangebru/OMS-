import { canonicalStage, findCheckpoint, aliasesForStage } from "./productionModel.js";

export const OFF_SITE_STAGE = "OFF_SITE";

export function isOffSiteStageName(stage) {
  return canonicalStage(stage) === OFF_SITE_STAGE || stage === OFF_SITE_STAGE;
}

function offSiteSet(offSiteStages = []) {
  return new Set(
    (offSiteStages || []).flatMap((s) => {
      const canon = canonicalStage(s) || s;
      return [s, canon].filter(Boolean);
    })
  );
}

export function stageIsOffSiteWork(stage, offSiteStages = []) {
  if (!stage || isOffSiteStageName(stage)) return false;
  const set = offSiteSet(offSiteStages);
  return set.has(stage) || set.has(canonicalStage(stage));
}

/**
 * Consecutive off-site work stages become one physical trip.
 * Return stage is the next in-shop stage after the window (scan-in on return).
 */
export function offSiteWindows(stageSequence = [], offSiteStages = []) {
  const set = offSiteSet(offSiteStages);
  if (!set.size) return [];
  const seq = Array.isArray(stageSequence) ? stageSequence.filter((s) => s !== "RECEIVED") : [];
  const windows = [];
  let current = null;
  for (const stage of seq) {
    const canon = canonicalStage(stage) || stage;
    if (set.has(stage) || set.has(canon)) {
      if (!current) current = { stages: [stage], returnStage: null };
      else current.stages.push(stage);
    } else if (current) {
      current.returnStage = stage;
      windows.push(current);
      current = null;
    }
  }
  if (current) {
    windows.push(current);
  }
  return windows;
}

/**
 * Scan sequence with OFF_SITE standing in for each off-site window.
 * In-shop stages that happen off-site are not fake workstations.
 */
export function effectiveScanSequence(stageSequence = [], offSiteStages = []) {
  const seq = Array.isArray(stageSequence) ? stageSequence.filter((s) => s !== "RECEIVED") : [];
  const windows = offSiteWindows(seq, offSiteStages);
  if (!windows.length) return [...seq];
  const covered = new Set(windows.flatMap((w) => w.stages));
  const out = [];
  let windowIdx = 0;
  for (const stage of seq) {
    const win = windows[windowIdx];
    if (win && win.stages[0] === stage) {
      out.push(OFF_SITE_STAGE);
      windowIdx += 1;
      continue;
    }
    if (covered.has(stage)) continue;
    out.push(stage);
  }
  return out;
}

export function openOffSiteCheckpoint(checkpoints = []) {
  return (
    checkpoints.find((c) => isOffSiteStageName(c.stage) && c.checkedInAt && !c.checkedOutAt) || null
  );
}

export function completedOffSiteTrips(checkpoints = []) {
  return checkpoints
    .filter((c) => isOffSiteStageName(c.stage) && c.checkedOutAt)
    .sort((a, b) => new Date(a.checkedOutAt) - new Date(b.checkedOutAt));
}

export function currentOffSiteWindow(checkpoints, stageSequence, offSiteStages) {
  const windows = offSiteWindows(stageSequence, offSiteStages);
  if (!windows.length) return null;
  const open = openOffSiteCheckpoint(checkpoints);
  const done = completedOffSiteTrips(checkpoints).length;
  if (open) return windows[Math.min(done, windows.length - 1)] || null;
  if (done < windows.length) {
    // Next trip not started — only "current" when next expected is OFF_SITE.
    return null;
  }
  return null;
}

export function pendingOffSiteWindow(checkpoints, stageSequence, offSiteStages) {
  const windows = offSiteWindows(stageSequence, offSiteStages);
  const done = completedOffSiteTrips(checkpoints).length;
  if (openOffSiteCheckpoint(checkpoints)) return windows[Math.min(done, windows.length - 1)] || null;
  return windows[done] || null;
}

/**
 * Current physical location. Open OFF_SITE checkpoint ⇒ off-site, not a fake in-shop stage.
 */
export function garmentLocation(checkpoints = []) {
  if (openOffSiteCheckpoint(checkpoints)) return "off_site";
  return "in_shop";
}

export function locationLabel(checkpoints, nextStage) {
  if (garmentLocation(checkpoints) === "off_site") return "Off-site";
  if (nextStage === OFF_SITE_STAGE) return "In shop — ready to send off-site";
  return null;
}

/**
 * Next scan target, treating off-site as a real location between in-shop stages.
 */
export function nextExpectedStageWithOffSite(checkpoints, stageSequence, offSiteStages = []) {
  const seq = effectiveScanSequence(stageSequence, offSiteStages);
  if (openOffSiteCheckpoint(checkpoints)) return OFF_SITE_STAGE;

  let tripIdx = 0;
  const trips = completedOffSiteTrips(checkpoints);

  for (const stage of seq) {
    if (stage === OFF_SITE_STAGE) {
      const trip = trips[tripIdx];
      tripIdx += 1;
      if (!trip) return OFF_SITE_STAGE;
      continue;
    }
    const cp = findCheckpoint(checkpoints, stage);
    if (!cp) return stage;
    if (!cp.checkedOutAt) return stage;
  }
  return seq[seq.length - 1] || "SHOWROOM";
}

export function deriveCurrentStageWithOffSite(checkpoints, stageSequence, offSiteStages = []) {
  const open = checkpoints.find((c) => c.checkedInAt && !c.checkedOutAt);
  if (open) {
    if (isOffSiteStageName(open.stage)) return OFF_SITE_STAGE;
    return open.stage;
  }
  const closedInShop = checkpoints
    .filter((c) => c.checkedOutAt && !isOffSiteStageName(c.stage))
    .sort((a, b) => new Date(b.checkedOutAt) - new Date(a.checkedOutAt));
  if (closedInShop.length) return closedInShop[0].stage;
  return null;
}

/**
 * Prior stages on the effective sequence that must be complete before check-in.
 */
export function priorEffectiveStagesComplete(checkpoints, targetStage, stageSequence, offSiteStages = []) {
  const seq = effectiveScanSequence(stageSequence, offSiteStages);
  const resolved =
    seq.includes(targetStage) || targetStage === OFF_SITE_STAGE
      ? targetStage
      : seq.find((s) => aliasesForStage(s).includes(targetStage)) || targetStage;
  const idx = seq.indexOf(resolved);
  if (idx <= 0) return { ok: true, resolved };

  let tripIdx = 0;
  const trips = completedOffSiteTrips(checkpoints);
  for (let i = 0; i < idx; i += 1) {
    const prior = seq[i];
    if (prior === OFF_SITE_STAGE) {
      const trip = trips[tripIdx];
      const open = openOffSiteCheckpoint(checkpoints);
      const thisTripOpen = Boolean(open) && tripIdx === trips.length;
      if (!trip && !thisTripOpen) {
        return {
          ok: false,
          resolved,
          message: `Cannot check in to ${targetStage}: garment must return from off-site first.`
        };
      }
      tripIdx += 1;
      continue;
    }
    const cp = findCheckpoint(checkpoints, prior);
    if (!cp?.checkedOutAt) {
      return {
        ok: false,
        resolved,
        message: `Cannot check in to ${targetStage}: prior stage ${prior} is not complete. Complete prior stages or use admin override.`
      };
    }
  }
  return { ok: true, resolved };
}
