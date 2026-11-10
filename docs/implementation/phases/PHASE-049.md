# PHASE-049 — CMMS — Asset Maintenance

> **Status:** NOT_STARTED — PLANNED (Blueprint v3.0) · **Wave:** 2 / Stage 13 · **Register:** [CR-19](../../planning/COMPLETENESS_REGISTER.md)
> **Evidence base:** [gap-analysis/ERP_FULL_GAP_ANALYSIS.md](../../planning/gap-analysis/ERP_FULL_GAP_ANALYSIS.md) §2 (H-15) · §9 (FA-F-01…FA-F-09, F-11/F-12/F-13) · [COMPLETENESS_ROADMAP.md](../../planning/COMPLETENESS_ROADMAP.md) §6.2

## 1. Phase Overview

- **Phase ID:** PHASE-049
- **Title:** CMMS — Asset Maintenance (صيانة الأصول)
- **Objective:** Deliver the maintenance half of the fixed-asset story (H-15): work
  orders with labor, parts and external costs that post to the GL as maintenance
  expense; preventive plans triggered by calendar days or meter deltas; asset meters
  (hours, km, production, custom) with a readings log; a spare-parts BOM per asset whose
  consumption is an inventory issue; asset transfers between branches with approval and
  a GL reclassification; QR/barcode tags with a scan-to-asset-card surface; and the
  warranty/insurance/license expiry registers with an alert job. The asset card gains its
  service-history timeline, cost-center grouping and component tracking (F-11/F-12/F-13).
- **Business value:** Fleet and equipment operators — the automotive-workshop,
  rental-logistics, healthcare and manufacturing templates — currently track maintenance
  on paper while the ERP holds the assets and the parts. This phase wires the two
  together: preventive discipline (calendar and meter triggers) cuts breakdown cost,
  spares consumption finally reconciles inventory movements to maintenance expense
  (FA-F-04), and expiry registers (warranty, insurance, license) turn renewals into
  scheduled alerts instead of surprises.
- **الملخص التنفيذي (AR):** تُكمل هذه المرحلة النصف الثاني من قصة الأصول الثابتة:
  أوامر صيانة بحالات محددة (مطلوب ← مخطط ← جارٍ ← معلّق ← مكتمل) بتكاليف عمالة
  وقطع وخدمات خارجية تُرحَّل مصروفَ صيانةً عبر محرك الترحيل، وخطط صيانة وقائية
  بمُطلِقي تقويمٍ (بالأيام) أو عدّاد (بفرق القراءة)، وعدادات الأصل (ساعات/كم/
  إنتاج/مخصص) مع سجل قراءات، وقائمة قطع غيار لكل أصل يتحول استهلاكها إلى صرف
  مخزوني، ونقل الأصول بين الفروع بموافقة وترحيل محاسبي، وبطاقات QR قابلة للمسح
  تفتح بطاقة الأصل، وسجلات انتهاء الضمان والتأمين والترخيص بتنبيهات دورية — مع
  خط زمني لتاريخ الأصل وتجميعه حسب مركز التكلفة وتتبع مكوناته (F-11/F-12/F-13).

## 2. Scope

In scope:

1. **Maintenance work orders (FA-F-02, H-15)**: `maintenance_work_orders` — status
   REQUESTED→PLANNED→IN_PROGRESS→ON_HOLD→COMPLETED, problem/solution text, priority,
   assigned technician, and labor/parts/external cost totals; completion posts G-60
   (maintenance expense) through the posting engine.
2. **Preventive plans (FA-F-01, FA-F-03)**: `maintenance_plans` — trigger CALENDAR (by
   interval in days) or METER (by reading delta on a chosen meter); plan evaluation
   creates work orders automatically, at most one open order per asset per trigger
   window (BR-066).
3. **Plan checklists (FA-F-03)**: `maintenance_plan_tasks` — checklist steps carried
   onto generated work orders with per-step results; a work order cannot complete with
   open steps (BR-067).
4. **Asset meters (FA-F-05)**: `asset_meters` (type HOURS/KM/PRODUCTION/CUSTOM, unit,
   last reading) + `asset_meter_readings` (value, date, source MANUAL/JOB/IMPORT) — the
   readings log that drives METER triggers and usage views.
5. **Spare-parts BOM (FA-F-04)**: `asset_spares` — spare item + qty per asset; work-order
   parts lines draw from the BOM; consumption posts as an inventory issue (G-61) under
   the existing no-negative-stock discipline (BR-068).
6. **Asset transfers (FA-F-07)**: `asset_transfers` — from/to branch, reason, approval;
   on approval the GL reclassification moves net book value between branch cost centers
   (G-62), posted exactly once (BR-069).
7. **Asset tags (FA-F-06)**: `asset_tags` — QR/barcode generation (unguessable signed
   codes), print sheet, and a scan surface that resolves the code to the asset card.
8. **Asset card extensions (FA-F-08, FA-F-09, F-11, F-12, F-13)**: `warranty_expiry`,
   `insurance_expiry`, `license_expiry` columns + grouping by cost center on the existing
   `assets` table; service-history timeline (work orders, readings, transfers); component
   tracking via a parent-asset link — components carry their own meters and spares and
   roll up into the parent's history.
9. **Integration & alerts**: work-order costs post to GL via the posting engine
   (maintenance expense, G-60); spares consumption = inventory issue (G-61); meter
   readings trigger plan evaluation; a daily `asset-expiry-sweep` job fires 30/7/0-day
   alerts for warranty, insurance and license expiries.

Out of scope: tax depreciation, partial disposal and IFRS-16 leases (054 per the
roadmap) · predictive maintenance analytics (064 candidate, recorded not committed) ·
telemetry device integrations (readings arrive manually or via the import toolkit
surface; live feeds wait on the API platform of 055) · capitalizable-improvement
posting flow (default is expensed; a recorded decision can flip it later).

## 3. Prerequisites

| Prerequisite | Status |
|---|---|
| PHASE-035 — Activation & Truth Restoration COMPLETE (v3.0 entry point and discipline baseline) | NOT_STARTED — PLANNED (Blueprint v3.0) |
| Delivered baseline: fixed-assets module (depreciation, `assets` tables), inventory issue discipline, posting engine, multi-branch model, RLS isolation, AR/EN i18n, ⌘K palette, pg-boss jobs | delivered (stages 1–11) |

No other v3.0 phase is a hard prerequisite: CMMS builds on the delivered asset module
directly. The work-order status machine and board patterns are shared with the
field-service surface of PHASE-048 where delivered; this phase is self-contained
without it
([COMPLETENESS_ROADMAP.md](../../planning/COMPLETENESS_ROADMAP.md) §5).

## 4. Design Impact

- **Navigation**: +3 screens — `/assets/maintenance` (orders board + plans),
  `/assets/meters`, `/assets/transfers` — plus the QR scan route resolving to the asset
  card and the extended asset card (history timeline, expiry chips, components); ⌘K
  registration (OA-04); 12-template screen discipline.
- **Migrations**: 4 scripts, next in sequence — `0083_cmms_work_orders.sql` (work
  orders, plans, plan tasks), `0084_cmms_meters_spares.sql` (meters, readings, spares,
  tags), `0085_cmms_transfers.sql` (transfers), `0086_cmms_asset_expiry_columns.sql`
  (ALTER on `assets` for the three expiry columns + cost-center grouping + the DATA-ONLY
  grants block). Exact numbers confirmed against the Drizzle journal at implementation
  time.
- **Entities**: +8 tenant tables → SQL + Drizzle mirror + `ENTITY_CATALOG.md` rows
  (CR-36a); +column family on `assets`.
- **Permissions**: +10 keys — `assets.maintenance.view/manage/plan`,
  `assets.meters.view/record`, `assets.spares.manage`, `assets.transfer.view/approve`,
  `assets.tags.manage`, `assets.expiry.view`; zero-drift discipline extended (CR-36b).
- **i18n**: ~+220 AR/EN key pairs across the three screen families, the scan surface and
  the extended asset card; parity equality extended (base+n = base+n).
- **Reports**: +4 contracts — `assets.maintenance-costs`, `assets.maintenance-backlog`
  (overdue plans and orders), `assets.meter-readings`, `assets.expiry-register` — with
  `REPORT_CATALOG.md` rows and the catalog↔registry reconciliation check extended.
- **Feature flags**: `assets.maintenance`, `assets.transfer` — template-composable
  grants (CR-36f); automotive-workshop, rental-logistics, healthcare and
  food-manufacturing templates compose them by default.
- **Posting rules**: `JOURNAL_RULES.md` gains G-60 (work-order completion → maintenance
  expense: labor + parts + external, asset cost untouched), G-61 (spares consumption →
  inventory issue posting), G-62 (asset transfer approval → NBV reclassification between
  branch cost centers); `ACCOUNTING_INVARIANTS.md` gains INV-033 (work-order cost
  integrity); `BUSINESS_RULES.md` gains BR-066…BR-069.
- **Jobs**: `asset-expiry-sweep` (daily) + meter-trigger plan evaluation (event-driven on
  reading insert) on the existing pg-boss queue.
- **Docs**: `ENTITY_CATALOG.md`, `REPORT_CATALOG.md`, `NAVIGATION_MODEL.md`,
  `JOURNAL_RULES.md`, `ACCOUNTING_INVARIANTS.md`, `BUSINESS_RULES.md`, the fixed-assets
  tables doc.
- **No new ADR** — postings ride the centralized posting engine and existing inventory
  issue discipline; CR-36 gates apply.
- **Offline sync assessment (OA-02)**: meter readings and work-order completion are
  flagged as future offline candidates for technicians; N/A-recorded for this phase (no
  synced entity added).

## 5. Implementation Plan

| Task | Description | Layer |
|---|---|---|
| T-01 | Migration `0083` (work orders, plans, plan tasks) + journal/spec updates | api |
| T-02 | Migration `0084` (meters, readings log, spares BOM, tags) | api |
| T-03 | Migration `0085` (asset transfers with approval) | api |
| T-04 | Migration `0086` (assets expiry columns + grouping + DATA-ONLY grants) | api |
| T-05 | Work-order API: status machine, cost collectors (labor/parts/external), completion gate (BR-067) | api |
| T-06 | G-60 posting rule: maintenance expense on completion, idempotent, via posting engine | api |
| T-07 | Plans API: CALENDAR/METER triggers, single-open-per-window (BR-066), checklist carry-over | api |
| T-08 | Meters API: readings log with monotonic-value validation, last-reading snapshot, trigger evaluation | api |
| T-09 | Spares API: BOM maintenance, parts lines → inventory issue posting G-61 (BR-068) | api |
| T-10 | Transfers API: approval flow + G-62 NBV reclassification posted exactly once (BR-069) | api |
| T-11 | Tags: signed code generation, print sheet, scan resolution route | api |
| T-12 | `asset-expiry-sweep` job (30/7/0) + notifications | api |
| T-13 | `/assets/maintenance` screen (orders board + plans admin + checklist entry) | web |
| T-14 | `/assets/meters` and `/assets/transfers` screens + QR scan surface | web |
| T-15 | Asset card extension: history timeline, expiry chips, components, cost-center grouping | web |
| T-16 | Report contracts ×4 + `REPORT_CATALOG.md` rows + catalog↔registry check extension | api |
| T-17 | Golden tests G-60…G-62 + INV-033 test + RLS attack tests A1–A10 + OA-06 budgets on readings/boards | api |
| T-18 | Docs: catalog/invariants/journal-rules/business-rules/navigation updates | docs |
| T-19 | Run full local gates and record evidence | all |

## 6. Verification

Acceptance criteria (all must pass with recorded evidence):

1. Migrations `0083…0086` apply cleanly with Drizzle mirror parity; all 8 new tables and
   the `assets` column family have `ENTITY_CATALOG.md` rows (CR-36a).
2. The work-order status machine enforces REQUESTED→PLANNED→IN_PROGRESS→ON_HOLD→
   COMPLETED transitions only; completion is blocked while checklist steps are open
   (BR-067) or cost lines are unposted.
3. Golden tests pass: G-60 posts maintenance expense (labor + parts + external) on
   completion with the asset's cost and depreciation untouched; G-61 posts spares
   consumption as a balanced inventory issue; G-62 reclassifies NBV between branch cost
   centers on transfer approval — all idempotent through the posting engine.
4. INV-033 holds: per work order, the GL maintenance expense equals the sum of its labor,
   parts and external source lines to the cent; no posting occurs before completion.
5. Preventive plans behave: a CALENDAR plan generates on its day interval; a METER plan
   generates when the reading delta crosses its threshold; at most one open order per
   asset per trigger window (BR-066); back-dated readings cannot double-trigger.
6. Meter readings validate monotonically per meter with an effective-date order; the
   last-reading snapshot and usage views reconcile with the log.
7. Asset tags: generated codes are unguessable and unique; scanning resolves to the
   asset card; the print sheet renders AR/EN with RTL correctness.
8. `asset-expiry-sweep` fires 30/7/0-day alerts for warranty, insurance and license
   expiries, deduplicated; evidence in the job log and notification records.
9. CR-36 gates: +10 permission keys with zero-drift equality · i18n parity · RLS attack
   tests A1–A10 on all new tables · feature-flag/template gating verified ·
   `docs:validate` green · OA-06 budgets (indexes + EXPLAIN on readings, boards and the
   service-history timeline).
10. Completion report `reports/PHASE-049-COMPLETION.md` appended with evidence;
    `IMPLEMENTATION_STATUS.md` row flipped; archive delivered as
    `ERP_PLATFORM_PHASE049.zip` (OA-07).

## 7. Risks and Constraints

- **Meter data quality** — out-of-order and back-dated readings can corrupt trigger
  evaluation: mitigated by monotonic-value validation, effective-date semantics and the
  single-open rule (BR-066).
- **Spare BOM drift** — BOM lines pointing at discontinued items break parts picking:
  mitigated by foreign keys into the item master and validation at BOM save time.
- **Transfer GL mapping** — branches without a mapped maintenance/cost-center account
  would break G-62: mitigated by a mapping check before posting and a clear error
  surface.
- **Tag security** — guessable QR codes would let outsiders probe asset records:
  mitigated by signed unguessable codes and the standard auth + RLS stack on resolution.

## 8. Completion and Handoff

- Completion report: `docs/implementation/phases/reports/PHASE-049-COMPLETION.md`
  (evidence per acceptance criterion, the three golden test transcripts, INV-033
  reconciliation output, sweep log).
- Status flip: `IMPLEMENTATION_STATUS.md` PHASE-049 row → COMPLETE; `NEXT_ACTION.md`
  → next eligible phase PHASE-050 (Quality Management System); unconnected Wave-2
  siblings may run in parallel per
  [COMPLETENESS_ROADMAP.md](../../planning/COMPLETENESS_ROADMAP.md) §5.
- Delivery: repository state archived as `ERP_PLATFORM_PHASE049.zip` (OA-07) and handed
  to the owner; the owner continues with «ابدأ تنفيذ المرحلة PHASE-050».
- Handoff notes for PHASE-050: calibration instruments are tracked as assets, so
  `calibration_records` binds to the asset card and its service-history timeline shipped
  here; the expiry-sweep pattern extends to calibration due dates.
