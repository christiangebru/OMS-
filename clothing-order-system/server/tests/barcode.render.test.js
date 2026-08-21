import { describe, it, expect } from "@jest/globals";
import { renderBarcodePng, renderBarcodeSvg, operationalItemBarcode } from "../src/utils/barcode.js";

describe("barcode rendering", () => {
  it("prints short operational codes, not database ids", () => {
    expect(operationalItemBarcode("ORD-293", 1)).toBe("ORD-293-1");
  });

  it("renders a high-resolution PNG without baked-in giant text", async () => {
    const png = await renderBarcodePng("ORD-293-1");
    expect(Buffer.isBuffer(png)).toBe(true);
    expect(png.slice(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(png.length).toBeGreaterThan(800);
  });

  it("renders a vector SVG suitable for print and display", () => {
    const svg = renderBarcodeSvg("ORD-293-1");
    expect(String(svg)).toMatch(/<svg/i);
    expect(String(svg).length).toBeGreaterThan(200);
  });
});
