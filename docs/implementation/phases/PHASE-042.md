# PHASE-042 — Manufacturing I — Routing, Work Centers & Costing

> **Status:** COMPLETE — DELIVERED 2026-11-12 (migrations 0065/0066, schema_version 66; the [completion report](reports/PHASE-042-COMPLETION.md) carries the evidence) · **Wave:** 2 / Stage 13 · **Register:** [CR-12](../../planning/COMPLETENESS_REGISTER.md)
> **Evidence base:** [gap-analysis/ERP_FULL_GAP_ANALYSIS.md](../../planning/gap-analysis/ERP_FULL_GAP_ANALYSIS.md) §2 H-04 · §7 M-02…M-04, M-12…M-19 · [gap-analysis/ERP_COMPLETENESS_GAP_REPORT.md](../../planning/gap-analysis/ERP_COMPLETENESS_GAP_REPORT.md) §2 «الفجوة 1: التصنيع» · [gap-analysis/GAP_ANALYSIS_LAYER2_IFRS_ADVANCED.md](../../planning/gap-analysis/GAP_ANALYSIS_LAYER2_IFRS_ADVANCED.md) (L2-12 standard costing — the v3.1 scope extension, decided pre-042 per the owner mandate)

## 1. Phase Overview

- **Phase ID:** PHASE-042
- **Title:** Manufacturing I — Routing, Work Centers & Costing (التصنيع ١ — مسارات التشغيل ومراكز العمل)
- **Objective:** Close the audit's **manufacturing execution gap**: production orders stop
  being one-shot "consume materials → produce item" documents and become
  **multi-operation shop-floor documents** executed against **routings** on **work
  centers** with setup/run times, per-operation progress, actual operation costing at
  work-center rates, rework orders, downtime records, and OEE visibility. The phase is
  execution-first by design: it lays the operational substrate (work centers with
  capacity and cost rates, routing times, actual times) that PHASE-043's MRP engine,
  bill of resources, and capacity checks will consume — sequencing follows the roadmap's
  hard rule that 042 precedes 043.
- **Business value:** The audit scored manufacturing 38% — "light assembly, not a
  manufacturing system" — and named routing/work centers a market-standard expectation
  of every ERP. With this phase a real factory can: define where and in what sequence
  product flows, cost operations at real machine/labor rates instead of one flat manual
  rate, see standard-vs-actual variance per operation, track rework and downtime with
  reason codes, and read OEE per work center. This is also the first phase where the
  shop floor (not the office) becomes a platform user via the barcode scan terminal.
- **الملخص التنفيذي (AR):** أولى مراحل الموجة الثانية: يرتقي التصنيع من «تجميع بسيط»
  إلى تشغيل حقيقي متعدد المراحل — مسارات تشغيل بعمليات مرقّمة ومراكز عمل بسعة
  لكل وردية ومعدلات تكلفة ثابتة ومتغيرة، وأوامر إنتاج تُنفَّذ عمليةً عملية بأزمنة
  تحضير وتشغيل فعلية ومسح باركود عند كل محطة من الويب وعميل سطح المكتب، مع تدوير
  التكاليف الفعلية إلى أمر الإنتاج وتسجيل فروق المعياري مقابل الفعلي لكل عملية،
  وأوامر إعادة تشغيل، وسجل توقفات بأكواد أسباب، ومؤشر OEE محسوب لكل مركز عمل.
  تُغلق بذلك فجوات H-04 وM-02 إلى M-19 تمهيداً لتخطيط الاحتياجات في المرحلة 043.

## 2. Scope

In scope:

1. **Work centers** (`work_centers`) (M-03, H-04): code, description AR/EN,
   `capacity_per_shift` (with shifts/day), `fixed_cost_rate` and `var_cost_rate` per
   hour in base currency, status ACTIVE/INACTIVE, cost-center linkage for analytics.
   Work-center-level capacity is the planning datum (M-04 first slice: availability
   windows and per-shift capacity — finite scheduling stays out of scope).
2. **Routings and routing operations** (`routings`, `routing_operations`) (M-02, H-04):
   routing header per item with one ACTIVE version (same discipline as BOMs),
   operations carrying `sequence`, `work_center_id`, `setup_time`, `run_time` (per
   unit), optional per-operation rate overrides (`fixed_cost_rate`, `var_cost_rate`),
   bilingual operation description, and an optional inspection hook reserved for
   PHASE-050 quality gates.
3. **Production order execution extension** (production order extension columns +
   `production_order_operations`) (M-02, M-17): `production_orders` gains `routing_id`
   and `current_operation`; per-order operation rows track per-operation progress —
   status machine PENDING / SETUP / RUNNING / PAUSED / COMPLETED / SKIPPED (skip
   requires approval + reason), actual setup and run times, operator, start/finish
   timestamps.
4. **Actual operation costing** (M-18): work-center rates roll into the production
   order's actual conversion cost (WIP legs) computed from actual setup/run times; the
   legacy flat labor/burden-rate path remains for routing-less orders (dual mode,
   documented — no silent behavior change).
5. **Standard-vs-actual variance records** (M-13, M-19): per-operation variance records
   classified as setup, run/usage, and rate variance, plus order-level yield variance;
   statistical scrap treatment (M-12) via operation-level scrap quantity with reason
   codes feeding yield analysis.
5a. **Standard costing layer** (**L2-12** — added by v3.1/CR-45 before this phase
   starts, per the owner's mandate that the decision precede 042/043): item standard
   costs by cost type (material, labor, overhead — and overhead sub-splits), **cost
   roll-up over BOM + routing** (low-level explosion computing the frozen standard per
   item from component standards + routing times × work-center rates), standard
   **freeze/activate** with effective dates (the BOM versioning discipline),
   **purchase-price variance** posting at receipt (standard vs actual, through the
   landed-cost point), and **stock revaluation** on standard change (the G-13/G-14
   adjustment shapes, batch-posted with a variance account). PHASE-043's planning
   costing consumes the frozen standards; WMS (044) values movements at standard when
   the item's policy elects it.
6. **Rework orders** (`rework_orders`) (M-14): reference the defective batch/serial and
   parent production order, carry their own routing and cost roll-up; rework cost posts
   to rework expense — never capitalized into the parent finished-goods layer.
7. **Downtime tracking** (`downtime_records`) (M-15): work center, reason code,
   duration, linked order/operation, operator note; the availability input of OEE and
   the non-value-added cost source.
8. **OEE computed views** (M-16): SQL views per work center and period computing
   availability × performance × quality from operation records, downtime records, and
   existing inspection results — derived facts only, no new source-of-truth tables.
9. **Shop-floor barcode scan points** (M-17): scan order / operation / work-center
   barcodes to start, pause, and complete operations from the web app and the desktop
   client; scan operations are idempotent (INV-013-style operation keys); offline scan
   queueing on the desktop client is assessed under CR-36 (g) / OA-02.
10. **Screens** (12-template screen discipline, AR/EN parity, RTL, empty/loading
    states, ⌘K registration per OA-04): `/manufacturing/routings` (list + versioned
    operation editor), `/manufacturing/work-centers`, the shop-floor terminal view
    (touch-first, large targets), and the downtime log; the production order detail
    gains an Operations tab and a create-rework action.

Out of scope: MRP / MPS / ATP / finite capacity scheduling (PHASE-043) · quality gates
at operations (PHASE-050) · maintenance work orders and meters (PHASE-049) · landed
cost in manufacturing (foreign-trade family) · sub-assembly WIP valuation across
warehouses (WMS valuation stays PHASE-044).

**v3.1 scope note (CR-45):** the standard-costing layer (L2-12) was consolidated into
this phase before implementation — the phase's literal mandate is "Routing, Work
Centers & **Costing**" and its variance machinery (M-13/M-18/M-19) is the direct
consumer; shipping it here hands PHASE-043 a frozen standard to plan against instead
of coupling MRP to an unshipped costing substrate. The effort estimate moves from
~4–6 to ~5–7 weeks.

## 3. Prerequisites

| Prerequisite | Status |
|---|---|
| PHASE-034 (Enterprise-Depth consolidation) baseline | delivered 2026-11-09 |
| PHASE-036 (Extensibility Core) COMPLETE | NOT_STARTED — hard prerequisite (custom fields surface on new entities) |
| v3.0 planning artifacts (register + roadmap + this document) | authored 2026-11-10 |

Per the [COMPLETENESS_ROADMAP.md](../../planning/COMPLETENESS_ROADMAP.md) dependency
graph, PHASE-036 must be COMPLETE before this phase (its entity registry is the surface
custom fields attach to); the delivered 34-phase baseline provides the production
order, BOM, and posting-engine substrate. Wave 1 (035…041) does not need to be fully
complete — only PHASE-036 does.

## 4. Design Impact

- **Migrations**: the sequence continues from PHASE-041's last journal entry (≈ 0059;
  exact numbers are taken at implementation time — this document plans ≈ 0060…0068):
  work centers · routings + routing_operations · production order extension columns +
  `production_order_operations` · rework orders · downtime records · **item standard
  costs + cost roll-up + freeze/activate (the v3.1 L2-12 addition)** · OEE views + seed
  migration (permissions, feature grants, reason codes — DATA-ONLY, following the
  0044/0046/0047 convention). Drizzle `_journal.json` + `migrations.ts/spec` updated
  per house convention.
- **Entities/catalog parity**: +7 tables (`work_centers`, `routings`,
  `routing_operations`, `production_order_operations`, `rework_orders`,
  `downtime_records`, `item_standard_costs` — the last is the v3.1 L2-12 addition)
  and +2 documented views (OEE per work center / per period) —
  each with SQL + Drizzle mirror + `ENTITY_CATALOG.md` row (CR-36 (a)).
- **Permissions**: +7 keys (`manufacturing.routings`, `manufacturing.work_centers`,
  `manufacturing.shopfloor`, `manufacturing.rework_orders`, `manufacturing.downtime`,
  `manufacturing.costing`, `manufacturing.standard_costs` — the last is v3.1/L2-12);
  the 245-discipline zero-drift check extends to the new
  baseline — both sides of the seeded set must stay equal (CR-36 (b)).
- **i18n**: ~160 new AR/EN dictionary keys across the four screens + terminal +
  operations tab; parity check extended (equality enforced on both locales).
- **Reports**: +4 contracts into `REPORT_CATALOG.md` (`manufacturing.work-center-
  utilization` (OEE), `manufacturing.downtime-analysis`, `manufacturing.rework-cost`,
  `manufacturing.cost-variance`); the catalog ↔ registry reconciliation check extends.
- **Posting canon** (**as implemented: G-40/G-41/G-42, INV-028, BR-068…071** — the original
  plan's G-38/G-39/G-40/INV-027/BR-057…060 predate the 039–041 waves' consumption of
  those slots; JOURNAL_RULES note 13 + the INV-028 row record the decision):
  goldens G-40 (operation WIP posting), G-41 (rework cost), G-42
  (downtime non-value posting) added to `JOURNAL_RULES.md` §7 with registered
  source/operation keys; invariant INV-028 (operation completion invariants) added to
  `ACCOUNTING_INVARIANTS.md`; BR-068…BR-071 added to `BUSINESS_RULES.md`.
- **Feature flags**: `manufacturing.routing.*`, `manufacturing.work_centers.*`,
  `manufacturing.shopfloor.*` — template-composable grants (CR-36 (f));
  manufacturing-bearing industry templates enable them by default.
- **Custom fields**: work centers, routings, and routing operations registered as
  custom-field surfaces in the PHASE-036 entity registry (first manufacturing
  consumers).
- **Sync surface (CR-36 (g))**: shop-floor scan endpoints assessed for the offline
  desktop client (idempotent scan queue); the web terminal needs no sync; the field
  client is N/A-recorded this phase.
- **Docs touched**: `JOURNAL_RULES.md` · `ACCOUNTING_INVARIANTS.md` ·
  `BUSINESS_RULES.md` · `ENTITY_CATALOG.md` · `FEATURE_CATALOG.md` ·
  `REPORT_CATALOG.md` · `NAVIGATION_MODEL.md` · `IMPLEMENTATION_STATUS.md` ·
  `NEXT_ACTION.md`.
- **No new ADR** — all changes stay within decided patterns (posting engine, document
  lifecycle, RLS); CR-36 gates apply throughout.

## 5. Implementation Plan

| Task | Description | Layer |
|---|---|---|
| T-01 | Author migrations ≈ 0060…0066 (work centers, routings + operations, production order extension + operation rows, rework orders, downtime records, OEE views, seeds) + journal/spec updates | api |
| T-02 | Drizzle mirrors, `ENTITY_CATALOG.md` rows, RLS policies + attack tests A1–A10 for every new table | api |
| T-03 | Work-center module: CRUD, cost rates, per-shift capacity, status, cost-center link | api |
| T-04 | Routing module: versioned header + operations grid (sequence, times, rate overrides), copy-from-routing, activation discipline | api |
| T-05 | Production order execution service: routing binding, operation state machine, actual time capture, `current_operation` advance, sequence enforcement (INV-028) | api |
| T-06 | Actual costing engine: rate × time roll-up into WIP legs (G-40), variance record computation (setup/usage/rate + order yield, M-12/M-13/M-19), posting-engine source keys | api |
| T-07 | Rework order service: create-from-defect, own routing execution, G-41 posting (expense — never parent FG) | api |
| T-08 | Downtime service: reason codes, duration, G-42 non-value posting policy (default OFF — record-only), OEE view inputs | api |
| T-09 | Shop-floor scan endpoints (start/pause/complete by barcode, idempotent keys) + offline scan queue assessment for the desktop client | api |
| T-10 | Build `/manufacturing/routings` and `/manufacturing/work-centers` screens with versioned editor and rate forms | web |
| T-11 | Build the shop-floor terminal view (touch-first, scan-first, AR/EN RTL) and the downtime log screen | web |
| T-12 | Production order detail: Operations tab (progress, actual times, variance view) + create-rework action | web |
| T-13 | NAV_ITEMS + ⌘K registration, permissions seeding, feature-flag grants, i18n keys | web |
| T-14 | Implement the 4 report contracts (`defineReport`) + tests + `REPORT_CATALOG.md` rows | api |
| T-15 | Golden suites G-40/G-41/G-42 with mandatory failure packs; INV-028 suite; BR-068…060 rules + guards | api |
| T-16 | Docs: JOURNAL_RULES §7 rows, ACCOUNTING_INVARIANTS INV-028, BUSINESS_RULES BR rows, FEATURE_CATALOG keys, NAVIGATION_MODEL entries | docs |
| T-17 | Run full local gates (typecheck/lint/boundaries/tests/docs/i18n parity/permissions drift/manifests) + OA-06 EXPLAIN budgets for `production_order_operations` and `downtime_records` hot paths; record evidence | all |

## 6. Verification

Acceptance criteria (all must pass with recorded evidence):

1. Migrations ≈ 0060…0066 apply cleanly; Drizzle mirrors and `ENTITY_CATALOG.md` rows
   exist for all 6 tables + 2 views (CR-36 (a)); RLS attack tests A1–A10 pass for every
   new tenant table (CR-36 (e)).
2. A routing-bound production order executes operation-by-operation: the state machine
   honors sequence (INV-028: operation N+1 cannot start before N completes; each
   operation completes at most once), actual setup/run times are captured, and
   `current_operation` advances exactly with the last completed operation.
3. Golden G-40 green: operation completion posts DR `WIP` · CR conversion-cost accrual
   at work-center rates × actual times, balanced in document and base currency
   (INV-001/002) and idempotent under retry (INV-013); the mandatory failure pack is
   red for each wrong shape.
4. Order completion computes standard-vs-actual variance records per operation
   (setup/usage/rate) and order-level yield variance exactly; rounding residuals are
   explicit, never absorbed.
5. Goldens G-41 (rework cost) and G-42 (downtime non-value posting) green with failure
   packs; a test asserts rework cost never lands in the parent FG layer (BR-069) and
   downtime posting is policy-gated (BR-070).
6. Routing-less orders still post through the legacy flat-rate path with zero drift in
   the existing G-17/G-18 golden packs (dual mode documented).
7. OEE views compute availability × performance × quality over seeded fixtures and the
   `manufacturing.work-center-utilization` report renders with AR/EN parity.
8. Shop-floor terminal: scan start/pause/complete works from web and the desktop
   client; a repeated scan returns the original result without duplicate effects; the
   sync-surface assessment is recorded (CR-36 (g)).
9. All house gates green: typecheck · lint · boundaries · unit tests · `docs:validate`
   · i18n parity · permissions drift (seeded set equal on both sides) · manifests;
   OA-06 performance budgets met (EXPLAIN-verified hot paths).
10. Completion report `reports/PHASE-042-COMPLETION.md` appended with evidence;
    `IMPLEMENTATION_STATUS.md` row flipped; archive delivered as
    `ERP_PLATFORM_PHASE042.zip` (OA-07).

## 7. Risks and Constraints

- **Backward compatibility of the production order flow** — existing tenants' orders
  must keep working without a routing: mitigated by dual mode (routing-less = legacy
  flat-rate path), a documented decision record, and G-17/G-18 regression packs.
- **Actual-costing precision** — rate × time products and variance splits are rounding
  traps: mitigated by the platform decimal discipline, explicit residual posting, and
  property tests over fractional hours and mixed rates.
- **OEE data quality** — availability is only as honest as downtime logging: mitigated
  by required reason codes, an exceptions report for RUNNING operations without
  progress, and per-work-center coverage metrics on the utilization report.
- **Shop-floor adoption** — operators are not office users: mitigated by the
  touch-first terminal, scan-first interaction, large-target RTL layout, and Arabic
  operation descriptions on the routing itself.
- **Offline scan conflicts on the desktop client** — two scans of the same operation
  offline: mitigated by idempotent operation keys (the INV-013 pattern), last-writer
  audit, and a sync exception queue surfaced to the supervisor.

## 8. Completion and Handoff

- Completion report: `docs/implementation/phases/reports/PHASE-042-COMPLETION.md`
  (evidence for each acceptance criterion, gate outputs, golden pack results, the
  dual-mode decision record, OA-06 EXPLAIN evidence).
- Status flip: `IMPLEMENTATION_STATUS.md` PHASE-042 row → COMPLETE; `NEXT_ACTION.md`
  → next eligible phase per the roadmap dependency graph — PHASE-044 (WMS) and
  PHASE-045 (HR Core) are unblocked by their own prerequisites, while PHASE-043 (MRP)
  additionally requires PHASE-044 and PHASE-038 COMPLETE.
- Delivery: repository state archived as `ERP_PLATFORM_PHASE042.zip` (OA-07) and handed
  to the owner; the owner continues with «ابدأ تنفيذ المرحلة PHASE-044» (or 045) until
  043's prerequisites are met.
- Handoff notes for PHASE-043: work-center capacities, routing times, and operation
  cost rates delivered here are the inputs of the bill of resources, rough-cut
  capacity checks, and standard-cost roll-up; the operation state machine is the
  execution backbone MRP suggestions will convert into. Handoff notes for PHASE-044:
  `production_order_operations` and `downtime_records` are bin/location-agnostic by
  design this phase — 044 may add bin references without migration conflicts (columns
  reserved).
