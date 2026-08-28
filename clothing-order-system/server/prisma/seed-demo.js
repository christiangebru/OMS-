/**
 * Demo seed — realistic development/demo data. Separate from the base seed.
 * Skips if orders already exist so it is safe to re-run.
 *
 * Usage: npm run seed:demo
 */
import "dotenv/config";
import path from "path";
import { fileURLToPath } from "url";
import bcrypt from "bcryptjs";
import { prisma } from "../src/db/prisma.js";
import { DEFAULT_TENANT_ID } from "../src/config/tenant.js";
import { newId } from "../src/utils/ids.js";
import { generateOrderId, computeEstimatedCompletion } from "../src/utils/orderId.js";
import { generateOrderBarcodeValue, generateItemBarcodeValue } from "../src/utils/barcode.js";
import { refreshStatisticSnapshot } from "../src/utils/stats.js";
import { seedClothingTypes } from "./seed.js";

async function ensureAdmin() {
  const existing = await prisma.user.findUnique({ where: { email: "admin@example.com" } });
  if (existing) return existing;
  const passwordHash = await bcrypt.hash("password123", 12);
  return prisma.user.create({
    data: { email: "admin@example.com", passwordHash, name: "Admin User", role: "admin" }
  });
}

async function main() {
  await seedClothingTypes();
  const admin = await ensureAdmin();

  const orderCount = await prisma.order.count();
  if (orderCount > 0) {
    console.log(`[seed:demo] ${orderCount} orders already exist — skipping demo data`);
    return;
  }

  // Customers
  const customers = [];
  for (const c of [
    { name: "Amina Yusuf", phone: "0911000001" },
    { name: "Bakri Osman", phone: "0911000002" },
    { name: "Layla Hassan", phone: "0911000003" }
  ]) {
    customers.push(
      await prisma.customer.create({ data: { tenantId: DEFAULT_TENANT_ID, ...c } })
    );
  }

  // Staff + skills
  const staffSpecs = [
    { name: "Cutter Sam", role: "CUTTER", skillLevel: 4, skills: ["RECEIVED", "CUTTING", "SEWING_CUTTING"] },
    { name: "Tailor Tara", role: "TAILOR", skillLevel: 5, skills: ["SEWING", "SEWING_CUTTING", "FINAL_SEWING", "FINISHING"] },
    { name: "Embroider Emma", role: "EMBROIDERER", skillLevel: 4, skills: ["EMBROIDERY"] },
    {
      name: "Finisher Fadi",
      role: "FINISHER",
      skillLevel: 3,
      skills: ["FINISHING", "PACKAGING", "READY", "SHOWROOM", "DELIVERED"]
    }
  ];
  for (const spec of staffSpecs) {
    const staff = await prisma.staff.create({
      data: {
        tenantId: DEFAULT_TENANT_ID,
        name: spec.name,
        phone: `0922${Math.floor(1000000 + Math.random() * 8999999)}`,
        role: spec.role,
        status: "AVAILABLE",
        skillLevel: spec.skillLevel,
        active: true
      }
    });
    await prisma.staffSkill.createMany({
      data: spec.skills.map((stage) => ({ staffId: staff.id, stage })),
      skipDuplicates: true
    });
  }

  // Orders + items
  const orderSpecs = [
    {
      customer: customers[0],
      priority: "NORMAL",
      depositPaid: 50,
      items: [
        {
          clothingCode: "THB-001",
          clothingType: "Thobe",
          fabricType: "Cotton",
          color: "White",
          quantity: 2,
          unitPrice: 60,
          neckType: "oval",
          handType: "normal",
          size: "adult",
          measurements: { gender: "male" }
        }
      ]
    },
    {
      customer: customers[1],
      priority: "RUSH",
      depositPaid: 0,
      items: [
        {
          clothingCode: "ABY-010",
          clothingType: "Abaya (embroidered)",
          fabricType: "Silk",
          color: "Black",
          quantity: 1,
          unitPrice: 180,
          difficultyLevel: 5,
          neckType: "square",
          handType: "wide",
          size: "adult",
          measurements: { gender: "female" }
        }
      ]
    }
  ];

  for (const spec of orderSpecs) {
    const orderId = await generateOrderId();
    const createdAt = new Date();
    const items = spec.items.map((it) => ({
      ...it,
      quantity: it.quantity || 1,
      productionDays: it.productionDays || 3,
      difficultyLevel: it.difficultyLevel || 3,
      lineTotal: (it.unitPrice || 0) * (it.quantity || 1)
    }));
    const totalRevenue = items.reduce((sum, i) => sum + i.lineTotal, 0);
    const due = new Date();
    due.setDate(due.getDate() + 10);

    const order = await prisma.order.create({
      data: {
        tenantId: DEFAULT_TENANT_ID,
        orderId,
        customerId: spec.customer.id,
        requiredCompletionDate: due,
        estimatedProductionCompletion: computeEstimatedCompletion(createdAt, items),
        productionStatus: "pending",
        priority: spec.priority,
        totalAgreedPrice: totalRevenue,
        depositPaid: spec.depositPaid,
        totalRevenue,
        barcodeValue: generateOrderBarcodeValue(orderId),
        barcodeGeneratedAt: createdAt,
        createdBy: admin.id,
        lastUpdatedBy: admin.id
      }
    });

    for (const it of items) {
      const itemId = newId();
      await prisma.orderItem.create({
        data: {
          id: itemId,
          order: order.id,
          orderId,
          clothingCode: it.clothingCode,
          clothingType: it.clothingType,
          fabricType: it.fabricType,
          color: it.color,
          quantity: it.quantity,
          neckType: it.neckType,
          handType: it.handType,
          size: it.size,
          measurements: it.measurements,
          productionDays: it.productionDays,
          unitPrice: it.unitPrice,
          lineTotal: it.lineTotal,
          difficultyLevel: it.difficultyLevel,
          barcodeValue: generateItemBarcodeValue(orderId, items.indexOf(it) + 1),
          barcodeGeneratedAt: createdAt
        }
      });
    }
  }

  await refreshStatisticSnapshot();
  console.log(`[seed:demo] Created ${orderSpecs.length} demo orders, ${customers.length} customers, ${staffSpecs.length} staff`);
}

const isDirectRun =
  process.argv[1] &&
  path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);

if (isDirectRun) {
  main()
    .then(() => prisma.$disconnect())
    .catch(async (e) => {
      console.error("[seed:demo] Failed:", e);
      await prisma.$disconnect();
      process.exit(1);
    });
}
