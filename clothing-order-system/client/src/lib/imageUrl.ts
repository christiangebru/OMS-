/**
 * Browser-safe image URL from a stored API value.
 * Never keep local filesystem paths in img src.
 */
export function storedImagePath(raw: string | undefined | null): string {
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

export function publicImageUrl(stored: string | undefined | null, apiBase = ""): string {
  const path = storedImagePath(stored);
  if (!path) return "";
  if (/^https?:\/\//i.test(path)) return path;
  const base = String(apiBase || "").replace(/\/$/, "");
  return base ? `${base}/${path}` : path;
}
