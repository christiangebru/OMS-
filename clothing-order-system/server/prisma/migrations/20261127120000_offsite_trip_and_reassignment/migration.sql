-- Additive only. Existing rows keep working with the defaults below.

-- Off-site trips are a location, not a staff member: record who took the
-- garment as free text, plus an optional phone and expected return date.
ALTER TABLE "stage_checkpoints" ADD COLUMN "offSiteHandlerName" TEXT NOT NULL DEFAULT '';
ALTER TABLE "stage_checkpoints" ADD COLUMN "offSiteHandlerPhone" TEXT NOT NULL DEFAULT '';
ALTER TABLE "stage_checkpoints" ADD COLUMN "expectedReturnAt" TIMESTAMP(3);

-- True once the manager changed this garment's off-site route by hand, so an
-- empty list means "all in shop" instead of "use the clothing type default".
ALTER TABLE "order_items" ADD COLUMN "offSiteRouteCustom" BOOLEAN NOT NULL DEFAULT false;

-- A stage handed to another worker is closed but not completed work.
ALTER TABLE "staff_assignments" ADD COLUMN "reassignedAt" TIMESTAMP(3);
