import { describe, it, expect, beforeAll, afterAll, beforeEach } from "@jest/globals";
import request from "supertest";
import {
  connectTestDb,
  disconnectTestDb,
  clearDb,
  createTestApp,
  createUser,
  auth,
  prisma
} from "./helpers.js";
import { seedClothingTypes, seedOrderWithItem } from "./fixtures.js";
import { newId } from "../src/utils/ids.js";

describe("order item images", () => {
  let app;
  let token;

  beforeAll(async () => {
    await connectTestDb();
    app = createTestApp();
  });

  afterAll(async () => {
    await disconnectTestDb();
  });

  beforeEach(async () => {
    await clearDb();
    await seedClothingTypes();
    const manager = await createUser({
      email: "img@test.local",
      name: "Manager",
      role: "manager"
    });
    token = manager.token;
  });

  it("patches category, caption, sortOrder and deletes an image", async () => {
    const { item } = await seedOrderWithItem({ clothingType: "thobe" });
    const image = await prisma.orderItemImage.create({
      data: {
        id: newId(),
        orderItemId: item.id,
        imageUrl: "uploads/test-front.jpg",
        caption: "",
        category: "other",
        sortOrder: 0
      }
    });

    const patched = await request(app)
      .patch(`/api/order-items/${item.id}/images/${image.id}`)
      .set(auth(token))
      .send({ category: "front", caption: "Front view", sortOrder: 2 });
    expect(patched.status).toBe(200);
    expect(patched.body.category).toBe("front");
    expect(patched.body.caption).toBe("Front view");
    expect(patched.body.sortOrder).toBe(2);
    expect(patched.body._id).toBe(image.id);

    const removed = await request(app)
      .delete(`/api/order-items/${item.id}/images/${image.id}`)
      .set(auth(token));
    expect(removed.status).toBe(204);

    const leftover = await prisma.orderItemImage.findUnique({ where: { id: image.id } });
    expect(leftover).toBeNull();
  });

  it("strips filesystem paths from scan-details image URLs", async () => {
    const { item } = await seedOrderWithItem({ clothingType: "thobe" });
    await prisma.orderItemImage.create({
      data: {
        id: newId(),
        orderItemId: item.id,
        imageUrl: "/Users/MAC/studio/server/uploads/front.jpg",
        caption: "Front",
        category: "front",
        sortOrder: 0
      }
    });

    const details = await request(app)
      .get(`/api/order-items/${item.id}/scan-details`)
      .set(auth(token));
    expect(details.status).toBe(200);
    expect(details.body.item.images[0].imageUrl).toBe("uploads/front.jpg");
    expect(details.body.item.images[0].imageUrl).not.toMatch(/\/Users\//);
  });
});
