# TABLES — Automotive & Distribution Cluster (PHASE-017)

> **Status:** DELIVERED (PHASE-017, migration `0025_automotive_distribution.sql`) ·
> **Owner:** Database Architecture · **Updated:** 2026-11-02 · Column-level specs for
> the PHASE-017 cluster (workshop job cards + vehicles, the `distribution` module:
> routes/visits/van stock/settlements/tiers/free goods, and commissions), authored
> in-phase per the file header rule. ADR-0009 precision discipline throughout:
> quantities and unit costs/prices are `numeric(19,6)` (6-decimal internal), money
> quanta `numeric(19,4)`. All tables are draft-lifecycle (SELECT/INSERT/UPDATE for
> `erp_app`; POSTED immutability is service discipline + status↔posted-columns shape
> CHECKs) **except** `route_customers` + `van_stocks` which carry DELETE (composition
> full-replace / mirror rewrite). RLS macro on every table; the isolation registry
> covers each (A1–A11). No table here writes `journal_*`, `stock_*`, or
> `partner_subledger_*` — those stay owned by accounting, inventory, and partners
> respectively (MODULE_BOUNDARIES; ADR-0007). Module ownership note: the three
> distribution tables the pre-017 ENTITY_CATALOG listed under §sales (`routes`,
> `van_stocks`, `rep_settlements`) are reconciled to `distribution` here and in the
> catalog (per [../../architecture/MODULE_BOUNDARIES.md](../../architecture/MODULE_BOUNDARIES.md)).

## §vehicles — the per-partner vehicle registry (partners-owned; T5)

**`vehicles`** — one row per customer vehicle; the workshop's per-vehicle service
history reads this registry (UNION ALL over sales-owned job cards / invoices / credit
notes — read-only, the §6 read precedent). `partner_id` composite FK (RESTRICT);
`make` (1–60) + `model` NOT NULL, `model_year` CHECK 1900–2100, `chassis_no` CHECK
`^[A-HJ-NPR-Z0-9]{6,17}$` (VIN shape — no I/O/Q) **tenant-unique where set** (partial
unique index; two chassis-less vehicles coexist), `plate_no`, `color`, `engine_no`,
`odometer_km` numeric(12,1) + `odometer_at` date (last reading), `status` CHECK
`('ACTIVE','ARCHIVED')` — archive only, no delete (history keeps its references).
Indexes: `uq_vehicles_tenant_chassis` (partial), `ix_vehicles_tenant_partner`,
`ix_vehicles_tenant_plate` (partial).

## §job_cards / §job_card_lines — the workshop work order (sales-owned; T3/T4)

**`job_cards`** — DRAFT → IN_PROGRESS (approve) → COMPLETED → INVOICED + CANCELLED
(only from DRAFT/IN_PROGRESS — `ck_job_cards_cancel_requires_reason` demands
`cancelled_at` + `note` on CANCELLED rows; the cancel reason lives on `note`).
`card_no` (JC-) tenant-unique where set; `parts_issue_mode` CHECK
`('reserve','issue_immediate')` — the policy switch: `reserve` holds one JOB_CARD
reservation per PARTS line at approve and the invoice's own post issues stock (flow B);
`issue_immediate` posts the COGS journal + `job_card`-sourced OUT move at approval.
`vehicle_id` FK (RESTRICT) — the workshop provenance; `quotation_id` / `invoice_id` /
`credit_note_id` (no FKs — cross-document links stamped by the services);
`labor_hours_total` numeric(19,6) recomputed from live LABOR lines; bilingual
complaints/diagnosis/note. **No ledger effect before INVOICED anywhere** (invariant
asserted across the whole chain). Indexes: `uq_job_cards_tenant_card_no` (partial),
`ix_job_cards_tenant_status`, `ix_job_cards_tenant_vehicle`, `ix_job_cards_tenant_customer`.

**`job_card_lines`** — `line_no` unique per card; `line_type` CHECK `('PARTS','LABOR')`
— PARTS lines require STOCK-kind items, LABOR lines SERVICE-kind + `estimated_hours`
(CHECK: LABOR ⇒ estimated_hours NOT NULL; billing rides estimated_hours at the per-hour
rate — `qty` is line-count semantics); `status` CHECK
`('PENDING','RESERVED','ISSUED','INVOICED','CANCELLED')` — **tombstone-based
full-replace** (no DELETE grant: PUT parks rows at −line_no, patches provided ids in
place, tombstones unmentioned rows CANCELLED; every consumer skips CANCELLED lines);
`reservation_id` (the JOB_CARD hold), the issue snapshot `issue_unit_cost` /
`issue_value` / `issue_journal_id` (stamped by the posting port under
`issue_immediate`), `invoice_line_id` (stamped by the port at invoice — the
card-line↔invoice-line mapping the profitability report rides). Indexes:
`uq_job_card_lines_card_line`, `ix_job_card_lines_reservation` (partial).

## §customer_tiers + the partner assignment (distribution-owned; T11)

**`customer_tiers`** — the BR-003 tier level: `code` tenant-unique (shape
`^[A-Za-z0-9._-]{2,30}$`), `price_list_id` FK → price_lists (RESTRICT; must be
SALE-kind — service-level), `discount_cap_pct` numeric(5,2) CHECK 0–100,
`visit_frequency_days` CHECK ≥ 0, `status` CHECK `('ACTIVE','INACTIVE')` — inactive
tiers never resolve. Assignment rides **`partners.customer_tier_id`** (the additive
partners column; distribution writes through the partners store's tier-slice — the
documented VAN-slice precedent). Price resolution order: customer's own list →
**tier list (this level, new in 017)** → base price → manual; a quoted price is never
overridden. Index: `uq_customer_tiers_tenant_code`, `ix_partners_tenant_tier` (partial).

## §free_goods_rules — buy-X-get-Y (distribution-owned; T11; BR-008)

**`free_goods_rules`** — `rule_type` CHECK `('BUY_X_GET_Y')`, `buy_item_id` /
`buy_qty` / `get_item_id` / `get_qty` (qty CHECK > 0, 19,6), `per_multiple` boolean
(floor(bought/buy) multiples vs once), `max_free_per_order` CHECK ≥ 0, `tier_id` FK
(NULL = all customers; a null-customer evaluation never matches tier-scoped rules),
`reason_code` NOT NULL (the BR-008 FOC reason carried onto zero-price invoice lines),
`valid_from`/`valid_to` CHECK from ≤ to (NULL bounds open-ended), `status` CHECK
`('ACTIVE','INACTIVE')`. **The engine never posts** — evaluation is pure quantity
math; the invoice path owns stock issue + COGS (zero revenue + full cost per FOC
line). Index: `uq_free_goods_rules_tenant_code`.

## §routes / §route_customers / §route_visits — planning only (T7)

**`routes`** — `code` tenant-unique, `sales_rep_id` FK → sales_reps (must be ACTIVE),
`van_warehouse_id` FK → warehouses (must be VAN-type + active — the binding is
optional), `day_pattern` jsonb ⊆ MON..SUN (default MON–FRI; service validates — no
dupes, non-empty), `status` CHECK `('ACTIVE','INACTIVE')`. **No route or visit
operation ever writes a journal** (planning data only — asserted in the spec pack).
Index: `uq_routes_tenant_code`.

**`route_customers`** — composition: `customer_id` unique per route (RESTRICT FK;
customers must be CUSTOMER/BOTH kind), `visit_order` CHECK ≥ 0 (defaults to array
index), `is_pinned`. Full-replace (DELETE + INSERT — one of the two DELETE-granted
tables). Index: `uq_route_customers_route_customer`.

**`route_visits`** — planned per (route, customer, date) — idempotent by service
pre-read (deliberately NO unique index; re-plans skip existing triples);
`planned_date` date NOT NULL; `status` CHECK
`('PLANNED','COMPLETED','SKIPPED','MISSED')` — conditional UPDATEs
(`WHERE status='PLANNED' …RETURNING`) are the exactly-once anchors; check-in stamps
`checked_in_at` (double check-in → typed state error; complete does NOT require a
prior check-in — actuals may arrive from sales documents); completion links
`sales_invoice_id` / `credit_note_id` / `receipt_id` (EXISTS-validated against posted
documents); the missed sweep flips stale PLANNED∧never-checked-in rows. Indexes:
`ix_route_visits_tenant_date`, `ix_route_visits_tenant_route`,
`ix_route_visits_tenant_status`.

## §warehouses VAN widenings + §van_stocks — the van model (T8)

**`warehouses` (additive columns — the VAN slice)**: `type` CHECK
`('STANDARD','VAN')` DEFAULT `'STANDARD'` + `rep_id` (one VAN per rep — partial
unique index `uq_warehouses_tenant_rep` WHERE rep IS NOT NULL AND type='VAN').
Inventory's `insertWarehouse` predates the columns; van rows are inserted by the
distribution store (`insertVanWarehouse`, the documented VAN-slice exception) with
`inventory_account_id NULL` ⇒ the tenant INVENTORY purpose (the shared-account
no-journal default per §2.5/G-15 policy-none). STANDARD warehouses remain
inventory's exclusively. Load-out/unload are ordinary `stock_transfers`
(TRN-numbered by the inventory module — INV-021; the manifest's `LOD-` series is
seeded but not consumed); in-transit van stock is visible but never sellable (BR-016).

**`van_stocks`** — the read-model mirror: one row per (warehouse VAN, item, batch)
with `qty` numeric(19,6) CHECK ≥ 0 + `value` numeric(19,4) (WAC carried) +
`refreshed_at`. Refresh is DELETE+INSERT scoped to the van slice inside the owning
transaction (the granted DELETE) — Σ signed `stock_moves` at the van == mirror qty
(conservation tie asserted by the spec and the `van-conservation-tie` report
assertion); `stock_moves` stays the source of truth. Unique index
`uq_van_stocks_key` (tenant, warehouse, item, COALESCE(batch, zero-uuid)) — the
batch-null coalesce pattern.

## §rep_settlements / §rep_settlement_lines — the day-end settlement (T10)

**`rep_settlements`** — STL- reserves at POST (INV-021; `uq_rep_settlements_tenant_no`
partial). `settlement_date` + `sales_rep_id` unique among live rows
(`uq_rep_settlements_rep_day` WHERE status <> 'CANCELLED' — **the day lock**: one
settlement per rep per day; POSTED rows are immutable, corrections are new documents).
Status CHECK `('DRAFT','COUNTED','APPROVED','POSTED','CANCELLED')`; money columns
19,4: `opening_cash` + the read-model components (`cash_sales`, `collections`,
`cash_refunds`, `rep_expenses`) + `expected_cash` (= opening + sales + collections −
refunds − expenses), `counted_cash`, `variance` + `variance_direction` CHECK
`('SHORTAGE','SURPLUS','NONE')` + `variance_reason` (CHECK: any non-NONE direction ⇒
reason NOT NULL — a reason is required for ANY non-zero variance, within tolerance
included) + `variance_journal_id` (CHECK: POSTED ⇒ NOT NULL — zero-variance posts
carry the exported `NO_VARIANCE_JOURNAL_ID` sentinel since a balanced zero journal is
impossible); the optional bank-deposit leg (`deposit_account_id` /
`deposit_amount` / `deposit_journal_id`); approval + posted/cancelled stamps
(BR-034 creator ≠ approver by default; beyond-tolerance or an active approval policy
gates post). The rep cash account is resolved through the OPENING_CASH line's source
reference (`source_type='cash_account'`) — the settlement table deliberately carries
no `cash_account_id` column (no rep→account mapping exists anywhere).

**`rep_settlement_lines`** — the signed component ledger: `component` CHECK
(`'OPENING_CASH','CASH_SALE','COLLECTION','CASH_REFUND','REP_EXPENSE','VARIANCE',`
`'BANK_DEPOSIT'`), `amount` 19,4 **signed** (refunds/expenses/variance/deposit
negative) so **Σ lines = expected_cash** (after post: counted − deposit);
`source_type`/`source_id` document refs. Upsert by (settlement, line_no) with a
zeroed stale tail on recount — recount tombstones ("superseded by recount", amount 0)
never pollute Σ (no DELETE grant). Index: `uq_rep_settlement_lines_settlement_line`.

## §commission_runs / §commission_run_lines + §sales_reps rule columns (T12)

**`sales_reps` (additive rule columns)**: `commission_method` CHECK
`('NONE','PERCENTAGE')` DEFAULT 'NONE', `commission_rate` numeric(7,4) CHECK 0–100,
`commission_basis` CHECK `('INVOICED','COLLECTED')` DEFAULT 'INVOICED',
`commission_tiers` jsonb (bands `[{upTo, rate}]` ascending, last open — portionᵢ =
min(base, upToᵢ) − min(base, upToᵢ₋₁); one half-up rounding at the end).

**`commission_runs`** — one basis per run (`basis` CHECK `('INVOICED','COLLECTED')`),
`period_from` ≤ `period_to`; status CHECK `('DRAFT','POSTED','CANCELLED')` — DRAFT
recomputable, POSTED immutable (corrections reverse the accrual journal, INV-014),
CANCELLED DRAFT-only + terminal; `total_base` / `total_commission` 19,4; `ck_…posted_shape`:
POSTED ⇒ posted_at + journal_entry_id (the single accrual journal, source
`commission_run:accrual`, entry dated **period_to** — matching principle). No number
series (the id is the reference). Index: `ix_commission_runs_tenant_period`.

**`commission_run_lines`** — one row per (run, rep) (`uq_commission_run_lines_run_rep`);
`base_amount` × `rate_applied` (flat rate, or the effective rate commission÷base×100 for
tiered) = `commission_amount` 19,4; `detail` jsonb (bands breakdown + the three
components invoicedNet/creditedNet/collectedNet regardless of basis); `payout_status`
CHECK `('ACCRUED','PAID')` + `payment_id` (payout rides treasury payments). Basis-mismatch
reps get **zero note-lines** (`detail.excluded`, reason BASIS_MISMATCH) so the
commissions-due statement explains their absence — note-lines never produce a DR line.
Recompute is per-rep UPSERT (dropped reps zeroed with `detail.dropped` — no DELETE grant).

## Widenings, the BR-008 relaxation & the CoA markers (0025)

- **`sales_invoices`** gains `job_card_id` + `vehicle_id` (provenance: the card→invoice
  chain + per-vehicle history; partial indexes on both).
- **`sales_invoice_lines`** gains `foc_reason_code` — and 0018's
  `ck_sales_invoice_lines_net_positive` is **re-issued additively** as
  `net_amount > 0 OR foc_reason_code IS NOT NULL`: a FOC line is a zero-price line WITH
  a reason; it still issues stock and posts full COGS (revenue side zero — BR-008).
- **`credit_notes`** gains `job_card_id` (the warranty-note provenance; partial index).
- **`stock_reservations`** holder widens with `'JOB_CARD'`; **`stock_moves`** source
  widens with `'job_card'` (the issue-at-approval move); **`cash_movements`** source
  widens with `'rep_settlement'` (variance + deposit legs — written through
  `treasuryStore.insertCashMovement`, treasury's own writer; the deposit legs carry
  `source_id` = the deposit journal entry id so `uq_cash_movements_source_side` holds).
- **CoA template markers (additive):** `2150 COMMISSION_ACCRUAL` (LIABILITY under 2100)
  + `5250 COMMISSION_EXPENSE` (EXPENSE under 5200) — the commission accrual pair — and
  the `4200` row's purpose gains `SERVICE_REVENUE` (labor revenue lines; UPDATE only
  where NULL). Existing tenants map once — fail-closed `PURPOSE_NOT_MAPPED` until then
  (the `CARD_RECEIVABLE`/DR-016-02 precedent).

## Grants & roles (migration 0025)

Draft-lifecycle tables: `REVOKE ALL` then `SELECT, INSERT, UPDATE` for `erp_app` on
`vehicles`, `job_cards`, `job_card_lines`, `customer_tiers`, `free_goods_rules`,
`routes`, `route_visits`, `rep_settlements`, `rep_settlement_lines`,
`commission_runs`, `commission_run_lines` ("status-lifecycled — no tombstone deletes";
documented service-level deviations: job-card line full-replace and settlement/commission
recount are tombstone/upsert shapes). `SELECT, INSERT, UPDATE, DELETE` on
`route_customers` (composition full-replace) + `van_stocks` (mirror rewrite).
Additive `SELECT, UPDATE` on `warehouses`, `partners`, `sales_reps`, `sales_invoices`,
`sales_invoice_lines`, `credit_notes`, `stock_reservations` (the VAN/tier/commission/
provenance slices — owning-module writes stay put). `SELECT` for `erp_readonly` on the
new tables; `erp_definer` read surface incl. the widened substrates. RLS macro
`erp.apply_tenant_policy` on all fourteen tenant-owned tables; every one registered in
the isolation suite's table registry with generated A-test coverage (A1–A11).
