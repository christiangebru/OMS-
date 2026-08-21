-- Additive operations milestone. Existing rows are preserved.

-- CreateTable
CREATE TABLE "order_groups" (
    "id" TEXT NOT NULL DEFAULT substr(md5((random())::text || (clock_timestamp())::text), 1, 24),
    "tenantId" TEXT NOT NULL DEFAULT 'default',
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "responsibleName" TEXT NOT NULL DEFAULT '',
    "responsiblePhone" TEXT NOT NULL DEFAULT '',
    "sharedDueDate" TIMESTAMP(3),
    "sharedPriority" TEXT,
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_groups_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "orders" ADD COLUMN "groupId" TEXT;

-- AlterTable
ALTER TABLE "staff_assignments" ADD COLUMN "queuePosition" INTEGER;

-- CreateIndex
CREATE INDEX "order_groups_tenantId_idx" ON "order_groups"("tenantId");

-- CreateIndex
CREATE INDEX "order_groups_name_idx" ON "order_groups"("name");

-- CreateIndex
CREATE INDEX "orders_groupId_idx" ON "orders"("groupId");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "order_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;
