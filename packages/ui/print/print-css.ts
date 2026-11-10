/**
 * PHASE-013 · shared print stylesheet (PRINTING_AND_EXPORT §2):
 * physical page metrics via @page, real <thead> repetition (Chromium
 * repeats it per page), page-break rules (break-inside: avoid on totals
 * blocks and document header; rows atomic; widows/orphans ≥ 2),
 * tabular-nums on money cells, embedded woff2 fonts (no system fonts),
 * and the bottom-start page-number furniture via the Chromium footer
 * template (a sanctioned physical-CSS exception — RTL_DESIGN_RULES §9).
 *
 * Logical properties only (erp-ui/no-physical-direction): the sheet
 * mirrors with `dir` — no left/right properties anywhere.
 */

import { EMBEDDED_FONTS } from "./fonts";

export const PRINT_CSS_VERSION = 1;

function fontFace(key: string): string {
  const font = EMBEDDED_FONTS[key]!;
  return `@font-face {
  font-family: "${font.family}";
  font-style: normal;
  font-weight: ${font.weight};
  font-display: block;
  src: url(data:font/woff2;base64,${font.data}) format("woff2");
  unicode-range: ${font.subset === "arabic" ? "U+0600-06FF, U+200C-200E, U+2010-2011, U+204F, U+FB50-FDFF, U+FE70-FEFF" : "U+0000-00FF, U+0131, U+0152-0153, U+2000-206F"};
}`;
}

export function printCss(page: { size: string; margin: string }): string {
  const faces = Object.keys(EMBEDDED_FONTS).map(fontFace).join("\n");
  return `${faces}

@page { size: ${page.size}; margin: ${page.margin}; }

* { box-sizing: border-box; margin: 0; padding: 0; }

html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }

body {
  font-family: "IBM Plex Sans Arabic", "Inter", sans-serif;
  font-size: 10.5pt;
  line-height: 1.45;
  color: #1a1a1a;
  background: #ffffff;
}

.mono { font-family: "IBM Plex Mono", monospace; }
.num { font-variant-numeric: tabular-nums; font-family: "IBM Plex Mono", monospace; }

h1 { font-size: 15pt; font-weight: 700; }
h2 { font-size: 12pt; font-weight: 600; }

table { width: 100%; border-collapse: collapse; }
thead { display: table-header-group; }
th, td { padding: 4pt 6pt; text-align: start; vertical-align: top; }
th { font-weight: 600; background: #f3f3f3; border-block-end: 0.75pt solid #cfcfcf; }
td { border-block-end: 0.5pt solid #e4e4e4; }
tr { break-inside: avoid; }
tbody tr:last-child td { border-block-end: none; }

thead th.numeric, td.numeric { text-align: end; }

.avoid-break { break-inside: avoid; }
.group-header { break-after: avoid; font-weight: 600; padding-block: 6pt 2pt; }

.totals { break-inside: avoid; margin-block-start: 8pt; }
.totals table { max-inline-size: 60%; margin-inline-start: auto; }
.totals td { border: none; padding: 2pt 6pt; }
.totals .check td { font-weight: 700; }

.doc-header { break-inside: avoid; margin-block-end: 10pt; }
.doc-header .title { font-size: 16pt; font-weight: 700; }
.parties { display: flex; gap: 12pt; margin-block: 8pt; }
.parties .party { flex: 1; }

.legal-footer {
  margin-block-start: 14pt;
  padding-block-start: 6pt;
  border-block-start: 0.75pt solid #cfcfcf;
  font-size: 8.5pt;
  color: #444;
}

.assertions { margin-block-start: 8pt; font-size: 9pt; }
.assertions .pass { color: #0a6e2d; }
.assertions .fail { color: #b3261e; font-weight: 700; }

.freshness { font-size: 8.5pt; color: #555; margin-block-start: 4pt; }

.negative { color: #b3261e; }

.receipt { font-family: "IBM Plex Mono", "IBM Plex Sans Arabic", monospace; }
.receipt .row { display: flex; justify-content: space-between; gap: 4mm; padding-block: 1mm; }
.receipt .items .row { border-block-end: 0.25pt dashed #999; }
.receipt-condensed .row { padding-block: 0.6mm; font-size: 8.5pt; }
`;
}
