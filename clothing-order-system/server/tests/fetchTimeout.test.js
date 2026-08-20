import { afterEach, describe, expect, it, jest } from "@jest/globals";
import {
  AUTH_RESTORE_TIMEOUT_MS,
  DEFAULT_API_TIMEOUT_MS,
  apiNetworkErrorMessage,
  fetchWithTimeout,
  mergeTimeoutSignal
} from "../../client/src/lib/fetchTimeout.js";

function hangingFetch(_url, init) {
  return new Promise((_resolve, reject) => {
    init.signal.addEventListener(
      "abort",
      () => {
        const err = new Error("The operation was aborted");
        err.name = "AbortError";
        reject(err);
      },
      { once: true }
    );
  });
}

describe("fetchWithTimeout", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("exposes a 10s auth-restore timeout and a longer default API timeout", () => {
    expect(AUTH_RESTORE_TIMEOUT_MS).toBe(10_000);
    expect(DEFAULT_API_TIMEOUT_MS).toBe(20_000);
  });

  it("resolves when fetch completes before the timeout", async () => {
    global.fetch = jest.fn(async () => ({ ok: true, status: 200 }));
    const res = await fetchWithTimeout("https://oms-28nk.onrender.com/api/auth/me", {}, 500);
    expect(res.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("aborts a hanging fetch with AbortError after timeoutMs", async () => {
    global.fetch = jest.fn(hangingFetch);
    const started = Date.now();
    await expect(fetchWithTimeout("https://example.test/hang", {}, 60)).rejects.toMatchObject({
      name: "AbortError"
    });
    expect(Date.now() - started).toBeGreaterThanOrEqual(50);
  });

  it("honors a caller AbortSignal before the timeout", async () => {
    global.fetch = jest.fn(hangingFetch);
    const user = new AbortController();
    const pending = fetchWithTimeout("https://example.test/hang", { signal: user.signal }, 5_000);
    user.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("mergeTimeoutSignal aborts after the given delay", async () => {
    const { signal, cleanup } = mergeTimeoutSignal(40);
    await new Promise((r) => setTimeout(r, 70));
    expect(signal.aborted).toBe(true);
    cleanup();
  });
});

describe("apiNetworkErrorMessage", () => {
  it("maps Safari Load failed and Chrome Failed to fetch", () => {
    expect(apiNetworkErrorMessage(new TypeError("Load failed"))).toBe("Cannot reach the server");
    expect(apiNetworkErrorMessage(new TypeError("Failed to fetch"))).toBe("Cannot reach the server");
    expect(apiNetworkErrorMessage(new TypeError("NetworkError when attempting to fetch resource."))).toBe(
      "Cannot reach the server"
    );
  });

  it("keeps timeout and unknown messages", () => {
    const abort = new Error("The operation was aborted");
    abort.name = "AbortError";
    expect(apiNetworkErrorMessage(abort)).toBe("Request timed out");
    expect(apiNetworkErrorMessage(new Error("socket hang up"))).toBe("socket hang up");
    expect(apiNetworkErrorMessage("not-an-error")).toBe("Network error");
  });
});
