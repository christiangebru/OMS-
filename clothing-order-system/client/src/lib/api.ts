import { apiUrl, resolveApiBase } from "./apiBase.js";
import {
  DEFAULT_API_TIMEOUT_MS,
  apiNetworkErrorMessage,
  fetchWithTimeout,
  isAbortError
} from "./fetchTimeout.js";

const API_BASE = resolveApiBase(import.meta.env.VITE_API_URL);

export { DEFAULT_API_TIMEOUT_MS, AUTH_RESTORE_TIMEOUT_MS } from "./fetchTimeout.js";

function authHeader(): HeadersInit {
  const token = localStorage.getItem("token");
  const h: Record<string, string> = {};
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export type ApiRequestInit = RequestInit & {
  timeoutMs?: number;
  skipAuthRedirect?: boolean;
};

export async function apiJson<T>(path: string, init: ApiRequestInit = {}): Promise<T> {
  const { timeoutMs, skipAuthRedirect, headers: initHeaders, ...rest } = init;
  const headers: HeadersInit = {
    ...authHeader(),
    ...(initHeaders || {})
  };
  if (!(rest.body instanceof FormData)) {
    (headers as Record<string, string>)["Content-Type"] = "application/json";
  }
  let res: Response;
  try {
    res = await fetchWithTimeout(
      apiUrl(path, API_BASE),
      { ...rest, headers },
      timeoutMs ?? DEFAULT_API_TIMEOUT_MS
    );
  } catch (e) {
    if (isAbortError(e)) {
      throw new ApiError("Request timed out", 0, "timeout");
    }
    throw new ApiError(apiNetworkErrorMessage(e), 0);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let data: { message?: string; errors?: Array<{ msg?: string }> } | null = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new ApiError(
        res.ok ? "Invalid server response" : `Request failed (${res.status})`,
        res.status || 502
      );
    }
  }
  if (!res.ok) {
    if (
      res.status === 401 &&
      !skipAuthRedirect &&
      typeof window !== "undefined" &&
      !path.startsWith("/api/auth/login") &&
      !path.startsWith("/api/auth/bootstrap")
    ) {
      localStorage.removeItem("token");
      if (!window.location.pathname.startsWith("/login")) {
        window.location.href = "/login";
      }
    }
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

export async function patchOrderItemImage(
  itemId: string,
  imageId: string,
  data: { caption?: string; category?: string; sortOrder?: number }
) {
  return apiJson(`/api/order-items/${itemId}/images/${imageId}`, {
    method: "PATCH",
    body: JSON.stringify(data)
  });
}

export async function deleteOrderItemImage(itemId: string, imageId: string) {
  return apiJson(`/api/order-items/${itemId}/images/${imageId}`, { method: "DELETE" });
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
