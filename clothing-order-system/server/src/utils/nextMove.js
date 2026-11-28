import { prisma } from "../db/prisma.js";
import { nextExpectedStage } from "./stageSequence.js";
import { rankStaffForAssignment } from "./assignmentScore.js";
import {
  OFF_SITE_STAGE,
  currentOffSiteWindow,
  isOutsourcedRoute,
  openOffSiteCheckpoint,
  pendingOffSiteWindow
} from "./offSite.js";
import {
  assemblyStage,
  expandSkipStages,
  isGarmentCompleteStage,
  isPartReadyForAssembly,
  stageMatchesStep
} from "./productionModel.js";
import { CANONICAL_WORKSTATION_STAGES, canonicalStage } from "../constants/production.js";

export const RECEIVED_STAGE = "RECEIVED";

const isWorkstation = (stage) => CANONICAL_WORKSTATION_STAGES.includes(canonicalStage(stage));

function brief(staff) {
  return staff ? { _id: staff.id, name: staff.name, status: staff.status } : null;
}

/**
 * The ONE thing the manager most likely does with this garment now, so the
 * scanner can put it on a single button:
 *   receive  — first scan: it arrived at the manager (then goes to storage)
 *   start    — nothing open: give it to the next station's worker
 *   transfer — open at a station: done there → straight to the next one
 *   send     — next step is an off-site trip
 *   back     — away now: it came back → straight to the next station
 *   parts    — made as parts that are not ready yet: scan the part labels
 *   none     — finished (showroom) or nothing to do
 */
export async function buildNextMove({ item, checkpoints, stageSequence, offSiteStages }) {
  const work = checkpoints.filter((c) => c.stage !== RECEIVED_STAGE);
  const received = checkpoints.some((c) => c.stage === RECEIVED_STAGE);
  const open = work.find((c) => c.checkedInAt && !c.checkedOutAt);
  const away = openOffSiteCheckpoint(work);
  const outsourced = isOutsourcedRoute(stageSequence, offSiteStages);

  let kind = "none";
  let fromStage = open?.stage || null;
  let toStage = null;

  if (away) {
    kind = "back";
    toStage = currentOffSiteWindow(work, stageSequence, offSiteStages)?.returnStage || null;
    // Coming back finished (trouser, tilet netela): straight to the showroom.
    if (!toStage) toStage = stageSequence[stageSequence.length - 1] || "SHOWROOM";
  } else if (open) {
    if (isGarmentCompleteStage(open.stage)) {
      kind = "none";
    } else {
      // What comes after this station once it is checked out.
      const simulated = work.map((c) => (c.id === open.id ? { ...c, checkedOutAt: new Date() } : c));
      toStage = nextExpectedStage(simulated, stageSequence, offSiteStages);
      kind = "transfer";
    }
  } else {
    const next = nextExpectedStage(work, stageSequence, offSiteStages);
    const done = work.some((c) => c.checkedOutAt && isGarmentCompleteStage(c.stage)) ||
      work.some((c) => isGarmentCompleteStage(c.stage));
    if (done) kind = "none";
    else if (!work.length && !received && !outsourced) {
      kind = "receive";
      toStage = next;
    } else {
      kind = next === OFF_SITE_STAGE ? "send" : "start";
      toStage = next;
    }
  }

  // A garment made as separate parts: until they are ready, the parts move, not it.
  let parts = null;
  if (item.itemKind !== "part" && (kind === "start" || kind === "receive")) {
    const rows = await prisma.orderItem.findMany({ where: { parentItemId: item.id, assembledAt: null } });
    if (rows.length) {
      const cps = await prisma.stageCheckpoint.findMany({ where: { orderItemId: { in: rows.map((r) => r.id) } } });
      const ready = rows.filter((r) =>
        isPartReadyForAssembly(
          cps.filter((c) => c.orderItemId === r.id),
          stageSequence.filter((s) => !expandSkipStages(r.skipStages).includes(s))
        )
      ).length;
      parts = { total: rows.length, ready, codes: rows.map((r) => r.partCode).filter(Boolean) };
      const assembleAt = assemblyStage(stageSequence);
      if (kind === "start") {
        if (ready === rows.length && assembleAt) toStage = assembleAt;
        else kind = "parts";
      }
    }
  }

  const toOffSite = toStage === OFF_SITE_STAGE;
  const needsWorker = Boolean(toStage) && !toOffSite && isWorkstation(toStage);
  const offSiteFor =
    toOffSite
      ? (pendingOffSiteWindow(
          open ? work.map((c) => (c.id === open.id ? { ...c, checkedOutAt: new Date() } : c)) : work,
          stageSequence,
          offSiteStages
        )?.stages || [])
      : [];

  // Who should take it next: the worker already assigned, else the top suggestion.
  let worker = null;
  let suggested = false;
  if (needsWorker && ["start", "transfer", "back", "receive"].includes(kind)) {
    const asg = await prisma.staffAssignment.findFirst({
      where: { orderItemId: item.id, completedAt: null },
      include: { staff: true },
      orderBy: { assignedAt: "desc" }
    });
    if (asg?.staff && stageMatchesStep(asg.stage, toStage, stageSequence)) {
      worker = brief(asg.staff);
    } else {
      try {
        const top = (await rankStaffForAssignment(item.id, toStage)).rankings[0];
        if (top?.staff) {
          worker = { _id: top.staff._id, name: top.staff.name, status: top.staff.status };
          suggested = true;
        }
      } catch {
        worker = null;
      }
    }
  }

  return {
    kind,
    received,
    fromStage,
    toStage,
    toOffSite,
    offSiteFor,
    needsWorker,
    worker,
    suggested,
    parts
  };
}
