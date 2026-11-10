/**
 * PHASE-021 · the webview reprint template's paper palette (PRINTING_AND_
 * EXPORT §2 — the same sanctioned exception as PHASE-013 print-css): the
 * offline console's reprint HTML (apps/web/components/offline/
 * reprint-html.ts) carries its own CMYK-safe receipt palette — ink
 * #111827, rule #d1d5db, marker #9ca3af, secondary #4b5563/#374151 —
 * governed by template versioning, NOT the screen design tokens
 * (DESIGN_TOKENS §17 bans raw values in SCREEN styling only).
 *
 * Field layout parity: @erp/desktop print/escpos.ts ReceiptTemplate (the
 * byte-exact ESC-POS renderer) — store name ar/en · docNo · docDate ·
 * vatRegNo · lines · Net/VAT/Total · footer · the bilingual REPRINT
 * marker. 80/58 mm paper widths (72/50 mm printable per @page margin).
 */

export const REPRINT_CSS_VERSION = 1;

/** The reprint receipt stylesheet (physical mm/pt metrics — the print-CSS
 * exception; logical properties only, the sheet mirrors with `dir`). */
export const REPRINT_CSS = `
    @page { margin: 6mm; }
    body { font-family: "IBM Plex Sans Arabic", system-ui, sans-serif; font-size: 10pt; color: #111827; margin: 0; }
    .doc { width: 72mm; margin-inline: auto; text-align: start; }
    h1 { font-size: 11pt; text-align: center; margin: 0 0 2mm; }
    h1 .en { display: block; font-size: 9pt; }
    p { margin: 0 0 1.5mm; text-align: center; }
    p.mark { border-block: 1px dashed #9ca3af; padding: 1mm 0; margin-block: 2mm; font-weight: 700; }
    table { width: 100%; border-collapse: collapse; margin-block: 2mm; }
    th { font-size: 8pt; text-align: start; border-block: 1px solid #d1d5db; padding-block: 1mm; }
    td { font-size: 9pt; padding-block: 0.75mm; vertical-align: top; }
    td.num, th.num { text-align: end; font-variant-numeric: tabular-nums; direction: ltr; }
    td.nm { max-width: 26mm; }
    td.nm.en { direction: ltr; text-align: end; font-size: 8pt; color: #4b5563; }
    tr.tt td { border-start: 1px solid #d1d5db; font-weight: 700; padding-top: 1.25mm; }
    .foot { text-align: center; margin-top: 3mm; }
    .reg, .dt { font-size: 8.5pt; color: #374151; }
  `;
