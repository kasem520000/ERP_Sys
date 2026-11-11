# Migration Adapters — Extract-then-Import (PHASE-040 · IN-26)

> **Status:** STABLE · **Owner:** Data Architecture · **Updated:** 2026-11-12 (PHASE-040 T-05)
> **Scope:** QuickBooks-shaped · Odoo-shaped · Excel-generic — the DOCUMENTED column
> mappings for migrating an extract into the platform. **The mapping documents are the
> contract** (PHASE-040 §6 acceptance 5): an adapter fixture that drifts from this
> document fails the import spec.
> **Out of scope (the documented boundary):** the live inter-ERP bridge (IN-27) and
> transactional-history import beyond opening balances — open invoices/bills land as
> per-partner opening-balance drafts (aggregate per customer/vendor before import).

## 1. How an adapter runs

1. **Extract** from the source system (the export notes below name the exact report/view).
2. **Download the template** — `GET /api/v1/imports/adapters/:key/template` returns the
   CSV template (BOM, source headers, one example row).
3. **Import** — adapters marked `engine: toolkit` run through the PHASE-040 imports hub
   (`/settings/imports`): the wizard pre-loads the adapter's column map (every column
   remains manually overridable — the §7 drift mitigation); the dry-run validates; the
   commit applies atomically (BR-066). Adapters marked `engine: baseline-console` run
   through the baseline items import console (`/inventory/import`, `items.import.run`).
4. **REQUIRES_VERIFICATION columns** — flagged in the tables below — vary across source
   versions/locales; the wizard surfaces the flag and the operator confirms the mapping
   before the dry-run.

The adapter catalog lives in code (`apps/api/src/modules/onboarding/application/adapters.ts`
— `MIGRATION_ADAPTERS`); this document is its human contract.

## 2. QuickBooks-shaped

### 2.1 Chart of Accounts (`quickbooks-chart-of-accounts` → kind `COA`, toolkit engine)

Source: Reports → Account List → Excel export, with the parent column flattened to the
parent's own account number.

| Source column | Canonical | Required | Notes |
|---|---|---|---|
| Account Number | `code` | yes | |
| Account Name | `name` | yes | |
| Account Type | `type` | yes | translated per the table below |
| Parent Account Number | `parent_code` | no | **REQUIRES_VERIFICATION** — QuickBooks names sub-accounts in the full path; export the parent's own number |
| Is Header Account | `is_group` | no | TRUE/FALSE (نعم/لا accepted) |
| Description | — (informational) | no | not imported |

**Account-type translation table (the contract):**

| QuickBooks type | Platform type |
|---|---|
| Bank · Accounts Receivable · Other Current Asset · Fixed Asset · Other Asset | `ASSET` |
| Accounts Payable · Other Current Liability · Long Term Liability | `LIABILITY` |
| Equity | `EQUITY` |
| Income · Other Income | `REVENUE` |
| Cost of Goods Sold · Expense · Other Expense | `EXPENSE` |

### 2.2 Trial Balance (`quickbooks-trial-balance` → kind `ACCOUNT_OPENING_BALANCES`, toolkit engine)

Source: Reports → Trial Balance as of the migration date.

| Source column | Canonical | Required | Notes |
|---|---|---|---|
| Account Number | `account_code` | yes | must exist (postable) in the tenant's CoA |
| Account Name | `account_name` | no | informational |
| Debit | `debit` | one of debit/credit | non-negative, ≤ 4dp |
| Credit | `credit` | one of debit/credit | non-negative, ≤ 4dp |

The file must **balance by nature** (Σdebit = Σcredit) — the dry-run rejects an
unbalanced file with a bilingual file-level error. Each row lands as an `ACCOUNT`
opening-balance draft through the opening engine (no journal bypass); posting happens
through the existing opening-balances post action (BR-035 once-only).

### 2.3 Customer List (`quickbooks-customers` → kind `PARTNERS`, baseline console)

Map Customer Name → `name`, set kind `CUSTOMER`; the open balance lands as a PARTNER
opening-balance draft (aggregate the open invoices per customer first — the documented
boundary). **REQUIRES_VERIFICATION:** Company Name vs Customer Name for B2B books.

### 2.4 Product/Service List (`quickbooks-items` → kind `ITEMS`, baseline console)

Map Item Name → `name`; Inventory items → `STOCK`, Services → `SERVICE` (manual pass in
the wizard). **REQUIRES_VERIFICATION:** the Type column vocabulary varies by QuickBooks
edition.

## 3. Odoo-shaped

### 3.1 Chart of Accounts (`odoo-chart-of-accounts` → kind `COA`, toolkit engine)

Source: Accounting → Chart of Accounts → list view export, company-filtered.

| Source column | Canonical | Required | Notes |
|---|---|---|---|
| Code | `code` | yes | |
| Name | `name` | yes | |
| Type | `type` | yes | translated per the table below |
| Parent Code | `parent_code` | no | **REQUIRES_VERIFICATION** — Odoo exports the parent as a name by default; switch the export to the parent's code column |

**Account-type translation table (the contract):**

| Odoo type | Platform type |
|---|---|
| asset · receivable · bank and cash | `ASSET` |
| liability · payable | `LIABILITY` |
| equity | `EQUITY` |
| income | `REVENUE` |
| expense | `EXPENSE` |

### 3.2 Partners (`odoo-partners` → kind `PARTNERS`, baseline console)

Map Name → `name`; run TWO passes — customers then suppliers — filtered by the Odoo
`customer_rank`/`supplier_rank` columns (kind `CUSTOMER` / `SUPPLIER`).

### 3.3 Products (`odoo-products` → kind `ITEMS`, baseline console)

Map Internal Reference → `sku`, Name → `name`; storable products → `STOCK`, services →
`SERVICE`. **REQUIRES_VERIFICATION:** the Product Type vocabulary (`Goods`, `Service`,
`Combo`) varies by Odoo version.

## 4. Excel-generic (the canonical templates)

The platform's own EN templates — the wizard's auto-detect maps these headers directly
(Arabic headers are first-class; see DATA_DICTIONARY §import-kinds for the full alias
table). Two adapters ship: `excel-generic-coa` (COA kind) and
`excel-generic-trial-balance` (ACCOUNT_OPENING_BALANCES kind); their columns are the
canonical columns themselves (kinds catalog: `GET /api/v1/imports/kinds`).

## 5. Verification evidence (the spec contract)

The DB suite (`__db__/onboarding/import-toolkit.db.spec.ts`) imports the QuickBooks
chart fixture and the Odoo chart fixture **through their documented mappings** — the
fixtures use the source headers verbatim, the engine applies the adapter columnMap and
the type translation table above, and the round-trip must land the accounts with the
translated types. A mapping drift (document ≠ code) fails the spec.
