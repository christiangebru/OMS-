-- Additive. Which route stages an OFF_SITE trip covered, so a later off-site
-- stage after the garment came back is a separate trip (not merged into it).
ALTER TABLE "stage_checkpoints" ADD COLUMN "coveredStages" TEXT[] DEFAULT ARRAY[]::TEXT[];
