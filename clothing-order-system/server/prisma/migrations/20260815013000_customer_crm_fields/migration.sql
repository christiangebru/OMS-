-- Additive customer CRM fields. No data dropped.

ALTER TABLE "customers" ADD COLUMN "email" TEXT NOT NULL DEFAULT '';
ALTER TABLE "customers" ADD COLUMN "address" TEXT NOT NULL DEFAULT '';
ALTER TABLE "customers" ADD COLUMN "notes" TEXT NOT NULL DEFAULT '';
