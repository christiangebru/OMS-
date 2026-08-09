import { Router } from "express";
import { body, param, query, validationResult } from "express-validator";
import { Customer } from "../models/Customer.js";
import { Measurement } from "../models/Measurement.js";
import { Order } from "../models/Order.js";
import { requireAuth } from "../middleware/auth.js";
import { DEFAULT_TENANT_ID } from "../config/tenant.js";
import { normalizePhone } from "../utils/migrateHelpers.js";

const router = Router();
router.use(requireAuth);

router.get("/", query("q").optional().isString(), async (req, res) => {
  const filter = { tenantId: DEFAULT_TENANT_ID };
  const q = (req.query.q || "").trim();
  if (q) {
    filter.$or = [
      { name: new RegExp(q, "i") },
      { phone: new RegExp(q.replace(/[^\d+]/g, ""), "i") }
    ];
  }

  const customers = await Customer.find(filter).sort({ name: 1 }).limit(100).lean();
  const ids = customers.map((c) => c._id);
  const orderAgg = await Order.aggregate([
    { $match: { customerId: { $in: ids } } },
    {
      $group: {
        _id: "$customerId",
        orderCount: { $sum: 1 },
        lastOrderDate: { $max: "$createdAt" }
      }
    }
  ]);
  const stats = new Map(orderAgg.map((r) => [String(r._id), r]));

  res.json(
    customers.map((c) => {
      const s = stats.get(String(c._id));
      return {
        ...c,
        orderCount: s?.orderCount || 0,
        lastOrderDate: s?.lastOrderDate || null
      };
    })
  );
});

router.get("/:id", param("id").isMongoId(), async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const customer = await Customer.findOne({
    _id: req.params.id,
    tenantId: DEFAULT_TENANT_ID
  }).lean();
  if (!customer) return res.status(404).json({ message: "Customer not found" });

  const [measurements, orders] = await Promise.all([
    Measurement.find({ customerId: customer._id }).sort({ recordedAt: -1 }).lean(),
    Order.find({ customerId: customer._id }).sort({ createdAt: -1 }).limit(50).lean()
  ]);

  res.json({
    ...customer,
    measurements,
    orders: orders.map((o) => ({
      _id: o._id,
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
      const customer = await Customer.create({
        tenantId: DEFAULT_TENANT_ID,
        name: req.body.name.trim(),
        phone,
        secondaryPhone: req.body.secondaryPhone
          ? normalizePhone(req.body.secondaryPhone)
          : ""
      });
      res.status(201).json(customer);
    } catch (e) {
      if (e.code === 11000) {
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

    const customer = await Customer.findOne({
      _id: req.params.id,
      tenantId: DEFAULT_TENANT_ID
    });
    if (!customer) return res.status(404).json({ message: "Customer not found" });

    if (req.body.name) customer.name = req.body.name.trim();
    if (req.body.phone) customer.phone = normalizePhone(req.body.phone);
    if (req.body.secondaryPhone !== undefined) {
      customer.secondaryPhone = req.body.secondaryPhone
        ? normalizePhone(req.body.secondaryPhone)
        : "";
    }

    try {
      await customer.save();
      res.json(customer);
    } catch (e) {
      if (e.code === 11000) {
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

    const customer = await Customer.findOne({
      _id: req.params.id,
      tenantId: DEFAULT_TENANT_ID
    });
    if (!customer) return res.status(404).json({ message: "Customer not found" });

    const num = (v) => (v === undefined || v === null || v === "" ? undefined : Number(v));
    const measurement = await Measurement.create({
      customerId: customer._id,
      chest: num(req.body.chest),
      waist: num(req.body.waist),
      hip: num(req.body.hip),
      shoulder: num(req.body.shoulder),
      sleeveLength: num(req.body.sleeveLength),
      inseam: num(req.body.inseam),
      neck: num(req.body.neck),
      notes: req.body.notes || "",
      recordedAt: new Date()
    });

    res.status(201).json(measurement);
  }
);

export default router;
