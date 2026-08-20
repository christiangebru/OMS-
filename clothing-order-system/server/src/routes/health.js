import { checkDb } from "../config/db.js";

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
