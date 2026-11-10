# ERD — Treasury & Tax Cluster

> **Status:** STABLE · **Owner:** Database Architecture · **Updated:** 2026-10-30 · **Phases:** 008–009, 023

Core attributes only. Column-level specifications: treasury tables in
[TABLES/treasury-tax.md](../TABLES/treasury-tax.md) (authored PHASE-008);
tax/compliance tables in [TABLES/tax-compliance.md](../TABLES/tax-compliance.md)
(**authored PHASE-009** — delivered by migration `0013_tax.sql`).

```mermaid
erDiagram
  tenants ||--o{ cash_accounts : ""
  cash_accounts ||--o{ cash_movements : ""
  tenants ||--o{ receipts : ""
  tenants ||--o{ payments : ""
  cash_accounts ||--o{ receipts : "deposited-in"
  cash_accounts ||--o{ payments : "paid-from"
  partners ||--o{ receipts : "payer"
  partners ||--o{ payments : "payee"
  receipts ||--o{ treasury_allocations : ""
  payments ||--o{ treasury_allocations : ""
  partner_subledger_entries ||--o{ treasury_allocations : "settled-open-item"
  tenants ||--o{ expense_categories : ""
  expense_categories ||--o{ expenses : ""
  cash_accounts ||--o{ expenses : "paid-from"
  cash_accounts ||--o{ cash_transfers : "from/to"
  cash_accounts ||--o{ cashier_shifts : ""
  cash_accounts ||--o{ bank_statements : ""
  bank_statements ||--o{ bank_statement_lines : ""
  cash_movements ||--o| bank_statement_lines : "matched-to"
  tenants ||--o{ tax_registrations : ""
  jurisdictions ||--o{ tax_registrations : ""
  jurisdictions ||--o{ jurisdiction_tax_rates : "versioned rates"
  tax_treatments ||--o{ jurisdiction_tax_rates : "treatment"
  jurisdictions ||--o{ tax_codes : "bound pack"
  tenants ||--o{ tax_codes : ""
  tenants ||--o{ tax_pack_bindings : "staged pin"
  jurisdictions ||--o{ tax_pack_bindings : ""
  tax_codes ||--o{ expenses : "G-11 VAT leg"
  tax_codes ||--o{ items : "item default"
  tax_codes ||--o{ item_categories : "category default"
  tax_codes ||--o{ sales_invoice_lines : "stamped-on (PHASE-012)"
  tenants ||--o{ tax_document_summaries : "INV-012 document side"
  tax_codes ||--o{ tax_document_summaries : "grouped-by"
  tenants ||--o{ vat_returns : ""
  jurisdictions ||--o{ vat_returns : ""
  tenants ||--o{ e_invoicing_submissions : ""
  jurisdictions ||--o{ e_invoicing_submissions : """"

  cash_accounts {
    uuid id PK
    text type "CASH|BANK|PETTY"
    uuid account_id FK "CoA ledger account"
    uuid branch_id FK
    text currency
    text status
  }
  cash_movements {
    uuid id PK
    uuid cash_account_id FK
    text direction "IN|OUT"
    numeric amount "19,4"
    text source_type "receipt|payment|cash_transfer|expense|shift_variance"
    uuid source_id
    date value_date
  }
  receipts {
    uuid id PK
    text receipt_no "official at posting"
    uuid cash_account_id FK
    uuid partner_id FK
    text method "CASH|BANK|CHEQUE|CARD|TRANSFER"
    numeric amount "19,4"
    numeric allocated_amount "19,4"
    text status "DRAFT..POSTED"
  }
  payments {
    uuid id PK
    text payment_no "official at posting"
    uuid cash_account_id FK
    uuid partner_id FK
    text method
    numeric amount "19,4"
    numeric allocated_amount "19,4"
    text status "DRAFT..POSTED"
  }
  treasury_allocations {
    uuid id PK
    uuid receipt_id FK "exactly one doc leg"
    uuid payment_id FK
    uuid open_item_id FK "partner_subledger_entries"
    numeric amount "19,4"
  }
  expenses {
    uuid id PK
    uuid expense_category_id FK
    uuid cash_account_id FK
    text payee
    numeric amount "19,4"
    uuid tax_code_id "FK live PHASE-009 — G-11 VAT leg"
    text status "DRAFT..POSTED"
  }
  expense_categories {
    uuid id PK
    text code
    uuid account_id FK "expense account"
  }
  cashier_shifts {
    uuid id PK
    uuid cash_account_id FK
    uuid user_id FK
    numeric opening_amount "19,4"
    numeric counted_amount "19,4"
    text status
  }
  bank_statement_lines {
    uuid id PK
    uuid bank_statement_id FK
    date line_date
    numeric amount "19,4"
    text reference
    uuid matched_movement_id FK
  }
  tax_treatments {
    text key PK "the six, never conflated"
    boolean taxable
    text output_tax_box "return-box semantics"
    text input_tax_box
  }
  jurisdictions {
    uuid id PK
    char country_code UK "ISO-3166"
    text vat_status "VAT_IN_FORCE|VAT_PLANNED|NO_VAT"
    text pack_version "1.0.0-baseline"
    jsonb descriptor "COUNTRY_PACKS §2 pack JSON"
    text verification_status "REQUIRES_VERIFICATION"
  }
  jurisdiction_tax_rates {
    uuid id PK
    uuid jurisdiction_id FK
    text treatment "STANDARD_RATED|ZERO_RATED|REVERSE_CHARGE"
    numeric rate "8,4"
    date effective_from "new row per change"
    date effective_to
    text source_ref
    timestamptz verified_at "NULL until verified"
  }
  tax_registrations {
    uuid id PK
    uuid tenant_id FK
    char country_code FK
    text registration_number "format unasserted"
    text status "REGISTERED|NOT_REGISTERED|DEREGISTERED"
    date effective_from
  }
  tax_codes {
    uuid id PK
    text code "uq per tenant"
    text default_treatment "resolver input"
    char country_code "pack binding"
    text snapshot_policy "STAMP_AT_POSTING"
  }
  tax_pack_bindings {
    uuid id PK
    uuid tenant_id FK
    char country_code
    text pack_version "pinned; apply audited"
  }
  tax_document_summaries {
    uuid id PK "append-only (grants+guard)"
    text source_type "expense | tax_fixture"
    text direction "OUTPUT|INPUT"
    text treatment
    numeric rate "8,4"
    numeric taxable_base "19,4"
    numeric tax_amount "19,4"
    jsonb snapshot "tax.snapshot.v1 frozen"
  }
  vat_returns {
    uuid id PK
    char country_code
    date period_start
    date period_end
    text status "DRAFT|READY|FILED"
    jsonb summary "deterministic"
    jsonb cross_check "INV-012 side-by-side"
    boolean cross_check_ok "gates READY"
  }
  e_invoicing_submissions {
    uuid id PK "schema 009; adapters 023"
    char country_code
    text source_type
    uuid source_id
    text adapter_id
    text status "PENDING|GENERATED|SUBMITTED|ACCEPTED|REJECTED|FAILED"
    text payload_digest
  }
```

Treasury invariants live in the substrate: every cash movement is written inside the
same transaction as its journal (ADR-0007) and a cash account's balance is **derived** —
never stored — as Σ `cash_movements` (INV-019, verified by the registered reconciliation
check RC-08). Bank statement lines are informational only — never ledger entries
([RECONCILIATION.md](../../accounting/RECONCILIATION.md) §4). Tax rate rows are
**seed/reference data** (non-tenant, read-only to `erp_app`); tenants reference them via
tax codes with rate snapshots frozen on document lines (BR-033 — a pack upgrade never
rewrites a stamped snapshot; [TAX_ENGINE.md](../../localization/TAX_ENGINE.md)). The
INV-012 document side (`tax_document_summaries`, append-only) reconciles per period
against GL movements on the three VAT purpose accounts (RC-06/RC-07 — BROKEN blocks the
VAT return's ready-to-file AND the period lock, PC-04).
