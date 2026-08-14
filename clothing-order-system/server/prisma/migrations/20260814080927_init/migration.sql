-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL DEFAULT substr(md5((random())::text || (clock_timestamp())::text), 1, 24),
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'manager',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL DEFAULT substr(md5((random())::text || (clock_timestamp())::text), 1, 24),
    "tenantId" TEXT NOT NULL DEFAULT 'default',
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "secondaryPhone" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "measurements" (
    "id" TEXT NOT NULL DEFAULT substr(md5((random())::text || (clock_timestamp())::text), 1, 24),
    "customerId" TEXT NOT NULL,
    "chest" DOUBLE PRECISION,
    "waist" DOUBLE PRECISION,
    "hip" DOUBLE PRECISION,
    "shoulder" DOUBLE PRECISION,
    "sleeveLength" DOUBLE PRECISION,
    "inseam" DOUBLE PRECISION,
    "neck" DOUBLE PRECISION,
    "notes" TEXT NOT NULL DEFAULT '',
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "measurements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL DEFAULT substr(md5((random())::text || (clock_timestamp())::text), 1, 24),
    "tenantId" TEXT NOT NULL DEFAULT 'default',
    "orderId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "groupCode" TEXT NOT NULL DEFAULT '',
    "requiredCompletionDate" TIMESTAMP(3) NOT NULL,
    "estimatedProductionCompletion" TIMESTAMP(3),
    "productionStatus" TEXT NOT NULL DEFAULT 'pending',
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "totalAgreedPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "depositPaid" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalRevenue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "barcodeValue" TEXT NOT NULL,
    "barcodeGeneratedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "lastUpdatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" TEXT NOT NULL DEFAULT substr(md5((random())::text || (clock_timestamp())::text), 1, 24),
    "order" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "clothingCode" TEXT NOT NULL,
    "clothingType" TEXT NOT NULL,
    "fabricType" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "neckType" TEXT NOT NULL,
    "handType" TEXT NOT NULL,
    "size" TEXT NOT NULL,
    "measurements" JSONB,
    "productionDays" INTEGER NOT NULL DEFAULT 3,
    "lineTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "unitPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "difficultyLevel" INTEGER NOT NULL DEFAULT 3,
    "barcodeValue" TEXT NOT NULL,
    "barcodeGeneratedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_item_images" (
    "id" TEXT NOT NULL DEFAULT substr(md5((random())::text || (clock_timestamp())::text), 1, 24),
    "orderItemId" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "caption" TEXT NOT NULL DEFAULT '',
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_item_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clothing_type_configs" (
    "id" TEXT NOT NULL DEFAULT substr(md5((random())::text || (clock_timestamp())::text), 1, 24),
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "stageSequence" TEXT[],
    "includesEmbroidery" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clothing_type_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_logs" (
    "id" TEXT NOT NULL DEFAULT substr(md5((random())::text || (clock_timestamp())::text), 1, 24),
    "orderId" TEXT NOT NULL,
    "mongoOrderId" TEXT,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT,
    "notes" TEXT NOT NULL DEFAULT '',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "production_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff" (
    "id" TEXT NOT NULL DEFAULT substr(md5((random())::text || (clock_timestamp())::text), 1, 24),
    "tenantId" TEXT NOT NULL DEFAULT 'default',
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'AVAILABLE',
    "skillLevel" INTEGER NOT NULL DEFAULT 3,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "staff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_skills" (
    "id" TEXT NOT NULL DEFAULT substr(md5((random())::text || (clock_timestamp())::text), 1, 24),
    "staffId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,

    CONSTRAINT "staff_skills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_assignments" (
    "id" TEXT NOT NULL DEFAULT substr(md5((random())::text || (clock_timestamp())::text), 1, 24),
    "staffId" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "suggestedStaffId" TEXT,
    "followedSuggestion" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "staff_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stage_checkpoints" (
    "id" TEXT NOT NULL DEFAULT substr(md5((random())::text || (clock_timestamp())::text), 1, 24),
    "orderItemId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "checkedInAt" TIMESTAMP(3) NOT NULL,
    "checkedInByStaffId" TEXT,
    "checkedOutAt" TIMESTAMP(3),
    "checkedOutByStaffId" TEXT,
    "notes" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "stage_checkpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "statistic_snapshots" (
    "id" TEXT NOT NULL DEFAULT substr(md5((random())::text || (clock_timestamp())::text), 1, 24),
    "key" TEXT NOT NULL DEFAULT 'global',
    "totalOrders" INTEGER NOT NULL DEFAULT 0,
    "completedOrders" INTEGER NOT NULL DEFAULT 0,
    "delayedOrders" INTEGER NOT NULL DEFAULT 0,
    "totalRevenue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "byStatus" JSONB NOT NULL DEFAULT '{}',
    "byClothingType" JSONB NOT NULL DEFAULT '{}',
    "lastComputedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "statistic_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "customers_tenantId_idx" ON "customers"("tenantId");

-- CreateIndex
CREATE INDEX "customers_phone_idx" ON "customers"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "customers_tenantId_phone_key" ON "customers"("tenantId", "phone");

-- CreateIndex
CREATE INDEX "measurements_customerId_idx" ON "measurements"("customerId");

-- CreateIndex
CREATE INDEX "measurements_recordedAt_idx" ON "measurements"("recordedAt");

-- CreateIndex
CREATE UNIQUE INDEX "orders_orderId_key" ON "orders"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "orders_barcodeValue_key" ON "orders"("barcodeValue");

-- CreateIndex
CREATE INDEX "orders_tenantId_idx" ON "orders"("tenantId");

-- CreateIndex
CREATE INDEX "orders_customerId_idx" ON "orders"("customerId");

-- CreateIndex
CREATE INDEX "orders_groupCode_idx" ON "orders"("groupCode");

-- CreateIndex
CREATE INDEX "orders_productionStatus_idx" ON "orders"("productionStatus");

-- CreateIndex
CREATE UNIQUE INDEX "order_items_barcodeValue_key" ON "order_items"("barcodeValue");

-- CreateIndex
CREATE INDEX "order_items_order_idx" ON "order_items"("order");

-- CreateIndex
CREATE INDEX "order_items_orderId_idx" ON "order_items"("orderId");

-- CreateIndex
CREATE INDEX "order_items_clothingType_idx" ON "order_items"("clothingType");

-- CreateIndex
CREATE INDEX "order_item_images_orderItemId_idx" ON "order_item_images"("orderItemId");

-- CreateIndex
CREATE UNIQUE INDEX "clothing_type_configs_key_key" ON "clothing_type_configs"("key");

-- CreateIndex
CREATE INDEX "production_logs_orderId_idx" ON "production_logs"("orderId");

-- CreateIndex
CREATE INDEX "staff_tenantId_idx" ON "staff"("tenantId");

-- CreateIndex
CREATE INDEX "staff_active_idx" ON "staff"("active");

-- CreateIndex
CREATE INDEX "staff_skills_staffId_idx" ON "staff_skills"("staffId");

-- CreateIndex
CREATE UNIQUE INDEX "staff_skills_staffId_stage_key" ON "staff_skills"("staffId", "stage");

-- CreateIndex
CREATE INDEX "staff_assignments_staffId_completedAt_idx" ON "staff_assignments"("staffId", "completedAt");

-- CreateIndex
CREATE INDEX "staff_assignments_orderItemId_stage_completedAt_idx" ON "staff_assignments"("orderItemId", "stage", "completedAt");

-- CreateIndex
CREATE INDEX "stage_checkpoints_orderItemId_idx" ON "stage_checkpoints"("orderItemId");

-- CreateIndex
CREATE UNIQUE INDEX "statistic_snapshots_key_key" ON "statistic_snapshots"("key");

-- AddForeignKey
ALTER TABLE "measurements" ADD CONSTRAINT "measurements_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_fkey" FOREIGN KEY ("order") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_item_images" ADD CONSTRAINT "order_item_images_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "order_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_logs" ADD CONSTRAINT "production_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_skills" ADD CONSTRAINT "staff_skills_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_assignments" ADD CONSTRAINT "staff_assignments_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_assignments" ADD CONSTRAINT "staff_assignments_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "order_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stage_checkpoints" ADD CONSTRAINT "stage_checkpoints_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "order_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
