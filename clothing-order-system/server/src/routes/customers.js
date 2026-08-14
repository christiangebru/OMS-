import { Router } from "express";
import { body, param, query, validationResult } from "express-validator";
import { prisma } from "../db/prisma.js";
import { s, sMany } from "../utils/serialize.js";
import { requireAuth } from "../middleware/auth.js";
import { DEFAULT_TENANT_ID } from "../config/tenant.js";
import { normalizePhone } from "../utils/migrateHelpers.js";

const router = Router();
router.use(requireAuth);

router.get("/", query("q").optional().isString(), async (req, res) => {
  const where = { tenantId: DEFAULT_TENANT_ID };
  const q = (req.query.q || "").trim();
  if (q) {
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { phone: { contains: q.replace(/[^\d+]/g, "") } }
    ];
  }

  const customers = await prisma.customer.findMany({
    where,
    orderBy: { name: "asc" },
    take: 100
  });
  const ids = customers.map((c) => c.id);
  const orderAgg = ids.length
    ? await prisma.order.groupBy({
        by: ["customerId"],
        where: { customerId: { in: ids } },
        _count: { _all: true },
        _max: { createdAt: true }
      })
    : [];
  const stats = new Map(orderAgg.map((r) => [r.customerId, r]));

  res.json(
    customers.map((c) => {
      const st = stats.get(c.id);
      return {
        ...s(c),
        orderCount: st?._count?._all || 0,
        lastOrderDate: st?._max?.createdAt || null
      };
    })
  );
});

router.get("/:id", param("id").isMongoId(), async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const customer = await prisma.customer.findFirst({
    where: { id: req.params.id, tenantId: DEFAULT_TENANT_ID }
  });
  if (!customer) return res.status(404).json({ message: "Customer not found" });

  const [measurements, orders] = await Promise.all([
    prisma.measurement.findMany({
      where: { customerId: customer.id },
      orderBy: { recordedAt: "desc" }
    }),
    prisma.order.findMany({
      where: { customerId: customer.id },
      orderBy: { createdAt: "desc" },
      take: 50
    })
  ]);

  res.json({
    ...s(customer),
    measurements: sMany(measurements),
    orders: orders.map((o) => ({
      _id: o.id,
      orderId: o.orderId,
      productionStatus: o.productionStatus,
      priority: o.priority,
      totalAgreedPrice: o.totalAgreedPrice,
      depositPaid: o.depositPaid,
      requiredCompletionDate: o.requiredCompletionDate,
      createdAt: o.createdAt
    }))
  });
});

router.post(
  "/",
  body("name").trim().notEmpty(),
  body("phone").trim().notEmpty(),
  body("secondaryPhone").optional().isString(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const phone = normalizePhone(req.body.phone);
    if (!phone) return res.status(400).json({ message: "Invalid phone" });

    try {
      const customer = await prisma.customer.create({
        data: {
          tenantId: DEFAULT_TENANT_ID,
          name: req.body.name.trim(),
          phone,
          secondaryPhone: req.body.secondaryPhone ? normalizePhone(req.body.secondaryPhone) : ""
        }
      });
      res.status(201).json(s(customer));
    } catch (e) {
      if (e.code === "P2002") {
        return res.status(409).json({ message: "Customer with this phone already exists" });
      }
      throw e;
    }
  }
);

router.patch(
  "/:id",
  param("id").isMongoId(),
  body("name").optional().trim().notEmpty(),
  body("phone").optional().trim().notEmpty(),
  body("secondaryPhone").optional().isString(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const customer = await prisma.customer.findFirst({
      where: { id: req.params.id, tenantId: DEFAULT_TENANT_ID }
    });
    if (!customer) return res.status(404).json({ message: "Customer not found" });

    const data = {};
    if (req.body.name) data.name = req.body.name.trim();
    if (req.body.phone) data.phone = normalizePhone(req.body.phone);
    if (req.body.secondaryPhone !== undefined) {
      data.secondaryPhone = req.body.secondaryPhone
        ? normalizePhone(req.body.secondaryPhone)
        : "";
    }

    try {
      const updated = await prisma.customer.update({ where: { id: customer.id }, data });
      res.json(s(updated));
    } catch (e) {
      if (e.code === "P2002") {
        return res.status(409).json({ message: "Customer with this phone already exists" });
      }
      throw e;
    }
  }
);

router.post(
  "/:id/measurements",
  param("id").isMongoId(),
  body("chest").optional().isFloat(),
  body("waist").optional().isFloat(),
  body("hip").optional().isFloat(),
  body("shoulder").optional().isFloat(),
  body("sleeveLength").optional().isFloat(),
  body("inseam").optional().isFloat(),
  body("neck").optional().isFloat(),
  body("notes").optional().isString(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const customer = await prisma.customer.findFirst({
      where: { id: req.params.id, tenantId: DEFAULT_TENANT_ID }
    });
    if (!customer) return res.status(404).json({ message: "Customer not found" });

    const num = (v) => (v === undefined || v === null || v === "" ? undefined : Number(v));
    const measurement = await prisma.measurement.create({
      data: {
        customerId: customer.id,
        chest: num(req.body.chest),
        waist: num(req.body.waist),
        hip: num(req.body.hip),
        shoulder: num(req.body.shoulder),
        sleeveLength: num(req.body.sleeveLength),
        inseam: num(req.body.inseam),
        neck: num(req.body.neck),
        notes: req.body.notes || "",
        recordedAt: new Date()
      }
    });

    res.status(201).json(s(measurement));
  }
);

export default router;
