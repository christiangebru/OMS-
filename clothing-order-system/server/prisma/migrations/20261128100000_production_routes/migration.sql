-- Additive. Orders already created keep the route they were created with.

-- Per-garment stages a part skips (e.g. the lower-body part of an
-- "upper body embroidery only" dress skips EMBROIDERY). Copied from the
-- clothing type when the part is created.
ALTER TABLE "order_items" ADD COLUMN "skipStages" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Clothing type: stages each part code skips, e.g. {"LB": ["EMBROIDERY"]}.
ALTER TABLE "clothing_type_configs" ADD COLUMN "partSkipStages" JSONB NOT NULL DEFAULT '{}';

-- Women's dresses: embroidery in-house by default (off-site per garment is optional).
UPDATE "clothing_type_configs"
SET "label" = 'Dress — full embroidery', "offSiteStages" = ARRAY[]::TEXT[], "updatedAt" = NOW()
WHERE "key" = 'womens_dress';

-- "Non-embroidered" dress still has embroidery on the upper body and wrists;
-- only the lower body has none.
UPDATE "clothing_type_configs"
SET "label" = 'Dress — upper body embroidery only',
    "stageSequence" = ARRAY['SEWING_CUTTING','EMBROIDERY','FINAL_SEWING','FINISHING','SHOWROOM']::TEXT[],
    "includesEmbroidery" = true,
    "offSiteStages" = ARRAY[]::TEXT[],
    "partSkipStages" = '{"LB": ["EMBROIDERY"]}',
    "updatedAt" = NOW()
WHERE "key" = 'dress';

-- Men's trouser: made entirely by an outside maker and returned complete.
UPDATE "clothing_type_configs"
SET "stageSequence" = ARRAY['SEWING_CUTTING','FINAL_SEWING','FINISHING','SHOWROOM']::TEXT[],
    "offSiteStages" = ARRAY['SEWING_CUTTING','FINAL_SEWING','FINISHING']::TEXT[],
    "partCodes" = ARRAY[]::TEXT[],
    "updatedAt" = NOW()
WHERE "key" = 'pants';
