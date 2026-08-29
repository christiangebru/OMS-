import { clothingTypeToKey } from "../constants/production.js";

/**
 * Resolve a ClothingTypeConfig from a free-text type and/or clothing code.
 * New-order labels ("Men's shirt") must still hit the `shirt` seed so off-site
 * trips and part codes stay attached.
 */
export async function findClothingTypeConfig(client, clothingType, clothingCode) {
  const typeKey = clothingTypeToKey(clothingType);
  const codeKey = clothingTypeToKey(clothingCode);
  const candidates = [...new Set([typeKey, codeKey])].filter(Boolean);
  for (const key of candidates) {
    const found = await client.clothingTypeConfig.findUnique({ where: { key } });
    if (found) return found;
  }
  const label = String(clothingType || "").trim();
  if (label) {
    const byLabel = await client.clothingTypeConfig.findFirst({
      where: { label: { equals: label, mode: "insensitive" } }
    });
    if (byLabel) return byLabel;
  }
  return null;
}
