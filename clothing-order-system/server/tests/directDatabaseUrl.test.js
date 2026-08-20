import { describe, expect, it } from "@jest/globals";
import { deriveDirectDatabaseUrl } from "../src/utils/directDatabaseUrl.js";

describe("deriveDirectDatabaseUrl", () => {
  it("strips Neon -pooler so migrate deploy can take advisory locks", () => {
    const pooled =
      "postgresql://u:p@ep-abc-pooler.us-east-1.aws.neon.tech/clothing_orders?sslmode=require";
    expect(deriveDirectDatabaseUrl(pooled)).toBe(
      "postgresql://u:p@ep-abc.us-east-1.aws.neon.tech/clothing_orders?sslmode=require"
    );
  });

  it("leaves local and already-direct URLs unchanged", () => {
    expect(deriveDirectDatabaseUrl("postgresql://oms:oms@127.0.0.1:5432/oms")).toBe(
      "postgresql://oms:oms@127.0.0.1:5432/oms"
    );
    expect(deriveDirectDatabaseUrl("")).toBe("");
  });
});
