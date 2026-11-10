# PHASE-018 — Manufacturing & Production · MASTER PLAN (binding for all task agents)

Repo: `/home/z/phase017_work` (pnpm monorepo). Phase contract:
`docs/implementation/phases/PHASE-018.md`. This file is the **binding design** for the
phase; where the phase doc is ambiguous, THIS file's decisions apply (each is marked
DECISION). Task agents write per-task evidence to `agent-ctx/` and MUST NOT touch files
owned by other tasks. Isolated test runs use a private `TMPDIR=$HOME/tmp-<task>`.

## 1. Canonical journal map (final — extends POSTING_ENGINE.md §4)

| Operation (source key) | Journal |
|---|---|
| Consumption (`production_order:consume`) | **DR WIP (purpose `WIP`) · CR inventory** (account of `resolveInventoryAccount(materialsWarehouse)`) at actual issue cost, per batch; one journal per consume call; stock moves `planIssue`/`applyIssue` with `sourceType:"production_order"` |
| Scrap pre-completion (`production_order:scrap`) | **DR `PRODUCTION_SCRAP` · CR WIP** — value user-entered (≤ current order WIP balance), reason code required by policy; NO stock move (stock left at consumption) |
| Completion (`production_order:complete`) | **DR FG inventory · CR WIP** (materials portion) **· [CR `PRODUCTION_LABOR` · CR `PRODUCTION_OVERHEAD` when rates > 0]**; FG receipt via `planReceipt`/`applyReceipt` (new batch, expiry = completedAt + item.shelf_life_days when policy on); FG unit cost = fgValue/actualQty (6dp); labor = actualQty × laborRate; overhead = actualQty × overheadRate. Per-order WIP nets to EXACTLY zero |
| QC-fail scrap of quarantined FG, post-completion (`production_order:qc_scrap`) | **DR `PRODUCTION_SCRAP` (reason `QC_FAILED`) · CR FG inventory account** — goods physically leave the FG warehouse (stock issue move). DECISION: WIP is already zero at completion, so the credit is the FG warehouse account; the debit (PRODUCTION_SCRAP) is the same item-6 posting. Documented in POSTING_ENGINE §4 |

DECISION (labor/overhead): absorbed **in the completion journal** as extra credit lines
(no separate absorption journal; no intermediate WIP state). New CoA template group
**5400 "Production absorption" / "استيعاب تكاليف الإنتاج"** (EXPENSE, group, parent 5000)
with leaves **5410 `PRODUCTION_LABOR`** "Applied production labor / أجور الإنتاج المطبقة"
and **5420 `PRODUCTION_OVERHEAD`** "Applied production overhead / مصاريف إنتاج غير مباشرة مطبقة".
Required (fail closed `PURPOSE_NOT_MAPPED`) only when the corresponding rate > 0.
Other new CoA markers: **1160 `WIP`** "Work in progress / تحت التشغيل" (ASSET leaf, parent
1100); **5120 `PRODUCTION_SCRAP`** "Production scrap / التالف (الإنتاج)" (EXPENSE leaf,
parent 5000).

## 2. Lifecycle (DOCUMENT_LIFECYCLE §3)

`DRAFT → RELEASED (release: reserves+binds PRD number, binds BOM version + snapshots
explosion level-1 as order lines) → IN_PROGRESS (start) → COMPLETED (complete: FG receipt
+ journals, closes) / CANCELLED (cancel: DRAFT/RELEASED/IN_PROGRESS with ZERO consumption
rows only; reason required; typed error otherwise)`. State matrix fully tested; illegal
transitions → typed `PRODUCTION_ORDER_STATE` errors. Idempotent replays (INV-013):
release on RELEASED → no-op returning current order; complete on COMPLETED → returns the
stored completion result (order row fg fields), no second journal/batch. Numbering:
`PRD-{YYYY}-{SEQ:5}`, docType `production_order`, per-branch (branchId = order.branchId),
periodKey = year — NumberingService reserve+bind at release (INV-021).

## 3. Explosion math (DECISION — pinned by property + golden tests)

```
gross_component_qty = round6( planned_output_qty × qty_per_output × (1 + scrap_pct/100)
                              ÷ (yield_pct/100) )
```
yield_pct stored per BOM version (e.g. 80.0000 = 80%); scrap_pct per component line.
Multi-level explosion composes level-by-level at 6dp — property test: composed
level-by-level === single-pass, for random trees. Cycle detection → typed
`BOM_CYCLE` error. Order planned lines = **level-1 only** (chaining via separate
semi-finished orders; one FG item per order — no co-products).

## 4. QC gate & quarantine (DECISION)

Policy `manufacturing.qc_gate` enum `required|off` (default `off`). With `required`:
completion creates the FG batch in **QUARANTINED** status (new `item_batches.status`
value; `listFefoBatches` already filters `status='ACTIVE'` so FEFO/availability exclude
it; explicit-batch issues on a QUARANTINED batch throw typed `BATCH_QUARANTINED`).
Inspection PASS + disposition ACCEPT (or PASS with no disposition) → status
QUARANTINED→ACTIVE (releases quarantine; NO journal). FAIL + SCRAP → the qc_scrap flow
(§1 row 4) issuing the whole remaining quarantined batch on-hand from the FG warehouse.
FAIL + REWORK → stays QUARANTINED (no journal; a later inspection decides). FAIL +
ACCEPT → operator override, releases quarantine (audited). RETURN_TO_SUPPLIER:
record-only (GRN-target inspections). Inspections: result PASS|FAIL, `sampled` boolean +
`sample_size` (pass/fail on the sample), dispositions
ACCEPT|SCRAP|REWORK|RETURN_TO_SUPPLIER (required on FAIL).

## 5. Variance review (DECISION — no new task entity)

After each consume, per component line: cumulative consumed qty vs planned
(explosion). If consumed > planned × (1 + `manufacturing.consumption_variance_threshold_pct`/100):
flag the order line (`over_plan` = true, once) + inbox notification
(category `stock`, severity `warning`, actionUrl → the order; InboxService) — the
"review task". Consumption is NEVER blocked; correction is an adjusted consumption.
Threshold default 5 (number).

## 6. Policies & settings (POLICY_REGISTRY + SETTINGS_REGISTRY, all with settingsKey)

| Key | Type | Default |
|---|---|---|
| `manufacturing.qc_gate` | enum required\|off | `off` |
| `manufacturing.scrap_reason_required` | boolean | `true` |
| `manufacturing.fg_batch_expiry_from_shelf_life` | boolean | `true` |
| `manufacturing.consumption_variance_threshold_pct` | number (0–100) | `5` |

Services read them through the **resolved effective config** (`ResolveEffectiveConfigService`
— exported by ConfigurationModule; read `config.policies[...]`), falling back to
`readEffectiveSetting` if a key is absent from the policies map (verify which; document).
Tests override via `tenant_settings` rows (L5). The food_manufacturing manifest carries
`required`/`true`/`true`/`5` as L1 defaults.

## 7. Migration 0026_manufacturing.sql — full DDL contract

Follow `0025_automotive_distribution.sql` byte-patterns (header, SET ROLE erp_migrate,
statement-breakpoints, RLS macro `SELECT erp.apply_tenant_policy('"t"')`, GRANTs,
`_schema_state` = 26). New tenant tables (7), all with standard columns +
`uq_<t>_id_tenant`, tenant-scoped indexes, composite 2-col FKs:

1. `bills_of_materials` — item_id FK, version_no int, status DRAFT|ACTIVE|ARCHIVED,
   output_uom_id FK (uoms), yield_pct numeric(7,4) NOT NULL DEFAULT 100.0000,
   effective_from date NULL, note/note_ar, activated_at/archived_at.
   CHECK 0 < yield_pct <= 100; uq (tenant, item, version_no); **partial uq (tenant, item)
   WHERE status='ACTIVE'**; ix (tenant, status).
2. `bom_lines` — bom_id FK composite, line_no, component_item_id FK, uom_id,
   qty_per_output numeric(19,6) > 0, scrap_pct numeric(7,4) >= 0 DEFAULT 0, note/note_ar.
   uq (tenant, bom, line_no). **DELETE granted** (DRAFT full-replace) — `deleteGranted: true`.
3. `production_orders` — branch_id FK, order_no text NULL, status
   DRAFT|RELEASED|IN_PROGRESS|COMPLETED|CANCELLED, bom_id FK NULL, item_id FK, uom_id,
   planned_qty numeric(19,6) > 0, planned_date date NULL, actual_qty numeric(19,6)
   DEFAULT 0, materials_warehouse_id FK, fg_warehouse_id FK, labor_rate numeric(19,6)
   DEFAULT 0, overhead_rate numeric(19,6) DEFAULT 0, cost_center_id uuid NULL,
   yield_snapshot numeric(7,4) NULL, fg_batch_id uuid NULL, fg_journal_id uuid NULL,
   fg_value/wip_credit_value/labor_value/overhead_value numeric(19,4) DEFAULT 0,
   note/note_ar, cancel_reason (ck: CANCELLED ⇒ cancelled_at+cancel_reason NOT NULL),
   released_at/started_at/completed_at/cancelled_at. uq (tenant, order_no) WHERE NOT
   NULL; ix (tenant, status); ix (tenant, item_id).
4. `production_order_lines` — order_id FK composite, line_no, component_item_id FK,
   uom_id, planned_qty numeric(19,6), scrap_pct numeric(7,4), actual_qty numeric(19,6)
   DEFAULT 0, over_plan boolean DEFAULT false, note/note_ar. uq (tenant, order, line_no);
   ix (tenant, order, item).
5. `production_consumptions` — order_id FK, item_id FK, batch_id uuid NULL, qty
   numeric(19,6), unit_cost numeric(19,6), value numeric(19,4), journal_id uuid NULL,
   consumed_at timestamptz, note/note_ar. ix (tenant, order); ix (tenant, item);
   **partial ix (tenant, batch) WHERE batch_id IS NOT NULL**.
6. `production_scraps` — order_id FK, reason_code text NOT NULL (1..40), qty
   numeric(19,6) > 0, value numeric(19,4) > 0, journal_id uuid NULL, scrapped_at, note/
   note_ar. ix (tenant, order). CHECK value <= (no — service-enforced ≤ WIP balance).
7. `inspections` — target_type production_order|goods_receipt, order_id FK NULL, grn_id
   FK NULL (composite → goods_receipts), fg_batch_id uuid NULL, result PASS|FAIL,
   sampled boolean DEFAULT false, sample_size int NULL, disposition
   ACCEPT|SCRAP|REWORK|RETURN_TO_SUPPLIER NULL, inspected_at, note/note_ar.
   CHECK target shape (production_order ⇒ order_id NOT NULL; goods_receipt ⇒ grn_id NOT
   NULL); CHECK (result='PASS' OR disposition IS NOT NULL). ix (tenant, order) WHERE NOT
   NULL; ix (tenant, grn) WHERE NOT NULL.

Widenings (DROP + re-ADD pattern):
- `item_batches.status` → ('ACTIVE','QUARANTINED','WRITTEN_OFF')
- `stock_moves.source_type` + `'production_order'`
- new nullable column `warehouses.role` text NULL CHECK IN ('RAW','WIP','FG') (convention
  only — no behavior depends on it; WarehouseService.create/update accept it)
- new nullable column `items.shelf_life_days` integer NULL (ItemService.create/update
  accept it; inventory `ItemReadRow` gains `shelfLifeDays`)
- new nullable column `item_batches.production_order_id` uuid NULL (composite FK →
  production_orders) — set on FG receipt (produced-batch provenance)

CoA template inserts (ON CONFLICT DO UPDATE pattern): 1160 WIP, 5120
PRODUCTION_SCRAP, 5400 group, 5410 PRODUCTION_LABOR, 5420 PRODUCTION_OVERHEAD.

Permission seeds (8 keys; ON CONFLICT DO UPDATE; matrix 238 → 246):
`manufacturing.boms.manage` (owner) · `manufacturing.production_orders.view` (viewer,
warehouse, accountant, owner) · `.create` (warehouse, owner) · `.approve` (owner, RISKY)
· `.post` (owner, RISKY) · `manufacturing.qc.manage` (warehouse, owner) ·
`manufacturing.genealogy.read` (viewer, accountant, owner) ·
`manufacturing.costing.read` (viewer, accountant, owner). AUTHORIZATION_MATRIX §3.8
gains the 6 new rows (qc/genealogy/costing) — keep the existing 2 rows byte-identical.

Plan grants: `array_cat` `feature_keys` on business+enterprise with:
`manufacturing.bom`, `manufacturing.production_orders`, `manufacturing.wip`,
`manufacturing.costing`, `manufacturing.scrap`, `manufacturing.batch_genealogy`,
`manufacturing.qc` (7 keys — starter does NOT get them).
Role-template grants per the §7 minimal-roles above (owner/viewer/warehouse/accountant).
Template seed: `industry.food_manufacturing` v1.0.0 manifest JSON **verbatim** from
`docs/industries/templates/manifests/manifest.food_manufacturing.json` (the canonical
source; contracts constant must be byte-equal to it).

## 8. Golden fixture numbers (binding — costing.spec, genealogy.spec, reports tie-outs)

Tenant `TENANT_M` (new manufacturing fixtures tenant; pick an unused digit pattern,
e.g. `44444444-4444-4444-4444-444444444444` — verify uniqueness). Warehouses **M-RAW**
(role RAW) + **M-FG** (role FG), branch MAIN. Purposes mapped: INVENTORY→1140, WIP→1160,
PRODUCTION_SCRAP→5120, PRODUCTION_LABOR→5410, PRODUCTION_OVERHEAD→5420, COGS→5100,
AR_CONTROL→1130, SALES_REVENUE→4100, VAT_PAYABLE→2120 (+ whatever the chosen stock-seed
path needs; mirror `sales/fixtures.ts` helpers).

Items (all STOCK, WAC, trackBatch + hasExpiry): flour (shelf 180d), yeast (90d),
packaging (365d), dough semi-finished (shelf_life_days 2), bread FG (shelf_life_days 5).
Material stock in M-RAW (use the batch-capable seeding path — `opening_balance_docs`
with batch info if supported, else `stock.manualReceipt` reason COUNT_GAIN like
`inventory/tracking.spec.ts`; agent verifies and documents): flour batch F1 2000 @ 10.00,
yeast batch Y1 1000 @ 20.00, packaging batch P1 1000 @ 1.00 (one batch each → FEFO trivial).

BOMs (both ACTIVE): **Dough v1** yield 80.0000 — flour 0.500000 scrap 2.0000; yeast
0.100000 scrap 0. **Bread v1** yield 80.0000 — dough 1.000000 scrap 0; packaging
0.250000 scrap 0.

**Dough order** (planned 1000, materials M-RAW, fg M-RAW — semi-finished returns to the
materials store; labor 0, overhead 0):
- release → PRD number; lines: flour 637.500000 (=1000×0.5×1.02/0.8), yeast 125.000000
- consume {flour 637.5 batch F1 @10 → 6375.0000; yeast 125 batch Y1 @20 → 2500.0000} →
  **J1 [DR WIP 8875.0000 · CR INVENTORY 8875.0000]**; no variance flag (0% over)
- scrap {qty 50, reason `BURNT`, value 443.7500} → **J2 [DR PRODUCTION_SCRAP 443.7500 ·
  CR WIP 443.7500]**; WIP balance 8431.2500
- complete {actual 950, batchNo = orderNo} → dough batch expiry = completedAt + 2d; unit
  cost 8.875000; value 8431.2500 → **J3 [DR INVENTORY 8431.2500 · CR WIP 8431.2500]**;
  WIP nets 0; dough on-hand M-RAW 950

**Bread order** (planned 750, materials M-RAW, fg M-FG, labor_rate 0.500000,
overhead_rate 0.250000):
- release → lines: dough 937.500000 (=750/0.8), packaging 234.375000 (=750×0.25/0.8)
- consume {dough 937.5 batch BD1 @8.875 → 8320.3125; packaging 234.375 batch P1 @1 →
  234.3750} → **J4 [DR WIP 8554.6875 · CR INVENTORY 8554.6875]**
- complete {actual 750, batchNo = orderNo} → bread batch expiry = completedAt + 5d; labor
  375.0000; overhead 187.5000; wip_credit 8554.6875; fg_value 9117.1875; unit cost
  12.156250 → **J5 [DR INVENTORY 9117.1875 · CR WIP 8554.6875 · CR PRODUCTION_LABOR
  375.0000 · CR PRODUCTION_OVERHEAD 187.5000]**; WIP nets 0

**Sale** (genealogy downstream + COGS tie): sales invoice 100 bread @ explicit batchId
BB1 (cash or credit; posts COGS 100 × 12.15625 = 1215.6250). QC gate stays **off** in
this chain (QC spec runs its own gate-required chain). Variance review + PERIOD_LOCKED +
replay packs use separate orders, NOT this chain.

## 9. API surface (24 routes — route-permissions.ts rows; controllers match VERBATIM)

Permission/feature per route (all requireIdentity + envelope + Idempotency-Key global
guard; zod UUID/QTY≤6dp/MONEY≤4dp):

| # | Method+Path | Permission | Feature |
|---|---|---|---|
| 1 | GET /api/v1/manufacturing/boms | manufacturing.boms.manage | manufacturing.bom |
| 2 | POST /api/v1/manufacturing/boms | " | " |
| 3 | GET /api/v1/manufacturing/boms/:id | " | " |
| 4 | PUT /api/v1/manufacturing/boms/:id | " | " (DRAFT-only edit) |
| 5 | POST /api/v1/manufacturing/boms/:id/activate | " | " (archives prev ACTIVE) |
| 6 | POST /api/v1/manufacturing/boms/:id/archive | " | " |
| 7 | GET /api/v1/manufacturing/boms/explosion?itemId&qty&bomId? | " | " (multi-level) |
| 8 | GET /api/v1/manufacturing/production-orders?status&itemId&limit | manufacturing.production_orders.view | manufacturing.production_orders |
| 9 | POST /api/v1/manufacturing/production-orders | .create | " |
| 10 | GET /api/v1/manufacturing/production-orders/:id | .view | " (order + lines + consumptions + scraps + completion summary) |
| 11 | PUT /api/v1/manufacturing/production-orders/:id | .create | " (DRAFT-only) |
| 12 | POST /:id/release | .approve | " (number + BOM bind) |
| 13 | POST /:id/start | .approve | " |
| 14 | POST /:id/consume | .post | " (lines:[{itemId,qty,batchId?}]) |
| 15 | POST /:id/scrap | .post | manufacturing.scrap |
| 16 | POST /:id/complete | .post | " (actualQty, batchNo?, completedAt?) |
| 17 | POST /:id/cancel | .approve | " (reason) |
| 18 | POST /api/v1/manufacturing/reconciliation/wip-check | manufacturing.costing.read | manufacturing.wip |
| 19 | GET /api/v1/manufacturing/genealogy/upstream/:batchId | manufacturing.genealogy.read | manufacturing.batch_genealogy |
| 20 | GET /api/v1/manufacturing/genealogy/downstream/:batchId | " | " |
| 21 | GET /api/v1/manufacturing/genealogy/batch/:batchId | " | " (batch summary) |
| 22 | GET /api/v1/manufacturing/inspections?targetType&orderId&limit | manufacturing.qc.manage | manufacturing.qc |
| 23 | GET /api/v1/manufacturing/inspections/:id | " | " |
| 24 | POST /api/v1/manufacturing/inspections | " | " (targetType, orderId?/grnId?, result, sampled?, sampleSize?, disposition?) |

## 10. Genealogy semantics

Upstream(batchId): the batch's producing order (`item_batches.production_order_id` /
order.fg_batch_id) → that order's `production_consumptions` batch_ids (level-1
materials) → recurse for material batches that were themselves produced
(`item_batches.production_order_id NOT NULL`). Downstream(batchId): orders that
consumed the batch (`production_consumptions.batch_id`) → their fg batches → recurse;
PLUS sales edges from `stock_moves` (source_type IN ('sales_invoice','delivery_note')
AND batch_id = :batch — inventory-owned table, allowed direction). Read-only — no
mutation path exists; empty results for untracked items. Genealogy NEVER writes; the
report `manufacturing.batch_genealogy` (reporting module) enriches with sales doc
numbers.

## 11. WIP reconciliation (INV-010 extension)

`ManufacturingReconciliationService.runWipCheck({asOf, runMode, checkedBy})` — kind
`"WIP"`, controlSide = GL balance of the WIP-purpose account(s), subledgerSide = Σ
per-order WIP balances (Σ consumptions.value − Σ scraps.value − orders.wip_credit_value);
BROKEN ⇒ audit `manufacturing.reconciliation_broken` + inbox notification (category
`reconciliation`). Add `"WIP"` to the two PC-04 hard-coded lists
(`assertCoreChecksGreen` + `PeriodService.lock`) and activate the `reconciliation.wip`
checklist row (state fn like `inventoryCheckState`; NOT_APPLICABLE when no WIP account
mapped / zero accounts). Route #18 above.

## 12. Reports (PHASE-013 contract, registry/industry/phase018.ts)

`manufacturing.production_cost` (params dateFrom/dateTo/locale + status?; requiredPermission
`manufacturing.costing.read`; GL tie: consumed-materials value ↔ consumption journals,
tolerance 0), `manufacturing.batch_genealogy` (param batchId; permission
`manufacturing.genealogy.read`), `manufacturing.qc_inspection_log` (params window;
permission `manufacturing.qc.manage`). `ManufacturingQueriesService` in
`registry/industry/manufacturing-queries.ts` (raw SQL via tenantTx, read-only).
Registry wiring: `DataSourceModule` + `SOURCE_MODULES` + `MODULE_DATA_PHASE
manufacturing: 18` + `REGISTERED_PHASE_WINDOW` 18; append to REPORT_CONTRACTS.

## 13. Template & configuration (industry.food_manufacturing)

- Contracts: `FOOD_MANUFACTURING_TEMPLATE_MANIFEST` (deep-frozen, byte-equal to the
  migration seed — both derive from `docs/industries/templates/manifests/manifest.food_manufacturing.json`),
  export + append to `SHIPPED_TEMPLATE_MANIFESTS`; `layer-fixtures.ts` SHIPPED_TEMPLATES +
  PLAN_KEYS transcription (0026 grants). `industry-manifests.test.ts` extends.
- POLICY_REGISTRY + SETTINGS_REGISTRY: the 4 keys (§6).
- `CURRENT_SHIPPED_PHASE` → `"PHASE-018"` (apply/prerequisites.ts).
- Golden effective-config pins: 3 new rows `industry.food_manufacturing ×
  {starter,business,enterprise}` + re-pin existing rows whose L4 entitlements changed
  from the 0026 plan grants (document the re-pins).
- `templates-018.spec.ts`: the §8 seven requirements incl. restaurant →
  food_manufacturing switch safety (additive-only BR-038, POS history untouched) and
  degraded entitlement (manufacturing keys missing ⇒ blocked with missingChain;
  restaurant without the add-on ⇒ prep-recipe items hidden cleanly).
- FEATURE_CATALOG permission column reconciled to real keys: bom→manufacturing.boms.manage;
  production_orders/wip→manufacturing.production_orders.view; costing→manufacturing.costing.read;
  scrap→manufacturing.production_orders.post; batch_genealogy→manufacturing.genealogy.read;
  qc→manufacturing.qc.manage.

## 14. Web (5 surfaces, bilingual RTL, server page + client component, distribution pattern)

Routes: `/manufacturing/boms`, `/manufacturing/orders`, `/manufacturing/qc`,
`/manufacturing/genealogy` + report deep-links (`/reports?report=manufacturing.*`).
`TARGET_ROUTE_ALIASES`: manufacturing.bom→/manufacturing/boms,
manufacturing.orders→/manufacturing/orders, manufacturing.qc→/manufacturing/qc,
manufacturing.genealogy→/manufacturing/genealogy. `INDUSTRY_REPORT_TARGETS` += the 3
manufacturing report keys. FALLBACK_CRUMBS rows. api-types rows; messages.ts error
mappers (localizedManufacturingError + status/disposition maps); dictionaries.ts keys
(AR+EN parity — both locales, no empty values); app-shell crumbs. Money canonical
strings; `dir="ltr"` on numerals; 44px touch targets; sticky footer; a11y labels.

## 15. Task order & dependencies

| Task | Agent scope | Depends on | Evidence file |
|---|---|---|---|
| T36 (1) | Foundation: migration 0026 + schema.ts + all registrations (migrations.ts, _journal, migrations.spec, permissions-drift union, route-permissions 24 rows, tables.registry + isolation fixtures + count bumps, ENTITY_CATALOG/TABLES/ERD, AUTHORIZATION_MATRIX rows) + inventory/items/warehouses enablement code (quarantine methods, planIssue guard, availability extension, item_batches provenance, shelf_life, warehouse role) | — | agent-ctx/T36-1-foundation.md |
| T37 (2) | Contracts + configuration + template: manifest constant, SHIPPED, layer-fixtures, POLICY/SETTINGS registries, CURRENT_SHIPPED_PHASE, golden pins, templates-018.spec (7 per-template tests) | T36 | agent-ctx/T37-2-template.md |
| T38 (3) | Production core: mfg module skeleton, BOM service+explosion+controller+spec, order service (lifecycle/consume/scrap/complete/posting), fixtures.ts + golden chain, orders.spec, costing.spec, WIP reconciliation + wip-recon.spec | T36 | agent-ctx/T38-3-production.md |
| T39 (4) | QC + genealogy: inspections service+controller+qc.spec (gate on chain), genealogy service+controller+genealogy.spec | T36, T38 | agent-ctx/T39-4-qc-genealogy.md |
| T40 (5) | Reports: phase018.ts contracts + ManufacturingQueriesService + registry wiring + industry-018.spec (GL tie-outs, dedicated tenant R18) | T36, T38, T39 | agent-ctx/T40-5-reports.md |
| T41 (6) | Web: 4 screens + aliases/targets/crumbs + dictionaries + api-types + messages | T38, T39 | agent-ctx/T41-6-web.md |
| — (me) | Docs updates + full gate + PHASE-018-COMPLETION.md | all | docs/implementation/phases/reports/PHASE-018-COMPLETION.md |

DB-test conventions: dedicated tenant per suite; `TMPDIR=$HOME/tmp-<task> npx vitest
run --config vitest.db.config.ts src/__db__/<path>`; delta-based stock asserts; order
independence (reopen periods after PERIOD_LOCKED packs). Gate commands: `pnpm
typecheck`, `pnpm lint`, `pnpm run lint:depcruise`, `pnpm run check:permissions-drift`,
`pnpm validate:manifests`, `pnpm test`, `pnpm --filter @erp/api test:db`, `pnpm
docs:validate`, `pnpm run check:i18n-parity`, `pnpm run check:rls`.
