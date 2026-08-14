import { prisma } from "../db/prisma.js";
import { s } from "./serialize.js";
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
    typeof orderItemIdOrDoc === "object" && orderItemIdOrDoc && orderItemIdOrDoc.id
      ? orderItemIdOrDoc
      : await prisma.orderItem.findUnique({ where: { id: orderItemIdOrDoc } });
  if (!item) return null;

  const order = await prisma.order.findUnique({ where: { id: item.order } });
  if (!order) return null;

  const [customer, images, siblings, checkpoints, seqInfo] = await Promise.all([
    order.customerId ? prisma.customer.findUnique({ where: { id: order.customerId } }) : null,
    prisma.orderItemImage.findMany({
      where: { orderItemId: item.id },
      orderBy: { uploadedAt: "asc" }
    }),
    prisma.orderItem.findMany({ where: { order: order.id }, orderBy: { createdAt: "asc" } }),
    prisma.stageCheckpoint.findMany({
      where: { orderItemId: item.id },
      orderBy: { checkedInAt: "asc" }
    }),
    resolveStageSequence(item.clothingType)
  ]);

  const siblingIds = siblings.map((sib) => sib.id);
  const allCp = siblingIds.length
    ? await prisma.stageCheckpoint.findMany({ where: { orderItemId: { in: siblingIds } } })
    : [];
  const cpByItem = new Map();
  for (const cp of allCp) {
    const k = cp.orderItemId;
    if (!cpByItem.has(k)) cpByItem.set(k, []);
    cpByItem.get(k).push(cp);
  }

  const siblingDetails = await Promise.all(
    siblings.map(async (sib) => {
      const cps = cpByItem.get(sib.id) || [];
      const { stageSequence } = await resolveStageSequence(sib.clothingType);
      return {
        _id: sib.id,
        clothingType: sib.clothingType,
        clothingCode: sib.clothingCode,
        barcodeValue: sib.barcodeValue,
        currentStage: deriveCurrentStage(cps, stageSequence),
        isCurrent: sib.id === item.id
      };
    })
  );

  let groupOtherOrders = 0;
  let groupOtherItems = 0;
  if (order.groupCode) {
    const groupOrders = await prisma.order.findMany({
      where: { groupCode: order.groupCode, id: { not: order.id } },
      select: { id: true }
    });
    groupOtherOrders = groupOrders.length;
    if (groupOrders.length) {
      groupOtherItems = await prisma.orderItem.count({
        where: { order: { in: groupOrders.map((o) => o.id) } }
      });
    }
  }

  const currentStage = deriveCurrentStage(checkpoints, seqInfo.stageSequence);
  const nextStage = nextExpectedStage(checkpoints, seqInfo.stageSequence);
  const days = daysUntil(order.requiredCompletionDate);

  return {
    customer: customer
      ? {
          _id: customer.id,
          name: customer.name,
          phone: customer.phone,
          secondaryPhone: customer.secondaryPhone || ""
        }
      : null,
    item: {
      _id: item.id,
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
      images: images.map(s)
    },
    group: {
      groupCode: order.groupCode || "",
      otherOrdersSharingGroup: groupOtherOrders,
      otherItemsSharingGroup: groupOtherItems
    },
    order: {
      orderId: order.orderId,
      _id: order.id,
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
  const item = await prisma.orderItem.findFirst({ where: { barcodeValue: value } });
  if (!item) {
    throw Object.assign(new Error(`No order item found for barcode ${value}`), {
      status: 404
    });
  }
  return item;
}
