# Report Contract

> **Status:** STABLE · **Owner:** Reporting Architecture · **Updated:** 2026-10-27

The normative contract every report implements
([ADR-0011](../architecture/ADR/ADR-0011-reporting-printing.md)). A report **is** its
contract: identity, parameters, scope, permission, currency handling, data sources,
aggregation, drill-down, exports, localization, freshness, and reconciliation assertions.
The registry validates contracts at boot
([REPORTING_ARCHITECTURE.md](REPORTING_ARCHITECTURE.md) §2); the catalog listing with
provenance is [REPORT_CATALOG.md](REPORT_CATALOG.md). Contracts are **code-defined**
(TypeScript modules) — tenants save parameter sets, never invent logic.

## 1. Contract schema (TypeScript-ish, normative)

```ts
type ReportContract = {
  id: string;                    // 'financial.trial-balance' — stable, URL-safe
  version: number;               // integer, bumped on ANY behavioral change
  title: Bilingual;              // { ar: 'ميزان المراجعة', en: 'Trial Balance' }
  category: 'financial' | 'ar-ap' | 'sales' | 'purchasing' | 'inventory'
           | 'treasury' | 'tax' | 'platform' | 'industry';
  description: Bilingual;        // shown in report picker (what it answers)

  parameters: ZodSchema;         // parameter schema (below for required keys)

  scopeRules: {
    tenant: true;                // always; RLS + explicit tenant_id
    branches: 'required' | 'optional' | 'fixed-all';
    warehouses?: 'optional' | 'required';
    costCenters?: 'optional';
    dateRange: 'required' | 'optional';
    asOf: 'required' | 'optional' | 'forbidden';
    // 'required' = report is deterministic by construction
  };

  requiredPermission: string;    // e.g. 'reports.financial.tb.read'

  currencyHandling: {
    presentation: 'base' | 'document' | 'both';
    // financial statements: base only. Sales by item may offer document+base.
    method: 'posted-rates';      // amounts use rates frozen at posting (INV-008)
  };

  dataSources: DataSourceDecl[]; // 1..n — module-owned authorized query services
  // DataSourceDecl = {
  //   module: 'accounting' | 'sales' | 'purchasing' | 'inventory'
  //         | 'treasury' | 'tax' | 'partners' | 'audit' | 'identity',
  //   service: string,            // e.g. 'glQueries.periodMovement()'
  //   tables: string[],           // provenance documentation (info only — never raw SQL)
  //   purpose: Bilingual          // why this source is needed (catalog provenance)
  // }

  aggregation: {
    groupBy: ColumnId[];         // grouping keys in order
    measures: MeasureDecl[];     // { id, kind: 'sum'|'count'|'balance', source, rounding }
    sorting: { by: ColumnId; dir: 'asc' | 'desc' }[];
    zeroSuppression: 'rows' | 'none';   // see FINANCIAL_REPORT_RULES §7
  };

  totals: {
    rowTotals: boolean;          // per-row sums where applicable
    grandTotals: 'sum' | 'balance-check' | 'none';
    subTotalsByGroup: boolean;
  };

  drillTargets: DrillTargetDecl[]; // row → route generation (REPORTING_ARCHITECTURE §9)

  exportFormats: ('pdf' | 'xlsx' | 'csv')[];   // subset supported; pdf requires template
  printTemplate?: 'a4-report' | 'a4-document';

  localization: {
    numerals: 'western';         // financial exports: Western digits at MVP
    direction: 'per-run-locale'; // RTL sheet views / RTL PDF when locale = ar
    labels: 'registry-bilingual';// column titles resolved per run locale
  };

  freshness: {
    semantics: 'as-of' | 'current';
    cacheTtlSeconds: number;     // 0 = no caching; see ARCHITECTURE §6
    invalidationEvents: string[];// e.g. ['invoice.posted', 'period.locked']
  };

  assertions: AssertionDecl[];   // reconciliation self-checks (below)
};

type AssertionDecl = {
  id: string;                    // 'tb-debits-equal-credits'
  invariant?: string;            // e.g. 'INV-001' link
  check: string;                 // executable check id implemented by the report
  onFailure: 'block-export';     // always block-export for financial reports
  message: Bilingual;
};
```

**Required parameter keys** (when a scope dimension is not `'forbidden'`, its
parameter must accept the user's *effective grants*, intersection applied by the
runner — never the requested scope alone): `branchIds?`, `warehouseIds?`,
`dateFrom/dateTo?` or `asOf?`, `currency?` (presentation only), `locale`,
`zeroSuppression?`, `grouping?` (contract-declared options only).

## 2. Runtime result envelope (normative)

```ts
type ReportResult = {
  reportId: string; contractVersion: number;
  runId: string;                 // report_runs id — artifact linkage & audit
  paramsEcho: Json;              // normalized params actually used
  columns: {
    id: string; label: Bilingual; type: 'text'|'money'|'qty'|'date'|'status'|'link';
    numeric?: boolean; widthHint?: number;   // DataTable numeric alignment (tabular-nums)
  }[];
  groups: { key: string; label: Bilingual; subtotal?: MoneyRow }[]; // group tree
  rows: {
    key: string; values: Record<string, string | number | null>;  // money = decimal strings
    drillLinks?: { label: Bilingual; route: string }[];
  }[];
  totals: { id: string; label: Bilingual; amount: string; kind: 'sum'|'check' }[];
  assertions: { id: string; status: 'PASS' | 'FAIL'; detail?: Bilingual }[];
  freshness: { computedAt: IsoDateTime; asOf?: IsoDateTime; cacheState: 'fresh'|'stale'|'recomputed' };
  formatting: { baseCurrency: string; numerals: 'western'; locale: 'ar'|'en' };
};
```

Money values are **decimal strings** (e.g., `"12500.0000"`,
[../architecture/ADR/ADR-0009-money-precision.md](../architecture/ADR/ADR-0009-money-precision.md))
— the UI renders with grouping; exports keep full precision minus declared rounding.

## 3. Worked example 1 — financial: Trial Balance (ميزان المراجعة)

```jsonc
{
  "id": "financial.trial-balance",
  "version": 3,
  "title": { "ar": "ميزان المراجعة", "en": "Trial Balance" },
  "category": "financial",
  "description": {
    "ar": "حركات ورصيد كل حساب لفترة محددة، مع التحقق من توازن المدين والدائن",
    "en": "Per-account period movement and balance with debit/credit balance check"
  },
  "parameters": {
    "dateFrom": "date (required)",
    "dateTo":   "date (required)",
    "asOf":     "datetime (optional — defaults to period end; enables determinism)",
    "branchIds": "uuid[] (optional)",
    "grouping": "enum ['none','account-type'] (default 'account-type')",
    "zeroSuppression": "boolean (default true)",
    "locale": "enum ['ar','en'] (default 'ar')",
    "includeOpening": "boolean (default true — opening balance column)"
  },
  "scopeRules": { "tenant": true, "branches": "optional", "dateRange": "required",
                  "asOf": "optional", "warehouses": "forbidden", "costCenters": "forbidden" },
  "requiredPermission": "reports.financial.tb.read",
  "currencyHandling": { "presentation": "base", "method": "posted-rates" },
  "dataSources": [
    { "module": "accounting", "service": "glQueries.periodMovementAndBalances",
      "tables": ["journal_entries", "journal_lines", "accounts"],
      "purpose": { "ar": "حركات ومراكز الحسابات المرحّلة", "en": "Posted account movements and balances" } }
  ],
  "aggregation": {
    "groupBy": ["accountType", "accountCode"],
    "measures": [
      { "id": "openingDebit",  "kind": "balance", "rounding": "minor-units(base)" },
      { "id": "periodDebit",   "kind": "sum",     "rounding": "minor-units(base)" },
      { "id": "periodCredit",  "kind": "sum",     "rounding": "minor-units(base)" },
      { "id": "closingDebit",  "kind": "balance", "rounding": "minor-units(base)" },
      { "id": "closingCredit", "kind": "balance", "rounding": "minor-units(base)" }
    ],
    "sorting": [{ "by": "accountCode", "dir": "asc" }],
    "zeroSuppression": "rows"
  },
  "totals": { "rowTotals": false, "grandTotals": "balance-check", "subTotalsByGroup": true },
  "drillTargets": [
    { "from": "accountRow",
      "route": "/{locale}/accounting/general-ledger?accountId={accountId}&from={dateFrom}&to={dateTo}&asOf={asOf}",
      "label": { "ar": "دفتر الأستاذ للحساب", "en": "Account ledger" } }
  ],
  "exportFormats": ["pdf", "xlsx", "csv"],
  "printTemplate": "a4-report",
  "localization": { "numerals": "western", "direction": "per-run-locale",
                    "labels": "registry-bilingual" },
  "freshness": { "semantics": "as-of", "cacheTtlSeconds": 3600,
                 "invalidationEvents": ["journal.posted", "journal.reversed", "period.locked"] },
  "assertions": [
    { "id": "tb-debits-equal-credits", "invariant": "INV-001",
      "check": "sum(periodDebit) == sum(periodCredit)",
      "onFailure": "block-export",
      "message": { "ar": "غير متوازن: المدين لا يساوي الدائن",
                   "en": "Unbalanced: total debits do not equal total credits" } },
    { "id": "tb-closing-net-zero",
      "check": "sum(closingDebit) - sum(closingCredit) == 0",
      "onFailure": "block-export",
      "message": { "ar": "صافي الأرصدة الختامية ليس صفراً",
                   "en": "Net closing balances are not zero" } }
  ]
}
```

Derivation math for these measures: [FINANCIAL_REPORT_RULES.md](FINANCIAL_REPORT_RULES.md) §2.

## 4. Worked example 2 — operational: Sales by Item (المبيعات حسب الصنف)

```jsonc
{
  "id": "sales.by-item",
  "version": 2,
  "title": { "ar": "المبيعات حسب الصنف", "en": "Sales by Item" },
  "category": "sales",
  "description": {
    "ar": "الكميات وصافي المبيعات والضريبة والتكلفة والربحية لكل صنف في فترة",
    "en": "Quantities, net sales, tax, cost and margin per item for a period"
  },
  "parameters": {
    "dateFrom": "date (required)", "dateTo": "date (required)",
    "branchIds": "uuid[] (optional)", "warehouseIds": "uuid[] (optional)",
    "itemCategoryIds": "uuid[] (optional)",
    "salesRepIds": "uuid[] (optional)",
    "excludeCreditNotes": "boolean (default false)",
    "currency": "enum ['base','document'] (default 'base')",
    "locale": "enum ['ar','en'] (default 'ar')"
  },
  "scopeRules": { "tenant": true, "branches": "optional", "warehouses": "optional",
                  "dateRange": "required", "asOf": "forbidden" },
  "requiredPermission": "reports.sales.by-item.read",
  "currencyHandling": { "presentation": "both", "method": "posted-rates" },
  "dataSources": [
    { "module": "sales", "service": "salesAnalytics.itemRevenue",
      "tables": ["sales_invoices", "credit_notes", "sales_invoice_lines", "sales_order_lines"],
      "purpose": { "ar": "بنود الفواتير والإشعارات الدائنة المرحّلة", "en": "Posted invoice and credit-note lines" } },
    { "module": "inventory", "service": "valuationQueries.cogsByItem",
      "tables": ["stock_moves", "stock_layers"],
      "purpose": { "ar": "تكلفة المبيعات الفعلية (WAC/FIFO)", "en": "Actual COGS by valuation method" } }
  ],
  "aggregation": {
    "groupBy": ["itemCategory", "itemId"],
    "measures": [
      { "id": "qtySold",   "kind": "sum", "rounding": "qty(3)" },
      { "id": "grossSales","kind": "sum", "rounding": "minor-units" },
      { "id": "discounts", "kind": "sum", "rounding": "minor-units" },
      { "id": "netSales",  "kind": "sum", "rounding": "minor-units" },
      { "id": "taxAmount", "kind": "sum", "rounding": "minor-units" },
      { "id": "cogs",      "kind": "sum", "rounding": "minor-units" },
      { "id": "marginPct", "kind": "derived", "rounding": "2dp" }
    ],
    "sorting": [{ "by": "netSales", "dir": "desc" }],
    "zeroSuppression": "rows"
  },
  "totals": { "rowTotals": false, "grandTotals": "sum", "subTotalsByGroup": true },
  "drillTargets": [
    { "from": "itemRow",
      "route": "/{locale}/sales/invoices?itemId={itemId}&from={dateFrom}&to={dateTo}",
      "label": { "ar": "فواتير الصنف", "en": "Item invoices" } }
  ],
  "exportFormats": ["pdf", "xlsx", "csv"],
  "printTemplate": "a4-report",
  "localization": { "numerals": "western", "direction": "per-run-locale",
                    "labels": "registry-bilingual" },
  "freshness": { "semantics": "current", "cacheTtlSeconds": 60,
                 "invalidationEvents": ["invoice.posted", "credit_note.posted"] },
  "assertions": [
    { "id": "sales-gl-tie",
      "check": "sum(netSales+taxAmount) == GL revenue+VAT movement for scope+period",
      "onFailure": "block-export",
      "message": { "ar": "المبيعات لا تطابق حركات دفتر الأستاذ",
                   "en": "Sales do not tie to GL movements" } }
  ]
}
```

Operational reports still carry at least one ledger-tie assertion where their totals
intersect GL accounts — trust is not financial-report-only
([REPORT_RECONCILIATION.md](REPORT_RECONCILIATION.md) §2).

## 5. Contract rules (binding)

1. **Versioning:** any change to parameters, scope, aggregation, assertions, or output
   bumps `version`; title/description fixes bump it too (registry snapshot changes).
   The runner refuses mismatched versions (stale client → refresh prompt).
2. **No contract without provenance:** `dataSources[].tables` must name the actual owned
   tables/services (directive STEP 9 — no reports without source-of-truth declaration);
   the registry boot check fails otherwise.
3. **Parameters are declarative:** the UI (FilterBar/ReportViewer) renders parameters
   from the schema — no bespoke parameter screens per report.
4. **Assertions are executable**, not documentation: each maps to a check implemented in
   the report's executor; financial reports must include every check listed in
   [FINANCIAL_REPORT_RULES.md](FINANCIAL_REPORT_RULES.md) §9 and
   [REPORT_RECONCILIATION.md](REPORT_RECONCILIATION.md) §1.
5. **Localization:** all user-facing strings are bilingual at the contract level; run
   locale chooses rendering; exports follow [PRINTING_AND_EXPORT.md](PRINTING_AND_EXPORT.md).
6. **Forbidden in contracts:** raw SQL, cross-module table writes, client-side
   aggregation of unscoped data, "export-only" reports (no on-screen verification),
   parameter options not derivable from the schema.
