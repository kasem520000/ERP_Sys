# REPORTING_AND_DOCUMENT_ENGINE — Reports, Printing, and Document Generation

> **Status:** STABLE · **Owner:** Reporting Architecture · **Updated:** 2026-10-28 (consolidation pass)
> **Authority:** Consolidates reporting rules. Normative detail remains in
> [REPORTING_ARCHITECTURE.md](REPORTING_ARCHITECTURE.md), [REPORT_CONTRACT.md](REPORT_CONTRACT.md),
> [REPORT_CATALOG.md](REPORT_CATALOG.md), [FINANCIAL_REPORT_RULES.md](FINANCIAL_REPORT_RULES.md),
> [REPORT_RECONCILIATION.md](REPORT_RECONCILIATION.md), [PRINTING_AND_EXPORT.md](PRINTING_AND_EXPORT.md).
> ADR: [../architecture/ADR/ADR-0011-reporting-printing.md](../architecture/ADR/ADR-0011-reporting-printing.md).

## 1. The report contract (executable, versioned)

Every report is a schema-validated contract: parameters, permissions, scope (tenant/branch
injected from context — never from report params), aggregation, drill-down, exports,
localization, freshness (`dataAsOf`), and **assertions** — executable self-checks whose
failure blocks output ([REPORT_CONTRACT.md](REPORT_CONTRACT.md) §1–5). Versioning: any
contract change bumps the report version; consumers pin versions.

## 2. Reconciliation (trust model)

1. **Built-in cross-checks vs GL:** every subledger report carries a ledger-tie assertion
   (AR/AP aging ↔ `AR_CONTROL`/`AP_CONTROL`, inventory valuation ↔ `INVENTORY`,
   tax summaries ↔ `VAT_*` purposes) — tolerance 0
   ([REPORT_RECONCILIATION.md](REPORT_RECONCILIATION.md) §1–2).
2. **Golden datasets in CI:** expected values are computed by an **independent code path
   (direct SQL), not the report's own query** — catches "consistent-with-itself but wrong"
   reports (test method adopted from Folder 4).
3. **As-of determinism:** a report rerun at the same `dataAsOf` with the same posted data
   is byte-identical — tested property (§4).
4. **Production drift = SEV-1:** scheduled reconciliation jobs that report ledger-vs-subledger
   drift trigger the incident ladder automatically
   ([../security/INCIDENT_RESPONSE.md](../security/INCIDENT_RESPONSE.md) §1).

## 3. Financial statements

TB (asserts ΣDr=ΣCr), Balance Sheet (asserts A=L+E with binding retained-earnings
composition), Income Statement, indirect-method Cash Flow (with its displayed limitation
note), per [FINANCIAL_REPORT_RULES.md](FINANCIAL_REPORT_RULES.md). Statements read
**posted data only**; unposted documents never appear; contra-account handling and
as-of logic are specified there.

## 4. Report catalog

~49 reports across financial / AR-AP / sales / purchasing / inventory / treasury / tax /
platform with parameters, permissions, sources, and phase matrix:
[REPORT_CATALOG.md](REPORT_CATALOG.md). Industry report packs are pinned inside template
manifests ([../industries/reports/README.md](../industries/reports/README.md)).

## 5. Printing and document generation

| Artifact | Engine | Rules |
|----------|--------|-------|
| PDF (all prints) | Server HTML/CSS → **headless Chromium** (the only engine that reproduces Arabic shaping reliably) | 4 base templates: `a4-document`, `a4-report`, `receipt-80`, `receipt-58` ([PRINTING_AND_EXPORT.md](PRINTING_AND_EXPORT.md) §1) |
| Financial documents | `a4-document` | Bilingual titles, legal footers from jurisdiction pack, **amount-in-words (tafqit)** — adopted from Folder 1 — QR slot for e-invoice packs, page X/Y |
| POS receipts | `receipt-80/58` | Cashier/shift/terminal, payment method, QR slot, bilingual legal line |
| XLSX | exceljs | Typed cells, real dates, RTL sheet views, values-only (no formulas as data) |
| CSV | UTF-8 with BOM | Excel-AR compatibility |
| Long exports | pg-boss jobs | >50k rows → tenant-scoped job + signed-URL delivery, audited |

Print artifacts are stored, signed-URL-delivered, and every download is audited;
retention honors legal holds; PDF/A-2b for period-close packs.

## 6. Permissions and tenancy

`requiredPermission` per contract; report scope from session context; exports and print
jobs run under tenant context (leakage-path checklist); watermarking for drafts;
report parameters are validated — filters never widen scope beyond the caller's branch grants.

## 7. Performance

Report execution budgets per contract (e.g., TB ≤ 2 s at 1M lines MVP); long-running
outputs are jobs; freshness is asserted, never assumed; drill-down links preserve scope
and as-of. Budgets are acceptance criteria proven by
[../testing/PERFORMANCE_TEST_PLAN.md](../testing/PERFORMANCE_TEST_PLAN.md), not claims.
