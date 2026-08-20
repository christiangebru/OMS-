/**
 * Neon pooled hosts look like ep-xxx-pooler.region.aws.neon.tech.
 * Prisma migrate deploy uses Postgres advisory locks, which PgBouncer
 * (the Neon pooler) does not support. Migrations must use the unpooled host.
 */
export function deriveDirectDatabaseUrl(raw) {
  return String(raw || "").replace(/-pooler\./i, ".");
}
