import { Router } from "express";
import { param, body, validationResult } from "express-validator";
import { OrderItem } from "../models/OrderItem.js";
import { OrderItemImage } from "../models/OrderItemImage.js";
import { StageCheckpoint } from "../models/StageCheckpoint.js";
import { Staff } from "../models/Staff.js";
import { requireAuth } from "../middleware/auth.js";
import { uploadItemImages } from "../middleware/upload.js";
import { buildSingleLabelPdf } from "../utils/labelPdf.js";
import { buildScanDetails } from "../utils/scanDetails.js";

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

  const item = await OrderItem.findById(req.params.id).lean();
  if (!item) return res.status(404).json({ message: "Order item not found" });

  const checkpoints = await StageCheckpoint.find({ orderItemId: item._id })
    .sort({ checkedInAt: 1 })
    .lean();

  const staffIds = [
    ...new Set(
      checkpoints
        .flatMap((c) => [c.checkedInByStaffId, c.checkedOutByStaffId])
        .filter(Boolean)
        .map(String)
    )
  ];
  const staffDocs = staffIds.length
    ? await Staff.find({ _id: { $in: staffIds } }).lean()
    : [];
  const staffMap = new Map(staffDocs.map((s) => [String(s._id), s]));

  const timeline = checkpoints.map((c) => {
    const inStaff = c.checkedInByStaffId
      ? staffMap.get(String(c.checkedInByStaffId))
      : null;
    const outStaff = c.checkedOutByStaffId
      ? staffMap.get(String(c.checkedOutByStaffId))
      : null;
    const durationMs =
      c.checkedInAt && c.checkedOutAt
        ? new Date(c.checkedOutAt) - new Date(c.checkedInAt)
        : c.checkedInAt && !c.checkedOutAt
          ? Date.now() - new Date(c.checkedInAt).getTime()
          : null;

    return {
      _id: c._id,
      stage: c.stage,
      checkedInAt: c.checkedInAt,
      checkedOutAt: c.checkedOutAt,
      notes: c.notes,
      checkedInBy: inStaff
        ? { _id: inStaff._id, name: inStaff.name, role: inStaff.role }
        : null,
      checkedOutBy: outStaff
        ? { _id: outStaff._id, name: outStaff.name, role: outStaff.role }
        : null,
      durationMs,
      open: Boolean(c.checkedInAt && !c.checkedOutAt)
    };
  });

  res.json({
    orderItemId: item._id,
    orderId: item.orderId,
    clothingType: item.clothingType,
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

    const item = await OrderItem.findById(req.params.id);
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

    const docs = await OrderItemImage.insertMany(
      files.map((f, i) => ({
        orderItemId: item._id,
        imageUrl: publicPath(f),
        caption: captions[i] || "",
        uploadedAt: new Date()
      }))
    );

    res.status(201).json(docs);
  });
});

router.delete(
  "/:id/images/:imageId",
  param("id").isMongoId(),
  param("imageId").isMongoId(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const image = await OrderItemImage.findOne({
      _id: req.params.imageId,
      orderItemId: req.params.id
    });
    if (!image) return res.status(404).json({ message: "Image not found" });
    await image.deleteOne();
    res.status(204).send();
  }
);

router.patch(
  "/:id/images/:imageId",
  param("id").isMongoId(),
  param("imageId").isMongoId(),
  body("caption").optional().isString(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const image = await OrderItemImage.findOne({
      _id: req.params.imageId,
      orderItemId: req.params.id
    });
    if (!image) return res.status(404).json({ message: "Image not found" });
    if (req.body.caption !== undefined) image.caption = String(req.body.caption);
    await image.save();
    res.json(image);
  }
);

router.get("/:id/barcode-label", param("id").isMongoId(), async (req, res) => {
  const item = await OrderItem.findById(req.params.id).lean();
  if (!item) return res.status(404).json({ message: "Order item not found" });

  const pdf = await buildSingleLabelPdf({
    barcodeValue: item.barcodeValue,
    title: item.clothingType,
    subtitle: item.orderId
  });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `inline; filename="item-${item.barcodeValue}.pdf"`
  );
  res.send(pdf);
});

export default router;
