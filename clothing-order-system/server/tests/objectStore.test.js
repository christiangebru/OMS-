import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { persistPublicImage, objectStoreKind } from "../src/utils/objectStore.js";
import { storedImagePath } from "../src/utils/publicImage.js";

async function multerFile() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "oms-upload-"));
  const filename = `${Date.now()}-front.jpg`;
  const filePath = path.join(dir, filename);
  await fs.writeFile(filePath, Buffer.from("fakepng"));
  return {
    filename,
    path: filePath,
    mimetype: "image/jpeg",
    dir
  };
}

describe("durable image object store", () => {
  const prev = { ...process.env };

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in prev)) delete process.env[key];
    }
    Object.assign(process.env, prev);
  });

  it("uses local disk when remote env vars are unset", async () => {
    const env = { ...process.env };
    delete env.S3_BUCKET;
    delete env.S3_ACCESS_KEY_ID;
    delete env.S3_SECRET_ACCESS_KEY;
    delete env.CLOUDINARY_CLOUD_NAME;
    delete env.CLOUDINARY_UPLOAD_PRESET;
    expect(objectStoreKind(env)).toBe("local");
    const file = await multerFile();
    const stored = await persistPublicImage(file, { env });
    expect(stored).toBe(`uploads/${file.filename}`);
    await fs.unlink(file.path).catch(() => {});
  });

  it("uploads to Cloudinary when configured (mocked)", async () => {
    const env = {
      CLOUDINARY_CLOUD_NAME: "demo",
      CLOUDINARY_UPLOAD_PRESET: "oms"
    };
    expect(objectStoreKind(env)).toBe("cloudinary");
    const file = await multerFile();
    const url = "https://res.cloudinary.com/demo/image/upload/v1/oms-garments/front.jpg";
    const stored = await persistPublicImage(file, {
      env,
      putCloudinary: async () => url
    });
    expect(stored).toBe(url);
    await expect(fs.stat(file.path)).rejects.toThrow();
  });

  it("uploads to S3 when configured (mocked) and prefers S3 over Cloudinary", async () => {
    const env = {
      S3_BUCKET: "oms-photos",
      S3_ACCESS_KEY_ID: "AKIATEST",
      S3_SECRET_ACCESS_KEY: "secret",
      S3_REGION: "us-east-1",
      CLOUDINARY_CLOUD_NAME: "demo",
      CLOUDINARY_UPLOAD_PRESET: "oms"
    };
    expect(objectStoreKind(env)).toBe("s3");
    const file = await multerFile();
    const url = "https://cdn.example.com/oms-garments/front.jpg";
    const stored = await persistPublicImage(file, {
      env,
      putS3: async () => url
    });
    expect(stored).toBe(url);
  });

  it("falls back to local when the remote store fails", async () => {
    const env = {
      CLOUDINARY_CLOUD_NAME: "demo",
      CLOUDINARY_UPLOAD_PRESET: "oms"
    };
    const file = await multerFile();
    const stored = await persistPublicImage(file, {
      env,
      putCloudinary: async () => {
        throw new Error("network");
      }
    });
    expect(stored).toBe(`uploads/${file.filename}`);
    await fs.unlink(file.path).catch(() => {});
  });

  it("keeps existing relative upload paths resolvable", () => {
    expect(storedImagePath("uploads/legacy-front.jpg")).toBe("uploads/legacy-front.jpg");
    expect(storedImagePath("https://res.cloudinary.com/demo/image/upload/v1/x.jpg")).toBe(
      "https://res.cloudinary.com/demo/image/upload/v1/x.jpg"
    );
  });
});
