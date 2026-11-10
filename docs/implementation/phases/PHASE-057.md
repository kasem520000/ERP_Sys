# PHASE-057 — BI & Analytics

> **Status:** NOT_STARTED — PLANNED (Blueprint v3.0) · **Wave:** 3 / Stage 14 · **Register:** [CR-27](../../planning/COMPLETENESS_REGISTER.md)
> **Evidence base:** [gap-analysis/ERP_FULL_GAP_ANALYSIS.md](../../planning/gap-analysis/ERP_FULL_GAP_ANALYSIS.md) §15 (R-01…R-15) · §28.3 (PP-20…PP-27) · [gap-analysis/PROJECT_EVALUATION_2026-11-10.md](../../planning/gap-analysis/PROJECT_EVALUATION_2026-11-10.md) §5.2 (F-7)

## 1. Phase Overview

- **Phase ID:** PHASE-057
- **Title:** BI & Analytics (ذكاء الأعمال والتحليلات)
- **Objective:** Deliver the self-service analytics layer the platform has never had —
  a governed report builder (dimension/measure picking over whitelisted SQL datasets),
  pivot/cross-tab rendering, drag-and-drop dashboards, report alerts, a KPI engine,
  and the piece the evaluation audit named the worst silent deviation: **scheduled
  report delivery over email/WhatsApp (F-7), closed with real code this time**. Every
  dataset is SQL-governed — parameterized fragments, EXPLAIN-verified hot paths
  (OA-06) — and the builder UI never emits raw SQL. This is the BI pillar of the
  Stage-14 "enterprise" gate (API platform + SSO + BI + operations).
- **Business value:** Turns 34 phases of accumulated transactional truth into decision
  surfaces a department head can build alone: a weekly margin pivot delivered to
  WhatsApp on Monday morning, a KPI tile that flags the owner when overdue receivables
  cross a threshold, side-by-side period comparison with variance highlighting, and
  drill-through from any figure to its source documents. Closes fifteen audited BI
  gaps (R-01…R-15) and eight polish gaps (PP-20…PP-27) in one disciplined layer
  instead of an external BI tool the tenant cannot afford or govern.
- **الملخص التنفيذي (AR):** تُنشئ هذه المرحلة طبقةَ التحليلات الذاتية الغائبة: بانِي
  تقارير محكوم فوق مجموعات بيانات مُدرَجة في القائمة البيضاء (SQL مُعامَل ومُتحقَّق
  أداؤه وفق OA-06)، جداول محورية، لوحات قابلة للسحب والإفلات، تنبيهات تقارير، ومحرّك
  مؤشرات أداء، ثم تُسلِّم «التقارير المجدولة» برمجياً حقيقياً عبر بريد المنصة وقنوات
  واتساب من PHASE-041 — فتُغلق فجوة F-7 التي وصفها التدقيق بأنها أهم انحراف صامت.
  كل تقرير قابل للمشاركة برمزٍ محدود النطاق، والتصدير صورةً أو PDF، والتعليق على
  اللقطات، والمقارنة جنباً إلى جنب مع إبراز الفروقات، والنقر من الرقم إلى مستنده
  المصدر.

## 2. Scope

In scope:

1. **Governed dataset registry** (R-01 foundation): a code-level `DATASETS` catalog —
   dimension/measure whitelist, join graph, filter parameters, and per-dataset row
   scoping that reuses RLS session variables — for the first ~10 core datasets (sales,
   AR/AP, inventory, GL, POS, purchasing). The registry is code, reviewed like code;
   no new table.
2. **Report builder** (R-01): `report_definitions` (dataset ref, column picks,
   filters, groupings, chart type, parameter defaults, ownership) and the
   `/analytics/builder` screen with a dimension/measure picker and live preview.
3. **Saved views** (R-15): `report_views` — per-user saved views and filters on any
   list surface or builder report; private by default, explicitly shareable.
4. **Self-service dashboards** (R-03): `dashboard_layouts` — per-user and per-role
   widget grids; chart widgets bound to report definitions; KPI tiles; drag-and-drop
   layout persistence; `/analytics/dashboards` screen.
5. **Report alerts** (R-04): `report_alerts` — condition → threshold → channel
   (in-app, email, WhatsApp); pg-boss evaluation with dedupe windows; alert inbox
   entries in the existing notification center.
6. **Scheduled delivery — the honest F-7 closure** (R-05, R-06, PP-20, PP-22):
   `report_schedules` (cron expression, channel, recipients, parameter snapshot,
   next-run) plus a `report_runs` extension (schedule linkage, delivery artifact,
   per-recipient dispatch status); the engine runs on pg-boss, renders artifacts, and
   dispatches through the PHASE-041 channel ports with their retry semantics.
7. **KPI engine** (R-09): `kpi_definitions` (dataset measure ref, aggregation/target,
   period grain) + `kpi_snapshots` (materialized periodic values with trend history);
   tiles on dashboards and the home surface.
8. **Rendering and interaction pack** (R-02, R-11, R-14, PP-21…PP-27): pivot/cross-tab
   renderer; free drill-down inside the dataset join graph; drill-through from a
   figure to its source documents (PP-21); side-by-side report comparison including
   cross-company without consolidation (R-14, PP-24); variance highlighting (PP-25);
   annotations pinned to report snapshots (PP-23); image/PDF export (PP-26); share
   links with scoped, expiring tokens via `report_shares` (PP-27).
9. **Predictive, what-if, benchmarking** (R-07, R-08, R-10): statistical trend and
   forecast lines (moving average + linear projection) on KPI and report series;
   what-if scenarios as parameterized re-runs compared side-by-side with variance;
   benchmarking surfaces shipped as PLACEHOLDER-marked inputs (no fabricated data;
   external feeds are a later owner decision). Deep AI prediction stays with
   PHASE-064.
10. **Boundary decision records** (R-12, R-13): `DR-057-01` — no standalone OLAP
    server; the pivot engine over governed datasets is the cube-equivalent at this
    platform's scale. `DR-057-02` — BI export split: this phase ships export
    artifacts (CSV/JSON/XLSX bundles of governed datasets); live Power BI/Tableau
    connector feeds remain with PHASE-055 per the roadmap's IN-23 assignment.

Out of scope: live BI connector feeds (055) · AI copilot analytics (064) · any change
to the 85+ code-level `defineReport` contracts (they remain the catalog layer; builder
reports are tenant metadata) · OLAP server (decision-recorded) · ETL/data-warehouse.

## 3. Prerequisites

| Prerequisite | Status |
|---|---|
| PHASE-041 (Communications Hub — email/WhatsApp/SMS channel ports) | PLANNED (Blueprint v3.0) — must be COMPLETE before this phase starts |
| Delivered report engine (85+ `defineReport` contracts, print/PDF pipeline) + pg-boss queue | shipped in stages 1–11 (audit §21 — do not touch) |

PHASE-055 is NOT a prerequisite: 057 and 055 are Wave-3 siblings with no edge in the
roadmap dependency graph; their overlap (BI export) is resolved by decision record
DR-057-02 rather than by ordering.

## 4. Design Impact

- **Migrations:** next in sequence (≈0111…0114 at authoring time, following
  PHASE-056's claimed 0107…0110; exact numbers are bound at implementation start —
  this document claims counts and contents, not fixed journal numbers):
  `reporting_core` (report_definitions, report_views, report_shares,
  dashboard_layouts), `reporting_delivery` (report_alerts, report_schedules, `report_runs` extension
  columns), `kpi_engine` (kpi_definitions, kpi_snapshots), plus one DATA-ONLY grants
  entry for `analytics.*` plan entitlements (the 0044/0046/0047 convention). Drizzle
  mirror, `_journal.json`, and migration spec updated per house convention.
- **Entities/catalog parity:** +8 new tables (the eight above; `report_runs` is
  extended, not new); every table ships SQL + Drizzle + an `ENTITY_CATALOG.md` row
  (CR-36 a).
- **Permissions:** +6 keys — `analytics.report_builder`, `analytics.dashboards`,
  `analytics.schedules`, `analytics.alerts`, `analytics.kpi_engine`,
  `analytics.shares`; the seeded set must equal the checked set — zero-drift equality
  re-run at the extended running base (CR-36 b).
- **i18n:** ~260–320 new dictionary keys (builder, dashboards, schedules, alerts,
  KPI, share, comparison surfaces) ×2 AR/EN; the parity equality check is extended
  (CR-36 c).
- **Docs:** `REPORT_CATALOG.md` (+2 rows) · `NAVIGATION_MODEL.md` (new `analytics`
  group) · new `ANALYTICS_DATASETS.md` (the governed registry contract) · decision
  records DR-057-01/02.
- **Reports:** +2 code-level contracts — `analytics.schedule-deliveries` (delivery
  audit log) and `analytics.kpi-snapshot-history` (KPI trend export); catalog rows
  mandatory.
- **Feature flags:** `analytics.self_service` — template-composable grant,
  enterprise-first entitlement migration (CR-36 f).
- **Goldens/invariants:** none allocated — reporting surfaces only; accounting
  numbering continues untouched (next allocations land in PHASE-058, 060, and 061).
- **Architecture:** read-path only, no posting-engine contact; no new ADR required —
  all patterns are decided, and the dataset governance rules live in
  ANALYTICS_DATASETS.md.

## 5. Implementation Plan

| Task | Description | Layer |
|---|---|---|
| T-01 | Author the `DATASETS` governed registry (~10 core datasets) with EXPLAIN budgets per OA-06 | api |
| T-02 | Migrations (≈0111…0114) + Drizzle mirror + `ENTITY_CATALOG.md` rows | api |
| T-03 | Report-definition CRUD + parameterized executor with dataset row scoping + tests | api |
| T-04 | KPI engine: definitions CRUD + snapshot materialization job + trend queries | api |
| T-05 | Scheduled-delivery engine on pg-boss: cron → run → artifact → 041 channel dispatch | jobs |
| T-06 | Alert evaluation job + dedupe windows + alert inbox entries + preferences hookup | jobs |
| T-07 | `/analytics/builder`: dimension/measure picker, filters, groupings, chart type, live preview | web |
| T-08 | Pivot/cross-tab renderer + free drill-down + drill-through to source documents | web |
| T-09 | `/analytics/dashboards`: drag-and-drop widget grid, per-user/role layouts, KPI tiles | web |
| T-10 | Comparison surface (side-by-side, cross-company, variance highlighting, annotations) | web |
| T-11 | Image/PDF/CSV export + `report_shares` scoped-token links | web |
| T-12 | `report_views` saved views on lists/reports + NAV and ⌘K registration (OA-04) | web |
| T-13 | Decision records DR-057-01/02 + docs updates (catalog, navigation model, datasets) | docs |
| T-14 | RLS attack tests A1–A10 on the 8 new tables + full local gates + evidence pack | all |

## 6. Verification

Acceptance criteria (all must pass with recorded evidence):

1. A tenant analyst builds a report over a governed dataset (dimensions, measures,
   filters, chart type), saves it to `report_definitions`, and re-runs it with
   different parameters — SQL proven parameterized (the API rejects any raw-SQL
   input) and the hot path EXPLAIN-verified within its OA-06 budget.
2. A `report_schedules` entry with a cron expression fires on time, produces a
   `report_runs` row linked to the schedule with its artifact, and delivers by email
   AND WhatsApp through the PHASE-041 channel ports with retry evidence — the F-7
   closure demonstrated with code and logs, and the DR-035-01 record updated to
   closed-with-code.
3. Alert rules evaluate on schedule; a threshold breach creates an alert inbox entry
   and a channel notification; the dedupe window prevents repeat spam.
4. The KPI engine materializes `kpi_snapshots` per period grain; tiles render current
   value, target, and trend line; a broken measure surfaces a readable error instead
   of a silent zero.
5. Dashboards: drag-and-drop persists per-user layouts; role layouts apply to new
   users; a six-widget dashboard renders within the recorded performance budget on
   seeded data; AR/EN and RTL parity hold.
6. Saved views (`report_views`) work on at least three list surfaces and on any
   builder report; views are per-user isolated (RLS test) and explicitly shareable.
7. Share links issue scoped, expiring, read-only tokens (`report_shares`); a revoked
   or expired token returns 404; drill-through from a figure lands on the correct
   source document.
8. Side-by-side comparison with variance highlighting and snapshot annotations works
   across periods and across companies without touching the consolidation path.
9. CR-36 gates: SQL + Drizzle + `ENTITY_CATALOG.md` for all 8 tables · permissions
   zero-drift at the extended base · AR/EN dictionary parity equality ·
   `docs:validate` green · RLS attack tests A1–A10 pass · feature-flag gating with
   template-composable grants · sync-surface assessment recorded (analytics is
   online-only; offline clients get an explicit N/A record per OA-02).
10. Completion report `docs/implementation/phases/reports/PHASE-057-COMPLETION.md`
    appended with evidence; `IMPLEMENTATION_STATUS.md` row flipped; archive delivered
    as `ERP_PLATFORM_PHASE057.zip` (OA-07).

## 7. Risks and Constraints

- **Scheduler honesty debt** — F-7 is the audit's flagship claims-without-code case;
  anything short of end-to-end delivery evidence (cron → artifact → channel receipt)
  fails the phase. Mitigated by making criterion 2 the demo-of-record and updating
  the DR-035-01 decision record in the same change.
- **Query cost on a shared OLTP database** — pivot-style aggregation can degrade
  transactional paths. Mitigated by the whitelist registry (bounded joins), OA-06
  EXPLAIN budgets with index additions, a per-run statement timeout, and handoff
  coordination with PHASE-059 (Redis caching on report hot paths and per-tenant
  report-run quotas when that phase lands).
- **WhatsApp template friction** — scheduled report bodies ride approved templates;
  attachments may fall back to email per provider policy. Mitigated by per-channel
  capability flags on `report_schedules` and an honest fallback recorded in the
  delivery log.
- **Registry sprawl** — every later module will want datasets. Mitigated by a
  documented contribution contract in ANALYTICS_DATASETS.md requiring EXPLAIN
  evidence at review time for every dataset addition.

## 8. Completion and Handoff

- Completion report: `docs/implementation/phases/reports/PHASE-057-COMPLETION.md`
  (evidence per acceptance criterion, delivery logs, the dataset registry table, gate
  outputs, and the two decision records).
- Status flip: `IMPLEMENTATION_STATUS.md` PHASE-057 row → COMPLETE; `NEXT_ACTION.md`
  points to the next eligible phase PHASE-058 (Enterprise Identity & Governance) per
  [COMPLETENESS_ROADMAP.md](../../planning/COMPLETENESS_ROADMAP.md) §5.
- Delivery: repository state archived as `ERP_PLATFORM_PHASE057.zip` (OA-07) and
  handed to the owner; the owner continues with «ابدأ تنفيذ المرحلة PHASE-058».
- Handoff notes for PHASE-058: the field-level audit trail becomes a first-class
  governed dataset here (governance surfaces consume it); the `report_shares`
  scoped-token pattern is the substrate 058's e-signature evidence trail reuses; KPI
  tiles become the natural home for governance health indicators (DSR aging,
  fraud-case counts) once 058 lands.
