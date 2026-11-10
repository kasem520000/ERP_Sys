# TABLES — Purchasing & Payables Cluster (PHASE-011)

> **Status:** DELIVERED (PHASE-011, migrations 0016/0017) · **Owner:** Database Architecture ·
> **Updated:** 2026-10-30 · Column-level specs for the PHASE-011 cluster, authored in-phase per
> the file header rule. ADR-0009 precision discipline throughout: quantities and unit
> costs/prices are `numeric(19,6)` (6-decimal internal), money quanta `numeric(19,4)`, FX
> rates `numeric(19,8)`. All tables are draft-lifecycle (SELECT/INSERT/UPDATE for `erp_app`;
> POSTED immutability is service discipline + status↔posted-columns shape CHECKs, mirroring
> the treasury pattern) **except** `purchase_reallocations`/`purchase_reallocation_lines`
> (0017: SELECT/INSERT only — the audit trail is append-only by shape). RLS macro on every
> table; the isolation registry covers each (A1–A11). No table in this cluster writes
> `journal_*`, `stock_*`, or `partner_subledger_*` — those stay owned by accounting,
> inventory, and partners respectively (MODULE_BOUNDARIES; ADR-0007).

## §purchase_requests / §purchase_request_lines — internal requisitions (§2.1)

**`purchase_requests`** — internal requisitions with approval routing. Not ledger
documents: `request_no` is reserved at **approval** (BR-029 assign-at policy — the
posting-time assignment is reserved for ledger documents).

| Column | Type | Constraints / Notes |
|--------|------|---------------------|
| `id` | uuid PK | app-generated UUIDv7; composite anchor `uq_purchase_requests_id_tenant` |
| `tenant_id` | uuid NOT NULL | FK tenants (RESTRICT); macro RLS |
| `created_at` / `updated_at` / `version` / `created_by` | standard | §5 columns |
| `branch_id` | uuid NOT NULL | composite FK → branches (RESTRICT) — branch scoping on documents |
| `request_no` | text NULL | tenant-unique `uq_purchase_requests_tenant_no`; set at approval |
| `needed_by` | date NULL | requested delivery date |
| `status` | text NOT NULL DEFAULT 'DRAFT' | CHECK `('DRAFT','PENDING_APPROVAL','APPROVED','REJECTED','CONVERTED','CANCELLED')` |
| `note` / `note_ar` | text | bilingual; 1–500 each |
| `submitted_at`/`submitted_by`, `approved_at`/`approved_by`, `rejected_at`/`rejected_by`+`rejection_reason`, `cancelled_at`/`cancelled_by`+`cancel_reason` | audit tuples | shape CHECKs: REJECTED ⇒ rejected pair; CANCELLED ⇒ cancelled pair |
| `converted_order_id` | uuid NULL | FK → purchase_orders (RESTRICT; expand step after purchase_orders ships) — the PR→PO conversion link |

Indexes: `ix_purchase_requests_tenant_status (tenant_id, status, created_at)`,
`ix_purchase_requests_tenant_branch`.

**`purchase_request_lines`** — one row per item requested: `request_id` composite FK
(CASCADE), `line_no` unique `(tenant_id, request_id, line_no)`, `item_id` composite FK →
items (RESTRICT), `qty numeric(19,6)` CHECK > 0, `note` 1–300. Index
`ix_purchase_request_lines_tenant_item`.

## §purchase_orders / §purchase_order_lines — supplier orders (§2.1; DOCUMENT_LIFECYCLE §3)

**`purchase_orders`** — DRAFT → PENDING_APPROVAL (BR-010 threshold routing against the
PHASE-007 approval_policies substrate) → APPROVED → ISSUED → CLOSED / CANCELLED.
Amendments are NEW revisions linked via `revision_of_id` (INV-003 — never in-place edits).

| Column | Type | Constraints / Notes |
|--------|------|---------------------|
| `branch_id` / `supplier_id` | uuid NOT NULL | composite FKs → branches / partners (RESTRICT) — supplier must be a supplier-kind partner (service-level) |
| `order_no` | text NULL | tenant-unique; assigned at ISSUED (BR-029; shape CHECK ties it to ISSUED/CLOSED) |
| `order_date` / `expected_date` | date NOT NULL / date NULL | |
| `currency_code` / `exchange_rate` | varchar(3) NOT NULL / numeric(19,8) NULL | document currency; FX captured when ≠ base (INV-008 original-rate discipline) |
| `revision_of_id` / `revision_no` | uuid NULL / integer DEFAULT 1 | the amendment chain; `ck_..._revision_shape` CHECK ≥ 1; index `ix_purchase_orders_revision_chain` |
| `status` | text NOT NULL DEFAULT 'DRAFT' | CHECK `('DRAFT','PENDING_APPROVAL','APPROVED','ISSUED','CLOSED','CANCELLED')` |
| `total_net` / `total_tax` / `total_gross` | numeric(19,4) DEFAULT 0 | CHECK `total_gross = total_net + total_tax` |
| `tax_summary` | jsonb NULL | accumulates by (treatment, rate, tax code) for INV-012 |
| `note` / `note_ar` | text | 1–500 |
| lifecycle tuples | | submitted/approved/rejected+reason/issued/closed/cancelled+reason — shape CHECKs on ISSUED (⇒ order_no + issued pair) and CANCELLED |

Indexes: `ix_purchase_orders_tenant_status (tenant_id, status, order_date)`,
`ix_purchase_orders_tenant_supplier (tenant_id, supplier_id, order_date)`,
`ix_purchase_orders_tenant_branch`, `ix_purchase_orders_revision_chain`.

**`purchase_order_lines`** — `order_id` (CASCADE), `line_no` unique per order, `item_id`
(RESTRICT), `qty numeric(19,6)` CHECK > 0, `unit_price numeric(19,6)` CHECK ≥ 0,
`tax_code_id` FK → tax_codes (the PHASE-009 stamps), `net_amount`/`tax_amount`
numeric(19,4) CHECK ≥ 0, `price_source` CHECK `('BASE_COST','PURCHASE_PRICE_LIST','MANUAL')`
(BR-003 purchase-side provenance — T11), `request_line_id` FK → purchase_request_lines
(SET NULL — the requisition link), `note` 1–300. Index
`ix_purchase_order_lines_tenant_item`.

## §goods_receipts / §goods_receipt_lines — GRN documents (§2.2; golden G-07)

**`goods_receipts`** — POSTED receives stock through the PHASE-010 inventory services
(`planReceipt`/`applyReceipt` inside the posting transaction — purchasing never writes
`stock_moves`; MODULE_BOUNDARIES) and posts `DR INVENTORY/expense · CR GRNI` (G-07).

| Column | Type | Constraints / Notes |
|--------|------|---------------------|
| `branch_id` / `supplier_id` / `po_id` / `warehouse_id` | uuid NOT NULL (po_id NULL) | composite FKs → branches / partners / purchase_orders / warehouses |
| `receipt_no` | text NULL | tenant-unique; assigned at POST (INV-021) |
| `receipt_date` | date NOT NULL | |
| `status` | text NOT NULL DEFAULT 'DRAFT' | CHECK `('DRAFT','POSTED','CANCELLED')` — no approval state: posting is the approval-analogous act |
| `po_less_reason` | text NULL | BR-012: shape CHECK `(po_id IS NULL) = (po_less_reason IS NOT NULL)` — a PO-less "direct purchase" REQUIRES an explicit reason (and the `purchasing.allow_po_less_grn` setting + permission at service level) |
| `total_value` | numeric(19,4) DEFAULT 0 | Σ line value_amounts |
| `posting_date`/`posted_by`/`posted_at`/`posted_journal_id` | posting tuple | shape CHECK: POSTED ⇔ all four + receipt_no present; `posted_journal_id` FK → journal_entries (RESTRICT) |
| `cancelled_at`/`cancelled_by`+`cancel_reason` | | shape CHECK on CANCELLED |

Indexes: `ix_goods_receipts_tenant_status`, `ix_goods_receipts_tenant_supplier`,
`ix_goods_receipts_tenant_po`, `ix_goods_receipts_tenant_wh`.

**`goods_receipt_lines`** — `receipt_id` (CASCADE), `line_no`, `po_line_id` FK →
purchase_order_lines (RESTRICT; the PO↔GRN match link), `item_id` (RESTRICT), `qty`
numeric(19,6) CHECK > 0, `unit_cost` numeric(19,6) CHECK ≥ 0 — the **PROVISIONAL** cost
(PO price at receipt; the supplier invoice's final cost revalues at G-08 with the variance
recorded), `value_amount` numeric(19,4) — the exact G-07 journal quantum, `account_id`
uuid NULL — the expense/asset account for non-stock lines (service-level requires exactly
one of stock-item/account), `batch_no`/`batch_expiry` (batch capture at receipt where the
item is tracked — shape CHECK expiry ⇒ batch_no), `serial_ids` jsonb (serial capture),
`note` 1–300. Indexes: `ix_goods_receipt_lines_tenant_item`, `ix_goods_receipt_lines_po_line`.

## §supplier_invoices / §supplier_invoice_lines — AP invoices (§2.3/§2.5; golden G-08)

**`supplier_invoices`** — the supplier's own `invoice_no` (BR-011 duplicate semantics:
(supplier, number, amount) **block** / (supplier, number) different amount **warn** —
enforced at service level, deliberately NOT a unique constraint), `internal_no` (BR-029 at
post), `match_result` jsonb recorded **BEFORE approval** (BR-009 — the posting path refuses
to run without it).

| Column | Type | Constraints / Notes |
|--------|------|---------------------|
| `branch_id` / `supplier_id` / `po_id` | uuid NOT NULL (po_id NULL) | composite FKs → branches / partners / purchase_orders |
| `invoice_no` | text NOT NULL | the SUPPLIER's number; CHECK length 1–60; index `ix_supplier_invoices_tenant_supplier_no` for the BR-011 lookup |
| `internal_no` | text NULL | tenant-unique `uq_..._tenant_internal`; assigned at POST (INV-021) |
| `invoice_date` / `due_date` | date NOT NULL | CHECK `due_date ≥ invoice_date`; due date from supplier credit terms (RECEIVABLES_AND_PAYABLES §2; BR-026) |
| `currency_code` / `exchange_rate` | varchar(3) / numeric(19,8) NULL | |
| `status` | text NOT NULL DEFAULT 'DRAFT' | CHECK `('DRAFT','PENDING_APPROVAL','APPROVED','POSTED','CANCELLED')` |
| `match_status` | text NOT NULL DEFAULT 'PENDING' | CHECK `('PENDING','MATCHED','EXCEPTION','DISPOSITIONED')` |
| `match_result` | jsonb NULL | per-line three-way-match outcomes + dispositions (qty/price variance, tolerance pass/fail, disposition + reason + who) — audit-visible |
| `duplicate_warning` | jsonb NULL | the BR-011 warn-path payload (blocked path throws) |
| `total_net` / `total_tax` / `total_gross` | numeric(19,4) DEFAULT 0 | CHECK `total_gross = total_net + total_tax` |
| `tax_summary` | jsonb NULL | by (treatment, rate, tax code) — the INV-012 input-side tie substrate |
| `posting_date`/`posted_by`/`posted_at`/`posted_journal_id` | posting tuple | shape CHECK: POSTED ⇔ all four + internal_no; FK → journal_entries |

Indexes: `ix_supplier_invoices_tenant_status (tenant_id, status, invoice_date)`,
**`ix_supplier_invoices_tenant_supplier_due (tenant_id, supplier_id, due_date)`** — the
mandated §6 AP aging/statement index (EXPLAIN-verified), `ix_supplier_invoices_tenant_supplier_no`,
`ix_supplier_invoices_tenant_po`.

**`supplier_invoice_lines`** — `invoice_id` (CASCADE), `line_no`, `grn_line_id` FK →
goods_receipt_lines (the PO ↔ GRN ↔ invoice three-way link), `po_line_id` FK,
`item_id`/`account_id` exactly-one (shape CHECK — stock line or expense line),
`description`/`description_ar`, `qty` CHECK > 0, `unit_price` CHECK ≥ 0, `tax_code_id` FK,
`vat_recoverable` boolean DEFAULT true (the T6 wiring input), `net_amount` CHECK > 0,
`tax_amount` CHECK ≥ 0, `tax_snapshot` jsonb (BR-033 frozen rate snapshot — stamped per
line, never recomputed), `grni_cleared_value` numeric(19,4) DEFAULT 0 + 
`stock_revalue_value` numeric(19,4) DEFAULT 0 — the per-line G-08 journal quanta
(GRNI clearing / WAC revalue) persisted for auditability. Indexes:
`ix_supplier_invoice_lines_tenant_item`, `ix_supplier_invoice_lines_grn_line`.

## §debit_notes / §debit_note_lines — AP corrections (§2.6; golden G-09)

**`debit_notes`** — mirror supplier-invoice corrections referencing the original invoice
(INV-003/BR-031 — corrections are always NEW documents): `ref_invoice_id` NOT NULL FK →
supplier_invoices (RESTRICT), `note_no` tenant-unique assigned at POST, `note_date`,
`branch_id`/`supplier_id`, currency/FX, status CHECK
`('DRAFT','PENDING_APPROVAL','APPROVED','POSTED','CANCELLED')`, totals with the
`total_gross = total_net + total_tax` CHECK, `tax_summary` jsonb, posting tuple with
shape CHECK, bilingual notes. Indexes: `ix_debit_notes_tenant_status`,
`ix_debit_notes_tenant_supplier`, `ix_debit_notes_ref_invoice`.

**`debit_note_lines`** — mirror supplier-invoice lines: `note_id` (CASCADE), `line_no`,
`invoice_line_id` FK → supplier_invoice_lines (RESTRICT; the reference chain),
`item_id`/`account_id` exactly-one, `qty` > 0, `unit_price` ≥ 0, `tax_code_id`,
`vat_recoverable`, `net_amount` > 0, `tax_amount` ≥ 0, `tax_snapshot` (BR-033), bilingual
descriptions, `note` 1–300. Index `ix_debit_note_lines_tenant_item`.

## §landed_costs / §landed_cost_allocations — the BASELINE (§2.10; PHASE-015 completes)

**`landed_costs`** — cost rows on a GRN (BASELINE ONLY here: allocation math +
remaining-qty constraint; the full workflow UI + entitlement activation are PHASE-015):

| Column | Type | Constraints / Notes |
|--------|------|---------------------|
| `grn_id` | uuid NOT NULL | FK → goods_receipts (RESTRICT) |
| `cost_no` | text NULL | tenant-unique; assigned at POST |
| `cost_type` | text NOT NULL | CHECK `('freight','customs','insurance','other')` |
| `vendor_id` | uuid NULL | FK → partners (the freight forwarder / customs agent) |
| `amount` | numeric(19,4) NOT NULL | CHECK > 0 |
| `allocation_method` | text NOT NULL DEFAULT 'VALUE' | CHECK `('VALUE','QTY')` — tenant-configured |
| `charge_account_id` | uuid NOT NULL | FK → accounts — the credit side (freight payable accrual, bank, or AP partner account) |
| `status` | text NOT NULL DEFAULT 'DRAFT' | CHECK `('DRAFT','POSTED','CANCELLED')` |
| `allocated_to_stock` / `allocated_to_cogs` | numeric(19,4) DEFAULT 0 | CHECK (POSTED ⇒ `allocated_to_stock + allocated_to_cogs = amount`) — the split is exact |
| posting/cancel tuples | | shape CHECKs as the family pattern |

Indexes: `ix_landed_costs_tenant_grn`, `ix_landed_costs_tenant_status`.

**`landed_cost_allocations`** — one row per GRN line: `landed_cost_id` (CASCADE),
`grn_line_id` + `item_id` + `warehouse_id` FKs, unique `(tenant_id, landed_cost_id,
grn_line_id)`, `qty_at_allocation` numeric(19,6) > 0, `remaining_qty` numeric(19,6) ≥ 0
CHECK `remaining_qty ≤ qty_at_allocation` — **the remaining-qty constraint** (§2.10: when
stock was already issued at the lower cost, allocation applies to remaining quantity only),
`allocated_amount` numeric(19,4) ≥ 0, `cogs_adjustment_amount` numeric(19,4) DEFAULT 0 ≥ 0 —
the issued-portion difference posting to a COGS-adjustment purpose (explicit, auditable,
never silent back-dating), `revalue_applied_at` timestamptz (the inventory revaluation
service's stamp). Allocation revalues the affected WAC/layers through the inventory
revaluation seam — purchasing never writes stock tables.

## §purchase_reallocations / §purchase_reallocation_lines — audited re-allocations (0017; §2.7)

**`purchase_reallocations`** — post-allocation re-allocation as AUDITED documents
(RECEIVABLES_AND_PAYABLES §3.3 — never edits): `payment_id` FK → payments (RESTRICT),
`supplier_id` FK, `reason` text 1–300 NOT NULL, `doc_no` tenant-unique,
`status` CHECK `('POSTED')` only — **the document IS the audited effect** (POSTED-at-create),
`total_amount` > 0, `executed_at`. Grants: SELECT/INSERT only for erp_app (append-only
audit trail by shape). Indexes: `ix_purchase_reallocations_tenant_payment`,
`ix_purchase_reallocations_tenant_supplier`.

**`purchase_reallocation_lines`** — the from→to pairs: `reallocation_id` (CASCADE),
`line_no`, `from_open_item_id` / `to_open_item_id` uuid NULL — exactly one may be NULL:
`to` NULL = un-allocate (return to on-account), `from` NULL = allocate an on-account
remainder (the explicit BR-027 on-account semantics); `amount` numeric(19,4) CHECK > 0;
direction CHECK (at least one side non-NULL). Index
`ix_purchase_reallocation_lines_tenant_doc`.

The service rewrites the payment's `treasury_allocations` rows inside the same
transaction under the CC-02 open-item lock, keeping INV-016 bounds; the partner subledger
is untouched (allocations are settlement metadata; the payment's AP_CONTROL line keeps its
1:1 provenance — INV-009).

## Reused substrates (no new columns)

- **`payments`** (PHASE-008, migration 0012) — the generic disbursement already carries
  `partner_id`, `allocated_amount`, `fx_gain_loss`; PHASE-011's AP payments post
  `DR AP_CONTROL (partner) · CR cash/bank` (G-10) with FX-difference lines on settlement
  (INV-008 mirror) through the treasury payment service.
- **`treasury_allocations`** (PHASE-008) — the INV-016 allocation substrate: AP
  allocations are rows with `payment_id` + `open_item_id` → `partner_subledger_entries`
  (AP side); FIFO suggestion + partial + on-account are service-level.
- **`partner_subledger_entries`** (PHASE-007, partners-owned) — supplier invoices (+),
  debit notes (−), payments (−), FX-difference and adjustment entries; INV-009 ties the
  open-item sum to `AP_CONTROL` from the first entry (opening AP settlement included).
- **`stock_moves.source_type`** — 0016 expands the CHECK with the purchasing sources
  (`goods_receipt`, `landed_cost`) so the inventory movement core can record provenance.

## Grants & roles (migrations 0016/0017)

Draft-lifecycle tables (0016, all twelve): `REVOKE ALL` then `SELECT, INSERT, UPDATE` for
`erp_app`; `SELECT` for `erp_readonly` and `erp_definer`. Re-allocation documents (0017):
`SELECT, INSERT` only for `erp_app` (append-only). RLS macro `erp.apply_tenant_policy` on
all fourteen tables; every one registered in the isolation suite's table registry
(`src/__db__/isolation/tables.registry.ts`) with generated A-test coverage (A1–A11) and
the registry negative proof.
