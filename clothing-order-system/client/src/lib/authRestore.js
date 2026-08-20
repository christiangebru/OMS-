/**
 * Pure auth-restore planner. AuthProvider applies this result so every path
 * ends with loading=false and never retries in a loop.
 */

import { isAbortError } from "./fetchTimeout.js";

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
