# Seeds — Reference Data

> **Status:** STABLE · **Owner:** Database & Product Architecture · **Updated:** 2026-11-05

Reference (seed) data is the platform's built-in, versioned configuration — distinct
from tenant data. Applied by migrations; idempotent by natural keys; versioned with the
packs they belong to.

## Catalog

| Seed set | Contents | Applied in | Notes |
|----------|----------|------------|-------|
| `currencies` | ISO-4217 codes incl. SAR, AED, BHD, KWD, OMR, QAR, YER, EGP, JOD, IQD, USD, EUR with minor units (2/3) | P-002 | Global, read-only |
| `countries` | ISO-3166 country records + default locale/currency/date formats | P-002 | Global |
| `tax_treatments` | The 6 treatments ([TAX_ENGINE.md](../../localization/TAX_ENGINE.md) §1) | P-009 | Global |
| `jurisdictions` + `jurisdiction_tax_rates` | Country pack registry + **versioned rates with `verified_at` + `source_ref`** — values marked `REQUIRES_VERIFICATION` until checked against official sources ([../../localization/compliance-matrix/](../../localization/compliance-matrix/README.md)) | P-009 | Global; updates staged |
| `permissions` | Full permission catalog (`module.resource.action`) matching [../../security/AUTHORIZATION_MATRIX.md](../../security/AUTHORIZATION_MATRIX.md) | P-003 | Global; code reviews diff it |
| `system_role_templates` | Tenant role templates: `owner`, `accountant`, `sales`, `purchasing`, `warehouse`, `cashier`, `viewer` + branch-scoped variants | P-003 | Instantiated per tenant on creation |
| `chart_of_accounts_template` | Bilingual default CoA ([CHART_OF_ACCOUNTS.md](../../accounting/CHART_OF_ACCOUNTS.md) §3) with purpose markers | P-004 (instantiation) / P-007 (posting readiness) | Instantiated per tenant, then tenant-owned |
| `industry_templates` | Template manifests ([../../industries/templates/](../../industries/templates/README.md)) | P-004 (list) / P-015 (engine) | Versioned JSONB manifests |
| `plans` + plan feature matrix | Subscription plan definitions ([../../product/SUBSCRIPTION_AND_ENTITLEMENTS.md](../../product/SUBSCRIPTION_AND_ENTITLEMENTS.md)) | P-004 (skeleton) / P-014 (billing-ready) | Admin-editable copy |
| `report_catalog` | Registered report contracts ([../../reporting/REPORT_CATALOG.md](../../reporting/REPORT_CATALOG.md)) | P-013 | Code-defined + registry row |
| `print_templates` | A4 document / A4 report / 80mm / 58mm base templates (AR/EN) | P-013 | Tenant-overridable (logo, footer) |
| `uoms` | Common units (piece, kg, g, L, box, carton, meter, hour) with factor table | P-006 | Tenant-extendable |
| `bank_statement_formats` | Bank-statement parser-format registry (migration 0035 §6): the PHASE-008 generic formats (`generic-csv`, `generic-xlsx`) plus the PHASE-023 structural format families `csv-debit-credit` (separate debit/credit columns; required columns `date`, `debit_or_credit`) and `csv-with-balances` (running balance; required columns `date`, `amount`, `balance`), each with declared `required_columns` | P-023 | Global, read-only; **format families only — no bank-specific attribution without verified documentation** (no-fabrication; [../../api/integrations/README.md](../../api/integrations/README.md) §3.6) |

## Rules

1. Seeds never carry tenant data; tenant instantiation copies (CoA, roles) and the copy
   becomes tenant-owned (editable, auditable).
2. Seed updates ship as migrations with: version bump, changelog note, and — for tax
   rates — a verification record (official source URL + date + who verified).
3. CI check: `permissions` seed ↔ authorization matrix doc drift detection (parse doc
   table, diff seed) — keeps security docs honest.
4. No seed value that encodes a **legal rule** may be edited at runtime by anyone;
   corrections go through pack versioning (ADR-0010).
