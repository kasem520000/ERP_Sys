/**
 * PHASE-013 T11 · the four versioned base print templates
 * (PRINTING_AND_EXPORT §1): pure HTML-string generators — the SAME payload
 * renders in the web PrintPreview (iframe srcDoc) and in the server
 * Chromium PDF (ADR-0011: screen preview = paper; no template ever
 * fetches data — data arrives as a typed payload).
 *
 * RTL rules (binding): receipts default RTL; Western digits LTR-isolated
 * (`.num` + tabular-nums — digit order never mirrors); QR/barcode blocks
 * physical; page numbers physical bottom-start (Chromium footer template,
 * set per run locale); logical CSS properties only.
 */

import { printCss as buildPrintCss, PRINT_CSS_VERSION as CSS_VERSION } from "./print-css";

export interface BilingualText {
  readonly ar: string;
  readonly en: string;
}

export interface PrintBranding {
  readonly tenantName: string;
  readonly tenantNameAr?: string;
  readonly logoDataUri?: string;
  readonly addressLine?: string;
  readonly phone?: string;
}

export interface LegalFooter {
  readonly legalName: string;
  readonly vatRegNo?: string;
  readonly notices: readonly string[];
}

export interface A4DocumentPayload {
  readonly template: "a4-document";
  readonly locale: "ar" | "en";
  readonly title: BilingualText;
  readonly docNo: string;
  readonly docDate: string;
  readonly branding: PrintBranding;
  readonly parties: readonly { readonly label: BilingualText; readonly lines: readonly string[] }[];
  readonly columns: readonly { readonly label: BilingualText; readonly numeric?: boolean }[];
  readonly rows: readonly (readonly (string | null)[])[];
  readonly totals: readonly { readonly label: BilingualText; readonly amount: string; readonly isCheck?: boolean }[];
  /** Pre-computed tafqit (amountToWords) — templates never compute. */
  readonly amountInWords?: string;
  readonly legalFooter?: LegalFooter;
}

export interface A4ReportPayload {
  readonly template: "a4-report";
  readonly locale: "ar" | "en";
  readonly title: BilingualText;
  readonly parameterSummary: readonly string[];
  readonly branding: PrintBranding;
  readonly columns: readonly { readonly label: BilingualText; readonly numeric?: boolean }[];
  readonly groups: readonly { readonly key: string; readonly label: BilingualText }[];
  readonly rows: readonly {
    readonly values: readonly (string | null)[];
    readonly groupKey?: string;
    readonly numeric?: boolean;
  }[];
  readonly totals: readonly { readonly label: BilingualText; readonly amount: string; readonly isCheck?: boolean }[];
  readonly assertions: readonly { readonly id: string; readonly status: "PASS" | "FAIL" }[];
  readonly asOf?: string;
  readonly computedAt: string;
}

export interface ReceiptPayload {
  readonly template: "receipt-80" | "receipt-58";
  readonly locale: "ar" | "en";
  readonly merchantName: string;
  readonly merchantVat?: string;
  readonly docNo: string;
  readonly cashier?: string;
  readonly shift?: string;
  readonly terminal?: string;
  readonly items: readonly { readonly name: string; readonly qty: string; readonly price: string; readonly total: string }[];
  readonly totals: readonly { readonly label: string; readonly amount: string }[];
  readonly paymentMethod: string;
  readonly qrPayload?: string;
  readonly offlineNo?: string;
  readonly legalLine?: string;
  readonly condensed?: boolean;
}

export const PRINT_TEMPLATE_VERSIONS: Readonly<Record<string, number>> = Object.freeze({
  "a4-document": 1,
  "a4-report": 1,
  "receipt-80": 1,
  "receipt-58": 1,
});

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function pick(text: BilingualText, locale: "ar" | "en"): string {
  return esc(locale === "ar" ? text.ar : text.en);
}

function htmlDocument(locale: "ar" | "en", title: string, body: string, css: string): string {
  return `<!DOCTYPE html>
<html lang="${locale}" dir="${locale === "ar" ? "rtl" : "ltr"}">
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<style>${css}</style>
</head>
<body>
${body}
</body>
</html>`;
}

/** The Chromium footer template: physical bottom-start page numbers. */
export function pageFooterTemplate(locale: "ar" | "en"): string {
  const label = locale === "ar" ? "صفحة" : "Page";
  return `<div style="font-family: 'IBM Plex Mono', monospace; font-size: 8pt; width: 100%; padding-inline: 14mm; display: flex; justify-content: space-between;">
<span>${label} <span class="pageNumber"></span>/<span class="totalPages"></span></span>
<span style="font-variant-numeric: tabular-nums;"></span>
</div>`;
}

// ---------------------------------------------------------------------------
// a4-document — invoices, notes, statements, vouchers
// ---------------------------------------------------------------------------

export function renderA4Document(payload: A4DocumentPayload): string {
  const locale = payload.locale;
  const parties = payload.parties
    .map(
      (party) => `<div class="party"><h2>${pick(party.label, locale)}</h2>${party.lines
        .map((line) => `<div>${esc(line)}</div>`)
        .join("")}</div>`,
    )
    .join("");
  const head = payload.columns
    .map((column) => `<th${column.numeric ? ' class="numeric"' : ""}>${pick(column.label, locale)}</th>`)
    .join("");
  const body = payload.rows
    .map(
      (row) =>
        `<tr>${row
          .map((cell, index) => `<td${payload.columns[index]?.numeric ? ' class="numeric num"' : ""}>${cell === null ? "" : esc(cell)}</td>`)
          .join("")}</tr>`,
    )
    .join("");
  const totals = payload.totals
    .map(
      (total) =>
        `<tr${total.isCheck ? ' class="check"' : ""}><td>${pick(total.label, locale)}</td><td class="numeric num">${esc(total.amount)}</td></tr>`,
    )
    .join("");
  const legal = payload.legalFooter
    ? `<div class="legal-footer">
<div>${esc(payload.legalFooter.legalName)}</div>
${payload.legalFooter.vatRegNo ? `<div>الرقم الضريبي / VAT No.: <span class="num">${esc(payload.legalFooter.vatRegNo)}</span></div>` : ""}
${payload.legalFooter.notices.map((notice) => `<div>${esc(notice)}</div>`).join("")}
</div>`
    : "";
  const bodyHtml = `
<div class="doc-header">
  ${payload.branding.logoDataUri ? `<img src="${payload.branding.logoDataUri}" alt="" style="max-inline-size: 40mm;">` : ""}
  <div class="title">${pick(payload.title, locale)}</div>
  <div><span class="num">${esc(payload.docNo)}</span> — <span class="num">${esc(payload.docDate)}</span></div>
  <div class="parties">${parties}</div>
</div>
<table>
  <thead><tr>${head}</tr></thead>
  <tbody>${body}</tbody>
</table>
<div class="totals avoid-break">
  <table>${totals}</table>
  ${payload.amountInWords ? `<div style="margin-block-start: 6pt;">${esc(payload.amountInWords)}</div>` : ""}
</div>
${legal}`;
  return htmlDocument(
    locale,
    `${payload.title.en} ${payload.docNo}`,
    bodyHtml,
    buildPrintCss({ size: "A4", margin: "16mm 14mm 18mm 14mm" }),
  );
}

// ---------------------------------------------------------------------------
// a4-report — statement/operational report prints
// ---------------------------------------------------------------------------

export function renderA4Report(payload: A4ReportPayload): string {
  const locale = payload.locale;
  const groupLabels = new Map(payload.groups.map((group) => [group.key, group.label]));
  const head = payload.columns
    .map((column) => `<th${column.numeric ? ' class="numeric"' : ""}>${pick(column.label, locale)}</th>`)
    .join("");
  const bodyRows: string[] = [];
  let lastGroup: string | undefined;
  for (const row of payload.rows) {
    if (row.groupKey !== undefined && row.groupKey !== lastGroup) {
      const label = groupLabels.get(row.groupKey);
      if (label !== undefined) {
        bodyRows.push(`<tr class="group-header"><td colspan="${payload.columns.length}">${pick(label, locale)}</td></tr>`);
      }
      lastGroup = row.groupKey;
    }
    bodyRows.push(
      `<tr>${row.values
        .map(
          (cell, index) =>
            `<td${payload.columns[index]?.numeric ? ' class="numeric num"' : ""}>${cell === null ? "" : esc(cell)}</td>`,
        )
        .join("")}</tr>`,
    );
  }
  const totals = payload.totals
    .map(
      (total) =>
        `<tr${total.isCheck ? ' class="check"' : ""}><td>${pick(total.label, locale)}</td><td class="numeric num">${esc(total.amount)}</td></tr>`,
    )
    .join("");
  const assertions = payload.assertions
    .map(
      (assertion) =>
        `<span class="${assertion.status === "PASS" ? "pass" : "fail"}">${esc(assertion.id)}: ${assertion.status === "PASS" ? "✔" : "✘"}</span>`,
    )
    .join(" &nbsp; ");
  const bodyHtml = `
<div class="doc-header">
  ${payload.branding.logoDataUri ? `<img src="${payload.branding.logoDataUri}" alt="" style="max-inline-size: 40mm;">` : ""}
  <div class="title">${pick(payload.title, locale)}</div>
  <div>${payload.parameterSummary.map((entry) => esc(entry)).join(" · ")}</div>
</div>
<table>
  <thead><tr>${head}</tr></thead>
  <tbody>${bodyRows.join("")}</tbody>
</table>
<div class="totals avoid-break"><table>${totals}</table></div>
<div class="assertions">${assertions}</div>
<div class="freshness">
  ${payload.asOf ? `${locale === "ar" ? "كما في" : "as of"} <span class="num">${esc(payload.asOf)}</span> · ` : ""}${locale === "ar" ? "وقت الاحتساب" : "computed at"} <span class="num">${esc(payload.computedAt)}</span>
</div>`;
  return htmlDocument(
    locale,
    `${payload.title.en}`,
    bodyHtml,
    buildPrintCss({ size: "A4", margin: "16mm 14mm 18mm 14mm" }),
  );
}

// ---------------------------------------------------------------------------
// receipt-80 / receipt-58 — POS roll prints (consumed by PHASE-016)
// ---------------------------------------------------------------------------

export function renderReceipt(payload: ReceiptPayload): string {
  const locale = payload.locale;
  const width = payload.template === "receipt-58" ? "58mm" : "80mm";
  const items = payload.items
    .map(
      (item) =>
        `<div class="row"><span>${esc(item.name)}</span><span class="num">${esc(item.qty)} × ${esc(item.price)} = ${esc(item.total)}</span></div>`,
    )
    .join("");
  const totals = payload.totals
    .map((total) => `<div class="row"><span>${esc(total.label)}</span><span class="num">${esc(total.amount)}</span></div>`)
    .join("");
  const qr = payload.qrPayload
    ? `<div style="text-align: center; margin-block: 2mm; font-size: 8pt;">[QR] ${esc(payload.qrPayload)}</div>`
    : "";
  const offline =
    payload.offlineNo !== undefined
      ? `<div style="text-align: center;">OFF-<span class="num">${esc(payload.offlineNo)}</span> — بانتظار المزامنة / pending sync</div>`
      : "";
  const bodyHtml = `
<div style="text-align: center;">
  <div style="font-weight: 700; font-size: 11pt;">${esc(payload.merchantName)}</div>
  ${payload.merchantVat ? `<div>الرقم الضريبي / VAT: <span class="num">${esc(payload.merchantVat)}</span></div>` : ""}
  <div style="margin-block: 1mm;"><span class="num">${esc(payload.docNo)}</span></div>
  ${payload.cashier ? `<div>${esc(payload.cashier)}${payload.shift ? " · " + esc(payload.shift) : ""}${payload.terminal ? " · " + esc(payload.terminal) : ""}</div>` : ""}
</div>
<div class="items" style="margin-block: 2mm;">${items}</div>
<div style="border-block: 0.5pt dashed #666; margin-block: 1.5mm;"></div>
<div>${totals}</div>
<div style="margin-block-start: 1.5mm;">${esc(payload.paymentMethod)}</div>
${qr}${offline}
${payload.legalLine ? `<div style="text-align: center; margin-block-start: 2mm; font-size: 8pt;">${esc(payload.legalLine)}</div>` : ""}
<div style="text-align: center; margin-block-start: 1mm; font-size: 8pt;">${locale === "ar" ? "شكراً لزيارتكم" : "Thank you"}</div>`;
  return htmlDocument(
    locale,
    payload.docNo,
    `<div class="receipt${payload.condensed ? " receipt-condensed" : ""}">${bodyHtml}</div>`,
    buildPrintCss({ size: `${width} auto`, margin: "3mm 2.5mm" }),
  );
}

export function renderReceipt80(payload: ReceiptPayload): string {
  return renderReceipt({ ...payload, template: "receipt-80" });
}

export function renderReceipt58(payload: ReceiptPayload): string {
  return renderReceipt({ ...payload, template: "receipt-58", condensed: true });
}

export { buildPrintCss as printCss, CSS_VERSION as PRINT_CSS_VERSION };
