import PDFDocument from "pdfkit";
import {
  LABEL_WIDTH_MM,
  LABEL_HEIGHT_MM,
  BATCH_PAGE_WIDTH_MM,
  BATCH_PAGE_HEIGHT_MM,
  BATCH_COLS,
  BATCH_ROWS,
  BATCH_MARGIN_MM,
  BATCH_GAP_MM,
  MM_TO_PT
} from "../config/labels.js";
import { renderBarcodePng } from "./barcode.js";

function mm(n) {
  return n * MM_TO_PT;
}

function collectPdf(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
}

/**
 * @param {{ barcodeValue: string, title: string, subtitle?: string }} label
 */
export async function buildSingleLabelPdf(label) {
  const w = mm(LABEL_WIDTH_MM);
  const h = mm(LABEL_HEIGHT_MM);
  const doc = new PDFDocument({ size: [w, h], margin: mm(2) });
  const done = collectPdf(doc);
  const png = await renderBarcodePng(label.barcodeValue);

  doc.fontSize(7).text(label.title || "", { width: w - mm(4), align: "center" });
  if (label.subtitle) {
    doc.fontSize(6).fillColor("#444").text(label.subtitle, { width: w - mm(4), align: "center" });
    doc.fillColor("#000");
  }
  const imgW = w - mm(6);
  const imgH = mm(12);
  doc.image(png, mm(3), doc.y + 2, { width: imgW, height: imgH, fit: [imgW, imgH] });
  doc.end();
  return done;
}

/**
 * @param {Array<{ barcodeValue: string, title: string, subtitle?: string }>} labels
 */
export async function buildBatchLabelPdf(labels) {
  const pageW = mm(BATCH_PAGE_WIDTH_MM);
  const pageH = mm(BATCH_PAGE_HEIGHT_MM);
  const margin = mm(BATCH_MARGIN_MM);
  const gap = mm(BATCH_GAP_MM);
  const cellW =
    (pageW - margin * 2 - gap * (BATCH_COLS - 1)) / BATCH_COLS;
  const cellH =
    (pageH - margin * 2 - gap * (BATCH_ROWS - 1)) / BATCH_ROWS;
  const perPage = BATCH_COLS * BATCH_ROWS;

  const doc = new PDFDocument({ size: "A4", margin: 0 });
  const done = collectPdf(doc);

  for (let i = 0; i < labels.length; i++) {
    if (i > 0 && i % perPage === 0) doc.addPage();
    const idx = i % perPage;
    const col = idx % BATCH_COLS;
    const row = Math.floor(idx / BATCH_COLS);
    const x = margin + col * (cellW + gap);
    const y = margin + row * (cellH + gap);
    const label = labels[i];
    const png = await renderBarcodePng(label.barcodeValue);

    doc.rect(x, y, cellW, cellH).stroke("#ccc");
    doc.fontSize(8).fillColor("#000").text(label.title || "", x + 4, y + 4, {
      width: cellW - 8,
      align: "center",
      lineBreak: false
    });
    if (label.subtitle) {
      doc.fontSize(6).fillColor("#555").text(label.subtitle, x + 4, y + 16, {
        width: cellW - 8,
        align: "center",
        lineBreak: false
      });
    }
    const imgW = cellW - 12;
    const imgH = Math.min(cellH - 36, mm(14));
    doc.image(png, x + 6, y + 28, { width: imgW, height: imgH, fit: [imgW, imgH] });
  }

  if (labels.length === 0) {
    doc.fontSize(12).text("No labels", margin, margin);
  }

  doc.end();
  return done;
}
