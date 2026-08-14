import { PrismaClient } from "@prisma/client";

/**
 * Single PrismaClient instance for the whole process.
 * Reused across hot reloads (node --watch) via globalThis to avoid exhausting
 * the connection pool during development.
 */
const globalForPrisma = globalThis;

export const prisma =
  globalForPrisma.__prisma ||
  new PrismaClient({
    log: process.env.PRISMA_LOG ? ["query", "warn", "error"] : ["warn", "error"]
  });

if (!globalForPrisma.__prisma) {
  globalForPrisma.__prisma = prisma;
}
