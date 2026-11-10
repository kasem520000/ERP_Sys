# Printing and Export

> **Status:** STABLE · **Owner:** Reporting Architecture · **Updated:** 2026-10-27

The print and export system implementing [ADR-0011](../architecture/ADR/ADR-0011-reporting-printing.md):
**4 versioned base templates** rendered as HTML/CSS and printed to PDF via headless
**Chromium (Playwright)** — the only engine that reproduces Arabic shaping, RTL mirroring,
numerals, and page furniture identically to the web preview. XLSX via **exceljs**
(RTL sheet views, values only); CSV with BOM. Exports always render from a stored report
run / document snapshot — you print what you saw
([REPORTING_ARCHITECTURE.md](REPORTING_ARCHITECTURE.md) §6.5).

## 1. The four base templates

| Template id | Paper | Used for | Key elements |
|-------------|-------|----------|--------------|
| `a4-document` | A4 210×297mm | Sales/supplier invoices, credit/debit notes, statements, receipts/payments vouchers | Tenant logo (top-start), bilingual document title (فاتورة ضريبية / Tax Invoice), parties block, line table, totals block **with amount-in-words line (tafqit / تفقيط)**, **bilingual legal footer** (tenant legal name, VAT reg no., jurisdiction-required notices from the jurisdiction pack), page numbers |
| `a4-report` | A4 210×297mm | All statement/operational report prints | Report title (AR/EN), parameter summary, group tree, result table, totals row with assertion status, footer with asOf + computedAt + page numbers |
| `receipt-80` | 80mm roll (variable length) | POS receipts (PHASE-016) | Logo/merchant block, cashier+shift+terminal, line items, totals, payment method, QR (e-invoice slot), bilingual thank-you/legal line |
| `receipt-58` | 58mm roll | Small-printer retail/food POS | Same as 80 minus optional blocks; single-line item mode (name × qty = total) |

Template rules: each template is a **versioned artifact** (`print_templates` + package
files in `packages/ui/print`); the version used is stamped on every generated PDF and on
`report_runs`; multi-page tables repeat headers; no template ever fetches data — data
arrives as a typed payload ([REPORT_CONTRACT.md](REPORT_CONTRACT.md) §2).

### RTL-correct receipt layout rules (binding)

- Receipts default to RTL Arabic layout: merchant name/logo top, Arabic labels primary
  (الإجمالي، الضريبة، المدفوع، المتبقي), Latin secondary line where required.
- The line-items table is RTL: item name column at start edge, qty × price × total with
  **Western digits, LTR-isolated numerals** ([../ui/RTL_DESIGN_RULES.md](../ui/RTL_DESIGN_RULES.md)
  §8) — digit order never mirrors.
- QR/barcode blocks render physically (never mirrored, never rotated); QR payload slot
  follows jurisdiction pack requirements (ZATCA PHASE-023).
- 58mm mode uses condensed line height (mono digits, 3.0mm gaps minimum for tear
  readability); "offline" receipts print the `OFF-…` number in the same slot as the
  official number, with "بانتظار المزامنة / pending sync" line
  ([../accounting/DOCUMENT_LIFECYCLE.md](../accounting/DOCUMENT_LIFECYCLE.md) §4).

## 2. HTML/CSS print stylesheet rules

- Physical page metrics via `@page` (e.g., `@page { size: A4; margin: 16mm 14mm 18mm 14mm }`;
  receipts `size: 80mm auto`), with a footer margin reserving page numbers.
- **Repeated table headers**: tables use real `<thead>` + `th` (Chromium repeats it per
  page) — never visual-only header rows.
- **Page numbering position is physical bottom-start of the paper** (bottom-right for
  Arabic/RTL documents, bottom-left for LTR) — a sanctioned physical-CSS exception
  ([../ui/RTL_DESIGN_RULES.md](../ui/RTL_DESIGN_RULES.md) §9); the template sets it from
  the run locale.
- Page-break rules: `break-inside: avoid` on totals blocks and document header;
  `break-after: avoid` on group headers; long statement lines never straddle pages
  (rows atomic). Widows/orphans ≥ 2 lines.
- Fonts: the same self-hosted woff2 set as web ([../ui/DESIGN_TOKENS.md](../ui/DESIGN_TOKENS.md)
  §6), embedded in the render bundle — no system fonts in PDFs; `font-variant-numeric:
  tabular-nums` on all money cells; numerals western at MVP.
- Colors: CMYK-safe approximations — money-critical semantics (negative red) kept;
  print-only styles neutralize shadows/elevations.
- Bilingual legal footers come from the jurisdiction pack
  ([../localization/TAX_ENGINE.md](../localization/TAX_ENGINE.md)) — templates render,
  packs decide content.
- **Amount-in-words (tafqit, adopted from Folder 1, consolidation 2026-10-28):** every
  `a4-document` financial print renders the document total in words in the document
  language(s) — Arabic tafqit for AR/AR+EN documents, English words for EN — produced by
  a shared `amountToWords(amount, currencyCode, locale)` helper. The helper is
  **verified per locale and per currency minor-unit** (including 3-decimal currencies
  KWD/BHD/OMR/JOD/IQD) with fixture tests as part of PHASE-013; no print template may
  format amount-in-words with ad-hoc string logic.

## 3. Chromium render service contract

| Aspect | Contract |
|--------|----------|
| Input | `{ html, assets: { fonts, images, css }, options: { format, pdfA?: 'pdfa-2b', locale, dir, headerTemplate?, footerTemplate? } }` |
| Output | `PDF` binary + `{ pages, renderMs, templateVersion }`; stored via the `files` module |
| Environment | Worker image bundles pinned Chromium (same version as the visual suite, [../ui/VISUAL_TESTING.md](../ui/VISUAL_TESTING.md) §6); isolated worker processes; pool concurrency bounded ([../architecture/DEPLOYMENT_ARCHITECTURE.md](../architecture/DEPLOYMENT_ARCHITECTURE.md)) |
| Fidelity | Screen preview and server PDF render the **same HTML payload** — browser "print to PDF" remains a UX convenience only, never the engine |
| Hard rules | No user-supplied HTML (payloads are generated from typed data); no network fetch inside render (assets bundled); render timeout 60s (heavy pack: 300s via pg-boss) |
| Archive class | Period-close packs and jurisdiction-required artifacts render as **PDF/A-2b**; ordinary document PDFs are standard PDF 1.7 |

## 4. XLSX export rules (exceljs)

1. **RTL sheet views**: when the run locale is Arabic, worksheets get
   `views: [{ rightToLeft: true }]` — column A appears on the right; sheets are
   per-report single-tab (grouped contracts may add per-group tabs, named bilingually).
2. **Column types**: text columns are `string`; money/qty columns are **numbers with
   number formats** (`#,##0.00` base-minor-units default; qty `#,##0.000`); dates are
   real dates with ISO display format; identifiers (doc numbers, IBANs, tax numbers)
   are **text** (leading zeros preserved — never numeric-coerced).
3. **Values only — no formulas** (ADR-0011): every cell is a computed value from the
   result envelope; totals rows are marked values. Auditability means the workbook is
   evidence, not a spreadsheet program.
4. Header styling: bold, filled gray-100, frozen top row, auto-filter on data tables,
   column widths from `widthHint`; bilingual title rows (AR line + EN line) above the
   header when locale is Arabic.
5. Footer block: asOf/computedAt/params summary + assertion status rows — a printed
  workbook must be self-describing.

## 5. CSV rules

- Encoding UTF-8 **with BOM** (Excel Arabic compatibility — mandatory, ADR-0011).
- Dates as ISO-8601 (`2026-10-27`); datetimes with offset.
- Numbers as **decimal strings with `.` separator** preserving declared precision
  (no thousands separators — round-trip safe); negative with leading `-`.
- Header row in the run locale (bilingual header only when explicitly requested —
  doubles columns otherwise); CRLF line endings; quoting per RFC 4180.
- No styling, no merged cells, no formulas — CSV is the interoperability floor.

## 6. Storage, delivery & audit of artifacts

- Artifacts are stored through the **`files` module** (object storage adapter,
  [../architecture/MODULE_BOUNDARIES.md](../architecture/MODULE_BOUNDARIES.md)) with
  metadata: run/document id, template + version, locale, sha256, content-type, size.
- Downloads use **short-lived signed URLs** (default 15 minutes); every download writes
  an audit event (user, artifact, run correlation id) — generated financial papers are
  auditable outputs.
- **Retention:** document PDFs (invoices, statements) live with the document (≥ document
  retention, default tenant lifetime + jurisdiction minimum); report artifacts default
  30 days with tenant-configurable extension; period-close **PDF/A packs are permanent**
  (retention "forever" flag). Cleanup is a pg-boss job honoring legal holds.
- Reprint/re-render rules: re-rendering an existing run replaces artifacts under the
  same run id (idempotent by `(report_id, params_hash)`); documents posted before a
  template version change may re-print under the **posting-time template version** when
  the jurisdiction pack requires it, else current — configured per pack, default
  current ([REPORTING_ARCHITECTURE.md](REPORTING_ARCHITECTURE.md) §8).

## 7. Scheduled & email delivery (post-MVP, documented seam)

MVP ships on-demand runs + manual export. The seam for later phases: a pg-boss schedule
row (cron + contract + params + recipients) that renders exports and delivers via the
`notifications` module email adapter with signed URLs (never attachments of unrestricted
size). The report contract already carries everything a schedule needs (scope, formats,
locale) — no schema change anticipated; delivery tracking lands with
[PHASE-019](../planning/MASTER_ROADMAP.md)/GA hardening, gated on notification
preferences ([../architecture/MODULE_BOUNDARIES.md](../architecture/MODULE_BOUNDARIES.md)).

## 8. Export integrity rules (binding)

1. **No export of an assertion-failed financial result** — the block is server-side, not
   a hidden button ([REPORT_RECONCILIATION.md](REPORT_RECONCILIATION.md) §1).
2. Every exported artifact embeds: tenant name, report/document id, asOf/computedAt,
   template version, page count (PDF footer/XLSX footer block) — an artifact must state
   what it is without its database row.
3. Exports are read-only evidence: they reflect the stored run envelope exactly,
   including zero-suppression settings (suppression state is recorded in paramsEcho).
4. Money in exports uses the same rounding as the on-screen result (§
   [FINANCIAL_REPORT_RULES.md](FINANCIAL_REPORT_RULES.md) §8) — screen, PDF, XLSX, CSV
   cannot disagree.
