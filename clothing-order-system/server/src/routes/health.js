import { execSync } from "child_process";
import { checkDb } from "../config/db.js";

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

/** Readiness: 503 when the database cannot be reached. Not used as healthCheckPath. */
export function readinessHandler(probe = checkDb) {
  return async (_req, res) => {
    try {
      await probe();
      res.status(200).json({ ok: true, db: "postgresql", dbConnected: true });
    } catch {
      res.status(503).json({ ok: false, db: "postgresql", dbConnected: false });
    }
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
