import { prisma } from "../db/prisma.js";

/**
 * Connect to PostgreSQL (Neon in production) via Prisma and verify the
 * connection with a trivial query.
 */
export async function connectDb() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set");
  }
  await prisma.$connect();
  await prisma.$queryRaw`SELECT 1`;
  console.log("[db] Connected to PostgreSQL");
}

/** Lightweight probe used by GET /health (liveness body) and GET /ready. */
export async function checkDb() {
  await prisma.$queryRaw`SELECT 1`;
  return true;
}
