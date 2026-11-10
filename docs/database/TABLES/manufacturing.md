# TABLES — Manufacturing Cluster (PHASE-018)

> **Status:** DELIVERED (PHASE-018, migration `0026_manufacturing.sql`) ·
> **Owner:** Database Architecture · **Updated:** 2026-11-02 · Column-level specs for
> the PHASE-018 cluster (bills of materials + lines, production orders + lines,
> consumptions, scraps, QC inspections), authored in-phase per the file header rule.
> ADR-0009 precision discipline throughout: quantities and unit costs/rates are
> `numeric(19,6)` (6-decimal internal), money quanta `numeric(19,4)`, percentages
> `numeric(7,4)`. All tables are draft-lifecycle (SELECT/INSERT/UPDATE for `erp_app`;
> posted/terminal immutability is service discipline + status↔stamped-columns shape
> CHECKs) **except** `bom_lines` which carries DELETE (the DRAFT full-replace — the
> only delete grant in the cluster). RLS macro on every table; the isolation
> registry covers each (A1–A10). No table here writes `journal_*` or `stock_*` —
> those stay owned by accounting and inventory respectively (MODULE_BOUNDARIES;
> ADR-0007: production journals flow only through the centralized posting engine,
> stock moves only through the inventory movement core).

## §bills_of_materials / §bom_lines — the versioned recipe (manufacturing-owned)

**`bills_of_materials`** — one version per (item, `version_no`); `status` CHECK
`('DRAFT','ACTIVE','ARCHIVED')` with **exactly one ACTIVE version per item**
(partial unique `uq_bills_of_materials_active_item` WHERE status='ACTIVE' — the
level-1 explosion resolves the ACTIVE version; activate archives the previous
ACTIVE in the same transaction). `item_id` + `output_uom_id` composite FKs
(RESTRICT); `yield_pct` numeric(7,4) NOT NULL DEFAULT 100.0000 with CHECK
`0 < yield_pct <= 100` — stored **per version** (80.0000 = 80%; the §3 explosion
divides by yield/100); `effective_from` date NULL; `activated_at`/`archived_at`
stamps; bilingual note. Indexes: `uq_bills_of_materials_tenant_item_version`,
`uq_bills_of_materials_active_item` (partial), `ix_bills_of_materials_tenant_status`.

**`bom_lines`** — `line_no` unique per BOM (`uq_bom_lines_bom_line`);
`component_item_id` + `uom_id` composite FKs (RESTRICT); `qty_per_output`
numeric(19,6) CHECK > 0 (per one output UoM of the recipe item);
`scrap_pct` numeric(7,4) NOT NULL DEFAULT 0 CHECK ≥ 0 (per component line — the
§3 gross requirement multiplies by (1 + scrap_pct/100)); bilingual note.
**DELETE granted** — DRAFT edits are a full-replace (delete + re-insert by the
service); ACTIVE/ARCHIVED versions are immutable by service discipline.
Index: `ix_bom_lines_tenant_component`.

## §production_orders / §production_order_lines — the PRD- work order

**`production_orders`** — DRAFT → RELEASED (number reserved + bound via
NumberingService, BOM bound + level-1 snapshot) → IN_PROGRESS (start) →
COMPLETED (complete: FG receipt + journals, closes) / CANCELLED
(DRAFT/RELEASED/IN_PROGRESS with ZERO consumption rows only — typed error
otherwise). `status` CHECK `('DRAFT','RELEASED','IN_PROGRESS','COMPLETED','CANCELLED')`;
`order_no` tenant-unique where set (partial `uq_production_orders_tenant_no` —
PRD-{yyyy}-{seq:5}, per-branch, reserved at release, INV-021);
`ck_production_orders_cancel_requires_reason` mirrors the job-card pattern but on
the dedicated column: CANCELLED ⇒ `cancelled_at` + `cancel_reason` NOT NULL.
`bom_id` FK NULL (bound at release); `branch_id`/`item_id`/`uom_id`/
`materials_warehouse_id`/`fg_warehouse_id` composite FKs (RESTRICT);
`planned_qty` CHECK > 0; `actual_qty` DEFAULT 0; `labor_rate`/`overhead_rate`
numeric(19,6) DEFAULT 0 (simple configured absorption — no shop-floor time
capture, documented limitation); `cost_center_id` uuid NULL (no FK — the
job_cards cross-document precedent); `yield_snapshot` numeric(7,4) NULL (the
bound version's yield at release); the completion stamps `fg_batch_id` /
`fg_journal_id` + the 19,4 costing columns `fg_value` / `wip_credit_value` /
`labor_value` / `overhead_value` (per-order WIP nets to EXACTLY zero at
completion — Σ consumptions.value − Σ scraps.value = wip_credit_value).
Indexes: `uq_production_orders_tenant_no` (partial),
`ix_production_orders_tenant_status`, `ix_production_orders_tenant_item`.

**`production_order_lines`** — the frozen level-1 explosion snapshot bound at
release: `uq_production_order_lines_order_line` (tenant, order, line_no);
`component_item_id`/`uom_id` composite FKs; `planned_qty` numeric(19,6);
`scrap_pct` numeric(7,4); `actual_qty` DEFAULT 0 (accumulated per component);
`over_plan` boolean DEFAULT false — flagged **once** when cumulative consumption
crosses planned × (1 + threshold%) (the §5 variance review; consumption is never
blocked — correction is an adjusted consumption). Index:
`ix_production_order_lines_tenant_order_item`.

## §production_consumptions — batch-linked material issues

One row per consumed component **batch**; the consume call posts ONE journal
(`production_order:consume` — DR WIP · CR the materials warehouse's inventory
account at actual issue cost, per batch) and issues stock through the inventory
movement core (`planIssue`/`applyIssue`, source_type `production_order`,
INV-018 atomic). `order_id`/`item_id` composite FKs (RESTRICT); `batch_id` uuid
NULL (no FK — the cross-module link precedent; genealogy reads join it against
`item_batches`); CHECKs: qty > 0, unit_cost ≥ 0, value > 0; `journal_id` uuid
NULL (the anchor — stock/journal linkage written at INSERT); `consumed_at`
timestamptz NOT NULL. Indexes: `ix_production_consumptions_tenant_order`,
`ix_production_consumptions_tenant_item`, `ix_production_consumptions_tenant_batch`
(partial WHERE batch_id IS NOT NULL — the genealogy upstream edge).

## §production_scraps — reason-coded WIP scrap (pre-completion)

`order_id` composite FK; `reason_code` text NOT NULL CHECK char_length 1..40
(policy `manufacturing.scrap_reason_required` defaults true); qty CHECK > 0;
value numeric(19,4) CHECK > 0 — user-entered, ≤ the order's running WIP balance
(service-enforced; the migration deliberately carries no ≤-WIP CHECK);
`journal_id` (the `production_order:scrap` anchor — DR PRODUCTION_SCRAP · CR
WIP); `scrapped_at` NOT NULL. **NO stock move** — stock physically left at
consumption; the QC-fail post-completion scrap is the separate qc_scrap flow
(stock issue move from the FG warehouse). Index:
`ix_production_scraps_tenant_order`.

## §inspections — QC pass/fail + dispositions

`target_type` CHECK `('production_order','goods_receipt')` with the target-shape
CHECK (production_order ⇒ order_id NOT NULL; goods_receipt ⇒ grn_id NOT NULL);
`order_id` FK NULL → production_orders, `grn_id` FK NULL → goods_receipts
(composite RESTRICT); `fg_batch_id` uuid NULL (no FK — the quarantine subject);
`result` CHECK `('PASS','FAIL')`; `sampled` boolean DEFAULT false +
`sample_size` int NULL (pass/fail on the sample); `disposition` NULL or CHECK
`('ACCEPT','SCRAP','REWORK','RETURN_TO_SUPPLIER')` with the fail-shape CHECK
(`result='PASS' OR disposition IS NOT NULL` — a disposition is required on
FAIL); `inspected_at` NOT NULL. PASS + ACCEPT (or PASS with no disposition)
releases a QUARANTINED FG batch to ACTIVE — **no journal**; FAIL + SCRAP routes
to the qc_scrap flow; FAIL + REWORK stays QUARANTINED; FAIL + ACCEPT is the
audited operator override; RETURN_TO_SUPPLIER is record-only (GRN targets).
Indexes: `ix_inspections_tenant_order` (partial WHERE order_id IS NOT NULL),
`ix_inspections_tenant_grn` (partial WHERE grn_id IS NOT NULL).

## Widenings, the quarantine state & the CoA markers (0026)

- **`item_batches.status`** widens to `('ACTIVE','QUARANTINED','WRITTEN_OFF')` —
  the QC gate (policy `manufacturing.qc_gate`, default off) completes the FG
  batch in QUARANTINED; `listFefoBatches` already filters status='ACTIVE' so
  FEFO auto-pick and availability exclude quarantined stock, and an
  explicit-batch issue on a QUARANTINED batch throws the typed
  `BATCH_QUARANTINED` (409) from the movement core.
- **`item_batches.production_order_id`** uuid NULL + composite FK →
  production_orders (RESTRICT) — set once at completion via the inventory
  store's provenance link (never re-pointed; the genealogy upstream edge).
  Partial index `ix_item_batches_tenant_production_order`.
- **`stock_moves.source_type`** widens with `'production_order'` (the
  consume/completion moves; full 0025 list re-issued + the new value).
- **`warehouses.role`** text NULL CHECK IN ('RAW','WIP','FG') — convention tag
  only (WarehouseService.create/update accept it); no behavior depends on it.
- **`items.shelf_life_days`** integer NULL — service-validated 1..3650; the FG
  batch expiry = completion date + shelf_life_days when the policy
  `manufacturing.fg_batch_expiry_from_shelf_life` is on (default true).
- **CoA template markers (additive):** `1160 WIP` (ASSET, parent 1100) +
  `5120 PRODUCTION_SCRAP` (EXPENSE, parent 5000) + the `5400` absorption group
  (EXPENSE, parent 5000, purpose NULL) with leaves `5410 PRODUCTION_LABOR` +
  `5420 PRODUCTION_OVERHEAD` (the completion journal's absorbed credit lines —
  required fail-closed `PURPOSE_NOT_MAPPED` only when the corresponding rate
  > 0). Existing tenants map once (the CARD_RECEIVABLE precedent DR-016-02).

## Grants & roles (migration 0026)

Draft-lifecycle tables: `SELECT, INSERT, UPDATE` for `erp_app` on
`bills_of_materials`, `production_orders`, `production_order_lines`,
`production_consumptions`, `production_scraps`, `inspections`
("status-lifecycled — no tombstone deletes"; the only sanctioned delete is the
bom_lines DRAFT full-replace). `SELECT, INSERT, UPDATE, DELETE` on `bom_lines`.
Additive `SELECT, UPDATE` on `item_batches`, `items`, `warehouses` (the
provenance/shelf-life/role slices — owning-module writes stay put; column
grants ride the table grants). `SELECT` for `erp_readonly` on the new tables;
`erp_definer` read surface incl. the widened substrates. RLS macro
`erp.apply_tenant_policy` on all seven tenant-owned tables; every one
registered in the isolation suite's table registry with generated A-test
coverage (A1–A10). The 0026 permission seeds (8 `manufacturing.*` keys) +
plan grants (the 7 manufacturing feature keys join business — enterprise
already carried them from the 0008 base seed) + role-template grants
(owner full set; viewer/accountant the read tier; warehouse view/create +
QC) + the `industry.food_manufacturing` v1.0.0 manifest seed (verbatim from
docs/industries/templates/manifests/manifest.food_manufacturing.json).
