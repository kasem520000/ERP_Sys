"use client";
/**
 * PHASE-021 T2-b · the webview's reprint path (OFFLINE_CAPABILITIES_MATRIX
 * row 32; MASTER-PLAN §6 "Reprint: cached POSTED sales invoices … Never
 * re-numbers"):
 *
 * The byte-exact ESC-POS renderer lives in @erp/desktop/print/escpos.ts,
 * which app code may NOT import (the desktop-no-web boundary). This
 * module is the webview's HONEST equivalent: the same FIELD LAYOUT as
 * print/escpos.ts's ReceiptTemplate (storeName ar/en · docNo · docDate ·
 * vatRegNo · lines (name ar/en, qty, unitPrice, lineTotal) · totals
 * Net/VAT/Total · footer · the bilingual REPRINT marker + timestamp),
 * rendered as printable HTML. The shell routes it through
 * bridge.print.printHtml; a browser falls back to window.print of the
 * SAME template (MASTER-PLAN §6). The CACHED doc_no is used VERBATIM —
 * a reprint never re-numbers (INV-021), and the defensive payload parse
 * degrades to column-level totals exactly like the desktop module.
 */
import type { CachedInvoice } from "../../lib/shell/store-client";
// The paper palette lives in the sanctioned print layer (PRINTING_AND_EXPORT
// §2 — screen tokens don't govern print CSS; same exception as PHASE-013).
import { REPRINT_CSS } from "@erp/ui/print";

interface CachedLine {
  nameAr?: unknown;
  name?: unknown;
  qty?: unknown;
  unitPrice?: unknown;
  lineTotal?: unknown;
}

interface CachedInvoicePayload {
  storeName?: { ar?: unknown; en?: unknown };
  vatRegNo?: unknown;
  subtotal?: unknown;
  lines?: unknown;
}

function asDecimalString(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function parsePayload(raw: string): CachedInvoicePayload {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as CachedInvoicePayload;
    }
    return {};
  } catch {
    return {}; // defensive: a corrupt cached payload must not break reprint
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;");
}

const cell = (value: string | undefined, fallback: string): string =>
  escapeHtml(value !== undefined && value.length > 0 ? value : fallback);

/**
 * Build the printable bilingual receipt HTML from a cached POSTED invoice.
 * The doc_no prints VERBATIM exactly once; the only addition is the
 * REPRINT marker line carrying the print timestamp.
 */
export function buildReprintHtml(invoice: CachedInvoice, printedAt: string): string {
  const payload = parsePayload(invoice.payload);
  const storeAr = cell(
    typeof payload.storeName?.ar === "string" ? payload.storeName.ar : undefined,
    "المتجر",
  );
  const storeEn = cell(
    typeof payload.storeName?.en === "string" ? payload.storeName.en : undefined,
    "Store",
  );
  const lines: CachedLine[] = Array.isArray(payload.lines) ? (payload.lines as CachedLine[]) : [];
  const rows = lines
    .map((line) => {
      const nameAr = cell(typeof line.nameAr === "string" ? line.nameAr : undefined, "");
      const nameEn = cell(typeof line.name === "string" ? line.name : undefined, "");
      const qty = escapeHtml(asDecimalString(line.qty) ?? "1");
      const unitPrice = escapeHtml(asDecimalString(line.unitPrice) ?? "0.00");
      const lineTotal = escapeHtml(asDecimalString(line.lineTotal) ?? "0.00");
      return `<tr><td class="nm">${nameAr || nameEn}</td><td class="nm en">${nameEn || nameAr}</td><td class="num">${qty}</td><td class="num">${unitPrice}</td><td class="num">${lineTotal}</td></tr>`;
    })
    .join("");

  const totals: { ar: string; en: string; amount: string }[] = [];
  const subtotal = asDecimalString(payload.subtotal);
  if (subtotal !== undefined) {
    totals.push({ ar: "الإجمالي قبل الضريبة", en: "Net", amount: escapeHtml(subtotal) });
  }
  if (invoice.totalTax !== null) {
    totals.push({ ar: "الضريبة", en: "VAT", amount: escapeHtml(invoice.totalTax) });
  }
  if (invoice.totalGross !== null) {
    totals.push({ ar: "الإجمالي", en: "Total", amount: escapeHtml(invoice.totalGross) });
  }
  const totalRows = totals
    .map(
      (total) =>
        `<tr class="tt"><td colspan="2">${escapeHtml(total.ar)} / ${escapeHtml(total.en)}</td><td class="num" colspan="3">${total.amount}</td></tr>`,
    )
    .join("");

  const vatRegNo =
    typeof payload.vatRegNo === "string" && payload.vatRegNo.length > 0
      ? `<p class="reg">الرقم الضريبي / VAT: ${escapeHtml(payload.vatRegNo)}</p>`
      : "";
  const docDate = invoice.issueDate !== null ? `<p class="dt">${escapeHtml(invoice.issueDate)}</p>` : "";

  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>REPRINT</title><style>${REPRINT_CSS}</style></head><body><div class="doc">
    <h1>${storeAr}<span class="en">${storeEn}</span></h1>
    <p class="mark">*** إعادة طباعة / REPRINT · ${escapeHtml(printedAt)} ***</p>
    <p class="dt"><span class="lbl">رقم المستند / Doc:</span> <b dir="ltr">${escapeHtml(invoice.docNo ?? "")}</b></p>
    ${docDate}
    ${vatRegNo}
    <table>
      <thead><tr><th>الصنف / Item</th><th class="num"></th><th class="num">كمية / Qty</th><th class="num">سعر / Price</th><th class="num">إجمالي / Total</th></tr></thead>
      <tbody>${rows}${totalRows}</tbody>
    </table>
    <p class="foot">شكراً لزيارتكم / Thank you</p>
  </div></body></html>`;
}
