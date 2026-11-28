-- Additive. Netela routes and the off-site fringe-twisting ("kuchet") step.

-- Embroidered netela: embroidery and finishing in-house, then fringe twisting off-site.
UPDATE "clothing_type_configs"
SET "label" = 'Netela — embroidered',
    "stageSequence" = ARRAY['EMBROIDERY','FINISHING','FRINGE_TWISTING','SHOWROOM']::TEXT[],
    "includesEmbroidery" = true,
    "offSiteStages" = ARRAY['FRINGE_TWISTING']::TEXT[],
    "updatedAt" = NOW()
WHERE "key" = 'netela';

-- Tilet netela (no embroidery): fringe twisting off-site only.
-- Tilet with embroidery: same route as the embroidered netela.
-- Only inserted where the clothing types were already seeded (fresh databases
-- get them from the seed).
INSERT INTO "clothing_type_configs"
  ("key", "label", "stageSequence", "includesEmbroidery", "itemKind", "partCodes", "offSiteStages", "compactLabel", "measurementProfile", "updatedAt")
SELECT 'netela_tilet', 'Netela — tilet, no embroidery', ARRAY['FRINGE_TWISTING','SHOWROOM']::TEXT[], false, 'accessory',
       ARRAY[]::TEXT[], ARRAY['FRINGE_TWISTING']::TEXT[], true, 'none', NOW()
WHERE EXISTS (SELECT 1 FROM "clothing_type_configs")
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "clothing_type_configs"
  ("key", "label", "stageSequence", "includesEmbroidery", "itemKind", "partCodes", "offSiteStages", "compactLabel", "measurementProfile", "updatedAt")
SELECT 'netela_tilet_embroidered', 'Netela — tilet with embroidery', ARRAY['EMBROIDERY','FINISHING','FRINGE_TWISTING','SHOWROOM']::TEXT[], true, 'accessory',
       ARRAY[]::TEXT[], ARRAY['FRINGE_TWISTING']::TEXT[], true, 'none', NOW()
WHERE EXISTS (SELECT 1 FROM "clothing_type_configs")
ON CONFLICT ("key") DO NOTHING;
