/**
 * Normalize stored reference-image values for API responses.
 * Never expose local filesystem paths to the browser.
 */
export function storedImagePath(raw) {
  const value = String(raw || "").trim();
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;

  const unix = value.replace(/\\/g, "/").replace(/\/+/g, "/");
  const uploads = unix.match(/(?:^|\/)(uploads\/[^\s?#]+)$/i);
  if (uploads) return uploads[1];

  if (/^[a-zA-Z]:\//.test(unix) || unix.startsWith("/") || unix.startsWith("file:")) {
    return "";
  }

  return unix.replace(/^\//, "");
}

export function publicImageUrl(stored, apiBase = "") {
  const path = storedImagePath(stored);
  if (!path) return "";
  if (/^https?:\/\//i.test(path)) return path;
  const base = String(apiBase || "").replace(/\/$/, "");
  return base ? `${base}/${path}` : path;
}
