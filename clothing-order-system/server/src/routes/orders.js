import { Router } from "express";
import { body, param, query, validationResult } from "express-validator";
import { prisma } from "../db/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { requireCapability } from "../middleware/permissions.js";
import { newId } from "../utils/ids.js";
import { isRecordId } from "../utils/recordId.js";
import { generateOrderId, generateOrderIdFallback, computeEstimatedCompletion } from "../utils/orderId.js";
import { refreshStatisticSnapshot } from "../utils/stats.js";
import { DEFAULT_TENANT_ID } from "../config/tenant.js";
import { normalizePhone } from "../utils/migrateHelpers.js";
import {
  ProductionStatus,
  OrderPriority,
  NeckType,
  HandType,
  SizeCategory
} from "../constants/production.js";
import { generateOrderBarcodeValue, ensureUniqueItemBarcode, operationalItemBarcode } from "../utils/barcode.js";
import { buildSingleLabelPdf, buildBatchLabelPdf } from "../utils/labelPdf.js";
import { hydrateOrder, hydrateOrders } from "../utils/orderHydrate.js";

const router = Router();
router.use(requireAuth);

const GENDERS = ["female", "male", "kids"];

/**
 * Validate order-item payloads at the API boundary so invalid enum values
 * produce a clear 400 instead of a database-level error.
 */
function validateItems(items) {
  if (!Array.isArray(items) || items.length < 1) {
    return { ok: false, message: "At least one item is required" };
  }
  for (const [i, it] of items.entries()) {
    const label = `items[${i}]`;
    if (!it || typeof it !== "object") {
      return { ok: false, message: `${label} must be an object` };
    }
    for (const f of ["clothingCode", "clothingType", "fabricType", "color"]) {
      if (typeof it[f] !== "string" || !it[f].trim()) {
        return { ok: false, message: `${label}.${f} is required` };
      }
    }
    if (
      it.quantity !== undefined &&
      (!Number.isFinite(Number(it.quantity)) || Number(it.quantity) < 1)
    ) {
      return { ok: false, message: `${label}.quantity must be a number >= 1` };
    }
    if (!NeckType.includes(it.neckType)) {
      return { ok: false, message: `${label}.neckType must be one of: ${NeckType.join(", ")}` };
    }
    if (!HandType.includes(it.handType)) {
      return { ok: false, message: `${label}.handType must be one of: ${HandType.join(", ")}` };
    }
    if (!SizeCategory.includes(it.size)) {
      return { ok: false, message: `${label}.size must be one of: ${SizeCategory.join(", ")}` };
    }
    if (it.measurements && !GENDERS.includes(it.measurements.gender)) {
      return {
        ok: false,
        message: `${label}.measurements.gender must be one of: ${GENDERS.join(", ")}`
      };
    }
  }
  return { ok: true };
}

function garmentKind(type) {
  const t = String(type || "").toLowerCase();
  if (/shirt|top/.test(t)) return "shirt";
  if (/pant|trouser/.test(t)) return "trouser";
  return "other";
}

function validateMensGarmentSet(set, items) {
  if (!set) return { ok: true };
  const kinds = items.map((it) => garmentKind(it.clothingType));
  const shirts = kinds.filter((k) => k === "shirt").length;
  const trousers = kinds.filter((k) => k === "trouser").length;
  if (set === "shirt") {
    if (shirts < 1 || trousers > 0) {
      return { ok: false, message: "Men's shirt-only orders must include a shirt and no trouser item" };
    }
  } else if (set === "trouser") {
    if (trousers < 1 || shirts > 0) {
      return { ok: false, message: "Men's trouser-only orders must include a trouser and no shirt item" };
    }
  } else if (set === "both") {
    if (shirts < 1 || trousers < 1) {
      return { ok: false, message: "Men's shirt + trouser orders must include both garments" };
    }
  }
  return { ok: true };
}

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
        shoulder: item.measurements.shoulder ? String(item.measurements.shoulder).trim() : "",
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
    _imageUrls: Array.isArray(item.images)
      ? item.images
          .map((img) => (typeof img === "string" ? { imageUrl: img } : img))
          .filter((img) => img?.imageUrl)
      : item.imagePath
        ? [{ imageUrl: String(item.imagePath), caption: "" }]
        : []
  };
}

async function resolveGroup(reqBody, client) {
  if (reqBody.groupId) {
    const group = await client.orderGroup.findFirst({
      where: { id: reqBody.groupId, tenantId: DEFAULT_TENANT_ID }
    });
    if (!group) throw Object.assign(new Error("Order group not found"), { status: 400 });
    return group;
  }
  return null;
}

async function resolveCustomerId(reqBody, client) {
  if (reqBody.customerId) {
    const existing = await client.customer.findFirst({
      where: { id: reqBody.customerId, tenantId: DEFAULT_TENANT_ID }
    });
    if (!existing) throw Object.assign(new Error("Customer not found"), { status: 400 });
    return existing.id;
  }

  if (reqBody.customerName && reqBody.customerPhone) {
    const phone = normalizePhone(reqBody.customerPhone);
    let customer = await client.customer.findFirst({
      where: { tenantId: DEFAULT_TENANT_ID, phone }
    });
    if (!customer) {
      customer = await client.customer.create({
        data: {
          tenantId: DEFAULT_TENANT_ID,
          name: String(reqBody.customerName).trim(),
          phone,
          secondaryPhone: reqBody.secondaryPhone ? normalizePhone(reqBody.secondaryPhone) : ""
        }
      });
    } else if (reqBody.customerName) {
      customer = await client.customer.update({
        where: { id: customer.id },
        data: { name: String(reqBody.customerName).trim() }
      });
    }
    return customer.id;
  }

  throw Object.assign(new Error("customerId or customerName+customerPhone required"), {
    status: 400
  });
}

async function createItemsForOrder(order, itemPayloads, client) {
  const existingCount = await client.orderItem.count({ where: { order: order.id } });
  let index = existingCount;
  for (const payload of itemPayloads) {
    const { _imageUrls, ...fields } = payload;
    const itemId = newId();
    const now = new Date();
    index += 1;
    const barcodeValue = await ensureUniqueItemBarcode(client, order.orderId, index, itemId);
    await client.orderItem.create({
      data: {
        id: itemId,
        order: order.id,
        orderId: order.orderId,
        ...fields,
        barcodeValue,
        barcodeGeneratedAt: now
      }
    });
    if (_imageUrls?.length) {
      await client.orderItemImage.createMany({
        data: _imageUrls.map((img) => ({
          orderItemId: itemId,
          imageUrl: img.imageUrl,
          caption: img.caption || "",
          uploadedAt: now
        }))
      });
    }
  }
}

async function replaceItemsForOrder(order, itemPayloads, client) {
  // Deleting items cascades their images, checkpoints and assignments (see schema).
  await client.orderItem.deleteMany({ where: { order: order.id } });
  await createItemsForOrder(order, itemPayloads, client);
}

async function logProduction(userId, order, action, fromStatus, toStatus, notes = "", client) {
  await client.productionLog.create({
    data: {
      orderId: order.orderId,
      mongoOrderId: order.id,
      userId: userId || null,
      action,
      fromStatus,
      toStatus,
      notes
    }
  });
}

router.get(
  "/",
  query("q").optional().isString(),
  query("status").optional().isIn(ProductionStatus),
  query("clothingType").optional().isString(),
  query("due").optional().isIn(["overdue", "today", "week"]),
  query("priority").optional().isIn(OrderPriority),
  async (req, res) => {
    const { q, status, clothingType, due, priority } = req.query;
    const where = { tenantId: DEFAULT_TENANT_ID };
    if (status) where.productionStatus = status;
    if (priority) where.priority = priority;

    if (clothingType) {
      const itemOrders = await prisma.orderItem.findMany({
        where: { clothingType: { contains: clothingType, mode: "insensitive" } },
        select: { order: true }
      });
      where.id = { in: [...new Set(itemOrders.map((o) => o.order))] };
    }

    if (q) {
      const customers = await prisma.customer.findMany({
        where: {
          tenantId: DEFAULT_TENANT_ID,
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { phone: { contains: q, mode: "insensitive" } }
          ]
        },
        select: { id: true }
      });
      const customerIds = customers.map((c) => c.id);
      const itemOrders = await prisma.orderItem.findMany({
        where: {
          OR: [
            { clothingType: { contains: q, mode: "insensitive" } },
            { barcodeValue: { contains: q, mode: "insensitive" } },
            { clothingCode: { contains: q, mode: "insensitive" } }
          ]
        },
        select: { order: true }
      });
      const matchingGroups = await prisma.orderGroup.findMany({
        where: {
          tenantId: DEFAULT_TENANT_ID,
          name: { contains: q, mode: "insensitive" }
        },
        select: { id: true }
      });
      where.OR = [
        { orderId: { contains: q, mode: "insensitive" } },
        { barcodeValue: { contains: q, mode: "insensitive" } },
        { groupCode: { contains: q, mode: "insensitive" } },
        { customerId: { in: customerIds } },
        { id: { in: [...new Set(itemOrders.map((o) => o.order))] } },
        { groupId: { in: matchingGroups.map((g) => g.id) } }
      ];
    }

    if (due) {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const endToday = new Date(start);
      endToday.setDate(endToday.getDate() + 1);
      const endWeek = new Date(start);
      endWeek.setDate(endWeek.getDate() + 7);
      const open = { productionStatus: { notIn: ["delivered"] } };
      if (due === "overdue") {
        where.AND = [...(where.AND || []), { requiredCompletionDate: { lt: start } }, open];
      } else if (due === "today") {
        where.AND = [
          ...(where.AND || []),
          { requiredCompletionDate: { gte: start, lt: endToday } },
          open
        ];
      } else if (due === "week") {
        where.AND = [
          ...(where.AND || []),
          { requiredCompletionDate: { gte: start, lt: endWeek } },
          open
        ];
      }
    }

    const orders = await prisma.order.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 500
    });
    res.json(await hydrateOrders(orders));
  }
);

router.get("/:orderId/barcode-label", param("orderId").notEmpty(), async (req, res) => {
  const order = await prisma.order.findUnique({ where: { orderId: req.params.orderId } });
  if (!order) return res.status(404).json({ message: "Order not found" });
  const customer = order.customerId
    ? await prisma.customer.findUnique({ where: { id: order.customerId } })
    : null;
  const pdf = await buildSingleLabelPdf({
    barcodeValue: order.barcodeValue,
    title: order.orderId,
    subtitle: customer?.name || ""
  });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="order-${order.orderId}-label.pdf"`);
  res.send(pdf);
});

router.get("/:orderId/barcode-labels/batch", param("orderId").notEmpty(), async (req, res) => {
  const order = await prisma.order.findUnique({ where: { orderId: req.params.orderId } });
  if (!order) return res.status(404).json({ message: "Order not found" });
  const items = await prisma.orderItem.findMany({
    where: { order: order.id },
    orderBy: { createdAt: "asc" }
  });
  const labels = items.map((it, idx) => ({
    barcodeValue: operationalItemBarcode(order.orderId, idx + 1, it.barcodeValue),
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
});

router.get("/:orderId", param("orderId").notEmpty(), async (req, res) => {
  const order = await prisma.order.findUnique({ where: { orderId: req.params.orderId } });
  if (!order) return res.status(404).json({ message: "Order not found" });
  res.json(await hydrateOrder(order));
});

router.post(
  "/",
  requireCapability("orders.write"),
  body("requiredCompletionDate").isISO8601(),
  body("items").isArray({ min: 1 }),
  body("productionStatus").optional().isIn(ProductionStatus),
  body("priority").optional().isIn(OrderPriority),
  body("groupCode").optional().isString(),
  body("groupId").optional({ nullable: true, checkFalsy: true }).custom(isRecordId),
  body("useGroupDueDate").optional().isBoolean(),
  body("useGroupPriority").optional().isBoolean(),
  body("totalAgreedPrice").optional().isFloat({ min: 0 }),
  body("depositPaid").optional().isFloat({ min: 0 }),
  body("customerId").optional({ checkFalsy: true }).custom(isRecordId),
  body("customerName").optional().trim().notEmpty(),
  body("customerPhone").optional().trim().notEmpty(),
  body("mensGarmentSet").optional().isIn(["shirt", "trouser", "both"]),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const itemCheck = validateItems(req.body.items);
    if (!itemCheck.ok) return res.status(400).json({ message: itemCheck.message });
    const setCheck = validateMensGarmentSet(req.body.mensGarmentSet, req.body.items);
    if (!setCheck.ok) return res.status(400).json({ message: setCheck.message });

    try {
      const created = await prisma.$transaction(async (tx) => {
        const customerId = await resolveCustomerId(req.body, tx);
        const group = await resolveGroup(req.body, tx);
        const itemPayloads = req.body.items.map(normalizeItemPayload);
        let orderId = await generateOrderId(tx);
        const createdAt = new Date();
        const estimatedProductionCompletion = computeEstimatedCompletion(createdAt, itemPayloads);
        const totalRevenue = itemPayloads.reduce((sum, i) => sum + i.lineTotal, 0);
        const totalAgreedPrice =
          req.body.totalAgreedPrice !== undefined
            ? Number(req.body.totalAgreedPrice)
            : totalRevenue;

        const due =
          group && req.body.useGroupDueDate && group.sharedDueDate
            ? group.sharedDueDate
            : new Date(req.body.requiredCompletionDate);
        const priority =
          group && req.body.useGroupPriority && group.sharedPriority
            ? group.sharedPriority
            : req.body.priority || "NORMAL";
        const groupCode = group ? group.name : req.body.groupCode || "";

        let doc;
        try {
          doc = await tx.order.create({
            data: {
              tenantId: DEFAULT_TENANT_ID,
              orderId,
              customerId,
              groupId: group?.id || null,
              groupCode,
              requiredCompletionDate: due,
              estimatedProductionCompletion,
              productionStatus: req.body.productionStatus || "pending",
              priority,
              totalAgreedPrice,
              depositPaid: Number(req.body.depositPaid) || 0,
              totalRevenue,
              barcodeValue: generateOrderBarcodeValue(orderId),
              barcodeGeneratedAt: createdAt,
              createdBy: req.user.id,
              lastUpdatedBy: req.user.id
            }
          });
        } catch (dup) {
          if (dup.code !== "P2002") throw dup;
          orderId = await generateOrderIdFallback(tx);
          doc = await tx.order.create({
            data: {
              tenantId: DEFAULT_TENANT_ID,
              orderId,
              customerId,
              groupId: group?.id || null,
              groupCode,
              requiredCompletionDate: due,
              estimatedProductionCompletion,
              productionStatus: req.body.productionStatus || "pending",
              priority,
              totalAgreedPrice,
              depositPaid: Number(req.body.depositPaid) || 0,
              totalRevenue,
              barcodeValue: generateOrderBarcodeValue(orderId),
              barcodeGeneratedAt: createdAt,
              createdBy: req.user.id,
              lastUpdatedBy: req.user.id
            }
          });
        }

        await createItemsForOrder(doc, itemPayloads, tx);
        await logProduction(req.user.id, doc, "order_created", null, doc.productionStatus, "", tx);
        return doc;
      });

      await refreshStatisticSnapshot();
      const full = await prisma.order.findUnique({ where: { id: created.id } });
      res.status(201).json(await hydrateOrder(full));
    } catch (e) {
      if (e.status) return res.status(e.status).json({ message: e.message });
      throw e;
    }
  }
);

router.put(
  "/:orderId",
  requireCapability("orders.write"),
  param("orderId").notEmpty(),
  body("requiredCompletionDate").optional().isISO8601(),
  body("items").optional().isArray({ min: 1 }),
  body("productionStatus").optional().isIn(ProductionStatus),
  body("priority").optional().isIn(OrderPriority),
  body("groupCode").optional().isString(),
  body("groupId").optional({ nullable: true, checkFalsy: true }).custom(isRecordId),
  body("totalAgreedPrice").optional().isFloat({ min: 0 }),
  body("depositPaid").optional().isFloat({ min: 0 }),
  body("customerId").optional({ checkFalsy: true }).custom(isRecordId),
  body("customerName").optional().trim().notEmpty(),
  body("customerPhone").optional().trim().notEmpty(),
  body("mensGarmentSet").optional().isIn(["shirt", "trouser", "both"]),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const order = await prisma.order.findUnique({ where: { orderId: req.params.orderId } });
    if (!order) return res.status(404).json({ message: "Order not found" });

    if (req.body.items) {
      const itemCheck = validateItems(req.body.items);
      if (!itemCheck.ok) return res.status(400).json({ message: itemCheck.message });
      const setCheck = validateMensGarmentSet(req.body.mensGarmentSet, req.body.items);
      if (!setCheck.ok) return res.status(400).json({ message: setCheck.message });
    }

    try {
      const updated = await prisma.$transaction(async (tx) => {
        const data = { lastUpdatedBy: req.user.id };

        if (req.body.customerId || (req.body.customerName && req.body.customerPhone)) {
          data.customerId = await resolveCustomerId(req.body, tx);
        }
        if (req.body.groupCode !== undefined) data.groupCode = req.body.groupCode;
        if (req.body.groupId !== undefined) {
          if (req.body.groupId) {
            const group = await resolveGroup(req.body, tx);
            data.groupId = group.id;
            data.groupCode = group.name;
          } else {
            data.groupId = null;
            if (req.body.groupCode === undefined) data.groupCode = "";
          }
        }
        if (req.body.requiredCompletionDate) {
          data.requiredCompletionDate = new Date(req.body.requiredCompletionDate);
        }
        if (req.body.priority) data.priority = req.body.priority;
        if (req.body.totalAgreedPrice !== undefined) {
          data.totalAgreedPrice = Number(req.body.totalAgreedPrice);
        }
        if (req.body.depositPaid !== undefined) {
          data.depositPaid = Number(req.body.depositPaid);
        }
        if (req.body.productionStatus) data.productionStatus = req.body.productionStatus;

        if (req.body.items) {
          const itemPayloads = req.body.items.map(normalizeItemPayload);
          await replaceItemsForOrder(order, itemPayloads, tx);
          data.totalRevenue = itemPayloads.reduce((sum, i) => sum + i.lineTotal, 0);
          data.estimatedProductionCompletion = computeEstimatedCompletion(
            order.createdAt,
            itemPayloads
          );
        }

        const prevStatus = order.productionStatus;
        const up = await tx.order.update({ where: { id: order.id }, data });

        if (prevStatus !== up.productionStatus) {
          await logProduction(
            req.user.id,
            up,
            "status_change",
            prevStatus,
            up.productionStatus,
            "",
            tx
          );
        }
        return up;
      });

      await refreshStatisticSnapshot();
      const full = await prisma.order.findUnique({ where: { id: updated.id } });
      res.json(await hydrateOrder(full));
    } catch (e) {
      if (e.status) return res.status(e.status).json({ message: e.message });
      throw e;
    }
  }
);

router.delete(
  "/:orderId",
  requireCapability("orders.delete"),
  param("orderId").notEmpty(),
  async (req, res) => {
    const order = await prisma.order.findUnique({ where: { orderId: req.params.orderId } });
    if (!order) return res.status(404).json({ message: "Order not found" });

    await prisma.order.delete({ where: { id: order.id } });
    await refreshStatisticSnapshot();
    res.status(204).send();
  }
);

export default router;
