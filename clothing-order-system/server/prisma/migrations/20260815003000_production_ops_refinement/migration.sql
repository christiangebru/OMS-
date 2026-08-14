-- Additive production-ops fields. No data dropped.

-- AlterTable
ALTER TABLE "measurements" ADD COLUMN "category" TEXT NOT NULL DEFAULT 'unspecified';
ALTER TABLE "measurements" ADD COLUMN "fields" JSONB;

-- AlterTable
ALTER TABLE "order_item_images" ADD COLUMN "category" TEXT NOT NULL DEFAULT 'other';
ALTER TABLE "order_item_images" ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "staff_assignments" ADD COLUMN "distributedAt" TIMESTAMP(3);
ALTER TABLE "staff_assignments" ADD COLUMN "distributedByUserId" TEXT;
ALTER TABLE "staff_assignments" ADD COLUMN "receivedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "measurements_category_idx" ON "measurements"("category");
