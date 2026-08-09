import { Order } from "../models/Order.js";
import { OrderItem } from "../models/OrderItem.js";
import { OrderItemImage } from "../models/OrderItemImage.js";
import { Customer } from "../models/Customer.js";
import { StageCheckpoint } from "../models/StageCheckpoint.js";
import { balanceRemaining } from "./orderHydrate.js";
import {
  deriveCurrentStage,
  nextExpectedStage,
  resolveStageSequence
} from "./stageSequence.js";

function daysUntil(date) {
  if (!date) return null;
  const ms = new Date(date).getTime() - Date.now();
  return ms / (24 * 60 * 60 * 1000);
}

/**
 * Full scan-detail context for an order item.
 */
export async function buildScanDetails(orderItemIdOrDoc) {
  const item =
    typeof orderItemIdOrDoc === "object" && orderItemIdOrDoc._id
      ? orderItemIdOrDoc
      : await OrderItem.findById(orderItemIdOrDoc).lean();
  if (!item) return null;

  const order = await Order.findById(item.order).lean();
  if (!order) return null;

  const [customer, images, siblings, checkpoints, seqInfo] = await Promise.all([
    order.customerId ? Customer.findById(order.customerId).lean() : null,
    OrderItemImage.find({ orderItemId: item._id }).sort({ uploadedAt: 1 }).lean(),
    OrderItem.find({ order: order._id }).sort({ createdAt: 1 }).lean(),
    StageCheckpoint.find({ orderItemId: item._id }).sort({ checkedInAt: 1 }).lean(),
    resolveStageSequence(item.clothingType)
  ]);

  const siblingIds = siblings.map((s) => s._id);
  const allCp = siblingIds.length
    ? await StageCheckpoint.find({ orderItemId: { $in: siblingIds } }).lean()
    : [];
  const cpByItem = new Map();
  for (const cp of allCp) {
    const k = String(cp.orderItemId);
    if (!cpByItem.has(k)) cpByItem.set(k, []);
    cpByItem.get(k).push(cp);
  }

  const siblingDetails = await Promise.all(
    siblings.map(async (sib) => {
      const cps = cpByItem.get(String(sib._id)) || [];
      const { stageSequence } = await resolveStageSequence(sib.clothingType);
      return {
        _id: sib._id,
        clothingType: sib.clothingType,
        clothingCode: sib.clothingCode,
        barcodeValue: sib.barcodeValue,
        currentStage: deriveCurrentStage(cps, stageSequence),
        isCurrent: String(sib._id) === String(item._id)
      };
    })
  );

  let groupOtherOrders = 0;
  let groupOtherItems = 0;
  if (order.groupCode) {
    const groupOrders = await Order.find({
      groupCode: order.groupCode,
      _id: { $ne: order._id }
    })
      .select("_id")
      .lean();
    groupOtherOrders = groupOrders.length;
    if (groupOrders.length) {
      groupOtherItems = await OrderItem.countDocuments({
        order: { $in: groupOrders.map((o) => o._id) }
      });
    }
  }

  const currentStage = deriveCurrentStage(checkpoints, seqInfo.stageSequence);
  const nextStage = nextExpectedStage(checkpoints, seqInfo.stageSequence);
  const days = daysUntil(order.requiredCompletionDate);

  return {
    customer: customer
      ? {
          _id: customer._id,
          name: customer.name,
          phone: customer.phone,
          secondaryPhone: customer.secondaryPhone || ""
        }
      : null,
    item: {
      _id: item._id,
      clothingCode: item.clothingCode,
      clothingType: item.clothingType,
      fabricType: item.fabricType,
      color: item.color,
      size: item.size,
      neckType: item.neckType,
      handType: item.handType,
      notes: item.notes,
      quantity: item.quantity,
      measurements: item.measurements,
      difficultyLevel: item.difficultyLevel,
      barcodeValue: item.barcodeValue,
      images
    },
    group: {
      groupCode: order.groupCode || "",
      otherOrdersSharingGroup: groupOtherOrders,
      otherItemsSharingGroup: groupOtherItems
    },
    order: {
      orderId: order.orderId,
      _id: order._id,
      productionStatus: order.productionStatus,
      priority: order.priority,
      siblingItems: siblingDetails
    },
    pricing: {
      totalAgreedPrice: order.totalAgreedPrice || 0,
      depositPaid: order.depositPaid || 0,
      balanceRemaining: balanceRemaining(order)
    },
    timing: {
      requiredCompletionDate: order.requiredCompletionDate,
      daysRemaining: days != null ? Number(days.toFixed(1)) : null,
      overdue: days != null ? days < 0 : false,
      currentStage,
      nextExpectedStage: nextStage,
      stageSequence: seqInfo.stageSequence
    }
  };
}

/**
 * Resolve barcode to OrderItem. Rejects order-level barcodes.
 */
export async function resolveItemByBarcode(barcodeValue) {
  const value = String(barcodeValue || "").trim();
  if (!value) {
    throw Object.assign(new Error("Barcode value is required"), { status: 400 });
  }
  if (/^ORD-/i.test(value)) {
    throw Object.assign(
      new Error("That is an order barcode. Scan the item label (ITM-…) instead."),
      { status: 400 }
    );
  }
  const item = await OrderItem.findOne({ barcodeValue: value }).lean();
  if (!item) {
    throw Object.assign(new Error(`No order item found for barcode ${value}`), {
      status: 404
    });
  }
  return item;
}
