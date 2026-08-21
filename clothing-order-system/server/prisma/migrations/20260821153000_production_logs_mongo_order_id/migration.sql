-- Additive. Some local databases were created from an older production_logs
-- shape (orderId / orderRefId) without mongoOrderId. Prisma Client requires
-- the column; existing log rows stay intact.

ALTER TABLE "production_logs" ADD COLUMN IF NOT EXISTS "mongoOrderId" TEXT;
