import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { uploadItemImages } from "../middleware/upload.js";
import { persistPublicImage } from "../utils/objectStore.js";

const router = Router();

function publicUrl(req, relativePath) {
  if (String(relativePath).startsWith("http")) return relativePath;
  const base = process.env.API_PUBLIC_URL || `${req.protocol}://${req.get("host")}`;
  return `${base}/${relativePath.replace(/^\//, "")}`;
}

router.post("/", requireAuth, (req, res) => {
  uploadItemImages.single("image")(req, res, async (err) => {
    if (err) {
      console.warn("[upload]", err.message);
      return res.status(400).json({ message: err.message || "Upload failed" });
    }
    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded (field name: image)" });
    }
    const relative = await persistPublicImage(req.file);
    res.status(201).json({
      path: relative,
      url: publicUrl(req, relative)
    });
  });
});

export default router;
