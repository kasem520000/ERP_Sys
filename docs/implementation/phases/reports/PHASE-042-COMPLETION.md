# PHASE-042 Completion Report — Manufacturing I: Routing, Work Centers & Costing

> **Status:** COMPLETE · **Date:** 2026-11-12 · **Phase doc:**
> [../PHASE-042.md](../PHASE-042.md) · **Register:** [CR-12](../../../planning/COMPLETENESS_REGISTER.md)
> · **Triple flip:** this report + the phase doc header + the IMPLEMENTATION_STATUS
> row flipped together (CR-48) · **Wave 2 opens here** — the first Wave-2 phase
> delivered on this lineage.
>
> **Errata 2026-11-13 (post-closure audit):** the isolation A-suite figures
> originally announced here as **1,332/1,332** were a miscount — the true
> 042-era baseline is **1,320** (219 registered tables × 6 generated `it()`
> blocks + 6 fixed tests), re-run verified against this report's exact commit
> (embedded PG16 + that tree's 66-entry chain: 1,320/1,320, exit 0 —
> [the gate-evidence ledger](../../../operations/gate-evidence/2026-11-13-post044-audit-fixes.md) §3).
> The +42 delta for this phase's seven tables was and remains correct
> (1,278 → 1,320).

## 1. Executive summary

PHASE-042 delivered the manufacturing-execution gap the audit scored 38% ("light
assembly, not a manufacturing system"): production orders are now multi-operation
shop-floor documents executed against **versioned routings** (one ACTIVE per item —
the BOM discipline) on **work centers** with per-shift capacity (hours) and
fixed/var hourly cost rates; the per-order operation rows carry the
**PENDING/SETUP/RUNNING/PAUSED/COMPLETED/SKIPPED** machine with actual-time
capture, **INV-028** sequence enforcement, SoD-gated skips, and per-operation
setup/usage/rate variance records; **G-40** posts conversion at work-center rates
× actual times into WIP; **rework orders** (G-41 → REWORK_EXPENSE — never the
parent FG layer, BR-069); **reason-coded downtime** (record-only by default —
BR-070; G-42 on the explicit policy opt-in) feeding the two derived **OEE views**;
and the v3.1/CR-45 **L2-12 standard-costing layer** (per-item frozen standards by
cost type, the low-level roll-up over BOM + routing, freeze/activate with the BOM
versioning discipline, **PPV at receipt** through the landed-cost point, stock
revaluation on standard change). The shop floor becomes a platform user: the
touch-first terminal + the idempotent `OP:<order>:<seq>:<action>` scan endpoint
(M-17). **Migrations 0065/0066 · schema_version 66 · 7 new RLS'd tables + 2
security_invoker views · permissions 272 → 279 · feature keys +6 · report
registry 91 → 95 · goldens G-40/41/42 · INV-028 · BR-068…071 · i18n +175
keys/locale (the operative count discipline).**

## 2. Mandatory code-evidence checklist (CR-48)

**New tables (SQL migration + Drizzle mirror + ENTITY_CATALOG row — CR-36 a):**

| Table | Migration | schema.ts (Drizzle) | Catalog |
|---|---|---|---|
| work_centers | 0065_routing_work_centers.sql §1 | `workCenters` — **schema.ts:5119** | §"manufacturing execution" (232 → 239) |
| routings | 0065 §2 | `routings` — **schema.ts:5151** | (same section) |
| routing_operations | 0065 §3 | `routingOperations` — **schema.ts:5183** | (same section) |
| production_order_operations | 0065 §5 | `productionOrderOperations` — **schema.ts:5218** | (same section) |
| rework_orders | 0065 §6 | `reworkOrders` — **schema.ts:5294** | (same section) |
| downtime_records | 0065 §7 | `downtimeRecords` — **schema.ts:5358** | (same section) |
| item_standard_costs | 0066_standard_costing.sql §1 | `itemStandardCosts` — **schema.ts:5392** | (same section) |

Plus: the **production_orders extension** (0065 §4 + 0066 §2 — additive only:
`routing_id`, `current_operation`, `std_unit_cost`, `yield_variance`); the two
**OEE views** `v_work_center_oee_daily`/`v_work_center_oee_period` (0065 §8 —
security_invoker so RLS rides through; derived facts, NOT in the tables registry
— the completeness probe now filters BASE TABLE only, the documented reasoning).

**Migrations & manifest:** journal idx 64/65 appended (66 entries); the manifest
`src/infra/db/migrations.ts` carries both tags with the numbering-note comment;
`migrations.db.spec.ts` 28/28 (apply + re-apply no-op + RLS catalog drift +
ownership + role defaults); the manifest pin re-anchored to `0066_standard_costing`;
§9 RLS = the house triple ×7; §10 grants (master-data shape — SELECT/INSERT/UPDATE,
no app-role DELETE, the 0026 precedent); §12/§6 CoA markers (5125 REWORK_EXPENSE,
5430 DOWNTIME_EXPENSE, 5990 PURCHASE_PRICE_VARIANCE, 5995 STANDARD_REVALUATION —
the 0026 additive pattern, fail-closed PURPOSE_NOT_MAPPED until mapped);
§13/§7 the permission seeds (matrix §3.20); §8/§9 of 0066 the feature plan grants
(business+enterprise) + the **food_manufacturing manifest enablement** (the
migration seed + the docs mirror + the contracts verbatim copy moved together;
the templates-018 KNOWN_HASH re-pinned per the 039 procedure).

**Core services (the `manufacturing` module, 2,288 new service lines):**
- `work-center-service.ts` (227) — CRUD + status (INACTIVE blocked while
  referenced by live operations/ACTIVE routings).
- `routing-service.ts` (330) — the BOM discipline mirrored: versionNo monotonic,
  DRAFT full-replace, activate archives the previous ACTIVE (23505 → typed),
  copy-from-routing; never posts journals.
- `operation-execution-service.ts` (581) — the INV-028 core: release freezes one
  op row per routing operation (std times + the effective rates — op-level
  overrides win over the work center); start/pause/resume/complete/skip with the
  sequence gate (typed OperationSequenceError), SoD skip (distinct approver),
  **G-40** at operation `op_<seq>` (DR WIP · CR PRODUCTION_LABOR (var × actual
  hours) · CR PRODUCTION_OVERHEAD (fixed × actual hours); 4dp exact — typed
  rounding guard), the variance columns (setup = Δtime × rates; usage =
  Δrun × rate against the running qty; rate = v1-zero, documented honestly),
  idempotent replay (the stored row recomputed — no second journal), and
  `current_operation` advancing exactly with the last resolved operation.
- `rework-service.ts` (417) — RW- numbering, the frozen aggregate std, **G-41**
  (DR REWORK_EXPENSE · CR labor · CR overhead — completion requires
  rework_value > 0), cancel semantics; **the BR-069 proof lives in the spec**
  (the parent order's value columns byte-identical before/after).
- `downtime-service.ts` (284) — the closed reason vocabulary, open/close, the
  **BR-070 policy gate** (`manufacturing.downtime_posting` — off by default:
  record-only; `post`: **G-42** DR DOWNTIME_EXPENSE · CR PRODUCTION_OVERHEAD at
  the center's rates × idle hours).
- `standard-cost-service.ts` (449) — the L2-12 layer: manual drafts, the
  **low-level roll-up** (material = Σ component gross qty × the component's
  ACTIVE standard — missing component standards fail closed naming the item;
  labor/overhead = the routing times × rates), freeze/activate (one ACTIVE per
  item — the BOM discipline), **PPV at receipt** (the GRN journal posts
  inventory at the ACTIVE standard when present; PURCHASE_PRICE_VARIANCE
  carries (actual − std) × qty; standard-less items keep the legacy shape —
  byte-identical, the purchasing suite stayed green), and **stock revaluation**
  on activate with `revaluateStock` (DR/CR inventory × (new−old)×qty contra
  STANDARD_REVALUATION — the G-13/G-14 shapes).
- Presentation: 5 controllers (815 lines) + **31 route-permission rows**
  (matrix §3.19/§3.20 block at route-permissions.ts:2881–3041) incl. the
  `OP:<orderId>:<seq>:<action>` scan endpoint (M-17 — idempotent by
  construction; the spec proves no duplicate journal on repeated scans).
- The production-order-service integration (dual mode): routing-bound orders
  skip the flat labor/overhead legs at completion (their conversion sits in
  WIP via the op postings) and compute `yield_variance` =
  (planned − actual) × std_unit_cost when a standard exists; routing-less
  orders keep the exact legacy path — **G-17/G-18 stayed green untouched**.

**Web (T-10…T-13, 3,165 component lines):** the five surfaces —
`/manufacturing/work-centers` (593), `/manufacturing/routings` (793 — the
versioned operation editor), `/manufacturing/shopfloor` (731 — the touch-first
terminal: big targets, autofocus scan input, the live op board + the SoD skip
dialog + the downtime quick-log), `/manufacturing/downtime` (575 — the log +
the OEE fold daily/period), `/manufacturing/standard-costs` (473 — versions,
manual create, roll-up, activate with the revaluation warning) — + the orders
workspace's **Operations tab** + create-rework action; 5 NAV_ITEMS rows
(NAVIGATION_MODEL §1.8) + FALLBACK_CRUMBS; ⌘K inherits (OA-04). i18n **+175
AR/EN pairs** (5,247 → **5,422 = 5,422**, parity gate green — the operative
count measured by loading the module, the audited discipline).

**Reports (T-14):** four contracts into REPORT_CATALOG §8 —
`manufacturing.work-center-utilization` (the OEE legs: availability ×
performance × quality from the views), `manufacturing.downtime-analysis` (the
reason breakdown + cost rollup), `manufacturing.rework-cost` (rework → parent
order join), `manufacturing.cost-variance` (the setup/usage/rate rollup + the
order yield variance). **Registry 91 → 95** (golden.spec pins re-anchored with
the composition comment extended; the known-permission catalogs extended with
`manufacturing.oee.read` — the 036/038 repair class).

**Specs (the 042 wave, 50 tests):**
- `__db__/manufacturing/routing-execution.spec.ts` (11) — the freeze, the
  sequence gate, G-40's exact journal_lines, idempotent replay (ONE journal at
  `op_10`), skip SoD, current_operation advance, the uncosted operation (rates
  0 → times recorded WITHOUT a journal), the dual-mode legacy release.
- `__db__/manufacturing/rework-costing.spec.ts` (7) — G-41 exact, **the parent
  FG never moves** (BR-069), zero-cost rejection, cancel, RW- numbering,
  replay.
- `__db__/manufacturing/downtime-oee.spec.ts` (8) — record-only default, the
  policy flip → G-42 exact + cost stamped, the CHECK floors, the OEE views
  (daily + period + the RLS-through-the-view probe on a dedicated isolated
  center), the typed already-closed rejection.
- `__db__/manufacturing/standard-costing.spec.ts` (12) — manual + activate
  (one ACTIVE), the total-sum CHECK floor, the roll-up exact + the
  missing-component fail-closed, std_unit_cost freeze at release (and NULL
  dual mode), yield variance exact, **PPV at receipt** (standard item:
  inventory at standard + the variance leg; non-standard: legacy shape),
  revaluation exact / no-op without stock.
- `__db__/reporting/manufacturing-reports.spec.ts` (9) — the four contracts
  render, filters narrow, the tenant-isolation probe, the deny path.
- `__db__/manufacturing/explain-budgets.db.spec.ts` (3) — the OA-06 budgets:
  the terminal scan, the OEE daily fold, the downtime list (seeded + ANALYZEd,
  enable_seqscan=off — index-driven, no seq-scan).
- The isolation A-suite: the seven tables registered (+42 → **1,320/1,320**;
  originally announced as 1,332 — see the errata note above).

## 3. Acceptance criteria vs. evidence (§6 of the phase doc)

| # | Criterion | Evidence |
|---|---|---|
| 1 | Migrations apply cleanly; tables RLS'd; Drizzle + catalog parity; A1–A10 | migrations.db.spec 28/28 over the 66-entry chain; catalog 232 → 239 (ENTITY_CATALOG §"manufacturing execution"; the check-rls catalog drift green inside the suite); the A-suite 1,320/1,320 (errata-corrected 2026-11-13; originally announced 1,332) |
| 2 | Routing-bound order executes operation-by-operation; INV-028 (N+1 gated, at-most-once, current_operation advances) | routing-execution.spec: the sequence gate, the idempotent replay (one `op_<seq>` journal), the advance assertions |
| 3 | G-40 green: DR WIP · CR conversion at rates × actual times, balanced, idempotent, failure packs | routing-execution.spec (exact journal_lines, 4dp; the rounding guard typed; the uncosted-op zero-journal proof) |
| 4 | Completion computes the variance records exactly; rounding explicit | the variance columns asserted exactly (setup/usage); yield_variance at order completion ((planned−actual)×std, 4dp); rate_variance v1-zero — the documented honest decision (D-4 below) |
| 5 | G-41 + G-42 green with failure packs; rework never in parent FG (BR-069); downtime policy-gated (BR-070) | rework-costing.spec (the parent-FG byte-identity proof) + downtime-oee.spec (the off→post flip with the exact G-42 lines) |
| 6 | Routing-less orders keep the legacy path — G-17/G-18 zero drift | the dual-mode release test + the existing costing.spec (J1–J5) green untouched in the full suite |
| 7 | OEE views compute over fixtures; the utilization report renders AR/EN | downtime-oee.spec (daily + period exact on an isolated center) + manufacturing-reports.spec (the utilization contract renders) |
| 8 | Scan start/pause/complete from the terminal; repeated scan = original result, no duplicate effects; the sync-surface assessment recorded | the OP-scan endpoint (shopfloor.controller) — idempotent by construction through the operation keys; the sync assessment: **the web terminal needs no sync; the scan endpoints are idempotent (INV-013 keys) — the offline desktop queue is assessed N/A-this-phase** (no offline client exists for the shop floor yet; recorded in NAVIGATION_MODEL §1.8's note) |
| 9 | House gates green: typecheck · lint · unit · docs:validate · i18n parity · permissions drift · registry · EXPLAIN | §5 below — all green; drift **279 = 279**; registry 95; EXPLAIN 3/3 |
| 10 | Completion report + status flip + archive | this file; the status row flipped; `ERP_PLATFORM_PHASE042.zip` |

## 4. Deviations & decisions (documented)

- **D-1 — the numbering deviation (the 0064 precedent).** The phase doc's
  counters were authored 2026-11-10, before 039/040/041 consumed the slots:
  BR-057…060 → **BR-068…071**; G-38/39/40 → **G-40/41/42** (039 took
  G-35…G-39); INV-027 → **INV-028** (037 took INV-027); migrations ≈0060…0066 →
  **0065/0066**; and the doc's planned "manufacturing.costing" permission key
  is already live as `manufacturing.costing.read` (0026) — the seven delivered
  keys are the honest set (272 → 279), with `manufacturing.oee.read` added for
  the OEE surfaces (the doc's list didn't name it; the viewer-tier grant
  follows the 0026 read-tier precedent — identity-flows viewer pin 46 → 47).
  Recorded in every touched doc's numbering note.
- **D-2 — rate_variance is v1-zero (honest).** The frozen std rates ARE the
  rates applied at completion (the work-center rate can't change mid-order in
  this phase's model), so the rate-variance column computes to zero by
  construction; work-center rate changes between orders surface in the NEXT
  order's setup/usage variances and the standard-cost roll-up. The column
  exists (the report + the M-19 shape demand it), the service documents the
  v1-zero decision, and PHASE-043's planning costing is the natural consumer
  of a real rate split. NOT silently absorbed — typed in the code comment,
  JOURNAL_RULES note 13, and BR-071.
- **D-3 — rework is conversion-cost-shaped.** The rework completion posts the
  routing conversion roll-up (labor + overhead at rates × actual times) to
  REWORK_EXPENSE; materials a rework might consume issue through the EXISTING
  inventory documents (no rework-specific material lines table — the doc's +7
  budget held). The defect reference (batch/serial + reason) is the
  informational link; the parent's FG value is provably untouched (the spec's
  byte-identity proof).
- **D-4 — usage-variance qty basis.** At mid-order operation completion the
  usage variance uses the order's running actual qty (planned when none
  produced yet); the order-level yield variance at completion catches the
  final difference — the split is documented in the service and the spec.
- **D-5 — the OEE views are NOT tenant tables.** security_invoker views with
  a tenant_id column — the A-suite's completeness probe now joins
  information_schema.tables and filters `table_type = 'BASE TABLE'` (views
  are derived facts, never registry rows); the RLS-through-the-view behavior
  is proven by the dedicated spec probe.
- **D-6 — the period view's downtime is independently derived.** The month's
  downtime_minutes comes from downtime_records directly (not the sum of
  dailies): days with zero operation rows still contribute their downtime —
  and the inner derived table exists because PostgreSQL does not match
  outer-reference expressions inside subqueries against the outer GROUP BY.
  Both recorded in the migration's §8 comments.
- **D-7 — A PRE-EXISTING 041 PIN ROT, caught + repaired.** The full-suite
  sweep exposed that 0064's all-plans grant (communication.templates +
  communication.outbound) had moved the starter plan to 60 feature keys at
  PHASE-041, but the tenancy-http `grantedKeys` pin stayed 58 — the targeted
  041 gate runs never exercised that spec (the 041 report's gate list shows
  the targeted set). 042's full run caught it; the pin is now 60 with the
  full lineage comment (the rot + the repair recorded in the spec + this
  report). 042's own grants touch business + enterprise only.
- **D-8 — the golden-effective-configs re-pin (ALL 37).** Three reviewed
  changes moved every pin: the 0066 plan grants (L4 folds feature_keys), the
  FEATURE_DEPS intake for the six keys (the catalog is CLOSED — unknown keys
  fail BR-040 closure; the honest edges: work_centers leaf · routing →
  item_master + work_centers · shopfloor → routing + work_centers · rework →
  production_orders · downtime → work_centers · standard_costs → bom +
  routing), and the downtime_posting policy default landing in every
  tenant's policy map. Recomputed by running the compose pipeline over the
  post-0065/0066 seeds (the 039 procedure; the review note in the spec).
- **D-9 — the templates-018 add-on is now thirteen keys.** The clean
  manufacturing-add-on removal revokes all thirteen (leaving the six new
  keys active with their deps revoked breaks BR-040) — the spec's
  MANUFACTURING_KEYS list + the starter missing-chain expectation updated;
  the KNOWN_HASH re-pinned to the enabled manifest.

## 5. Gate evidence (the full sweep)

- **typecheck:** 8/8 workspaces (api · web · contracts · ui · desktop ·
  mobile · shared · e2e) — 0 errors.
- **lint:** api clean · web clean · contracts clean.
- **unit:** api **576/576** (51 files; the Playwright browser present for the
  zatca-qr spec — the audit's environmental note resolved here) · web
  **73/73** · contracts **56/56** (the manifest hash test cross-checked
  against node:crypto on the ENABLED food manifest).
- **DB suite (embedded PG16, the full 66-migration chain):**
  **2,768/2,768 — 189 files, 0 failures** (the 041 baseline was 176 files /
  2,619 at 040 + 041's additions; +50 new tests here + the regression base).
- **isolation (RLS A1–A10):** **1,320/1,320** (+42 for the seven 042 tables;
  errata-corrected 2026-11-13 — originally announced 1,332, re-run verified
  1,320).
- **migrations:** 28/28 (apply + re-apply no-op; the RLS catalog drift probe
  green with the seven new tables catalogued).
- **docs:validate:** **33/33**. **i18n parity:** **5,422 = 5,422** (AR = EN;
  +175, the operative count). **permissions drift:** **279 = 279** (matrix
  §3.20 = the seed union; SEED_PATHS + 0065/0066). **manifests:** 13/13 valid.
- **report registry:** 95 contracts (the golden.spec + industry pins
  re-anchored). **EXPLAIN budgets:** 3/3 (index-driven, no seq-scan).

## 6. Delivery

The per-phase archive `ERP_PLATFORM_PHASE042.zip` (OA-07) accompanies this
report. Wave 2 opens with 042 delivered; per the roadmap dependency graph the
next eligible phases are **PHASE-044 (WMS & Inventory Intelligence)** and
PHASE-045 (HR Core) — PHASE-043 (MRP) additionally requires 044 (its other
inputs — work-center capacities, routing times, the frozen standards — shipped
here). The owner continues with «ابدأ تنفيذ المرحلة PHASE-044».
