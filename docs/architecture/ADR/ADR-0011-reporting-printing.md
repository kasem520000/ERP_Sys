# ADR-0011 — Reporting: Report Contract, HTML→Chromium PDF, exceljs Exports

> **Status:** ACCEPTED · **Date:** 2026-10-27 · **Supersedes:** none

## Context

Reporting must reconcile to authoritative accounting data, support Arabic RTL print
layouts with exact fonts and numerals, export to PDF/XLSX/CSV, work behind permissions,
and remain consistent across financial statements, operational reports, and industry
reports. Directive §11 forbids per-screen duplicated report logic and forbids report
filters from bypassing tenant permissions.

## Decision

1. **Every report implements the Report Contract** ([../../reporting/REPORT_CONTRACT.md](../../reporting/REPORT_CONTRACT.md)):
   stable ID + version, parameter schema, tenant/branch scope rules, required
   permission, currency handling, aggregation rules, drill-down links, localization, and
   declared data sources. The contract is registered in the report catalog
   ([../../reporting/REPORT_CATALOG.md](../../reporting/REPORT_CATALOG.md)).
2. **Execution**: reports run as read-only queries through authorized query services
   inside the module that owns the data — never raw cross-module SQL, never bypassing
   tenant scoping. Heavy renders run as pg-boss jobs (ADR-0008).
3. **PDF rendering**: HTML templates (the same design-system print CSS used by the web
   app) rendered headless via **Chromium (Playwright)** server-side. This is the only
   technology that reliably reproduces Arabic shaping, RTL mirroring, page headers /
   footers / numbering, and numerals identically to the browser preview.
4. **Spreadsheet export**: **exceljs** (XLSX with RTL sheet views, styled headers,
   formulas avoided — values only for auditability). CSV is generated directly with
   BOM for Excel Arabic compatibility.
5. **Print templates** are versioned artifacts (A4 document, A4 report, 80mm receipt,
   58mm receipt) shared by web print and server PDF.

## Alternatives considered

| Alternative | Why not |
|-------------|---------|
| react-pdf / @react-pdf/renderer | Good quality but font/shaping story for complex Arabic is weaker; layout parity with web preview is lost. |
| JasperReports / server Java | New runtime + language; violates monorepo language decision. |
| Browser "print to PDF" only | No server-side scheduled/email exports; inconsistent output across user machines. Kept as a UX path, not the engine. |
| SheetJS CE | Weaker styling/RTL support than exceljs. |

## Consequences

- Playwright/Chromium becomes a server dependency (bundled in the worker image; ~300MB).
  Acceptable for report volume; isolated to worker processes; documented in
  [../DEPLOYMENT_ARCHITECTURE.md](../DEPLOYMENT_ARCHITECTURE.md).
- Report rendering capacity is bounded by worker concurrency; job queue smooths spikes.
- Financial statements derive exclusively from posted journal data + documented rules
  ([../../reporting/FINANCIAL_REPORT_RULES.md](../../reporting/FINANCIAL_REPORT_RULES.md)),
  each with reconciliation checks ([../../reporting/REPORT_RECONCILIATION.md](../../reporting/REPORT_RECONCILIATION.md)).

## Revisit triggers

- If PDF volume makes Chromium pool maintenance painful, evaluate a dedicated render
  service — the Report Contract isolates the change.
