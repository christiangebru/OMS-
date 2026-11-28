-- Additive. DESIGN: the designer draws the embroidery pattern before
-- embroidery. Every route with EMBROIDERY gets DESIGN right before it.
-- Garments already past embroidery are not sent back: a garment that reached a
-- later step without a DESIGN checkpoint simply skips it (see skippedLateStage).
UPDATE "clothing_type_configs"
SET "stageSequence" =
      "stageSequence"[1:array_position("stageSequence", 'EMBROIDERY') - 1]
      || ARRAY['DESIGN']::TEXT[]
      || "stageSequence"[array_position("stageSequence", 'EMBROIDERY'):],
    "updatedAt" = NOW()
WHERE 'EMBROIDERY' = ANY("stageSequence")
  AND NOT ('DESIGN' = ANY("stageSequence"));
