/**
 * Production start: bind the HTTP port first, then run prisma migrate deploy
 * in the background.
 *
 * Render free has no Pre-Deploy Command, so migrations run here. A hung
 * advisory lock (Prisma P1002, common on Neon pooled URLs) previously
 * blocked listen() and produced Render 502 / x-render-routing: no-deploy.
 * spawnSync before listen also blocked the event loop during the migrate
 * timeout window, so health checks could fail at boot.
 */
import "dotenv/config";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deriveDirectDatabaseUrl } from "./utils/directDatabaseUrl.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATE_TIMEOUT_MS = Number(process.env.MIGRATE_DEPLOY_TIMEOUT_MS || 25000);

function runMigrateDeployInBackground() {
  if (!process.env.DATABASE_URL) {
    console.error("[start] DATABASE_URL is not set; skipping migrate deploy");
    return;
  }

  const migrateUrl = process.env.DIRECT_URL || deriveDirectDatabaseUrl(process.env.DATABASE_URL);
  const prismaCli = path.join(__dirname, "../node_modules/prisma/build/index.js");

  console.log("[start] prisma migrate deploy in background (timeout %sms)", MIGRATE_TIMEOUT_MS);
  const child = spawn(process.execPath, [prismaCli, "migrate", "deploy"], {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: migrateUrl }
  });

  const timer = setTimeout(() => {
    console.error("[start] prisma migrate deploy timed out; killing migrate process");
    child.kill("SIGKILL");
  }, MIGRATE_TIMEOUT_MS);

  child.on("error", (err) => {
    clearTimeout(timer);
    console.error("[start] prisma migrate deploy failed to spawn:", err.message);
  });

  child.on("exit", (status, signal) => {
    clearTimeout(timer);
    if (signal) {
      console.error("[start] prisma migrate deploy killed by %s", signal);
      return;
    }
    if (status !== 0) {
      console.error("[start] prisma migrate deploy exited %s", status);
      return;
    }
    console.log("[start] prisma migrate deploy finished");
  });
}

await import("./index.js");
runMigrateDeployInBackground();
