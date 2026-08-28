import { Router } from "express";
import { prisma } from "../db/prisma.js";
import { s, sMany } from "../utils/serialize.js";
import { requireAuth } from "../middleware/auth.js";
import {
  clothingTypeToKey,
  SKIP_EMBROIDERY_SEQUENCE
} from "../constants/production.js";

const router = Router();
router.use(requireAuth);

router.get("/", async (_req, res) => {
  const configs = await prisma.clothingTypeConfig.findMany({ orderBy: { label: "asc" } });
  res.json(sMany(configs));
});

router.get("/resolve/:clothingType", async (req, res) => {
  const key = clothingTypeToKey(req.params.clothingType);
  const config = key ? await prisma.clothingTypeConfig.findUnique({ where: { key } }) : null;
  if (config) return res.json(s(config));
  res.json({
    key: key || "unknown",
    label: req.params.clothingType || "Unknown",
    stageSequence: [...SKIP_EMBROIDERY_SEQUENCE],
    includesEmbroidery: false,
    itemKind: "garment",
    partCodes: [],
    fallback: true
  });
});

export default router;
