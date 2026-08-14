/**
 * Base seed — required reference data only (clothing type configs).
 * Idempotent: safe to run repeatedly. Used as the Prisma `db seed` target.
 */
import "dotenv/config";
import path from "path";
import { fileURLToPath } from "url";
import { prisma } from "../src/db/prisma.js";
import { DEFAULT_CLOTHING_TYPE_SEEDS } from "../src/utils/migrateHelpers.js";

export async function seedClothingTypes() {
  for (const c of DEFAULT_CLOTHING_TYPE_SEEDS) {
    await prisma.clothingTypeConfig.upsert({
      where: { key: c.key },
      create: {
        key: c.key,
        label: c.label,
        stageSequence: c.stageSequence,
        includesEmbroidery: c.includesEmbroidery
      },
      update: {
        label: c.label,
        stageSequence: c.stageSequence,
        includesEmbroidery: c.includesEmbroidery
      }
    });
  }
  console.log(`[seed] Upserted ${DEFAULT_CLOTHING_TYPE_SEEDS.length} clothing type configs`);
}

async function main() {
  await seedClothingTypes();
  console.log("[seed] Base seed complete");
}

const isDirectRun =
  process.argv[1] &&
  path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);

if (isDirectRun) {
  main()
    .then(() => prisma.$disconnect())
    .catch(async (e) => {
      console.error("[seed] Failed:", e);
      await prisma.$disconnect();
      process.exit(1);
    });
}
