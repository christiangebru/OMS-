import mongoose from "mongoose";
import { Customer } from "../src/models/Customer.js";
import { Order } from "../src/models/Order.js";
import { OrderItem } from "../src/models/OrderItem.js";
import { Staff } from "../src/models/Staff.js";
import { StaffSkill } from "../src/models/StaffSkill.js";
import { ClothingTypeConfig } from "../src/models/ClothingTypeConfig.js";
import { DEFAULT_TENANT_ID } from "../src/config/tenant.js";
import { DEFAULT_CLOTHING_TYPE_SEEDS } from "../src/utils/migrateHelpers.js";
import { generateItemBarcodeValue, generateOrderBarcodeValue } from "../src/utils/barcode.js";

export async function seedClothingTypes() {
  await ClothingTypeConfig.deleteMany({});
  await ClothingTypeConfig.insertMany(DEFAULT_CLOTHING_TYPE_SEEDS);
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
  const customer = await Customer.create({
    tenantId: DEFAULT_TENANT_ID,
    name: "Test Customer",
    phone: `09${Date.now().toString().slice(-8)}`
  });

  const orderId = `ORD-TEST-${new mongoose.Types.ObjectId().toString().slice(-8).toUpperCase()}`;
  const due = new Date();
  due.setDate(due.getDate() + daysUntilDue);

  const orderFields = {
    tenantId: DEFAULT_TENANT_ID,
    orderId,
    customerId: customer._id,
    groupCode,
    requiredCompletionDate: due,
    productionStatus: "pending",
    priority,
    totalRevenue: 100,
    barcodeValue: generateOrderBarcodeValue(orderId),
    barcodeGeneratedAt: new Date()
  };
  if (totalAgreedPrice !== undefined) orderFields.totalAgreedPrice = totalAgreedPrice;
  if (depositPaid !== undefined) orderFields.depositPaid = depositPaid;

  const order = await Order.create(orderFields);

  const itemId = new mongoose.Types.ObjectId();
  const item = await OrderItem.create({
    _id: itemId,
    order: order._id,
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
  });

  const siblings = [];
  for (const extra of extraItems) {
    const sid = new mongoose.Types.ObjectId();
    siblings.push(
      await OrderItem.create({
        _id: sid,
        order: order._id,
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
      })
    );
  }

  const staff = await Staff.create({
    tenantId: DEFAULT_TENANT_ID,
    name: "Floor Worker",
    phone: "0911000001",
    role: "TAILOR",
    status: "AVAILABLE",
    skillLevel: 3,
    active: true
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
  await StaffSkill.insertMany(allStages.map((stage) => ({ staffId: staff._id, stage })));

  return { customer, order, item, siblings, staff };
}

export async function createStaff({
  name,
  skillLevel = 3,
  status = "AVAILABLE",
  stages = ["CUTTING"]
}) {
  const staff = await Staff.create({
    tenantId: DEFAULT_TENANT_ID,
    name,
    phone: `09${Math.floor(Math.random() * 1e8)}`,
    role: "TAILOR",
    status,
    skillLevel,
    active: true
  });
  if (stages.length) {
    await StaffSkill.insertMany(stages.map((stage) => ({ staffId: staff._id, stage })));
  }
  return staff;
}
