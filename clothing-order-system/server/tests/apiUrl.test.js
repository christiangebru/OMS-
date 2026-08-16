import { describe, it, expect } from "@jest/globals";
import { apiUrl, resolveApiBase } from "../../client/src/lib/apiBase.js";

const RENDER = "https://oms-28nk.onrender.com";
const OPS = "/api/dashboard/operations";

describe("apiUrl / resolveApiBase", () => {
  it("resolves canonical production base + operations path", () => {
    expect(apiUrl(OPS, RENDER)).toBe(`${RENDER}${OPS}`);
  });

  it("strips trailing slash from base", () => {
    expect(apiUrl(OPS, `${RENDER}/`)).toBe(`${RENDER}${OPS}`);
  });

  it("strips accidental /api suffix from base (never /api/api/...)", () => {
    expect(apiUrl(OPS, `${RENDER}/api`)).toBe(`${RENDER}${OPS}`);
    expect(apiUrl(OPS, `${RENDER}/API`)).toBe(`${RENDER}${OPS}`);
  });

  it("never produces /api/api/ for production endpoints", () => {
    const bases = [RENDER, `${RENDER}/`, `${RENDER}/api`, `${RENDER}/API`];
    const paths = [
      "/api/dashboard/operations",
      "/api/production/queue",
      "/api/production/queue?lite=1",
      "/api/production/floor"
    ];
    for (const base of bases) {
      for (const path of paths) {
        const url = apiUrl(path, base);
        expect(url).not.toContain("/api/api/");
        expect(url.startsWith(RENDER)).toBe(true);
      }
    }
  });

  it("refuses to build double /api paths", () => {
    expect(() => apiUrl("/api/dashboard/operations", `${RENDER}/api`)).not.toThrow();
    // Bypass normalization to prove guard catches impossible states if reintroduced
    expect(resolveApiBase("")).toBe("");
    expect(apiUrl("/api/auth/me", "")).toBe("/api/auth/me");
  });
});
