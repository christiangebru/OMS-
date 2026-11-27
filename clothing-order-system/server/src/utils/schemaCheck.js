import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, "../../prisma/migrations");
const CACHE_MS = 60_000;

let cached = null;

/** Columns the Prisma client expects: { table: [column, ...] }. */
export function expectedColumns(datamodel = Prisma.dmmf.datamodel) {
  const out = {};
  for (const model of datamodel.models) {
    const table = model.dbName || model.name;
    out[table] = model.fields
      .filter((f) => f.kind === "scalar" || f.kind === "enum")
      .map((f) => f.dbName || f.name);
  }
  return out;
}

export function localMigrationNames(dir = MIGRATIONS_DIR) {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
  } catch {
    return [];
  }
}

/** Pure comparison, so it can be tested without a database. */
export function compareSchema({ expected, actualRows, localMigrations, appliedRows }) {
  const actual = new Set(actualRows.map((r) => `${r.table_name}.${r.column_name}`));
  const missingColumns = [];
  for (const [table, cols] of Object.entries(expected)) {
    for (const col of cols) {
      if (!actual.has(`${table}.${col}`)) missingColumns.push(`${table}.${col}`);
    }
  }
  const finished = new Set(
    appliedRows.filter((r) => r.finished_at && !r.rolled_back_at).map((r) => r.migration_name)
  );
  const failedMigrations = appliedRows
    .filter((r) => !r.finished_at && !r.rolled_back_at)
    .map((r) => r.migration_name);
  const pendingMigrations = localMigrations.filter((name) => !finished.has(name));
  return {
    ok: !missingColumns.length && !failedMigrations.length && !pendingMigrations.length,
    missingColumns,
    pendingMigrations,
    failedMigrations
  };
}

/**
 * Does the live database match what this build expects? Catches a deploy whose
 * background `prisma migrate deploy` timed out or failed (e.g. the earlier
 * missing orders.notes column), which a plain SELECT 1 cannot see.
 */
export async function checkSchema({ force = false } = {}) {
  if (!force && cached && Date.now() - cached.at < CACHE_MS) return cached.result;
  const actualRows = await prisma.$queryRaw`
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = current_schema()`;
  let appliedRows = [];
  try {
    appliedRows = await prisma.$queryRaw`
      SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations"`;
  } catch {
    appliedRows = [];
  }
  const result = compareSchema({
    expected: expectedColumns(),
    actualRows,
    localMigrations: localMigrationNames(),
    appliedRows
  });
  // Only cache a healthy answer, so a fix shows up on the next probe.
  cached = result.ok ? { at: Date.now(), result } : null;
  return result;
}
