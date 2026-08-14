/**
 * Response serialization helpers.
 *
 * The legacy MongoDB API exposed primary keys as `_id`. Prisma records use
 * `id`. These helpers rename `id` -> `_id` at the record boundary so the
 * existing frontend contract is preserved. Conversion is shallow on purpose:
 * JSON columns (measurements, metadata, byStatus, ...) are copied verbatim and
 * never rewritten.
 */

/** Convert a single Prisma record to the API shape (`id` -> `_id`). */
export function s(rec) {
  if (rec == null) return rec;
  const { id, ...rest } = rec;
  return id === undefined ? { ...rest } : { _id: id, ...rest };
}

/** Convert an array of records. */
export function sMany(arr) {
  return (arr || []).map(s);
}
