import { describe, expect, it } from "@jest/globals";
import {
  AUTH_TOKEN_KEY,
  AUTH_USER_CACHE_KEY,
  clearAuthSession,
  parseCachedAuthUser,
  planAuthBoot,
  planAuthRestore,
  isTimeoutError,
  authRestoreFailureMessage,
  readCachedAuthUser,
  writeCachedAuthUser
} from "../../client/src/lib/authRestore.js";

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
    },
    setItem(key, value) {
      data[key] = String(value);
    },
    removeItem(key) {
      delete data[key];
    },
    _data: data
  };
}

describe("planAuthRestore", () => {
  it("no token → user=null, loading=false, do not clear token", () => {
    const planned = planAuthRestore({ token: null });
    expect(planned.loading).toBe(false);
    expect(planned.user).toBe(null);
    expect(planned.clearToken).toBe(false);
    expect(planned.sessionError).toBe(null);
  });

  it("successful session restore → user set, loading=false", () => {
    const user = { id: "abc", email: "a@b.c", name: "Ann", role: "admin" };
    const planned = planAuthRestore({ token: "tok", result: { ok: true, user } });
    expect(planned.loading).toBe(false);
    expect(planned.user).toEqual(user);
    expect(planned.clearToken).toBe(false);
    expect(planned.sessionError).toBe(null);
  });

  it("401 → clear session, loading=false", () => {
    const planned = planAuthRestore({
      token: "tok",
      result: { ok: false, error: { status: 401, message: "Invalid or expired token" } }
    });
    expect(planned.loading).toBe(false);
    expect(planned.user).toBe(null);
    expect(planned.clearToken).toBe(true);
    expect(planned.sessionError).toMatch(/session expired/i);
  });

  it("network failure → clear session, loading=false", () => {
    const planned = planAuthRestore({
      token: "tok",
      result: { ok: false, error: { status: 0, message: "Failed to fetch" } }
    });
    expect(planned.loading).toBe(false);
    expect(planned.user).toBe(null);
    expect(planned.clearToken).toBe(true);
    expect(planned.sessionError).toMatch(/trouble connecting/i);
  });

  it("timeout / AbortError → clear session, loading=false", () => {
    const abort = Object.assign(new Error("The operation was aborted"), { name: "AbortError" });
    expect(isTimeoutError(abort)).toBe(true);
    expect(isTimeoutError({ code: "timeout", message: "Request timed out" })).toBe(true);

    const planned = planAuthRestore({
      token: "tok",
      result: { ok: false, error: { status: 0, code: "timeout", message: "Request timed out" } }
    });
    expect(planned.loading).toBe(false);
    expect(planned.user).toBe(null);
    expect(planned.clearToken).toBe(true);
    expect(planned.sessionError).toMatch(/trouble connecting/i);
  });

  it("500 / API failure → clear session, loading=false", () => {
    const planned = planAuthRestore({
      token: "tok",
      result: { ok: false, error: { status: 500, message: "Internal Server Error" } }
    });
    expect(planned.loading).toBe(false);
    expect(planned.user).toBe(null);
    expect(planned.clearToken).toBe(true);
    expect(authRestoreFailureMessage({ status: 500 })).toMatch(/could not restore/i);
  });

  it("loading is always false on every planned outcome", () => {
    const cases = [
      planAuthRestore({ token: null }),
      planAuthRestore({ token: "t", result: { ok: true, user: { id: "1" } } }),
      planAuthRestore({ token: "t", result: { ok: false, error: { status: 401 } } }),
      planAuthRestore({ token: "t", result: { ok: false, error: { status: 0 } } }),
      planAuthRestore({ token: "t", result: { ok: false, error: { code: "timeout" } } }),
      planAuthRestore({ token: "t", result: { ok: false, error: { status: 503 } } })
    ];
    for (const planned of cases) {
      expect(planned.loading).toBe(false);
    }
  });
});

describe("planAuthBoot (cached-user restore)", () => {
  const user = { id: "abc", email: "a@b.c", name: "Ann", role: "admin" };

  it("token + cached user → loading=false so the shop is not blocked", () => {
    const boot = planAuthBoot({ token: "tok", cachedUser: user });
    expect(boot.loading).toBe(false);
    expect(boot.user).toEqual(user);
    expect(boot.token).toBe("tok");
    expect(boot.sessionError).toBe(null);
  });

  it("token without cache → loading=true (restore spinner until /me)", () => {
    const boot = planAuthBoot({ token: "tok", cachedUser: null });
    expect(boot.loading).toBe(true);
    expect(boot.user).toBe(null);
    expect(boot.token).toBe("tok");
  });

  it("no token → loading=false even if a stale cache exists", () => {
    const boot = planAuthBoot({ token: null, cachedUser: user });
    expect(boot.loading).toBe(false);
    expect(boot.user).toBe(null);
    expect(boot.token).toBe(null);
  });
});

describe("auth user cache", () => {
  it("parses a valid snapshot and rejects junk", () => {
    const user = { id: "1", email: "a@b.c", name: "Ann", role: "admin" };
    expect(parseCachedAuthUser(JSON.stringify(user))).toEqual(user);
    expect(parseCachedAuthUser("{")).toBe(null);
    expect(parseCachedAuthUser(JSON.stringify({ email: "no-id" }))).toBe(null);
    expect(parseCachedAuthUser(null)).toBe(null);
  });

  it("round-trips through storage next to the token key", () => {
    const store = memoryStorage();
    const user = { id: "1", email: "a@b.c", name: "Ann", role: "admin", extra: "drop-me" };
    writeCachedAuthUser(user, store);
    expect(store.getItem(AUTH_USER_CACHE_KEY)).toBe(
      JSON.stringify({ id: "1", email: "a@b.c", name: "Ann", role: "admin" })
    );
    expect(readCachedAuthUser(store)).toEqual({ id: "1", email: "a@b.c", name: "Ann", role: "admin" });
    store.setItem(AUTH_TOKEN_KEY, "tok");
    clearAuthSession(store);
    expect(store.getItem(AUTH_TOKEN_KEY)).toBe(null);
    expect(store.getItem(AUTH_USER_CACHE_KEY)).toBe(null);
  });
});
