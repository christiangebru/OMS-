/**
 * Accept both the current ObjectId-shaped 24-hex keys and legacy ids that
 * already exist in some databases (Prisma cuid(), UUID).
 * Assigned ≠ a reason to reject the request at the validator.
 */
export function isRecordId(value) {
  if (typeof value !== "string" || !value) return false;
  if (/^[a-f0-9]{24}$/i.test(value)) return true;
  if (/^c[a-z0-9]{20,31}$/i.test(value)) return true;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    return true;
  }
  return false;
}
