import { Router } from "express";
import { ClothingTypeConfig } from "../models/ClothingTypeConfig.js";
import { requireAuth } from "../middleware/auth.js";
import {
  clothingTypeToKey,
  SKIP_EMBROIDERY_SEQUENCE
} from "../constants/production.js";

const router = Router();
router.use(requireAuth);

router.get("/", async (_req, res) => {
  const configs = await ClothingTypeConfig.find().sort({ label: 1 }).lean();
  res.json(configs);
});

router.get("/resolve/:clothingType", async (req, res) => {
  const key = clothingTypeToKey(req.params.clothingType);
  const config = key ? await ClothingTypeConfig.findOne({ key }).lean() : null;
  if (config) return res.json(config);
  res.json({
    key: key || "unknown",
    label: req.params.clothingType || "Unknown",
    stageSequence: [...SKIP_EMBROIDERY_SEQUENCE],
    includesEmbroidery: false,
    fallback: true
  });
});

export default router;
