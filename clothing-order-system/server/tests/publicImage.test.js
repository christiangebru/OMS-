import { describe, it, expect } from "@jest/globals";
import { storedImagePath, publicImageUrl } from "../src/utils/publicImage.js";

describe("public image paths", () => {
  it("keeps https Cloudinary URLs", () => {
    const url = "https://res.cloudinary.com/demo/image/upload/v1/oms-garments/front.jpg";
    expect(storedImagePath(url)).toBe(url);
    expect(publicImageUrl(url, "http://localhost:4000")).toBe(url);
  });

  it("keeps relative uploads paths", () => {
    expect(storedImagePath("uploads/front.jpg")).toBe("uploads/front.jpg");
    expect(publicImageUrl("uploads/front.jpg", "http://localhost:4000")).toBe(
      "http://localhost:4000/uploads/front.jpg"
    );
  });

  it("does not expose local filesystem paths", () => {
    expect(
      storedImagePath("/Users/MAC/order manager_v4/clothing-order-system/server/uploads/front.jpg")
    ).toBe("uploads/front.jpg");
    expect(storedImagePath("/tmp/secret.png")).toBe("");
    expect(storedImagePath("C:\\\\Users\\\\studio\\\\uploads\\\\back.jpg")).toBe("uploads/back.jpg");
  });
});
