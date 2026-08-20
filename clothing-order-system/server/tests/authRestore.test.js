import { describe, it, expect } from "@jest/globals";
import { planAuthRestore, isTimeoutError, authRestoreFailureMessage } from "../../client/src/lib/authRestore.js";

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
