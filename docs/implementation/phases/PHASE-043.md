# PHASE-043 — Manufacturing II — MRP & Planning

> **Status:** COMPLETE 2026-11-13 (Blueprint v3.0) — [the completion report](reports/PHASE-043-COMPLETION.md) · **Wave:** 2 / Stage 13 · **Register:** [CR-13](../../planning/COMPLETENESS_REGISTER.md)
> **Evidence base:** [gap-analysis/ERP_FULL_GAP_ANALYSIS.md](../../planning/gap-analysis/ERP_FULL_GAP_ANALYSIS.md) §2 H-03 · §7 M-01, M-05…M-11, M-21/M-22/M-24/M-25 · [gap-analysis/ERP_COMPLETENESS_GAP_REPORT.md](../../planning/gap-analysis/ERP_COMPLETENESS_GAP_REPORT.md) §2 «الفجوة 1: التصنيع»

## 1. Phase Overview

- **Phase ID:** PHASE-043
- **Title:** Manufacturing II — MRP & Planning (التصنيع ٢ — تخطيط الاحتياجات)
- **Objective:** Deliver the **planning brain** the audit called the single most
  disqualifying manufacturing gap: a deterministic **MRP engine** computing net
  requirements — (MPS + firm sales orders + safety stock) − (on-hand − reserved) −
  (on-order: open POs + open MOs) — over **multi-level BOM explosions** with low-level
  codes, phantom flattening, alternative-material substitution, and by/co-product
  netting, producing **actionable suggestions** (purchase order / production order /
  transfer) that convert to real documents in one click. Around the engine: master
  production schedule, item planning policies (lead time, auto-computed safety stock,
  lot sizing, time fences), bill of resources, an ATP/CTP service consumed by sales
  order lines, MTO linkage between production and sales orders, and the contract
  manufacturing flow.
- **Business value:** The audit's verdict — "a real factory plans manually in Excel;
  this alone disqualifies the system as a manufacturing ERP." With MRP live, material
  planners run net-requirements on demand, buyers receive converted purchase orders
  instead of spreadsheet guesses, sales promises real dates via ATP/CTP, and
  make-to-order shops link production orders directly to customer demand. The engine
  is deliberately deterministic and explanation-first: every suggestion carries its
  netting math so users trust — and audit — the plan.
- **الملخص التنفيذي (AR):** قلب التصنيع الحقيقي: محرك تخطيط احتياجات المواد (MRP)
  يحسب الاحتياج الصافي — (MPS + أوامر بيع مؤكدة + مخزون أمان) − (المتاح − المحجوز)
  − (قيد الشراء + قيد التصنيع) — مع انفجار قوائم مواد متعدد المستويات بأكواد
  المستوى الأدنى وتسطيح القوائم الوهمية والمواد البديلة وخصم المنتجات المصاحبة
  والثانوية، وينتج اقتراحات أوامر شراء/إنتاج/تحويل تُحوَّل بنقرة واحدة إلى
  مستندات فعلية. يشمل الجدول الزمني للإنتاج الرئيسي (MPS) وخدمة ATP/CTP تستهلكها
  بنود أوامر البيع، وربط أمر الإنتاج بأمر البيع (MTO) وتدفق التصنيع التعاقدي، مع
  سياسات تخطيط على مستوى الصنف وقائمة موارد لكل قائمة مواد.

## 2. Scope

In scope:

1. **Item planning policies** (item card planning-policy fields) (M-01, DF-24):
   `lead_time`, `safety_stock` (manual value or auto-compute policy from service
   level + demand variability over a look-back window), `lot_sizing` rule (lot-for-lot
   / fixed order quantity / period supply / order multiple), and `time_fences`
   (frozen / slushy / open) — surfaced as a planning tab on the item card.
2. **Master production schedule** (`mps_entries`) (M-05): planned production quantities
   per item per bucket, overriding or seeding demand inside the frozen fence; edits
   inside the frozen fence require an explicit permission + reason.
3. **Bill of resources** (`bill_of_resources`) (M-25): critical resources (work
   centers + key materials) per BOM with consumption factors, consumed for rough-cut
   capacity and supply feasibility checks against PHASE-042 work-center capacities —
   not finite scheduling.
4. **MRP run engine** (`mrp_runs`, `mrp_demand_lines`, `mrp_supply_lines`) (H-03,
   M-01, M-07): run parameters — planning horizon, bucket size (day/week), scope
   items, run mode (regenerative / net-change); net requirements per bucket =
   (MPS + firm sales orders + safety stock) − (on-hand − reserved) − (on-order: open
   purchase orders + open production orders); multi-level BOM explosion with
   **low-level codes** (memoized, cycle-detected); phantom BOM flattening (M-08);
   alternative-material substitution (M-09) at explosion time with substitution
   records; by/co-product netting (M-11); expiry-aware supply qualification using
   shelf-life data from PHASE-044 (M-10) so FEFO-short supply does not cover far
   demand.
5. **MRP suggestions** (`mrp_suggestions`) (H-03, M-01, M-24): type PURCHASE_ORDER /
   PRODUCTION_ORDER / TRANSFER, quantity after lot-sizing, `due_date`, status
   SUGGESTED / ACCEPTED / DISMISSED (reason required), and a one-to-one document
   link after conversion; one-click conversion to a purchase order (through the
   PHASE-038 auto-PO path), a production order (routing pre-bound when the item has
   one), or an inter-warehouse transfer.
6. **ATP/CTP computation service** (M-06, S-10): available-to-promise /
   capable-to-promise per item and date, consumed by sales order lines (promise-date
   suggestion + warning on over-promise); conservative exclusions are hard rules —
   quarantined, reserved, and consignment-owned stock never promise (BR-080).
7. **MTO linkage** (M-22): production order ↔ sales order line link with a hard
   reservation; completion routes to the sales delivery with the MO's actual cost.
8. **Contract manufacturing flow** (M-21): tolling — material issue to the processor
   (stock-at-processor tracking), conversion service purchase order receipt, and
   yield/scrap settlement on return.
9. **By/co-product completion posting** (M-11): joint allocation of actual WIP cost
   across main product and co/by-products per BOM percentages (G-47).
10. **Reservation policy engine** (I-14): automatic reservation of sales and
    production order lines against bin-level stock using PHASE-044 strategies
    (FIFO/FEFO) — the missing policy layer over the existing `stock_reservations`.
11. **Screens** (12-template discipline, AR/EN parity, RTL, ⌘K registration):
    `/manufacturing/mrp` (run configuration + run history + suggestions board with
    accept / dismiss-with-reason / convert), `/manufacturing/mps` (bucket grid
    editor), and the item-card planning tab.

Out of scope: finite capacity scheduling / load leveling (bill of resources gives
rough-cut checks only) · quality gates in planning (PHASE-050) · statistical demand
forecasting and ML safety stock (PHASE-064 may assist later; policies here are
deterministic) · drop-ship and trading replenishment flows (PHASE-060).

## 3. Prerequisites

| Prerequisite | Status |
|---|---|
| PHASE-034 (Enterprise-Depth consolidation) baseline | delivered 2026-11-09 |
| PHASE-042 (Manufacturing I) COMPLETE | NOT_STARTED — hard prerequisite (routings, work centers, operation execution) |
| PHASE-044 (WMS & Inventory Intelligence) COMPLETE | NOT_STARTED — hard prerequisite (bins, FEFO/expiry-aware supply, consignment exclusion) |
| PHASE-038 (Procurement Sourcing) COMPLETE | NOT_STARTED — required for the auto-PO conversion path |
| v3.0 planning artifacts (register + roadmap + this document) | authored 2026-11-10 |

Per the [COMPLETENESS_ROADMAP.md](../../planning/COMPLETENESS_ROADMAP.md) dependency
graph, the hard edges are 042 → 043, 044 → 043, and 038 → 043: although 043 precedes
044 numerically, **execution order is 044 before 043** because the MRP engine
consumes bin-level and expiry-aware supply. PHASE-036 is transitively covered by the
PHASE-042 prerequisite.

## 4. Design Impact

- **Migrations**: the sequence continues from PHASE-042's last journal entry (≈ 0066;
  exact numbers taken at implementation time — planned ≈ 0067…0072): item
  planning-policy fields · `mps_entries` · `bill_of_resources` · `mrp_runs` +
  `mrp_demand_lines` + `mrp_supply_lines` + `mrp_suggestions` · seed migration
  (permissions, feature grants, lot-sizing rule definitions — DATA-ONLY). Drizzle
  `_journal.json` + `migrations.ts/spec` updated per house convention.
- **Entities/catalog parity**: +6 tables (`mps_entries`, `bill_of_resources`,
  `mrp_runs`, `mrp_demand_lines`, `mrp_supply_lines`, `mrp_suggestions`) — each with
  SQL + Drizzle mirror + `ENTITY_CATALOG.md` row (CR-36 (a)); item planning fields
  are an extension of the items table.
- **Permissions**: +4 keys (`manufacturing.mrp`, `manufacturing.mps`,
  `manufacturing.planning_policies`, `manufacturing.mps.frozen_edit`); zero-drift
  check extended to the new baseline — seeded set equal on both sides (CR-36 (b)).
- **i18n**: ~140 new AR/EN dictionary keys (run form, suggestions board, MPS grid,
  item planning tab); parity check extended.
- **Reports**: +2 contracts into `REPORT_CATALOG.md`
  (`manufacturing.mrp-exceptions`, `manufacturing.atp-position`); catalog ↔ registry
  reconciliation check extended.
- **Posting canon** (**as implemented: goldens G-47…G-49 · INV-030 ·
  BR-078…BR-080 — the ID_LEDGER-coordinated slots; the plan's G-44…G-46/INV-028/
  BR-061…063 predate the 039–044 waves' consumption of those slots**; see the
  completion report and JOURNAL_RULES note 15): G-47 (by/co-product joint
  allocation), G-48 (contract manufacturing tolling round trip), G-49 (MTO
  completion at actual cost with reservation chain) added to `JOURNAL_RULES.md`
  §7; a note records that MRP runs and suggestions are **not ledger documents**
  (the budgeting precedent — no golden row for the run itself). Invariant
  INV-030 (MRP netting exactness + the one-conversion law) added to
  `ACCOUNTING_INVARIANTS.md`; BR-078…BR-080 added to `BUSINESS_RULES.md`.
- **Feature flags**: `manufacturing.mrp.*`, `manufacturing.mps.*`,
  `manufacturing.planning.*` — template-composable grants (CR-36 (f)).
- **Custom fields**: `mrp_runs`, `mrp_suggestions`, and `mps_entries` registered as
  custom-field surfaces in the PHASE-036 entity registry.
- **Sync surface (CR-36 (g))**: N/A-recorded — planning is a server-side batch and
  interactive surface; no synced entities added.
- **Docs touched**: `JOURNAL_RULES.md` · `ACCOUNTING_INVARIANTS.md` ·
  `BUSINESS_RULES.md` · `ENTITY_CATALOG.md` · `FEATURE_CATALOG.md` ·
  `REPORT_CATALOG.md` · `NAVIGATION_MODEL.md` · `IMPLEMENTATION_STATUS.md` ·
  `NEXT_ACTION.md` (sales-order-line ATP note).
- **No new ADR** — the engine is a deterministic pure service over existing stores;
  CR-36 gates apply. An architecture note on determinism (run snapshots + replayable
  parameters) is added to the module README instead.

## 5. Implementation Plan

| Task | Description | Layer |
|---|---|---|
| T-01 | Author migrations ≈ 0067…0072 (item planning fields, `mps_entries`, `bill_of_resources`, MRP family, seeds) + journal/spec updates | api |
| T-02 | Drizzle mirrors, `ENTITY_CATALOG.md` rows, RLS policies + attack tests A1–A10 for the six new tables | api |
| T-03 | BOM graph service: low-level codes, cycle detection, phantom flattening, alternative substitution, by/co-product links | api |
| T-04 | Net-requirements engine: bucketed netting (the exact formula), lot sizing, time fences, safety-stock auto-compute policy; deterministic run snapshots | api |
| T-05 | Suggestion lifecycle: generation, accept / dismiss-with-reason, idempotent one-click conversion to PO (via the auto-PO path), MO (routing pre-bound), or transfer | api |
| T-06 | MPS service + entries grid backend; frozen-fence edit permission + reason | api |
| T-07 | Bill of resources service + rough-cut capacity check against PHASE-042 work-center capacities | api |
| T-08 | ATP/CTP service + sales order line integration (S-10): promise-date suggestion, over-promise warning, hard exclusions (BR-080) | api |
| T-09 | MTO linkage: MO ↔ sales line link, the availability reservation (an ATP-level hold — the soft model, declared in the round-2 audit), completion routing to sales delivery (G-49) | api |
| T-10 | Contract manufacturing flow: stock-at-processor issue/return, conversion service PO, yield settlement (G-48) | api |
| T-11 | By/co-product completion posting with joint allocation (G-47) + substitution records on explosion | api |
| T-12 | Reservation policy engine (I-14) over `stock_reservations` using PHASE-044 strategies | api |
| T-13 | Build `/manufacturing/mrp` (run config, run history, suggestions board with netting drill-down) | web |
| T-14 | Build `/manufacturing/mps` bucket grid editor + item-card planning tab | web |
| T-15 | NAV_ITEMS + ⌘K registration, permissions seeding, feature grants, i18n keys | web |
| T-16 | Implement the 2 report contracts + tests + `REPORT_CATALOG.md` rows | api |
| T-17 | Golden suites G-47/G-48/G-49 with failure packs (**delivered** — the planned slots, kept; see JOURNAL_RULES note 15); INV-030 suite (netting, idempotent conversion, cycle termination, allocation exactness); BR-078…080 guards | api |
| T-18 | Docs (delivered 2026-11-13): JOURNAL_RULES §7 rows for the three goldens + the no-golden-for-runs note, the invariants doc's INV-030 row, the business-rules register's BR-078…080 rows, FEATURE_CATALOG keys, NAVIGATION_MODEL entries, module determinism note | docs |
| T-19 | Run full local gates + OA-06 EXPLAIN budgets (explosion queries, suggestion board queries); record evidence | all |

## 6. Verification

Acceptance criteria (all must pass with recorded evidence):

1. Migrations 0074–0079 apply cleanly (the planned ≈0067…0072 slots were
   taken by PHASE-044 — the honest next slots; the numbering note); Drizzle
   mirrors + `ENTITY_CATALOG.md` parity for the 11 tables (CR-36 (a)); RLS
   attack tests A1–A10 pass for every new tenant table (CR-36 (e)).
2. Net-requirements correctness proven by property tests over seeded multi-level
   fixtures: per bucket, (MPS + firm sales orders + safety stock) − (on-hand −
   reserved) − (open POs + open MOs) computes exactly; low-level-code explosion
   terminates on cyclic fixture graphs with a typed error; phantom flattening
   preserves total component demand (Σ before = Σ after).
3. Suggestions: acceptance is idempotent (INV-030 — exactly one document per
   suggestion, retry returns the original); dismissal requires a reason; converted
   documents carry bidirectional links to their suggestion and run.
4. Converted production orders arrive routing pre-bound from PHASE-042 data and
   converted purchase orders flow through the PHASE-038 path — no duplicated
   document-creation logic.
5. ATP/CTP: a sales order line suggests promise dates from live supply; over-promise
   warns; quarantined, reserved, and consignment-owned stock are excluded by hard
   rule (BR-080) — asserted by tests.
6. MTO linkage end-to-end: MO completion routes to the linked sales delivery and
   carries the MO actual cost (G-49 golden green with failure pack).
7. Contract manufacturing round trip green (G-48): stock-at-processor balances to
   zero on full return, conversion fee posts through AP, yield loss posts explicitly.
8. By/co-product completion (G-47): Σ allocated costs = actual WIP consumed exactly;
   allocation percentages sum to 100 or a typed validation rejects the BOM.
9. All house gates green: typecheck · lint · boundaries · unit tests ·
   `docs:validate` · i18n parity · permissions drift equality · manifests; OA-06
   budgets met for explosion and suggestion-board hot paths; the sync-surface
   assessment is N/A-recorded (CR-36 (g)).
10. Completion report `reports/PHASE-043-COMPLETION.md` appended with evidence;
    `IMPLEMENTATION_STATUS.md` row flipped; archive delivered as
    `ERP_PLATFORM_PHASE043.zip` (OA-07).

## 7. Risks and Constraints

- **MRP correctness is unforgiving** — a wrong netting line becomes a wrong purchase
  order: mitigated by a pure deterministic engine, replayable run snapshots,
  per-suggestion netting drill-down, and property tests over multi-level fixtures.
- **Performance on deep BOM graphs** — explosion cost grows with levels and items:
  mitigated by low-level-code memoization, the synchronous atomic run (see the
  deviation below), OA-06 EXPLAIN budgets, and an explosion-depth cap with an
  explicit typed warning.

  **Deviation (recorded honestly per the post-closure audit): the plan
  sketched "async run execution with progress"; the DELIVERED engine runs
  SYNCHRONOUSLY within the caller's unit of work — deliberately: the whole
  run (row + snapshots + suggestions) commits or rolls back as ONE atomic
  transaction (no half-written plans, ever), and the depth cap + the
  memoized kernel bound the walk (the full DB suite's heaviest runs stay
  in the hundreds of milliseconds). A progress-streaming async mode is
  future work if real-world runtimes grow — it is NOT delivered and is no
  longer described as such anywhere.
- **Garbage-in planning data** — missing lead times or zero safety stock silently
  produce nonsense plans: mitigated by policy validation warnings, a data-readiness
  panel on the run screen, and the MRP exceptions report.
- **Duplicate document creation** — double-clicking conversion must never create two
  POs: mitigated by idempotent acceptance (INV-030), unique suggestion→document keys,
  and coverage netting that subtracts in-flight suggestions on re-run.
- **Expectation management** — this is infinite-capacity MRP with rough-cut checks,
  not a finite scheduler: mitigated by explicit documentation, the bill-of-resources
  overload warnings, and the out-of-scope list above.

## 8. Completion and Handoff

- Completion report: `docs/implementation/phases/reports/PHASE-043-COMPLETION.md`
  (evidence per acceptance criterion, gate outputs, golden pack results, run
  performance evidence, the determinism note).
- Status flip: `IMPLEMENTATION_STATUS.md` PHASE-043 row → COMPLETE; `NEXT_ACTION.md`
  → next eligible phase per the roadmap (typically PHASE-045 HR Core, whose
  prerequisites are already met, or any unblocked wave-2 phase).
- Delivery: repository state archived as `ERP_PLATFORM_PHASE043.zip` (OA-07); the
  owner continues with «ابدأ تنفيذ المرحلة PHASE-045» (or the next eligible phase).
- Handoff notes for PHASE-045/046: nothing in HR consumes MRP directly, but the
  payroll variable-feed discipline mirrors the run-snapshot pattern used here. Handoff
  notes for the Stage-13 gate: MRP live is one of the four "full ERP" gate conditions
  (CR-38) — record its evidence in the gate checklist. The ATP service is consumed by
  sales order lines now; PHASE-060 deepens the sales side (quotations, forecasting)
  on top of it.
