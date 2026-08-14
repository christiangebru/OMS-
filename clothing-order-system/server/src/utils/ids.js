import crypto from "crypto";

/**
 * Generate a 24-char lowercase-hex id (ObjectId-shaped).
 * Used where the id must be known before insert (e.g. item barcodes derive
 * from the item id). Matches the database-side default so the two are
 * interchangeable and both satisfy `isMongoId()` validators.
 */
export function newId() {
  return crypto.randomBytes(12).toString("hex");
}
