import { execSync } from "child_process";
import { checkDb } from "../config/db.js";
import { checkSchema } from "../utils/schemaCheck.js";

function resolveCommit() {
  const envCommit =
    process.env.RENDER_GIT_COMMIT ||
    process.env.GIT_COMMIT ||
    process.env.COMMIT_SHA;
  if (envCommit) return envCommit;
  try {
    return execSync("git rev-parse HEAD", { timeout: 1000 }).toString().trim();
  } catch {
    return "unknown";
  }
}

/**
 * Liveness for Render `healthCheckPath`. Always 200 once Express is listening.
 * DB status is reported in the body so a Neon blip cannot fail the deploy.
 */
export function healthLivenessHandler(probe = checkDb) {
  return async (_req, res) => {
    let dbConnected = false;
    try {
      await probe();
      dbConnected = true;
    } catch {
      // Process is up; callers that need the database should use GET /ready.
    }
    res.status(200).json({ ok: true, db: "postgresql", dbConnected });
  };
}

/**
 * Readiness: 503 when the database cannot be reached, or when its schema does
 * not match this build (missing columns, pending or failed migrations).
 * Not used as healthCheckPath. A custom `probe` (tests) skips the schema check
 * unless a `schemaProbe` is also passed.
 */
export function readinessHandler(probe = checkDb, schemaProbe = probe === checkDb ? checkSchema : null) {
  return async (_req, res) => {
    try {
      await probe();
    } catch {
      return res.status(503).json({ ok: false, db: "postgresql", dbConnected: false });
    }
    if (!schemaProbe) {
      return res.status(200).json({ ok: true, db: "postgresql", dbConnected: true });
    }
    let schema;
    try {
      schema = await schemaProbe();
    } catch (e) {
      schema = { ok: false, error: "schema check failed" };
    }
    res
      .status(schema.ok ? 200 : 503)
      .json({ ok: schema.ok, db: "postgresql", dbConnected: true, schema });
  };
}

/** Version: exposes deployment commit and branch without leaking sensitive env vars. */
export function versionHandler() {
  const commit = resolveCommit();
  const branch =
    process.env.RENDER_GIT_BRANCH ||
    process.env.GIT_BRANCH ||
    "main";
  return (_req, res) => {
    res.status(200).json({
      commit: process.env.RENDER_GIT_COMMIT || commit,
      branch: process.env.RENDER_GIT_BRANCH || branch
    });
  };
}
