import { Router } from "express";
import { param, body, validationResult } from "express-validator";
import { prisma } from "../db/prisma.js";
import { s, sMany } from "../utils/serialize.js";
import { requireAuth } from "../middleware/auth.js";
import { uploadItemImages } from "../middleware/upload.js";
import { buildSingleLabelPdf } from "../utils/labelPdf.js";
import { buildScanDetails } from "../utils/scanDetails.js";
import { resolveStageSequence } from "../utils/stageSequence.js";
import { buildStageStates } from "../utils/stageTimeline.js";

const router = Router();
router.use(requireAuth);

function publicPath(file) {
  return `uploads/${file.filename}`;
}

router.get("/:id/scan-details", param("id").isMongoId(), async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const details = await buildScanDetails(req.params.id);
  if (!details) return res.status(404).json({ message: "Order item not found" });
  res.json(details);
});

router.get("/:id/timeline", param("id").isMongoId(), async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const item = await prisma.orderItem.findUnique({ where: { id: req.params.id } });
  if (!item) return res.status(404).json({ message: "Order item not found" });

  const checkpoints = await prisma.stageCheckpoint.findMany({
    where: { orderItemId: item.id },
    orderBy: { checkedInAt: "asc" }
  });

  const staffIds = [
    ...new Set(
      checkpoints
        .flatMap((c) => [c.checkedInByStaffId, c.checkedOutByStaffId])
        .filter(Boolean)
    )
  ];
  const staffDocs = staffIds.length
    ? await prisma.staff.findMany({ where: { id: { in: staffIds } } })
    : [];
  const staffMap = new Map(staffDocs.map((st) => [st.id, st]));

  const { stageSequence } = await resolveStageSequence(item.clothingType);

  const timeline = checkpoints.map((c) => {
    const inStaff = c.checkedInByStaffId ? staffMap.get(c.checkedInByStaffId) : null;
    const outStaff = c.checkedOutByStaffId ? staffMap.get(c.checkedOutByStaffId) : null;
    const durationMs =
      c.checkedInAt && c.checkedOutAt
        ? new Date(c.checkedOutAt) - new Date(c.checkedInAt)
        : c.checkedInAt && !c.checkedOutAt
          ? Date.now() - new Date(c.checkedInAt).getTime()
          : null;

    return {
      _id: c.id,
      stage: c.stage,
      checkedInAt: c.checkedInAt,
      checkedOutAt: c.checkedOutAt,
      notes: c.notes,
      checkedInBy: inStaff ? { _id: inStaff.id, name: inStaff.name, role: inStaff.role } : null,
      checkedOutBy: outStaff
        ? { _id: outStaff.id, name: outStaff.name, role: outStaff.role }
        : null,
      durationMs,
      open: Boolean(c.checkedInAt && !c.checkedOutAt)
    };
  });

  const stages = buildStageStates(checkpoints, stageSequence).map((st) => {
    const entry = timeline.find((t) => t.stage === st.stage);
    return {
      ...st,
      checkedInBy: entry?.checkedInBy || null,
      checkedOutBy: entry?.checkedOutBy || null
    };
  });

  res.json({
    orderItemId: item.id,
    orderId: item.orderId,
    clothingType: item.clothingType,
    stageSequence,
    stages,
    timeline
  });
});

router.post("/:id/images", param("id").isMongoId(), (req, res) => {
  uploadItemImages.array("images", 12)(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ message: err.message || "Upload failed" });
    }
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const item = await prisma.orderItem.findUnique({ where: { id: req.params.id } });
    if (!item) return res.status(404).json({ message: "Order item not found" });

    const files = req.files || [];
    if (!files.length) {
      return res.status(400).json({ message: "No files uploaded (field name: images)" });
    }

    const captions = Array.isArray(req.body.captions)
      ? req.body.captions
      : req.body.caption
        ? [req.body.caption]
        : [];
    const categories = Array.isArray(req.body.categories)
      ? req.body.categories
      : req.body.category
        ? [req.body.category]
        : [];

    const existingCount = await prisma.orderItemImage.count({
      where: { orderItemId: item.id }
    });
    const now = new Date();
    const docs = await Promise.all(
      files.map((f, i) =>
        prisma.orderItemImage.create({
          data: {
            orderItemId: item.id,
            imageUrl: publicPath(f),
            caption: captions[i] || "",
            category: categories[i] || "other",
            sortOrder: existingCount + i,
            uploadedAt: now
          }
        })
      )
    );

    res.status(201).json(sMany(docs));
  });
});

router.delete(
  "/:id/images/:imageId",
  param("id").isMongoId(),
  param("imageId").isMongoId(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const image = await prisma.orderItemImage.findFirst({
      where: { id: req.params.imageId, orderItemId: req.params.id }
    });
    if (!image) return res.status(404).json({ message: "Image not found" });
    await prisma.orderItemImage.delete({ where: { id: image.id } });
    res.status(204).send();
  }
);

router.patch(
  "/:id/images/:imageId",
  param("id").isMongoId(),
  param("imageId").isMongoId(),
  body("caption").optional().isString(),
  body("category").optional().isString(),
  body("sortOrder").optional().isInt(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const image = await prisma.orderItemImage.findFirst({
      where: { id: req.params.imageId, orderItemId: req.params.id }
    });
    if (!image) return res.status(404).json({ message: "Image not found" });
    const data = {};
    if (req.body.caption !== undefined) data.caption = String(req.body.caption);
    if (req.body.category !== undefined) data.category = String(req.body.category);
    if (req.body.sortOrder !== undefined) data.sortOrder = Number(req.body.sortOrder);
    const updated = Object.keys(data).length
      ? await prisma.orderItemImage.update({ where: { id: image.id }, data })
      : image;
    res.json(s(updated));
  }
);

router.get("/:id/barcode-label", param("id").isMongoId(), async (req, res) => {
  const item = await prisma.orderItem.findUnique({ where: { id: req.params.id } });
  if (!item) return res.status(404).json({ message: "Order item not found" });

  const pdf = await buildSingleLabelPdf({
    barcodeValue: item.barcodeValue,
    title: item.clothingType,
    subtitle: item.orderId
  });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="item-${item.barcodeValue}.pdf"`);
  res.send(pdf);
});

export default router;
