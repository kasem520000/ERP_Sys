/**
 * PHASE-048 (W-13 — T-16) — the three bilingual CONTRACTING print
 * templates (the plan §3 W-13 / D-14; PRINTING_AND_EXPORT's §1
 * discipline, the PHASE-013 base set's own laws):
 *
 * - `a4-progress-certificate` — the progress certificate (المستخلص):
 *   the certificate's own figures + the BR-093 ceiling context + the
 *   certificate history table + the signature blocks.
 * - `a4-sub-certificate` — the subcontractor certificate (مستخلص الباطن):
 *   the sub certificate's figures + the agreement's context + the sub
 *   history table + the signatures.
 * - `a4-retention-statement` — the retention statement (كشف المحتجيات):
 *   the ledger rows verbatim (NO client-side totals — the register's own
 *   figures are the statement's figures; zero parallel computation).
 *
 * THE LAWS (binding, the owner's W-13 clauses 1–3):
 *
 * - **PURE HTML-STRING GENERATORS** — no data fetching, no clock reads,
 *   NO WALL-CLOCK ANYWHERE: every date (docDate/asOf) is a payload
 *   PARAMETER the caller passes from engine data; two renders of the
 *   same payload are byte-identical (the golden determinism law).
 * - **EVERY NUMBER IS A PAYLOAD STRING** — the caller's engine outputs
 *   verbatim; the template never computes, rounds, or reformats a
 *   number (zero parallel computation in the print — stricter than the
 *   one-rounding-at-display allowance).
 * - **BILINGUAL LABELS RIDE THE PAYLOAD** (`BilingualText`): the
 *   production callers build every label from the app i18n dictionary
 *   EXCLUSIVELY (D-14 — the declared delta lands in the dictionary, not
 *   here; the template package stays app-agnostic).
 * - **RTL correctness in both directions** (RTL_DESIGN_RULES): the html
 *   dir follows the locale; logical CSS properties only; Western digits
 *   LTR-isolated (`.num` + tabular-nums — digit order never mirrors).
 * - **Page-break discipline for long tables**: a real `<thead>`
 *   (Chromium repeats it per page), rows atomic (`break-inside:
 *   avoid`), the totals/signature blocks never split (`.avoid-break`).
 */

import { printCss as buildPrintCss } from "./print-css";
import { esc, htmlDocument, pick } from "./templates";
import type { BilingualText, LegalFooter, PrintBranding } from "./templates";

/** A label/value figure row (the engine's own string, verbatim). */
export interface CertificateFigure {
  readonly label: BilingualText;
  readonly value: string;
  /** Mono LTR isolation (codes/decimals/dates — the bidi law). */
  readonly mono?: boolean;
}

/** A signature block (the print convention: the label + a signing line). */
export interface CertificateSignature {
  readonly label: BilingualText;
}

/** The two certificate layouts' shared payload shape (the sub and the
 * progress certificate differ in content, never in layout law). */
export interface CertificatePrintPayload {
  readonly template: "a4-progress-certificate" | "a4-sub-certificate";
  readonly locale: "ar" | "en";
  readonly title: BilingualText;
  readonly docNo: string;
  readonly docDate: string;
  readonly branding: PrintBranding;
  readonly parties: readonly { readonly label: BilingualText; readonly lines: readonly string[] }[];
  readonly figures: readonly CertificateFigure[];
  readonly columns: readonly { readonly label: BilingualText; readonly numeric?: boolean }[];
  readonly rows: readonly (readonly (string | null)[])[];
  readonly totals: readonly { readonly label: BilingualText; readonly amount: string; readonly isCheck?: boolean }[];
  readonly signatures: readonly CertificateSignature[];
  readonly note?: BilingualText;
  readonly legalFooter?: LegalFooter;
}

/** The retention statement's payload (the ledger rows verbatim — NO
 * computed totals; the register's own figures are the statement's). */
export interface RetentionStatementPrintPayload {
  readonly template: "a4-retention-statement";
  readonly locale: "ar" | "en";
  readonly title: BilingualText;
  /** The statement's as-of PARAMETER (the caller passes engine data —
   * never a template-side clock read). */
  readonly asOf: string;
  readonly branding: PrintBranding;
  readonly parties: readonly { readonly label: BilingualText; readonly lines: readonly string[] }[];
  readonly figures: readonly CertificateFigure[];
  readonly columns: readonly { readonly label: BilingualText; readonly numeric?: boolean }[];
  readonly rows: readonly (readonly (string | null)[])[];
  readonly signatures: readonly CertificateSignature[];
  readonly note?: BilingualText;
  readonly legalFooter?: LegalFooter;
}

// -- the shared certificate layout (progress + sub) --------------------------

function figuresGrid(payload: {
  locale: "ar" | "en";
  figures: readonly CertificateFigure[];
}): string {
  if (payload.figures.length === 0) return "";
  const cells = payload.figures
    .map(
      (figure) =>
        `<div class="figure"><div class="figure-label">${pick(figure.label, payload.locale)}</div>` +
        `<div class="figure-value${figure.mono === false ? "" : " num"}">${esc(figure.value)}</div></div>`,
    )
    .join("");
  return `<div class="figures avoid-break">${cells}</div>`;
}

function signatureRow(payload: { locale: "ar" | "en"; signatures: readonly CertificateSignature[] }): string {
  if (payload.signatures.length === 0) return "";
  const blocks = payload.signatures
    .map(
      (signature) =>
        `<div class="signature"><div class="signature-label">${pick(signature.label, payload.locale)}</div>` +
        `<div class="signature-line"></div></div>`,
    )
    .join("");
  return `<div class="signatures avoid-break">${blocks}</div>`;
}

function certificateBody(payload: CertificatePrintPayload): string {
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
          .map(
            (cell, index) =>
              `<td${payload.columns[index]?.numeric ? ' class="numeric num"' : ""}>${cell === null ? "" : esc(cell)}</td>`,
          )
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
    ? `<div class="legal-footer"><div>${esc(payload.legalFooter.legalName)}</div>${payload.legalFooter.notices
        .map((notice) => `<div>${esc(notice)}</div>`)
        .join("")}</div>`
    : "";
  return `
<div class="doc-header">
  ${payload.branding.logoDataUri ? `<img src="${payload.branding.logoDataUri}" alt="" style="max-inline-size: 40mm;">` : ""}
  <div class="branding-name">${esc(payload.branding.tenantName)}</div>
  <div class="title">${pick(payload.title, locale)}</div>
  <div><span class="num">${esc(payload.docNo)}</span> — <span class="num">${esc(payload.docDate)}</span></div>
  <div class="parties">${parties}</div>
</div>
${figuresGrid(payload)}
<table>
  <thead><tr>${head}</tr></thead>
  <tbody>${body}</tbody>
</table>
<div class="totals avoid-break"><table>${totals}</table></div>
${payload.note ? `<div class="print-note">${pick(payload.note, locale)}</div>` : ""}
${signatureRow(payload)}
${legal}`;
}

// -- the retention statement layout ------------------------------------------

function statementBody(payload: RetentionStatementPrintPayload): string {
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
          .map(
            (cell, index) =>
              `<td${payload.columns[index]?.numeric ? ' class="numeric num"' : ""}>${cell === null ? "" : esc(cell)}</td>`,
          )
          .join("")}</tr>`,
    )
    .join("");
  const asOfLabel: BilingualText = { ar: "كما في", en: "As of" };
  const legal = payload.legalFooter
    ? `<div class="legal-footer"><div>${esc(payload.legalFooter.legalName)}</div>${payload.legalFooter.notices
        .map((notice) => `<div>${esc(notice)}</div>`)
        .join("")}</div>`
    : "";
  return `
<div class="doc-header">
  ${payload.branding.logoDataUri ? `<img src="${payload.branding.logoDataUri}" alt="" style="max-inline-size: 40mm;">` : ""}
  <div class="branding-name">${esc(payload.branding.tenantName)}</div>
  <div class="title">${pick(payload.title, locale)}</div>
  <div>${pick(asOfLabel, locale)} <span class="num">${esc(payload.asOf)}</span></div>
  <div class="parties">${parties}</div>
</div>
${figuresGrid(payload)}
<table>
  <thead><tr>${head}</tr></thead>
  <tbody>${body}</tbody>
</table>
${payload.note ? `<div class="print-note">${pick(payload.note, locale)}</div>` : ""}
${signatureRow(payload)}
${legal}`;
}

// -- the template CSS (the certificate statement's own additions) ------------

function certificatePrintCss(): string {
  return `
.figures { display: flex; flex-wrap: wrap; gap: 6pt 18pt; margin-block: 8pt; padding: 6pt; border: 0.5pt solid #d9d9d9; border-radius: 3pt; }
.figure { min-inline-size: 30%; }
.figure-label { font-size: 8.5pt; color: #444; }
.figure-value { font-size: 11pt; font-weight: 600; }
.branding-name { font-size: 12pt; font-weight: 700; }
.print-note { margin-block-start: 10pt; font-size: 8.5pt; color: #555; }
.signatures { display: flex; gap: 12pt; margin-block-start: 22pt; }
.signature { flex: 1; }
.signature-label { font-size: 9pt; color: #333; margin-block-end: 26pt; }
.signature-line { border-block-start: 0.75pt solid #1a1a1a; block-size: 0; }
`;
}

// -- the three public renderers (pure) ---------------------------------------

/** The progress certificate (المستخلص) — the layout laws above. */
export function renderProgressCertificate(payload: CertificatePrintPayload): string {
  const body = certificateBody({ ...payload, template: "a4-progress-certificate" });
  return htmlDocument(
    payload.locale,
    `${payload.title.en} ${payload.docNo}`,
    body,
    buildPrintCss({ size: "A4", margin: "16mm 14mm 18mm 14mm" }) + certificatePrintCss(),
  );
}

/** The subcontractor certificate (مستخلص الباطن) — the same layout law. */
export function renderSubcontractorCertificate(payload: CertificatePrintPayload): string {
  const body = certificateBody({ ...payload, template: "a4-sub-certificate" });
  return htmlDocument(
    payload.locale,
    `${payload.title.en} ${payload.docNo}`,
    body,
    buildPrintCss({ size: "A4", margin: "16mm 14mm 18mm 14mm" }) + certificatePrintCss(),
  );
}

/** The retention statement (كشف المحتجيات) — the ledger rows verbatim. */
export function renderRetentionStatement(payload: RetentionStatementPrintPayload): string {
  const body = statementBody(payload);
  return htmlDocument(
    payload.locale,
    `${payload.title.en}`,
    body,
    buildPrintCss({ size: "A4", margin: "16mm 14mm 18mm 14mm" }) + certificatePrintCss(),
  );
}
