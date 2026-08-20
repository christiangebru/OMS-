/**
 * AbortController-based fetch timeout. Used by the client API layer and
 * covered by server-side regression tests (no frontend test runner).
 */

export const DEFAULT_API_TIMEOUT_MS = 20_000;
export const AUTH_RESTORE_TIMEOUT_MS = 10_000;

export function isAbortError(error) {
  if (!error || typeof error !== "object") return false;
  return error.name === "AbortError";
}

export function abortError(message = "The operation was aborted") {
  const err = new Error(message);
  err.name = "AbortError";
  return err;
}

/**
 * Combine a timeout with an optional caller-supplied AbortSignal.
 * Caller must invoke cleanup() so the timer does not leak.
 */
export function mergeTimeoutSignal(timeoutMs, userSignal) {
  const controller = new AbortController();
  const ms = typeof timeoutMs === "number" && timeoutMs > 0 ? timeoutMs : DEFAULT_API_TIMEOUT_MS;

  const abortFromTimeout = () => controller.abort();
  const abortFromUser = () => controller.abort();
  const timeoutId = setTimeout(abortFromTimeout, ms);

  if (userSignal) {
    if (userSignal.aborted) {
      controller.abort();
    } else {
      userSignal.addEventListener("abort", abortFromUser, { once: true });
    }
  }

  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timeoutId);
      if (userSignal) userSignal.removeEventListener("abort", abortFromUser);
    }
  };
}

export async function fetchWithTimeout(url, init = {}, timeoutMs = DEFAULT_API_TIMEOUT_MS) {
  const { signal, cleanup } = mergeTimeoutSignal(timeoutMs, init.signal);
  try {
    if (signal.aborted) throw abortError();
    return await fetch(url, { ...init, signal });
  } finally {
    cleanup();
  }
}
