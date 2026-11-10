# TABLES — Sales & Receivables Cluster (PHASE-012; POS core 016)

> **Status:** DELIVERED (PHASE-012, migrations 0018/0019; POS core added by PHASE-016,
> migration 0024; commerce channel staging added by PHASE-023, migration
> `0035_external_integrations.sql`) · **Owner:** Database Architecture ·
> **Updated:** 2026-11-05 · Column-level specs for the PHASE-012 cluster, authored in-phase per
> the file header rule, plus the PHASE-016 POS core that lands in this cluster (terminal
> registry, floor service, the sales-invoice POS channel, and the narrow sync slice).
> ADR-0009 precision discipline throughout: quantities and unit
> costs/prices are `numeric(19,6)` (6-decimal internal), money quanta `numeric(19,4)`, FX
> rates `numeric(19,8)`. All tables are draft-lifecycle (SELECT/INSERT/UPDATE for `erp_app`;
> POSTED immutability is service discipline + status↔posted-columns shape CHECKs, mirroring
> the treasury/purchasing pattern) **except** `sales_reallocations`/`sales_reallocation_lines`
> (0019: SELECT/INSERT only — the audit trail is append-only by shape). RLS macro on every
> table; the isolation registry covers each (A1–A11). No table in this cluster writes
> `journal_*`, `stock_*`, or `partner_subledger_*` — those stay owned by accounting,
> inventory, and partners respectively (MODULE_BOUNDARIES; ADR-0007).

## §sales_reps — the representative registry (§2.10)

**`sales_reps`** — sales-rep records with attribution on documents (commissions are
explicitly PHASE-017 — no computation here): `code` tenant-unique (1–40), `name` (1–200),
`name_ar`, `email`/`phone` optional, `status` CHECK `('ACTIVE','INACTIVE')`. Index
`ix_sales_reps_tenant_status (tenant_id, status, code)`.

## §quotations / §quotation_lines — offers (§2.1; BR-006; DOCUMENT_LIFECYCLE §3)

**`quotations`** — no ledger effect; `quote_no` reserves at SENT (QOT-, BR-029's first
outbound state) — `uq_quotations_tenant_no`; `valid_until` NOT NULL (the service derives
`quote_date + sales.quote_default_validity_days` = 30; `ck_quotations_validity` enforces
validity ≥ date). State shapes: `ck_quotations_sent_shape` (SENT/ACCEPTED ⇒ sent_at/by +
quote_no), `ck_quotations_accepted_shape` (ACCEPTED ⇒ accepted_at/by +
`converted_order_id` FK → sales_orders), rejected/cancelled shapes mirror. Totals CHECK
`gross = net + tax`. Indexes: `ix_quotations_tenant_status (tenant_id, status, quote_date)`,
`ix_quotations_tenant_customer`.

**`quotation_lines`** — `quotation_id` (CASCADE), `line_no` (unique per quote), `item_id`
FK (RESTRICT), qty `numeric(19,6) > 0`, `unit_price ≥ 0`, discount ≥ 0, tax_code_id FK,
net/tax ≥ 0 (BR-003 resolution at create; manual override within BR-002 ceilings is
service-level).

## §sales_orders / §sales_order_lines — confirmed orders (§2.2)

**`sales_orders`** — the source of deliveries and invoices; `order_no` reserves at ISSUE
(SOR-). `warehouse_id` FK NOT NULL (targeting), `quotation_id` FK NULL (the conversion
chain), state shapes mirror the quotations (issued/approved/cancelled), totals CHECK.
Indexes: `ix_sales_orders_tenant_status`, `ix_sales_orders_tenant_customer`.

**`sales_order_lines`** — carry the optional **soft reservation** reference:
`reservation_id` FK → `stock_reservations` (ON DELETE SET NULL — the PHASE-010 seam;
holder_type `'SALES_ORDER'`, expiry honored by the sweep, availability nets ACTIVE
non-expired rows; non-blocking by design). `net_amount > 0` (an order line is never
zero-priced — free goods are invoice-level per BR-008).

## §delivery_notes / §delivery_note_lines — goods-out (§2.3; BR-007; golden G-03)

**`delivery_notes`** — POSTED issues stock through `inventory.issueStock` + posts the COGS
journal (`DR COGS · CR INVENTORY` at issue cost) **without AR**; `converted_invoice_id`
FK → sales_invoices (flow A); `cogs_value` records the issue total; posted shape CHECK
ties `status='POSTED'` ⇔ posting_date/by/at + posted_journal_id + delivery_no (DEL-).
Indexes: `ix_delivery_notes_tenant_status`, `ix_delivery_notes_tenant_customer`.

**`delivery_note_lines`** — `order_line_id` FK NULL (order provenance), batch capture at
issue (BR-017 FEFO picks when unspecified; explicit `batch_id` binds), `serial_ids` jsonb,
and the **issue-cost snapshot** `issue_unit_cost`/`issue_value` (`ck_..._issue_shape`
pairs them) — the W-3 original-cost provenance later credit notes re-enter at.

## §sales_invoices / §sales_invoice_lines — billing (§2.4; POSTING_ENGINE §4; goldens G-01/G-02/G-03; W-1)

**`sales_invoices`** — `kind` CHECK `('CASH','CREDIT')` (`ck_..._cash_shape`: CASH ⇒
`cash_account_id` NOT NULL); `invoice_no` (SAL-) reserves at posting —
`uq_sales_invoices_tenant_no` (INV-021); `due_date ≥ invoice_date` (`ck_..._due_after`);
flow shapes: `ck_..._goods_shape` (`warehouse_id IS NULL OR delivery_id IS NULL` — flow A
(stock/COGS at the DN) vs flow B (with-goods, the invoice issues + posts its own COGS via
`posted_cogs_journal_id`)); `credit_check` jsonb records the BR-001 decision at approval
(posture, math, override — the UI only reflects it); `tax_summary` jsonb (INV-012);
`offline_receipt_no` (the `OFF-` number recorded alongside the official number at
sync-time posting — live since PHASE-016) + `einvoice_status` (PHASE-023, stays NULL).
The AR aging index `ix_sales_invoices_tenant_customer_due (tenant_id, customer_id,
due_date)` — EXPLAIN-verified for the statement/aging surfaces; plus status/order/delivery
indexes.

**`sales_invoice_lines`** — item XOR account (`ck_..._target`); `delivery_line_id` FK
(flow A link); **`tax_snapshot` jsonb** stamped per line (BR-033 — posting re-resolves
deterministically and REFUSES a mismatch, never silently recomputes); batch/serial
capture + the issue-cost snapshot (`issue_unit_cost`/`issue_value` — flow B stamped at
post, flow A copied from the DN line at conversion; the credit-note re-entry source).

## §credit_notes / §credit_note_lines — AR corrections/returns (§2.5; BR-004; golden G-04; W-3)

**`credit_notes`** — `invoice_id` FK NOT NULL (**the reference requirement never
disables** — BR-004); the return window is a service check
(`sales.return_window_days` = 14, 0 = dates off); `note_no` (CRN-) at posting;
`reentry_value` records the re-entry total; posted/cancelled shape CHECKs mirror the
invoices. Indexes: `ix_credit_notes_tenant_status`, `ix_credit_notes_tenant_invoice`.

**`credit_note_lines`** — `invoice_line_id` FK NOT NULL (per-line mandatory reference),
`return_to_stock` boolean; `ck_..._reentry_shape`: return ⇒ item + `reentry_unit_cost` +
`reentry_value` (snapshotted from the referenced invoice line — the ORIGINAL issue cost,
batch preserved, serial binds the originally sold unit per BR-018 — never a
current-average recompute).

## §sales_reallocations / §sales_reallocation_lines — audited re-allocations (0019; §2.7)

**`sales_reallocations`** — the AR mirror of 0017: post-allocation re-allocation as
AUDITED documents (RECEIVABLES_AND_PAYABLES §3.3 — never edits): `receipt_id` FK →
receipts (RESTRICT), `customer_id` FK, `reason` 1–300 NOT NULL, `doc_no` (SRA-)
tenant-unique, `status` CHECK `('POSTED')` only — **the document IS the audited effect**
(POSTED-at-create), `total_amount` > 0. Grants: SELECT/INSERT only (append-only).

**`sales_reallocation_lines`** — from→to pairs with the explicit BR-027 on-account
semantics (exactly one side may be NULL: `to` NULL = un-allocate, `from` NULL = allocate
an on-account remainder); `amount` > 0.

## POS core — terminal registry, floor service & the POS channel (PHASE-016, migration 0024)

Brief specs for the `pos` module's server tables (the device-local SQLite mirror is
[LOCAL_DATABASE.md §1.1](../../offline/LOCAL_DATABASE.md) — owned by `@erp/sync-core`).

**`pos_terminals`** — the terminal registry (T2): one row per branch counter — `code`
tenant-unique (shape `^[A-Za-z0-9._-]{2,30}$`), `branch_id`, till `cash_account_id`
(treasury CASH), optional `device_id` (one terminal = one device; unique per tenant
where set), default `warehouse_id` for flow-B issues, `receipt_size` CHECK
`('80mm','58mm')`, `quick_keys` jsonb, `status` CHECK `('ACTIVE','INACTIVE')` —
activate/deactivate only (documents reference terminals, no delete) — `offline_seq`
(the terminal-scoped `OFF-` sequence) and `last_seen_at`/`activated_at`/`deactivated_at`.
Indexes: `uq_pos_terminals_tenant_code`, `uq_pos_terminals_tenant_device` (partial),
`ix_pos_terminals_tenant_branch`.

**`pos_tables` / `pos_checks`** — the ledger-free floor (T6): `pos_tables` (zone, label,
seats CHECK 1–40, status `FREE|OCCUPIED|RESERVED|OUT_OF_SERVICE`, sort_key) and
`pos_checks` (`check_no` tenant-unique, `table_id`, `order_type` CHECK
`DINE_IN|TAKEAWAY|DELIVERY|COUNTER`, `guest_count` 1–50, status `OPEN|PAID|CANCELLED`,
`lines` jsonb — the working order document behind send/merge/transfer/split,
`invoice_id` → sales_invoices at payment). **An unpaid open check holds NO ledger
effect**; the check converts to a `channel='POS'` sale at payment and only then posts.

**`pos_kitchen_tickets`** — printed kitchen tickets from open checks (print-only — screen
KDS is a roadmap extension): `ticket_no` tenant-unique, `items` jsonb, status
`PRINTED|VOID`, `printed_at`.

**Widenings (0024)**: `sales_invoices` gains the POS channel columns — `channel` CHECK
`('STANDARD','POS')` DEFAULT `'STANDARD'` (existing rows and back-office views
unchanged), `pos_terminal_id`, `order_type` (NULL outside POS), `pos_table_id`
(paid-check provenance), `tenders` jsonb (the cash/card split record — the G-02 debit
split: cash → till, card → `CARD_RECEIVABLE`); index `ix_sales_invoices_tenant_channel_terminal`.
`cashier_shifts` gains `pos_terminal_id` + `denominations` jsonb (per-denomination blind
count BR-021) + `blind_count` (DEFAULT true) — runtime writes stay treasury-owned
through its published service (MODULE_BOUNDARIES). `devices` gains the `pos-terminal`
platform value + `capabilities`/`tenant_id`/`terminal_id`. The narrow sync slice —
`change_log` (POS feed group: items/barcodes/uoms/price_list_items/partners/tax_codes)
and `sync_cursors` (per-device × entity-type pull positions) — was
[SYNC_PROTOCOL.md §11](../../offline/SYNC_PROTOCOL.md)'s boundary in schema form until
PHASE-020 generalized it (migrations 0029–0031: `tombstones` + `inbox_commands` +
`device_refresh_tokens` + the `devices` registry widening + `owner_device_id` — the
full column specs now live in [sync.md](sync.md)). The
CoA template gains the additive `CARD_RECEIVABLE` marker (1151 — fail-closed
`PURPOSE_NOT_MAPPED` until the tenant maps it; [DR-016-02](../../decisions/DR-016-02-card-receivable-mapping.md)).
Grants: SELECT/INSERT/UPDATE on the six new tables for `erp_app`, SELECT for
`erp_readonly`/`erp_definer`; RLS macro on every tenant-owned table.

## Commerce channel staging — imported channel orders (PHASE-023, migration `0035_external_integrations.sql`)

The `sales/adapters/commerce` substrate (T8): channel orders pulled through the
`CommerceChannelPort` (the fake adapter ships first — no real channel is claimed)
staged for the **server-decision conflict policy** behind the new permission
`sales.commerce.manage` (catalog 243→244, drift-green). Both tables are RLS'd +
registry-isolated; grants: SELECT/INSERT/UPDATE on orders (no DELETE — import
history is bookkeeping), full CRUD on imports.

**`commerce_channel_orders`** — staged orders, upsert by natural key
`uq_commerce_channel_orders_natural (tenant_id, channel_adapter_id,
channel_order_id)`: a re-import whose FINANCIAL fields differ flags `CONFLICT`
with the previous payload preserved in `conflict_detail` (jsonb); resolution is
an explicit human decision (`KEEP_EXISTING` / `TAKE_INCOMING` — ADR-0012, never
last-write-wins; an unresolved conflict swallows further re-imports as conflict
signals). Columns: `channel_adapter_id` (ck length 2–40), `channel_order_id` (ck
length 1–120), `payload` jsonb (the pulled order verbatim), `status` CHECK
`('IMPORTED','CONFLICT','RESOLVED')` DEFAULT `'IMPORTED'`, `conflict_detail`
jsonb, `import_batch_id` uuid (soft link to the batch — no FK), `resolved_by`/
`resolved_at`/`resolution` (the resolution audit). Index:
`ix_commerce_orders_tenant_status (tenant_id, channel_adapter_id, status)`.

**`commerce_channel_imports`** — batch bookkeeping: `uq_commerce_imports_batch
(tenant_id, channel_adapter_id, batch_key)` is the **Idempotency-Key per batch**
(a duplicate batch replays the RECORDED outcome without re-pulling — the webhook
ingest discipline); `cursor_before`/`cursor_after` jsonb (the channel cursor
moves only on a completed pull), counters `pulled_count`/`imported_count`/
`skipped_count`/`conflict_count` (what the UI surfaces), `status` CHECK
`('COMPLETED','FAILED')` DEFAULT `'COMPLETED'`, `error` text.

## Reused substrates (no new columns)

- **`receipts`** (PHASE-008, migration 0012) — the money leg rides the treasury service
  wholesale: PHASE-012 posts `DR cash/bank · CR AR_CONTROL (partner)` with the W-2
  FX-gain/loss residual lines at settlement (INV-008 stored rate) and the settlement +
  on-account control legs split explicitly. The 0019 header records the reconciliation:
  the "receipts gains AR-allocation rows/columns" design item is satisfied by the
  existing substrate (`treasury_allocations.receipt_id` + `allocated_amount`).
- **`treasury_allocations`** (PHASE-008) — the INV-016 allocation substrate for receipts;
  the re-allocation service rewrites them under the CC-02 lock and re-syncs
  `receipts.allocated_amount`.
- **`partner_subledger_entries`** (PHASE-007) — invoices (+), credit notes (−), receipts
  (−), FX residual entries; INV-009 ties the open-item sum to `AR_CONTROL` from the first
  entry (opening AR settlement included, G-16 AR side).
- **`stock_moves.source_type`** — 0018 expands the CHECK with `delivery_note`,
  `sales_invoice`, `credit_note`; **`cash_movements.source_type`** gains `sales_invoice`
  (the G-02 counter-payment movement, INV-019).

## Grants & roles (migrations 0018/0019)

Draft-lifecycle tables (0018, all twelve): `REVOKE ALL` then `SELECT, INSERT, UPDATE` for
`erp_app`; `SELECT` for `erp_readonly` and `erp_definer`. Re-allocation documents (0019):
`SELECT, INSERT` only for `erp_app` (append-only). RLS macro `erp.apply_tenant_policy` on
all fourteen tables; every one registered in the isolation suite's table registry
(`src/__db__/isolation/tables.registry.ts`) with generated A-test coverage (A1–A11) and
the registry negative proof.
