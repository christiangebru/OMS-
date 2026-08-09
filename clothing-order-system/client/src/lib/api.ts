const API_BASE = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");

function authHeader(): HeadersInit {
  const token = localStorage.getItem("token");
  const h: Record<string, string> = {};
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: HeadersInit = {
    ...authHeader(),
    ...(init.headers || {})
  };
  if (!(init.body instanceof FormData)) {
    (headers as Record<string, string>)["Content-Type"] = "application/json";
  }
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const msg = data?.message || data?.errors?.[0]?.msg || res.statusText;
    throw new ApiError(msg || "Request failed", res.status);
  }
  return data as T;
}

export async function uploadImage(file: File): Promise<{ path: string; url: string }> {
  const fd = new FormData();
  fd.append("image", file);
  const headers = authHeader();
  const res = await fetch(`${API_BASE}/api/upload`, { method: "POST", headers, body: fd });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.message || "Upload failed", res.status);
  return data;
}

export async function uploadOrderItemImages(
  itemId: string,
  files: File[],
  captions?: string[]
): Promise<unknown[]> {
  const fd = new FormData();
  files.forEach((f) => fd.append("images", f));
  (captions || []).forEach((c) => fd.append("captions", c));
  const headers = authHeader();
  const res = await fetch(`${API_BASE}/api/order-items/${itemId}/images`, {
    method: "POST",
    headers,
    body: fd
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.message || "Upload failed", res.status);
  return data;
}

export function imageUrlFromPath(path: string): string {
  if (!path) return "";
  if (path.startsWith("http")) return path;
  return `${API_BASE}/${path.replace(/^\//, "")}`;
}

export function balanceRemaining(totalAgreedPrice?: number, depositPaid?: number): number {
  return Math.max(0, (Number(totalAgreedPrice) || 0) - (Number(depositPaid) || 0));
}

export function apiBaseUrl(): string {
  return API_BASE;
}

export function authToken(): string | null {
  return localStorage.getItem("token");
}
