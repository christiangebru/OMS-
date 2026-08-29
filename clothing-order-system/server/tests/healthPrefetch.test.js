import { describe, expect, it } from "@jest/globals";
import { healthUrl, prefetchApiHealth } from "../../client/src/lib/healthPrefetch.js";

describe("prefetchApiHealth", () => {
  it("builds GET {apiBase}/health without an /api prefix", () => {
    expect(healthUrl("https://oms-28nk.onrender.com")).toBe("https://oms-28nk.onrender.com/health");
    expect(healthUrl("https://oms-28nk.onrender.com/")).toBe("https://oms-28nk.onrender.com/health");
    expect(healthUrl("https://oms-28nk.onrender.com/api")).toBe("https://oms-28nk.onrender.com/health");
  });

  it("GETs /health with no Authorization header", async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, init });
      return { ok: true, status: 200 };
    };
    await prefetchApiHealth({ fetchImpl, apiBase: "https://oms-28nk.onrender.com" });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://oms-28nk.onrender.com/health");
    expect(calls[0].init.method).toBe("GET");
    expect(calls[0].init.credentials).toBe("omit");
    expect(calls[0].init.headers).toBeUndefined();
  });

  it("does not throw when fetch rejects", async () => {
    const fetchImpl = async () => {
      throw new Error("Failed to fetch");
    };
    await expect(
      prefetchApiHealth({ fetchImpl, apiBase: "https://oms-28nk.onrender.com" })
    ).resolves.toBeUndefined();
  });

  it("does not throw when fetch throws synchronously", async () => {
    const fetchImpl = () => {
      throw new Error("boom");
    };
    await expect(prefetchApiHealth({ fetchImpl, apiBase: "http://localhost:4000" })).resolves.toBeUndefined();
  });

  it("does not throw when fetch is missing", async () => {
    await expect(
      prefetchApiHealth({ fetchImpl: null, apiBase: "http://localhost:4000" })
    ).resolves.toBeUndefined();
  });
});
