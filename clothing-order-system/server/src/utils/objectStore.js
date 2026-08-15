import fs from "fs/promises";

function cloudinaryTarget() {
  const cloud = process.env.CLOUDINARY_CLOUD_NAME;
  const preset = process.env.CLOUDINARY_UPLOAD_PRESET;
  if (!cloud || !preset) return null;
  return { cloud, preset };
}

/**
 * Persist an uploaded multer file. Local disk is the default (Render-ephemeral).
 * When CLOUDINARY_CLOUD_NAME + CLOUDINARY_UPLOAD_PRESET are set, upload there
 * and return the HTTPS URL so reference photos survive deploys.
 */
export async function persistPublicImage(file) {
  const localPath = `uploads/${file.filename}`;
  const cloud = cloudinaryTarget();
  if (!cloud || !file?.path) return localPath;

  try {
    const buf = await fs.readFile(file.path);
    const form = new FormData();
    form.append("file", `data:${file.mimetype || "image/jpeg"};base64,${buf.toString("base64")}`);
    form.append("upload_preset", cloud.preset);
    form.append("folder", "oms-garments");
    const res = await fetch(`https://api.cloudinary.com/v1_1/${cloud.cloud}/image/upload`, {
      method: "POST",
      body: form
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.secure_url) {
      console.warn("[objectStore] Cloudinary upload failed, keeping local file", data.error || res.status);
      return localPath;
    }
    await fs.unlink(file.path).catch(() => {});
    return data.secure_url;
  } catch (err) {
    console.warn("[objectStore] Cloudinary error, keeping local file", err.message);
    return localPath;
  }
}
