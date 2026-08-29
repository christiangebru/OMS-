/**
 * Fire-and-forget GET /health so a sleeping Render instance starts waking
 * on first paint (login included), not after Continue.
 */

import { resolveApiBase } from "./apiBase.js";

export function healthUrl(apiBase) {
  const base = resolveApiBase(apiBase);
  return base ? `${base}/health` : "/health";
}

/**
 * Kick the API. Never throws; ignores network / CORS / missing fetch.
 * @param {{ fetchImpl?: typeof fetch, apiBase?: string }} [options]
 * @returns {Promise<void>}
 */
export function prefetchApiHealth(options = {}) {
  const fetchImpl = Object.prototype.hasOwnProperty.call(options, "fetchImpl")
    ? options.fetchImpl
    : globalThis.fetch;
  const apiBase = options.apiBase ?? "";
  const url = healthUrl(apiBase);

  try {
    if (typeof fetchImpl !== "function") return Promise.resolve();
    const pending = fetchImpl(url, {
      method: "GET",
      cache: "no-store",
      credentials: "omit"
    });
    if (pending && typeof pending.then === "function") {
      return pending.then(
        () => undefined,
        () => undefined
      );
    }
    return Promise.resolve();
  } catch {
    return Promise.resolve();
  }
}
