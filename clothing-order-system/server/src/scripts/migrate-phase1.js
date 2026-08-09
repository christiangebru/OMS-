/**
 * One-time Phase 1 migration:
 * - Backfill Customers from order customerName/customerPhone (dedupe by phone)
 * - Extract embedded items → OrderItem + OrderItemImage
 * - Generate barcodes
 * - Seed ClothingTypeConfig
 *
 * Usage: npm run migrate:phase1
 */
import "dotenv/config";
import mongoose from "mongoose";
import path from "path";
import { fileURLToPath } from "url";
import { connectDb } from "../config/db.js";
import { DEFAULT_TENANT_ID } from "../config/tenant.js";
import { Customer } from "../models/Customer.js";
import { OrderItem } from "../models/OrderItem.js";
import { OrderItemImage } from "../models/OrderItemImage.js";
import { ClothingTypeConfig } from "../models/ClothingTypeConfig.js";
import {
  generateOrderBarcodeValue,
  generateItemBarcodeValue,
  generateUniqueBarcode
} from "../utils/barcode.js";
import { DEFAULT_CLOTHING_TYPE_SEEDS, normalizePhone } from "../utils/migrateHelpers.js";

export async function seedClothingTypes() {
  const count = await ClothingTypeConfig.countDocuments();
  if (count > 0) {
    console.log(`[migrate] ClothingTypeConfig already has ${count} docs — skip seed`);
    return;
  }
  await ClothingTypeConfig.insertMany(DEFAULT_CLOTHING_TYPE_SEEDS);
  console.log(`[migrate] Seeded ${DEFAULT_CLOTHING_TYPE_SEEDS.length} clothing type configs`);
}

export async function migrateOrders() {
  // Use native collection to read legacy fields that may no longer be in schema
  const col = mongoose.connection.collection("orders");
  const cursor = col.find({});
  let migrated = 0;
  let skipped = 0;

  while (await cursor.hasNext()) {
    const raw = await cursor.next();
    const orderMongoId = raw._id;
    const businessOrderId = raw.orderId;

    // Customer backfill
    let customerId = raw.customerId || null;
    if (!customerId && (raw.customerPhone || raw.customerName)) {
      const phone = normalizePhone(raw.customerPhone) || `unknown-${orderMongoId}`;
      const name = (raw.customerName || "Unknown").trim();
      let customer = await Customer.findOne({ tenantId: DEFAULT_TENANT_ID, phone });
      if (!customer) {
        try {
          customer = await Customer.create({
            tenantId: DEFAULT_TENANT_ID,
            name,
            phone
          });
        } catch (e) {
          if (e.code === 11000) {
            customer = await Customer.findOne({ tenantId: DEFAULT_TENANT_ID, phone });
          } else {
            throw e;
          }
        }
      }
      customerId = customer._id;
    }

    if (!customerId) {
      console.warn(`[migrate] Order ${businessOrderId} has no customer — creating placeholder`);
      const phone = `legacy-${orderMongoId}`;
      const customer = await Customer.create({
        tenantId: DEFAULT_TENANT_ID,
        name: "Legacy Customer",
        phone
      });
      customerId = customer._id;
    }

    // Extract items
    const embeddedItems = Array.isArray(raw.items) ? raw.items : [];
    const existingItemCount = await OrderItem.countDocuments({ order: orderMongoId });

    if (embeddedItems.length > 0 && existingItemCount === 0) {
      for (const emb of embeddedItems) {
        const itemId = emb._id || new mongoose.Types.ObjectId();
        const barcodeValue = generateItemBarcodeValue(itemId);
        const now = new Date();
        await OrderItem.create({
          _id: itemId,
          order: orderMongoId,
          orderId: businessOrderId,
          clothingCode: emb.clothingCode || "N/A",
          clothingType: emb.clothingType || "unknown",
          fabricType: emb.fabricType || "",
          color: emb.color || "",
          quantity: emb.quantity || 1,
          notes: emb.notes || "",
          neckType: emb.neckType || "oval",
          handType: emb.handType || "normal",
          size: emb.size || "adult",
          measurements: emb.measurements,
          productionDays: emb.productionDays || 3,
          unitPrice: emb.unitPrice || 0,
          lineTotal: emb.lineTotal ?? (emb.unitPrice || 0) * (emb.quantity || 1),
          difficultyLevel: emb.difficultyLevel || 3,
          barcodeValue,
          barcodeGeneratedAt: now
        });

        if (emb.imagePath) {
          await OrderItemImage.create({
            orderItemId: itemId,
            imageUrl: emb.imagePath,
            caption: "",
            uploadedAt: now
          });
        }
      }
      console.log(
        `[migrate] Extracted ${embeddedItems.length} items from order ${businessOrderId}`
      );
    } else if (existingItemCount > 0) {
      skipped += 1;
    }

    // Ensure item barcodes for already-extracted items missing them
    const itemsMissingBarcode = await OrderItem.find({
      order: orderMongoId,
      $or: [{ barcodeValue: { $exists: false } }, { barcodeValue: null }, { barcodeValue: "" }]
    });
    for (const it of itemsMissingBarcode) {
      it.barcodeValue = generateItemBarcodeValue(it._id);
      it.barcodeGeneratedAt = new Date();
      await it.save();
    }

    const barcodeValue =
      raw.barcodeValue || generateOrderBarcodeValue(businessOrderId) || generateUniqueBarcode("ORD");
    const barcodeGeneratedAt = raw.barcodeGeneratedAt || new Date();

    const unset = {};
    if (raw.customerName !== undefined) unset.customerName = "";
    if (raw.customerPhone !== undefined) unset.customerPhone = "";
    if (embeddedItems.length > 0) unset.items = "";

    const set = {
      tenantId: raw.tenantId || DEFAULT_TENANT_ID,
      customerId,
      barcodeValue,
      barcodeGeneratedAt,
      priority: raw.priority || "NORMAL",
      totalAgreedPrice: raw.totalAgreedPrice ?? raw.totalRevenue ?? 0,
      depositPaid: raw.depositPaid ?? 0
    };

    const update = { $set: set };
    if (Object.keys(unset).length) update.$unset = unset;

    await col.updateOne({ _id: orderMongoId }, update);
    migrated += 1;
  }

  console.log(`[migrate] Processed ${migrated} orders (${skipped} already had extracted items)`);
  return { migrated, skipped };
}

async function main() {
  await connectDb();
  await seedClothingTypes();
  await migrateOrders();
  console.log("[migrate] Phase 1 migration complete");
  await mongoose.disconnect();
  process.exit(0);
}

const isDirectRun =
  process.argv[1] &&
  path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);

if (isDirectRun) {
  main().catch(async (e) => {
    console.error("[migrate] Failed:", e);
    try {
      await mongoose.disconnect();
    } catch {
      /* ignore */
    }
    process.exit(1);
  });
}
