/**
 * Canonical API origin resolver. Used by the client and server-side regression tests.
 * VITE_API_URL must be the backend origin only (no trailing slash, no /api suffix).
 */
export function resolveApiBase(raw) {
  return String(raw || "")
    .trim()
    .replace(/\/$/, "")
    .replace(/\/api$/i, "");
}

/** Build a full request URL from an optional base override and an /api/... path. */
export function apiUrl(path, rawBase = "") {
  const base = resolveApiBase(rawBase);
  if (!path.startsWith("/")) {
    throw new Error(`API paths must start with / (got ${path})`);
  }
  const url = `${base}${path}`;
  if (url.includes("/api/api/")) {
    throw new Error(`Refusing double /api prefix: ${url}`);
  }
  return url;
}
