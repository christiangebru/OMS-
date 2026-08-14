import { prisma } from "../src/db/prisma.js";
import { DEFAULT_TENANT_ID } from "../src/config/tenant.js";
import { DEFAULT_CLOTHING_TYPE_SEEDS } from "../src/utils/migrateHelpers.js";
import { newId } from "../src/utils/ids.js";
import { generateItemBarcodeValue, generateOrderBarcodeValue } from "../src/utils/barcode.js";

/** Expose the Prisma `id` as `_id` so existing assertions keep working. */
function alias(rec) {
  return rec ? { ...rec, _id: rec.id } : rec;
}

export async function seedClothingTypes() {
  await prisma.clothingTypeConfig.deleteMany({});
  await prisma.clothingTypeConfig.createMany({
    data: DEFAULT_CLOTHING_TYPE_SEEDS.map((c) => ({
      key: c.key,
      label: c.label,
      stageSequence: c.stageSequence,
      includesEmbroidery: c.includesEmbroidery
    }))
  });
}

/**
 * Create a full order + one item + skilled AVAILABLE staff for scanning.
 */
export async function seedOrderWithItem({
  clothingType = "thobe",
  difficultyLevel = 3,
  daysUntilDue = 7,
  priority = "NORMAL",
  totalAgreedPrice,
  depositPaid,
  groupCode = "",
  extraItems = []
} = {}) {
  const customer = await prisma.customer.create({
    data: {
      tenantId: DEFAULT_TENANT_ID,
      name: "Test Customer",
      phone: `09${Date.now().toString().slice(-8)}`
    }
  });

  const orderId = `ORD-TEST-${newId().slice(-8).toUpperCase()}`;
  const due = new Date();
  due.setDate(due.getDate() + daysUntilDue);

  const order = await prisma.order.create({
    data: {
      tenantId: DEFAULT_TENANT_ID,
      orderId,
      customerId: customer.id,
      groupCode,
      requiredCompletionDate: due,
      productionStatus: "pending",
      priority,
      totalRevenue: 100,
      barcodeValue: generateOrderBarcodeValue(orderId),
      barcodeGeneratedAt: new Date(),
      ...(totalAgreedPrice !== undefined ? { totalAgreedPrice } : {}),
      ...(depositPaid !== undefined ? { depositPaid } : {})
    }
  });

  const itemId = newId();
  const item = await prisma.orderItem.create({
    data: {
      id: itemId,
      order: order.id,
      orderId,
      clothingCode: "C1",
      clothingType,
      fabricType: "cotton",
      color: "white",
      quantity: 1,
      notes: "",
      neckType: "oval",
      handType: "normal",
      size: "adult",
      productionDays: 3,
      unitPrice: 100,
      lineTotal: 100,
      difficultyLevel,
      barcodeValue: generateItemBarcodeValue(itemId),
      barcodeGeneratedAt: new Date()
    }
  });

  const siblings = [];
  for (const extra of extraItems) {
    const sid = newId();
    siblings.push(
      await prisma.orderItem.create({
        data: {
          id: sid,
          order: order.id,
          orderId,
          clothingCode: extra.clothingCode || "C2",
          clothingType: extra.clothingType || clothingType,
          fabricType: "cotton",
          color: "black",
          quantity: 1,
          notes: "",
          neckType: "oval",
          handType: "normal",
          size: "adult",
          productionDays: 3,
          unitPrice: 50,
          lineTotal: 50,
          difficultyLevel: extra.difficultyLevel || 3,
          barcodeValue: generateItemBarcodeValue(sid),
          barcodeGeneratedAt: new Date()
        }
      })
    );
  }

  const staff = await prisma.staff.create({
    data: {
      tenantId: DEFAULT_TENANT_ID,
      name: "Floor Worker",
      phone: "0911000001",
      role: "TAILOR",
      status: "AVAILABLE",
      skillLevel: 3,
      active: true
    }
  });

  const allStages = [
    "RECEIVED",
    "CUTTING",
    "SEWING",
    "EMBROIDERY",
    "FINISHING",
    "READY",
    "DELIVERED"
  ];
  await prisma.staffSkill.createMany({
    data: allStages.map((stage) => ({ staffId: staff.id, stage })),
    skipDuplicates: true
  });

  return {
    customer: alias(customer),
    order: alias(order),
    item: alias(item),
    siblings: siblings.map(alias),
    staff: alias(staff)
  };
}

export async function createStaff({
  name,
  skillLevel = 3,
  status = "AVAILABLE",
  stages = ["CUTTING"]
}) {
  const staff = await prisma.staff.create({
    data: {
      tenantId: DEFAULT_TENANT_ID,
      name,
      phone: `09${Math.floor(Math.random() * 1e8)}`,
      role: "TAILOR",
      status,
      skillLevel,
      active: true
    }
  });
  if (stages.length) {
    await prisma.staffSkill.createMany({
      data: stages.map((stage) => ({ staffId: staff.id, stage })),
      skipDuplicates: true
    });
  }
  return alias(staff);
}
