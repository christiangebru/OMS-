import { Router } from "express";
import { body, param, query, validationResult } from "express-validator";
import mongoose from "mongoose";
import { Order, ProductionStatus, OrderPriority } from "../models/Order.js";
import { OrderItem } from "../models/OrderItem.js";
import { OrderItemImage } from "../models/OrderItemImage.js";
import { Customer } from "../models/Customer.js";
import { ProductionLog } from "../models/ProductionLog.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { generateOrderId, computeEstimatedCompletion } from "../utils/orderId.js";
import { refreshStatisticSnapshot } from "../utils/stats.js";
import { DEFAULT_TENANT_ID } from "../config/tenant.js";
import { normalizePhone } from "../utils/migrateHelpers.js";
import {
  generateOrderBarcodeValue,
  generateItemBarcodeValue
} from "../utils/barcode.js";
import { buildSingleLabelPdf, buildBatchLabelPdf } from "../utils/labelPdf.js";
import { hydrateOrder, hydrateOrders } from "../utils/orderHydrate.js";

const router = Router();
router.use(requireAuth);

function normalizeItemPayload(item) {
  const qty = Number(item.quantity) || 1;
  const unitPrice = Number(item.unitPrice) || 0;
  const productionDays = Math.max(1, Number(item.productionDays) || 3);
  const difficultyLevel = Math.min(5, Math.max(1, Number(item.difficultyLevel) || 3));
  const measurements = item.measurements
    ? {
        gender: item.measurements.gender,
        vest: item.measurements.vest ? String(item.measurements.vest).trim() : "",
        height: item.measurements.height ? String(item.measurements.height).trim() : "",
        breast: item.measurements.breast ? String(item.measurements.breast).trim() : "",
        waist: item.measurements.waist ? String(item.measurements.waist).trim() : "",
        shoulder: item.measurements.shoulder
          ? String(item.measurements.shoulder).trim()
          : "",
        arm: item.measurements.arm ? String(item.measurements.arm).trim() : "",
        chest: item.measurements.chest ? String(item.measurements.chest).trim() : ""
      }
    : undefined;

  return {
    clothingCode: String(item.clothingCode).trim(),
    clothingType: String(item.clothingType).trim(),
    fabricType: String(item.fabricType).trim(),
    color: String(item.color).trim(),
    quantity: qty,
    notes: item.notes ? String(item.notes) : "",
    neckType: item.neckType,
    handType: item.handType,
    size: item.size,
    measurements,
    productionDays,
    unitPrice,
    lineTotal: unitPrice * qty,
    difficultyLevel,
    /** Pending image URLs to create after item insert (from create flow) */
    _imageUrls: Array.isArray(item.images)
      ? item.images
          .map((img) => (typeof img === "string" ? { imageUrl: img } : img))
          .filter((img) => img?.imageUrl)
      : item.imagePath
        ? [{ imageUrl: String(item.imagePath), caption: "" }]
        : []
  };
}

async function resolveCustomerId(body) {
  if (body.customerId) {
    const existing = await Customer.findOne({
      _id: body.customerId,
      tenantId: DEFAULT_TENANT_ID
    });
    if (!existing) throw Object.assign(new Error("Customer not found"), { status: 400 });
    return existing._id;
  }

  if (body.customerName && body.customerPhone) {
    const phone = normalizePhone(body.customerPhone);
    let customer = await Customer.findOne({ tenantId: DEFAULT_TENANT_ID, phone });
    if (!customer) {
      customer = await Customer.create({
        tenantId: DEFAULT_TENANT_ID,
        name: String(body.customerName).trim(),
        phone,
        secondaryPhone: body.secondaryPhone ? normalizePhone(body.secondaryPhone) : ""
      });
    } else if (body.customerName) {
      customer.name = String(body.customerName).trim();
      await customer.save();
    }
    return customer._id;
  }

  throw Object.assign(new Error("customerId or customerName+customerPhone required"), {
    status: 400
  });
}

async function createItemsForOrder(orderDoc, itemPayloads) {
  const created = [];
  for (const payload of itemPayloads) {
    const { _imageUrls, ...fields } = payload;
    const itemId = new mongoose.Types.ObjectId();
    const now = new Date();
    const item = await OrderItem.create({
      _id: itemId,
      order: orderDoc._id,
      orderId: orderDoc.orderId,
      ...fields,
      barcodeValue: generateItemBarcodeValue(itemId),
      barcodeGeneratedAt: now
    });
    if (_imageUrls?.length) {
      await OrderItemImage.insertMany(
        _imageUrls.map((img) => ({
          orderItemId: item._id,
          imageUrl: img.imageUrl,
          caption: img.caption || "",
          uploadedAt: now
        }))
      );
    }
    created.push(item);
  }
  return created;
}

async function replaceItemsForOrder(orderDoc, itemPayloads) {
  const existing = await OrderItem.find({ order: orderDoc._id });
  const existingIds = existing.map((i) => i._id);
  if (existingIds.length) {
    await OrderItemImage.deleteMany({ orderItemId: { $in: existingIds } });
    await OrderItem.deleteMany({ order: orderDoc._id });
  }
  return createItemsForOrder(orderDoc, itemPayloads);
}

async function logProduction(userId, orderDoc, action, fromStatus, toStatus, notes = "") {
  await ProductionLog.create({
    orderId: orderDoc.orderId,
    mongoOrderId: orderDoc._id,
    userId,
    action,
    fromStatus,
    toStatus,
    notes
  });
}

router.get(
  "/",
  query("q").optional().isString(),
  query("status").optional().isIn(ProductionStatus),
  query("clothingType").optional().isString(),
  async (req, res) => {
    const { q, status, clothingType } = req.query;
    const filter = { tenantId: DEFAULT_TENANT_ID };
    if (status) filter.productionStatus = status;

    if (clothingType) {
      const itemOrderIds = await OrderItem.find({
        clothingType: new RegExp(clothingType, "i")
      }).distinct("order");
      filter._id = { $in: itemOrderIds };
    }

    if (q) {
      const rx = new RegExp(q, "i");
      const customers = await Customer.find({
        tenantId: DEFAULT_TENANT_ID,
        $or: [{ name: rx }, { phone: rx }]
      }).select("_id");
      const customerIds = customers.map((c) => c._id);
      const itemOrders = await OrderItem.find({ clothingType: rx }).distinct("order");
      filter.$or = [
        { orderId: rx },
        { customerId: { $in: customerIds } },
        { _id: { $in: itemOrders } }
      ];
    }

    const orders = await Order.find(filter).sort({ createdAt: -1 }).limit(500).lean();
    res.json(await hydrateOrders(orders));
  }
);

router.get(
  "/:orderId/barcode-label",
  param("orderId").notEmpty(),
  async (req, res) => {
    const order = await Order.findOne({ orderId: req.params.orderId }).lean();
    if (!order) return res.status(404).json({ message: "Order not found" });
    const customer = order.customerId
      ? await Customer.findById(order.customerId).lean()
      : null;
    const pdf = await buildSingleLabelPdf({
      barcodeValue: order.barcodeValue,
      title: order.orderId,
      subtitle: customer?.name || ""
    });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="order-${order.orderId}-label.pdf"`
    );
    res.send(pdf);
  }
);

router.get(
  "/:orderId/barcode-labels/batch",
  param("orderId").notEmpty(),
  async (req, res) => {
    const order = await Order.findOne({ orderId: req.params.orderId }).lean();
    if (!order) return res.status(404).json({ message: "Order not found" });
    const items = await OrderItem.find({ order: order._id }).sort({ createdAt: 1 }).lean();
    const labels = items.map((it) => ({
      barcodeValue: it.barcodeValue,
      title: it.clothingType,
      subtitle: `${order.orderId} · ${it.clothingCode}`
    }));
    const pdf = await buildBatchLabelPdf(labels);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="order-${order.orderId}-item-labels.pdf"`
    );
    res.send(pdf);
  }
);

router.get("/:orderId", param("orderId").notEmpty(), async (req, res) => {
  const order = await Order.findOne({ orderId: req.params.orderId }).lean();
  if (!order) return res.status(404).json({ message: "Order not found" });
  res.json(await hydrateOrder(order));
});

router.post(
  "/",
  body("requiredCompletionDate").isISO8601(),
  body("items").isArray({ min: 1 }),
  body("productionStatus").optional().isIn(ProductionStatus),
  body("priority").optional().isIn(OrderPriority),
  body("groupCode").optional().isString(),
  body("totalAgreedPrice").optional().isFloat({ min: 0 }),
  body("depositPaid").optional().isFloat({ min: 0 }),
  body("customerId").optional().isMongoId(),
  body("customerName").optional().trim().notEmpty(),
  body("customerPhone").optional().trim().notEmpty(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    try {
      const customerId = await resolveCustomerId(req.body);
      const itemPayloads = (req.body.items || []).map(normalizeItemPayload);
      const orderId = generateOrderId();
      const createdAt = new Date();
      const estimatedProductionCompletion = computeEstimatedCompletion(
        createdAt,
        itemPayloads
      );
      const totalRevenue = itemPayloads.reduce((s, i) => s + i.lineTotal, 0);
      const totalAgreedPrice =
        req.body.totalAgreedPrice !== undefined
          ? Number(req.body.totalAgreedPrice)
          : totalRevenue;

      const doc = await Order.create({
        tenantId: DEFAULT_TENANT_ID,
        orderId,
        customerId,
        groupCode: req.body.groupCode || "",
        requiredCompletionDate: req.body.requiredCompletionDate,
        estimatedProductionCompletion,
        productionStatus: req.body.productionStatus || "pending",
        priority: req.body.priority || "NORMAL",
        totalAgreedPrice,
        depositPaid: Number(req.body.depositPaid) || 0,
        totalRevenue,
        barcodeValue: generateOrderBarcodeValue(orderId),
        barcodeGeneratedAt: createdAt,
        createdBy: req.user._id,
        lastUpdatedBy: req.user._id
      });

      try {
        await createItemsForOrder(doc, itemPayloads);
      } catch (itemErr) {
        // Order creation is not a single atomic transaction here, so if item
        // creation fails after the order document was inserted we must remove the
        // half-created order to avoid orphaned orders with no items.
        const createdItems = await OrderItem.find({ order: doc._id }).select("_id");
        if (createdItems.length) {
          await OrderItemImage.deleteMany({
            orderItemId: { $in: createdItems.map((i) => i._id) }
          });
          await OrderItem.deleteMany({ order: doc._id });
        }
        await Order.deleteOne({ _id: doc._id });
        throw itemErr;
      }
      await logProduction(req.user._id, doc, "order_created", null, doc.productionStatus);
      await refreshStatisticSnapshot();
      res.status(201).json(await hydrateOrder(doc.toObject()));
    } catch (e) {
      if (e.status) return res.status(e.status).json({ message: e.message });
      throw e;
    }
  }
);

router.put(
  "/:orderId",
  param("orderId").notEmpty(),
  body("requiredCompletionDate").optional().isISO8601(),
  body("items").optional().isArray({ min: 1 }),
  body("productionStatus").optional().isIn(ProductionStatus),
  body("priority").optional().isIn(OrderPriority),
  body("groupCode").optional().isString(),
  body("totalAgreedPrice").optional().isFloat({ min: 0 }),
  body("depositPaid").optional().isFloat({ min: 0 }),
  body("customerId").optional().isMongoId(),
  body("customerName").optional().trim().notEmpty(),
  body("customerPhone").optional().trim().notEmpty(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const order = await Order.findOne({ orderId: req.params.orderId });
    if (!order) return res.status(404).json({ message: "Order not found" });

    const prevStatus = order.productionStatus;

    try {
      if (req.body.customerId || (req.body.customerName && req.body.customerPhone)) {
        order.customerId = await resolveCustomerId(req.body);
      }
    } catch (e) {
      if (e.status) return res.status(e.status).json({ message: e.message });
      throw e;
    }

    if (req.body.groupCode !== undefined) order.groupCode = req.body.groupCode;
    if (req.body.requiredCompletionDate) {
      order.requiredCompletionDate = req.body.requiredCompletionDate;
    }
    if (req.body.priority) order.priority = req.body.priority;
    if (req.body.totalAgreedPrice !== undefined) {
      order.totalAgreedPrice = Number(req.body.totalAgreedPrice);
    }
    if (req.body.depositPaid !== undefined) {
      order.depositPaid = Number(req.body.depositPaid);
    }
    if (req.body.productionStatus) {
      order.productionStatus = req.body.productionStatus;
    }

    if (req.body.items) {
      const itemPayloads = req.body.items.map(normalizeItemPayload);
      await replaceItemsForOrder(order, itemPayloads);
      order.totalRevenue = itemPayloads.reduce((s, i) => s + i.lineTotal, 0);
      order.estimatedProductionCompletion = computeEstimatedCompletion(
        order.createdAt,
        itemPayloads
      );
    }

    order.lastUpdatedBy = req.user._id;
    await order.save();

    if (prevStatus !== order.productionStatus) {
      await logProduction(
        req.user._id,
        order,
        "status_change",
        prevStatus,
        order.productionStatus
      );
    }
    await refreshStatisticSnapshot();
    res.json(await hydrateOrder(order.toObject()));
  }
);

router.delete(
  "/:orderId",
  requireRole("admin"),
  param("orderId").notEmpty(),
  async (req, res) => {
    const order = await Order.findOne({ orderId: req.params.orderId });
    if (!order) return res.status(404).json({ message: "Order not found" });

    const items = await OrderItem.find({ order: order._id }).select("_id");
    const itemIds = items.map((i) => i._id);
    if (itemIds.length) {
      await OrderItemImage.deleteMany({ orderItemId: { $in: itemIds } });
      await OrderItem.deleteMany({ order: order._id });
    }
    await order.deleteOne();
    await refreshStatisticSnapshot();
    res.status(204).send();
  }
);

export default router;
