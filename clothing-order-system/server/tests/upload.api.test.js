import { describe, it, expect, beforeAll, afterAll, beforeEach } from "@jest/globals";
import request from "supertest";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import {
  connectTestDb,
  disconnectTestDb,
  clearDb,
  createTestApp,
  createUser,
  auth
} from "./helpers.js";
import { seedClothingTypes } from "./fixtures.js";

const png1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

describe("POST /api/upload", () => {
  let app;
  let token;

  beforeAll(async () => {
    await connectTestDb();
    app = createTestApp();
  });

  afterAll(async () => {
    await disconnectTestDb();
  });

  beforeEach(async () => {
    await clearDb();
    await seedClothingTypes();
    const manager = await createUser({
      email: "upload@test.local",
      name: "Manager",
      role: "manager"
    });
    token = manager.token;
  });

  it("rejects unauthenticated uploads", async () => {
    const res = await request(app)
      .post("/api/upload")
      .attach("image", png1x1, { filename: "front.png", contentType: "image/png" });
    expect(res.status).toBe(401);
  });

  it("stores on local disk when remote object-store env is unset", async () => {
    delete process.env.S3_BUCKET;
    delete process.env.S3_ACCESS_KEY_ID;
    delete process.env.S3_SECRET_ACCESS_KEY;
    delete process.env.CLOUDINARY_CLOUD_NAME;
    delete process.env.CLOUDINARY_UPLOAD_PRESET;

    const res = await request(app)
      .post("/api/upload")
      .set(auth(token))
      .attach("image", png1x1, { filename: "front.png", contentType: "image/png" });
    expect(res.status).toBe(201);
    expect(res.body.path).toMatch(/^uploads\//);
    expect(res.body.url).toMatch(/uploads\//);

    const disk = path.join(path.dirname(fileURLToPath(import.meta.url)), "../uploads", path.basename(res.body.path));
    await expect(fs.stat(disk)).resolves.toBeTruthy();
    await fs.unlink(disk).catch(() => {});
  });
});
