import { Router } from "express";
import { body, param, validationResult } from "express-validator";
import { prisma } from "../db/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { requireCapability } from "../middleware/permissions.js";
import { isRecordId } from "../utils/recordId.js";
import { resolveStageSequence, nextExpectedStage } from "../utils/stageSequence.js";
import {
  OFF_SITE_STAGE,
  buildMakerMessage,
  isOutsourcedRoute,
  itemOffSiteStages,
  offSiteTripSummary,
  openOffSiteCheckpoint,
  pendingOffSiteWindow
} from "../utils/offSite.js";
import { isGarmentCompleteStage } from "../utils/productionModel.js";
import { operationalItemBarcode, operationalPartBarcode } from "../utils/barcode.js";
import { syncOrderStatusFromItems } from "../utils/syncOrderFromStages.js";
import { buildScanDetails } from "../utils/scanDetails.js";

/**
 * Off-site work without a scan: garments made by outside makers (the trouser)
 * are sent by message and have no label until they come back.
 *   GET  /api/off-site                  away + waiting to be sent
 *   POST /api/off-site/items/:id/send   mark as sent (who, due back)
 *   POST /api/off-site/items/:id/back   it came back (outsourced → showroom)
 */
const router = Router();
router.use(requireAuth, requireCapability("distribution"));

async function routeFor(item) {
  const info = await resolveStageSequence(item.clothingType, item.clothingCode, item.skipStages);
  const offSiteStages = itemOffSiteStages(item, info.offSiteStages);
  return { stageSequence: info.stageSequence, offSiteStages };
}

function codeFor(item, order) {
  return item.itemKind === "part"
    ? operationalPartBarcode(order.orderId, item.itemIndex || 1, item.partCode, item.barcodeValue)
    : operationalItemBarcode(order.orderId, item.itemIndex || 1, item.barcodeValue);
}

function rowFor(item, order, customer, cps, route, neededBy) {
  const open = openOffSiteCheckpoint(cps);
  const code = codeFor(item, order);
  const outsourced = isOutsourcedRoute(route.stageSequence, route.offSiteStages);
  const covered = open?.coveredStages?.length
    ? open.coveredStages
    : pendingOffSiteWindow(cps, route.stageSequence, route.offSiteStages)?.stages || [];
  // A maker who makes the whole garment (trouser) needs no work list; anyone
  // doing one step (cutting, fringe twisting) is told which.
  const work = outsourced && covered.includes("SEWING_CUTTING") ? [] : covered;
  return {
    itemId: item.id,
    code,
    orderId: order.orderId,
    customer: { name: customer?.name || "", phone: customer?.phone || "" },
    clothingType: item.clothingType,
    itemKind: item.itemKind || "garment",
    measurements: item.measurements || null,
    notes: item.notes || "",
    due: order.requiredCompletionDate,
    priority: order.priority || "NORMAL",
    outsourced,
    trip: offSiteTripSummary(open),
    message: buildMakerMessage({
      code,
      customerName: customer?.name,
      clothingType: item.clothingType,
      work,
      measurements: item.measurements,
      notes: item.notes,
      neededBy: open?.expectedReturnAt || neededBy || order.requiredCompletionDate
    })
  };
}

router.get("/", async (_req, res) => {
  // Every garment in an open order that is away now, or whose next step is an
  // off-site trip (outsourced garments, the shirt's cutting, netela fringes…).
  const items = await prisma.orderItem.findMany({
    where: {
      // Parts already joined into their garment travel with it.
      NOT: { itemKind: "part", assembledAt: { not: null } },
      orderRel: { productionStatus: { notIn: ["delivered", "ready_for_pickup"] } }
    },
    include: { checkpoints: true, orderRel: { include: { customer: true } } }
  });
  const away = [];
  const toSend = [];
  for (const it of items) {
    const cps = it.checkpoints;
    const awayNow = Boolean(openOffSiteCheckpoint(cps));
    if (!awayNow && cps.some((c) => !c.checkedOutAt)) continue; // being worked on in the shop
    const route = await routeFor(it);
    if (!awayNow && !route.offSiteStages.length) continue;
    if (!awayNow && nextExpectedStage(cps, route.stageSequence, route.offSiteStages) !== OFF_SITE_STAGE) continue;
    const row = rowFor(it, it.orderRel, it.orderRel.customer, cps, route);
    if (row.trip) away.push(row);
    else {
      row.offSiteFor = (pendingOffSiteWindow(cps, route.stageSequence, route.offSiteStages)?.stages || []);
      toSend.push(row);
    }
  }
  const byDue = (a, b) =>
    new Date(a.trip?.expectedReturnAt || a.due || 0) - new Date(b.trip?.expectedReturnAt || b.due || 0);
  away.sort(byDue);
  toSend.sort(byDue);
  res.json({ away, toSend });
});

const clip = (v, n) => String(v || "").trim().slice(0, n);

router.post(
  "/items/:id/send",
  param("id").custom(isRecordId),
  body("offSiteHandlerName").optional({ nullable: true }).isString().isLength({ max: 120 }),
  body("offSiteHandlerPhone").optional({ nullable: true }).isString().isLength({ max: 40 }),
  body("expectedReturnAt").optional({ nullable: true, checkFalsy: true }).isISO8601(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const item = await prisma.orderItem.findUnique({
      where: { id: req.params.id },
      include: { checkpoints: true, orderRel: { include: { customer: true } } }
    });
    if (!item) return res.status(404).json({ message: "Garment not found" });
    const route = await routeFor(item);
    const cps = item.checkpoints;
    if (openOffSiteCheckpoint(cps)) {
      return res.status(400).json({ message: "This garment is already away." });
    }
    const openHere = cps.find((c) => !c.checkedOutAt);
    if (openHere) {
      return res.status(400).json({ message: `Finish ${openHere.stage} first (scan it out).` });
    }
    const next = nextExpectedStage(cps, route.stageSequence, route.offSiteStages);
    if (next !== OFF_SITE_STAGE) {
      return res.status(400).json({ message: `This garment's next step is ${next}, not off-site.` });
    }
    const due = req.body.expectedReturnAt ? new Date(req.body.expectedReturnAt) : null;
    const covered = pendingOffSiteWindow(cps, route.stageSequence, route.offSiteStages)?.stages || [];
    const handler = clip(req.body.offSiteHandlerName, 120);

    await prisma.$transaction(async (tx) => {
      await tx.stageCheckpoint.create({
        data: {
          orderItemId: item.id,
          stage: OFF_SITE_STAGE,
          checkedInAt: new Date(),
          checkedInByStaffId: null,
          offSiteHandlerName: handler,
          offSiteHandlerPhone: clip(req.body.offSiteHandlerPhone, 40),
          expectedReturnAt: due && !Number.isNaN(due.getTime()) ? due : null,
          coveredStages: covered,
          notes: "Sent by message (no scan)"
        }
      });
      await syncOrderStatusFromItems(item.order, req.user.id, tx);
      await tx.productionLog.create({
        data: {
          orderId: item.orderRel.orderId,
          mongoOrderId: item.order,
          userId: req.user.id,
          action: "sent_off_site",
          fromStatus: OFF_SITE_STAGE,
          toStatus: OFF_SITE_STAGE,
          notes: `Sent off-site${handler ? ` to ${handler}` : ""}`,
          metadata: { itemId: item.id, coveredStages: covered }
        }
      });
    });

    const fresh = await prisma.stageCheckpoint.findMany({ where: { orderItemId: item.id } });
    res.json({
      ok: true,
      row: rowFor(item, item.orderRel, item.orderRel.customer, fresh, route),
      scanDetails: await buildScanDetails(item.id)
    });
  }
);

router.post("/items/:id/back", param("id").custom(isRecordId), async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const item = await prisma.orderItem.findUnique({
    where: { id: req.params.id },
    include: { orderRel: true }
  });
  if (!item) return res.status(404).json({ message: "Garment not found" });
  const route = await routeFor(item);
  const cps = await prisma.stageCheckpoint.findMany({ where: { orderItemId: item.id } });
  const trip = openOffSiteCheckpoint(cps);
  if (!trip) return res.status(400).json({ message: "This garment is not away." });

  let completed = false;
  await prisma.$transaction(async (tx) => {
    const now = new Date();
    await tx.stageCheckpoint.update({
      where: { id: trip.id },
      data: {
        checkedOutAt: now,
        notes: [trip.notes, "Back from off-site"].filter(Boolean).join(" | ")
      }
    });
    const after = await tx.stageCheckpoint.findMany({ where: { orderItemId: item.id } });
    const next = nextExpectedStage(after, route.stageSequence, route.offSiteStages);
    // Outsourced: it comes back finished, so it goes straight to the showroom.
    if (isGarmentCompleteStage(next)) {
      await tx.stageCheckpoint.create({
        data: { orderItemId: item.id, stage: next, checkedInAt: now, notes: "Back complete from maker" }
      });
      completed = true;
    }
    await syncOrderStatusFromItems(item.order, req.user.id, tx);
    await tx.productionLog.create({
      data: {
        orderId: item.orderRel.orderId,
        mongoOrderId: item.order,
        userId: req.user.id,
        action: "back_from_off_site",
        fromStatus: OFF_SITE_STAGE,
        toStatus: completed ? next : OFF_SITE_STAGE,
        notes: `Back from off-site${trip.offSiteHandlerName ? ` (${trip.offSiteHandlerName})` : ""}`,
        metadata: { itemId: item.id, completed }
      }
    });
  });

  res.json({
    ok: true,
    completed,
    code: codeFor(item, item.orderRel),
    scanDetails: await buildScanDetails(item.id)
  });
});

export default router;
