-- Additive. Existing orders and their labels keep working.

-- Habesha garments: colour of the inner fabric (Geber), separate from the
-- main fabric colour.
ALTER TABLE "order_items" ADD COLUMN "innerFabricColor" TEXT NOT NULL DEFAULT '';

-- Hide clothing types from new-order pickers without deleting them, so old
-- orders that used them still resolve their production route.
ALTER TABLE "clothing_type_configs" ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true;

-- Common names. Keys stay the same, so existing items still match by code.
UPDATE "clothing_type_configs" SET "label" = 'Dress (embroidered)', "updatedAt" = NOW() WHERE "key" = 'womens_dress';
UPDATE "clothing_type_configs" SET "label" = 'Shirt', "updatedAt" = NOW() WHERE "key" = 'shirt';
UPDATE "clothing_type_configs" SET "label" = 'Trouser', "updatedAt" = NOW() WHERE "key" = 'pants';

-- Plain dress (no embroidery), only where clothing types have been set up.
INSERT INTO "clothing_type_configs"
  ("key", "label", "stageSequence", "includesEmbroidery", "itemKind", "partCodes", "offSiteStages", "compactLabel", "measurementProfile", "updatedAt")
SELECT 'dress', 'Dress', ARRAY['SEWING_CUTTING','FINAL_SEWING','FINISHING','SHOWROOM']::TEXT[], false, 'garment',
       ARRAY['WR','UB','LB']::TEXT[], ARRAY[]::TEXT[], false, 'female', NOW()
WHERE EXISTS (SELECT 1 FROM "clothing_type_configs")
ON CONFLICT ("key") DO NOTHING;

-- Not garments this atelier makes; hidden from pickers, kept for history.
UPDATE "clothing_type_configs" SET "active" = false, "updatedAt" = NOW()
WHERE "key" IN ('abaya', 'abaya_embroidered', 'thobe', 'thobe_embroidered', 'kids_garment');
