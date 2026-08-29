import { newId } from "./ids.js";
import { ensureUniqueItemBarcode, ensureUniquePartBarcode } from "./barcode.js";
import { findClothingTypeConfig } from "./clothingTypeConfig.js";
import { resolvePartCodes, partLabel } from "./productionModel.js";

export async function hasProductionHistory(orderId, client) {
  const items = await client.orderItem.findMany({
    where: { order: orderId },
    select: { id: true }
  });
  if (!items.length) return false;
  const ids = items.map((i) => i.id);
  const [cp, asg] = await Promise.all([
    client.stageCheckpoint.count({ where: { orderItemId: { in: ids } } }),
    client.staffAssignment.count({ where: { orderItemId: { in: ids } } })
  ]);
  return cp > 0 || asg > 0;
}

export async function itemHasHistory(itemId, client) {
  const [cp, asg] = await Promise.all([
    client.stageCheckpoint.count({ where: { orderItemId: itemId } }),
    client.staffAssignment.count({ where: { orderItemId: itemId } })
  ]);
  return cp > 0 || asg > 0;
}

async function configForType(clothingType, clothingCode, client) {
  return findClothingTypeConfig(client, clothingType, clothingCode);
}

async function createPartRows(order, parent, partCodes, client) {
  const now = new Date();
  for (const code of partCodes) {
    const partId = newId();
    const barcodeValue = await ensureUniquePartBarcode(client, order.orderId, parent.itemIndex, code);
    await client.orderItem.create({
      data: {
        id: partId,
        order: order.id,
        orderId: order.orderId,
        clothingCode: `${parent.clothingCode}-${code}`,
        clothingType: parent.clothingType,
        fabricType: parent.fabricType,
        color: parent.color,
        quantity: 1,
        notes: `${partLabel(code)} of ${parent.clothingType}`,
        neckType: parent.neckType,
        handType: parent.handType,
        size: parent.size,
        audience: parent.audience || "",
        setChoice: parent.setChoice || "",
        measurements: parent.measurements || undefined,
        productionDays: parent.productionDays,
        unitPrice: 0,
        lineTotal: 0,
        difficultyLevel: parent.difficultyLevel,
        barcodeValue,
        barcodeGeneratedAt: now,
        itemKind: "part",
        parentItemId: parent.id,
        partCode: code,
        itemIndex: parent.itemIndex,
        offSiteStages: parent.offSiteStages || [],
        printPartLabel: true
      }
    });
  }
}

export async function createItemsForOrder(order, itemPayloads, client, { partLabelMode = "none" } = {}) {
  const existingTop = await client.orderItem.count({
    where: { order: order.id, parentItemId: null, itemKind: { not: "part" } }
  });
  let index = existingTop;
  const created = [];
  for (const payload of itemPayloads) {
    const { _imageUrls, _selectedPartCodes, _partLabelMode, ...fields } = payload;
    const itemId = newId();
    const now = new Date();
    const kind = fields.itemKind || "garment";
    if (kind !== "part") index += 1;
    const barcodeValue = await ensureUniqueItemBarcode(client, order.orderId, index, itemId);
    const config = await configForType(fields.clothingType, fields.clothingCode, client);
    const itemKind = fields.itemKind || config?.itemKind || "garment";
    const offSiteStages = fields.offSiteStages?.length
      ? fields.offSiteStages
      : config?.offSiteStages || [];
    const row = await client.orderItem.create({
      data: {
        id: itemId,
        order: order.id,
        orderId: order.orderId,
        clothingCode: fields.clothingCode,
        clothingType: fields.clothingType,
        fabricType: fields.fabricType,
        color: fields.color,
        quantity: fields.quantity,
        notes: fields.notes,
        neckType: fields.neckType,
        handType: fields.handType,
        size: fields.size,
        audience: fields.audience || "",
        setChoice: fields.setChoice || "",
        measurements: fields.measurements,
        productionDays: fields.productionDays,
        unitPrice: fields.unitPrice,
        lineTotal: fields.lineTotal,
        difficultyLevel: fields.difficultyLevel,
        barcodeValue,
        barcodeGeneratedAt: now,
        itemKind,
        itemIndex: index,
        offSiteStages,
        printPartLabel: false
      }
    });
    if (_imageUrls?.length) {
      await client.orderItemImage.createMany({
        data: _imageUrls.map((img, i) => ({
          orderItemId: itemId,
          imageUrl: img.imageUrl,
          caption: img.caption || "",
          category: img.category || "other",
          sortOrder: Number(img.sortOrder) || i,
          uploadedAt: now
        }))
      });
    }
    const mode = _partLabelMode || partLabelMode || "none";
    if (itemKind !== "part" && itemKind !== "accessory") {
      const codes = resolvePartCodes(fields.clothingType, config, mode, _selectedPartCodes);
      if (codes.length) await createPartRows(order, row, codes, client);
    }
    created.push(row);
  }
  return created;
}

export async function replaceItemsForOrder(order, itemPayloads, client, { partLabelMode = "none" } = {}) {
  const history = await hasProductionHistory(order.id, client);
  if (history) {
    throw Object.assign(
      new Error(
        "Cannot replace garments: this order already has production history (scans or assignments). Edit due date, deposit, notes, and prices without replacing items, or add new garments."
      ),
      { status: 409, code: "PRODUCTION_HISTORY" }
    );
  }
  await client.orderItem.deleteMany({ where: { order: order.id } });
  await createItemsForOrder(order, itemPayloads, client, { partLabelMode });
}

function payloadId(payload) {
  return payload.id || payload._id || null;
}

export async function upsertItemsForOrder(order, itemPayloads, client, { partLabelMode = "none" } = {}) {
  const existing = await client.orderItem.findMany({
    where: { order: order.id },
    orderBy: { createdAt: "asc" }
  });
  const existingById = new Map(existing.map((it) => [it.id, it]));
  const incomingIds = itemPayloads.map(payloadId).filter(Boolean);
  const payloadsHaveIds = incomingIds.length > 0;
  const allMissingIds = itemPayloads.every((p) => !payloadId(p));

  if (allMissingIds && existing.length) {
    await replaceItemsForOrder(order, itemPayloads, client, { partLabelMode });
    return;
  }

  const keepIds = new Set(incomingIds);
  for (const row of existing) {
    if (row.itemKind === "part") continue;
    if (payloadsHaveIds && !keepIds.has(row.id)) {
      if (await itemHasHistory(row.id, client)) {
        throw Object.assign(
          new Error(
            `Cannot remove ${row.clothingType} (${row.barcodeValue}): it has production history. Completion is per garment.`
          ),
          { status: 409, code: "PRODUCTION_HISTORY" }
        );
      }
      await client.orderItem.delete({ where: { id: row.id } });
    }
  }

  let maxIndex = existing
    .filter((it) => it.itemKind !== "part")
    .reduce((m, it) => Math.max(m, it.itemIndex || 0), 0);

  for (const payload of itemPayloads) {
    const id = payloadId(payload);
    const { _imageUrls, _selectedPartCodes, _partLabelMode, ...fields } = payload;
    if (id && existingById.has(id)) {
      const data = {
        clothingCode: fields.clothingCode,
        clothingType: fields.clothingType,
        fabricType: fields.fabricType,
        color: fields.color,
        quantity: fields.quantity,
        notes: fields.notes,
        neckType: fields.neckType,
        handType: fields.handType,
        size: fields.size,
        measurements: fields.measurements,
        productionDays: fields.productionDays,
        unitPrice: fields.unitPrice,
        lineTotal: fields.lineTotal,
        difficultyLevel: fields.difficultyLevel
      };
      if (fields.audience !== undefined) data.audience = fields.audience;
      if (fields.setChoice !== undefined) data.setChoice = fields.setChoice;
      if (fields.offSiteStages) data.offSiteStages = fields.offSiteStages;
      await client.orderItem.update({ where: { id }, data });
      continue;
    }
    maxIndex += 1;
    const created = await createItemsForOrder(
      order,
      [{ ...payload, itemKind: fields.itemKind }],
      client,
      { partLabelMode: _partLabelMode || partLabelMode }
    );
    if (created[0] && created[0].itemIndex !== maxIndex) {
      await client.orderItem.update({
        where: { id: created[0].id },
        data: { itemIndex: maxIndex }
      });
    }
  }
}
