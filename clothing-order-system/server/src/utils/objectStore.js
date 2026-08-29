import crypto from "crypto";
import fs from "fs/promises";

/**
 * Durable image store. Local disk is the dev fallback when remote env vars are unset.
 *
 * Precedence: S3-compatible (bucket + keys) → Cloudinary unsigned preset → local `uploads/`.
 */

export function s3Config(env = process.env) {
  const bucket = env.S3_BUCKET || env.AWS_S3_BUCKET || "";
  const accessKeyId = env.S3_ACCESS_KEY_ID || env.AWS_ACCESS_KEY_ID || "";
  const secretAccessKey = env.S3_SECRET_ACCESS_KEY || env.AWS_SECRET_ACCESS_KEY || "";
  if (!bucket || !accessKeyId || !secretAccessKey) return null;
  return {
    bucket,
    accessKeyId,
    secretAccessKey,
    region: env.S3_REGION || env.AWS_REGION || "us-east-1",
    endpoint: env.S3_ENDPOINT || env.AWS_S3_ENDPOINT || "",
    publicBase: (env.S3_PUBLIC_BASE_URL || env.S3_PUBLIC_URL || "").replace(/\/$/, "")
  };
}

export function cloudinaryConfig(env = process.env) {
  const cloud = env.CLOUDINARY_CLOUD_NAME;
  const preset = env.CLOUDINARY_UPLOAD_PRESET;
  if (!cloud || !preset) return null;
  return { cloud, preset };
}

/** Which backend persistPublicImage will use for this env. */
export function objectStoreKind(env = process.env) {
  if (s3Config(env)) return "s3";
  if (cloudinaryConfig(env)) return "cloudinary";
  return "local";
}

function localPathFor(file) {
  return `uploads/${file.filename}`;
}

export async function putCloudinary(file, cfg, { fetchImpl = fetch } = {}) {
  const buf = await fs.readFile(file.path);
  const form = new FormData();
  form.append("file", `data:${file.mimetype || "image/jpeg"};base64,${buf.toString("base64")}`);
  form.append("upload_preset", cfg.preset);
  form.append("folder", "oms-garments");
  const res = await fetchImpl(`https://api.cloudinary.com/v1_1/${cfg.cloud}/image/upload`, {
    method: "POST",
    body: form
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.secure_url) {
    const err = new Error(data.error?.message || `Cloudinary upload failed (${res.status})`);
    err.payload = data;
    throw err;
  }
  return data.secure_url;
}

function hmac(key, value) {
  return crypto.createHmac("sha256", key).update(value, "utf8").digest();
}

function sha256Hex(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function amzDate(d) {
  return d.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

/**
 * S3-compatible PUT (AWS, R2, MinIO). Path-style when S3_ENDPOINT is set.
 */
export async function putS3(file, cfg, { fetchImpl = fetch } = {}) {
  const buf = await fs.readFile(file.path);
  const key = `oms-garments/${file.filename}`;
  const contentType = file.mimetype || "application/octet-stream";
  const now = new Date();
  const dateStamp = now.toISOString().slice(0, 10).replace(/-/g, "");
  const amz = amzDate(now);
  const payloadHash = sha256Hex(buf);
  const region = cfg.region || "us-east-1";

  let url;
  let host;
  let canonicalUri;
  if (cfg.endpoint) {
    const base = cfg.endpoint.replace(/\/$/, "");
    const u = new URL(base);
    host = u.host;
    canonicalUri = `/${cfg.bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;
    url = `${base}/${cfg.bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;
  } else {
    host = `${cfg.bucket}.s3.${region}.amazonaws.com`;
    canonicalUri = `/${key.split("/").map(encodeURIComponent).join("/")}`;
    url = `https://${host}${canonicalUri}`;
  }

  const canonicalHeaders = [
    `content-type:${contentType}`,
    `host:${host}`,
    `x-amz-content-sha256:${payloadHash}`,
    `x-amz-date:${amz}`
  ].join("\n");
  const signedHeaders = "content-type;host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = [
    "PUT",
    canonicalUri,
    "",
    `${canonicalHeaders}\n`,
    signedHeaders,
    payloadHash
  ].join("\n");
  const scope = `${dateStamp}/${region}/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amz, scope, sha256Hex(canonicalRequest)].join("\n");
  const kDate = hmac(`AWS4${cfg.secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, "s3");
  const kSigning = hmac(kService, "aws4_request");
  const signature = crypto.createHmac("sha256", kSigning).update(stringToSign, "utf8").digest("hex");
  const authorization = `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const res = await fetchImpl(url, {
    method: "PUT",
    headers: {
      "Content-Type": contentType,
      Host: host,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amz,
      Authorization: authorization
    },
    body: buf
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`S3 upload failed (${res.status}) ${text.slice(0, 200)}`);
  }
  if (cfg.publicBase) return `${cfg.publicBase}/${key}`;
  return url;
}

/**
 * Persist an uploaded multer file. Returns a stored path or HTTPS URL.
 * Existing relative `uploads/…` values keep resolving via express.static.
 */
export async function persistPublicImage(file, deps = {}) {
  const env = deps.env || process.env;
  const localPath = localPathFor(file);
  if (!file?.path) return localPath;

  const kind = objectStoreKind(env);
  try {
    if (kind === "s3") {
      const put = deps.putS3 || putS3;
      const url = await put(file, s3Config(env), { fetchImpl: deps.fetchImpl || fetch });
      await fs.unlink(file.path).catch(() => {});
      return url;
    }
    if (kind === "cloudinary") {
      const put = deps.putCloudinary || putCloudinary;
      const url = await put(file, cloudinaryConfig(env), { fetchImpl: deps.fetchImpl || fetch });
      await fs.unlink(file.path).catch(() => {});
      return url;
    }
  } catch (err) {
    console.warn(`[objectStore] ${kind} upload failed, keeping local file`, err.message);
    return localPath;
  }
  return localPath;
}
