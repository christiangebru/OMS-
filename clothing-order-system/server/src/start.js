/**
 * Production start: attempt prisma migrate deploy, then always boot the API.
 *
 * Render free has no Pre-Deploy Command, so migrations run here. A hung
 * advisory lock (Prisma P1002, common on Neon pooled URLs) previously
 * prevented `node src/index.js` from ever listening, which produced
 * Render 502 / x-render-routing: no-deploy.
 */
import "dotenv/config";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deriveDirectDatabaseUrl } from "./utils/directDatabaseUrl.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATE_TIMEOUT_MS = Number(process.env.MIGRATE_DEPLOY_TIMEOUT_MS || 25000);

function runMigrateDeploy() {
  if (!process.env.DATABASE_URL) {
    console.error("[start] DATABASE_URL is not set");
    process.exit(1);
  }

  const migrateUrl = process.env.DIRECT_URL || deriveDirectDatabaseUrl(process.env.DATABASE_URL);
  const prismaCli = path.join(__dirname, "../node_modules/prisma/build/index.js");

  console.log("[start] prisma migrate deploy (timeout %sms)", MIGRATE_TIMEOUT_MS);
  const result = spawnSync(process.execPath, [prismaCli, "migrate", "deploy"], {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: migrateUrl },
    timeout: MIGRATE_TIMEOUT_MS,
    killSignal: "SIGKILL"
  });

  if (result.error?.code === "ETIMEDOUT") {
    console.error("[start] prisma migrate deploy timed out; starting API without waiting");
    return;
  }
  if (result.error) {
    console.error("[start] prisma migrate deploy failed to spawn:", result.error.message);
    return;
  }
  if (result.signal) {
    console.error("[start] prisma migrate deploy killed by %s; starting API", result.signal);
    return;
  }
  if (result.status !== 0) {
    console.error("[start] prisma migrate deploy exited %s; starting API", result.status);
  }
}

runMigrateDeploy();
await import("./index.js");
