import { Router } from "express";
import { body, param, validationResult } from "express-validator";
import { prisma } from "../db/prisma.js";
import { s } from "../utils/serialize.js";
import { requireAuth } from "../middleware/auth.js";
import { requireCapability } from "../middleware/permissions.js";
import { DEFAULT_TENANT_ID } from "../config/tenant.js";
import { OrderPriority } from "../constants/production.js";
import { hydrateOrder, hydrateOrders } from "../utils/orderHydrate.js";
import { isRecordId } from "../utils/recordId.js";

const router = Router();
router.use(requireAuth);

function serializeGroup(group, extra = {}) {
  if (!group) return null;
  const { orders, ...rest } = group;
  return {
    ...s(rest),
    ...extra,
    orderCount: extra.orderCount ?? (orders ? orders.length : undefined)
  };
}

async function groupProgress(groupId) {
  const orders = await prisma.order.findMany({
    where: { groupId, tenantId: DEFAULT_TENANT_ID },
    include: { customer: true, items: true }
  });
  const total = orders.length;
  const ready = orders.filter((o) =>
    ["completed", "ready_to_pack", "ready_for_pickup", "delivered"].includes(o.productionStatus)
  ).length;
  const inProduction = orders.filter((o) =>
    ["cutting", "stitching", "finishing", "pending"].includes(o.productionStatus)
  ).length;
  const outstanding = orders.reduce(
    (sum, o) => sum + Math.max(0, (o.totalAgreedPrice || 0) - (o.depositPaid || 0)),
    0
  );
  const dueDates = orders.map((o) => o.requiredCompletionDate).filter(Boolean);
  const earliestDue = dueDates.length
    ? new Date(Math.min(...dueDates.map((d) => new Date(d).getTime())))
    : null;
  let status = "Empty";
  if (total && ready === total) status = "Ready";
  else if (inProduction) status = "In Production";
  else if (total) status = "Received";
  return {
    orderCount: total,
    readyCount: ready,
    inProductionCount: inProduction,
    outstanding,
    earliestDue,
    status,
    orders
  };
}

router.get("/", async (req, res) => {
  const q = String(req.query.q || "").trim();
  const where = { tenantId: DEFAULT_TENANT_ID };
  if (q) {
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { responsibleName: { contains: q, mode: "insensitive" } },
      { responsiblePhone: { contains: q, mode: "insensitive" } }
    ];
  }
  const groups = await prisma.orderGroup.findMany({
    where,
    orderBy: { updatedAt: "desc" }
  });
  const rows = await Promise.all(
    groups.map(async (g) => {
      const progress = await groupProgress(g.id);
      return serializeGroup(g, {
        orderCount: progress.orderCount,
        readyCount: progress.readyCount,
        inProductionCount: progress.inProductionCount,
        outstanding: progress.outstanding,
        earliestDue: progress.earliestDue,
        status: progress.status
      });
    })
  );
  res.json(rows);
});

router.get("/:id", param("id").custom(isRecordId), async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const group = await prisma.orderGroup.findFirst({
    where: { id: req.params.id, tenantId: DEFAULT_TENANT_ID }
  });
  if (!group) return res.status(404).json({ message: "Group not found" });
  const progress = await groupProgress(group.id);
  const hydrated = await hydrateOrders(progress.orders.map(({ items, customer, ...order }) => order));
  res.json({
    ...serializeGroup(group, {
      orderCount: progress.orderCount,
      readyCount: progress.readyCount,
      inProductionCount: progress.inProductionCount,
      outstanding: progress.outstanding,
      earliestDue: progress.earliestDue,
      status: progress.status
    }),
    orders: hydrated
  });
});

router.post(
  "/",
  requireCapability("orders.write"),
  body("name").trim().notEmpty(),
  body("description").optional().isString(),
  body("responsibleName").optional().isString(),
  body("responsiblePhone").optional().isString(),
  body("sharedDueDate").optional({ nullable: true }).isISO8601(),
  body("sharedPriority").optional({ nullable: true }).isIn([...OrderPriority, ""]),
  body("notes").optional().isString(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const group = await prisma.orderGroup.create({
      data: {
        tenantId: DEFAULT_TENANT_ID,
        name: String(req.body.name).trim(),
        description: req.body.description ? String(req.body.description).trim() : "",
        responsibleName: req.body.responsibleName ? String(req.body.responsibleName).trim() : "",
        responsiblePhone: req.body.responsiblePhone ? String(req.body.responsiblePhone).trim() : "",
        sharedDueDate: req.body.sharedDueDate ? new Date(req.body.sharedDueDate) : null,
        sharedPriority: req.body.sharedPriority || null,
        notes: req.body.notes ? String(req.body.notes).trim() : ""
      }
    });
    res.status(201).json(serializeGroup(group, { orderCount: 0, readyCount: 0, outstanding: 0, status: "Empty" }));
  }
);

router.patch(
  "/:id",
  requireCapability("orders.write"),
  param("id").custom(isRecordId),
  body("name").optional().trim().notEmpty(),
  body("description").optional().isString(),
  body("responsibleName").optional().isString(),
  body("responsiblePhone").optional().isString(),
  body("sharedDueDate").optional({ nullable: true }).isISO8601(),
  body("sharedPriority").optional({ nullable: true }).isIn([...OrderPriority, ""]),
  body("notes").optional().isString(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const group = await prisma.orderGroup.findFirst({
      where: { id: req.params.id, tenantId: DEFAULT_TENANT_ID }
    });
    if (!group) return res.status(404).json({ message: "Group not found" });

    const data = {};
    if (req.body.name !== undefined) data.name = String(req.body.name).trim();
    if (req.body.description !== undefined) data.description = String(req.body.description);
    if (req.body.responsibleName !== undefined) data.responsibleName = String(req.body.responsibleName);
    if (req.body.responsiblePhone !== undefined) data.responsiblePhone = String(req.body.responsiblePhone);
    if (req.body.sharedDueDate !== undefined) {
      data.sharedDueDate = req.body.sharedDueDate ? new Date(req.body.sharedDueDate) : null;
    }
    if (req.body.sharedPriority !== undefined) data.sharedPriority = req.body.sharedPriority || null;
    if (req.body.notes !== undefined) data.notes = String(req.body.notes);

    const updated = await prisma.orderGroup.update({ where: { id: group.id }, data });
    const progress = await groupProgress(updated.id);
    res.json(
      serializeGroup(updated, {
        orderCount: progress.orderCount,
        readyCount: progress.readyCount,
        outstanding: progress.outstanding,
        earliestDue: progress.earliestDue,
        status: progress.status
      })
    );
  }
);

router.post(
  "/:id/orders",
  requireCapability("orders.write"),
  param("id").custom(isRecordId),
  body("orderId").notEmpty(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const group = await prisma.orderGroup.findFirst({
      where: { id: req.params.id, tenantId: DEFAULT_TENANT_ID }
    });
    if (!group) return res.status(404).json({ message: "Group not found" });

    const order =
      (await prisma.order.findUnique({ where: { orderId: String(req.body.orderId) } })) ||
      (await prisma.order.findUnique({ where: { id: String(req.body.orderId) } }));
    if (!order) return res.status(404).json({ message: "Order not found" });

    const updated = await prisma.order.update({
      where: { id: order.id },
      data: { groupId: group.id, groupCode: group.name }
    });
    res.json(await hydrateOrder(updated));
  }
);

router.delete(
  "/:id/orders/:orderId",
  requireCapability("orders.write"),
  param("id").custom(isRecordId),
  param("orderId").notEmpty(),
  async (req, res) => {
    const order =
      (await prisma.order.findUnique({ where: { orderId: req.params.orderId } })) ||
      (await prisma.order.findUnique({ where: { id: req.params.orderId } }));
    if (!order || order.groupId !== req.params.id) {
      return res.status(404).json({ message: "Order is not in this group" });
    }
    const updated = await prisma.order.update({
      where: { id: order.id },
      data: { groupId: null, groupCode: "" }
    });
    res.json(await hydrateOrder(updated));
  }
);

export default router;
