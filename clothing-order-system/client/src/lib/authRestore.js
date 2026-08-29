/**
 * Pure auth-restore planner. AuthProvider applies this result so every path
 * ends with loading=false and never retries in a loop.
 *
 * Last-known user is cached next to the JWT so returning visits can render
 * the shop immediately while GET /api/auth/me refreshes in the background.
 */

import { isAbortError } from "./fetchTimeout.js";

export const AUTH_TOKEN_KEY = "token";
export const AUTH_USER_CACHE_KEY = "authUser";

export function isTimeoutError(error) {
  if (!error || typeof error !== "object") return false;
  if (error.code === "timeout") return true;
  if (isAbortError(error)) return true;
  return /timed out|aborted/i.test(String(error.message || ""));
}

export function authRestoreFailureMessage(error) {
  if (!error) return "Could not restore your session. Please sign in again.";
  if (error.status === 401) return "Your session expired. Please sign in again.";
  if (isTimeoutError(error) || error.status === 0) {
    return "Having trouble connecting to the server. Please sign in again.";
  }
  return "Could not restore your session. Please sign in again.";
}

function safeStorage(storage) {
  if (storage) return storage;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

/** @param {unknown} raw */
export function parseCachedAuthUser(raw) {
  if (!raw || typeof raw !== "string") return null;
  try {
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof parsed.id === "string" &&
      parsed.id &&
      typeof parsed.email === "string" &&
      typeof parsed.name === "string" &&
      typeof parsed.role === "string"
    ) {
      return {
        id: parsed.id,
        email: parsed.email,
        name: parsed.name,
        role: parsed.role
      };
    }
  } catch {
    // ignore corrupt cache
  }
  return null;
}

export function readCachedAuthUser(storage) {
  const store = safeStorage(storage);
  if (!store || typeof store.getItem !== "function") return null;
  try {
    return parseCachedAuthUser(store.getItem(AUTH_USER_CACHE_KEY));
  } catch {
    return null;
  }
}

export function writeCachedAuthUser(user, storage) {
  const store = safeStorage(storage);
  if (!store || typeof store.setItem !== "function" || !user) return;
  const snapshot = parseCachedAuthUser(JSON.stringify(user));
  if (!snapshot) return;
  try {
    store.setItem(AUTH_USER_CACHE_KEY, JSON.stringify(snapshot));
  } catch {
    // quota / private mode
  }
}

export function clearAuthSession(storage) {
  const store = safeStorage(storage);
  if (!store) return;
  try {
    if (typeof store.removeItem === "function") {
      store.removeItem(AUTH_TOKEN_KEY);
      store.removeItem(AUTH_USER_CACHE_KEY);
    }
  } catch {
    // ignore
  }
}

/**
 * First-paint auth state. Token + cached user → render the app immediately.
 * Token without a cache still blocks on /api/auth/me (existing spinner).
 *
 * @param {{ token?: string | null, cachedUser?: object | null }} [input]
 */
export function planAuthBoot(input = {}) {
  const token = input.token || null;
  const cachedUser = input.cachedUser || null;

  if (token && cachedUser) {
    return {
      loading: false,
      user: cachedUser,
      token,
      sessionError: null
    };
  }

  if (token) {
    return {
      loading: true,
      user: null,
      token,
      sessionError: null
    };
  }

  return {
    loading: false,
    user: null,
    token: null,
    sessionError: null
  };
}

/**
 * @param {{ token?: string | null, result?: { ok: true, user: unknown } | { ok: false, error?: object } }} input
 */
export function planAuthRestore(input = {}) {
  const token = input.token || null;
  const result = input.result;

  if (!token) {
    return {
      loading: false,
      user: null,
      token: null,
      sessionError: null,
      clearToken: false
    };
  }

  if (result && result.ok) {
    return {
      loading: false,
      user: result.user,
      token,
      sessionError: null,
      clearToken: false
    };
  }

  return {
    loading: false,
    user: null,
    token: null,
    sessionError: authRestoreFailureMessage(result?.error),
    clearToken: true
  };
}
