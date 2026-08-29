-- Additive garment/part/accessory model and order header notes.
-- Existing rows are preserved (defaults only).

-- AlterTable
ALTER TABLE "orders" ADD COLUMN "notes" TEXT NOT NULL DEFAULT '';
ALTER TABLE "orders" ADD COLUMN "partLabelMode" TEXT NOT NULL DEFAULT 'none';

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN "itemKind" TEXT NOT NULL DEFAULT 'garment';
ALTER TABLE "order_items" ADD COLUMN "parentItemId" TEXT;
ALTER TABLE "order_items" ADD COLUMN "partCode" TEXT NOT NULL DEFAULT '';
ALTER TABLE "order_items" ADD COLUMN "itemIndex" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "order_items" ADD COLUMN "assembledAt" TIMESTAMP(3);
ALTER TABLE "order_items" ADD COLUMN "offSiteStages" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "order_items" ADD COLUMN "printPartLabel" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "clothing_type_configs" ADD COLUMN "itemKind" TEXT NOT NULL DEFAULT 'garment';
ALTER TABLE "clothing_type_configs" ADD COLUMN "partCodes" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "clothing_type_configs" ADD COLUMN "offSiteStages" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "clothing_type_configs" ADD COLUMN "compactLabel" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "clothing_type_configs" ADD COLUMN "measurementProfile" TEXT NOT NULL DEFAULT '';

-- Backfill stable garment indexes from existing creation order
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY "order" ORDER BY "createdAt" ASC) AS rn
  FROM "order_items"
)
UPDATE "order_items"
SET "itemIndex" = ranked.rn
FROM ranked
WHERE "order_items".id = ranked.id;

-- CreateIndex
CREATE INDEX "order_items_parentItemId_idx" ON "order_items"("parentItemId");

-- CreateIndex
CREATE INDEX "order_items_itemKind_idx" ON "order_items"("itemKind");

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_parentItemId_fkey" FOREIGN KEY ("parentItemId") REFERENCES "order_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
