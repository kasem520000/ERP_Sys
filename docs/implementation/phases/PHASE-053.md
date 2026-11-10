# PHASE-053 — Accounting Depth & Treasury

> **Status:** NOT_STARTED — PLANNED (Blueprint v3.0) · **Wave:** 3 / Stage 14 · **Register:** [CR-23](../../planning/COMPLETENESS_REGISTER.md)
> **Evidence base:** [gap-analysis/ERP_FULL_GAP_ANALYSIS.md](../../planning/gap-analysis/ERP_FULL_GAP_ANALYSIS.md) §3 A-01…A-15 · §12 T-01…T-13 · §4 S-19 · §28.1 PP-05/PP-09 · §29 DF-55 · [COMPLETENESS_ROADMAP.md](../../planning/COMPLETENESS_ROADMAP.md) §6.2

## 1. Phase Overview

- **Phase ID:** PHASE-053
- **Title:** Accounting Depth & Treasury (العمق المحاسبي والخزينة)
- **Objective:** Take the platform's strongest module — accounting at 94% per the audit —
  through the "last mile" that separates a solid GL from a controller's daily tool:
  configurable analytic dimensions beyond cost-center/project with posting-time
  completeness enforcement, hierarchical cost-center rollups, a full FX revaluation
  engine with auto-reversal (replacing the minimal G-19 behavior, default stays OFF per
  policy), branch P&L segment reporting, AR/AP netting for dual-role partners,
  intercompany vouchers between group tenants with zero cross-tenant writes, and a
  treasury pack: cash-flow forecasting, daily cash position, bank guarantees, banking
  details on cash accounts, vault registers, multi-currency cash boxes, card/gateway
  reconciliation surfaces, split payments, and employee custody.
- **Business value:** The audit rates treasury at 72% and calls cash-flow forecasting,
  liquidity management, netting, and intercompany "core" gaps (A-08/A-09/A-10) —
  exactly what finance buyers test in a demo. Analytic dimensions (A-01, "flexibility
  zero" today) unlock department/region/channel P&L questions the GL cannot answer;
  segment statements per branch answer the multi-branch tenant's first question; the
  accountant polish items (period compare, closing checklist) turn month-end from a
  spreadsheet exercise into an in-product workflow.
- **الملخص التنفيذي (AR):** تُكمل هذه المرحلة «الميل الأخير» في المحاسبة: أبعادٌ تحليلية قابلة للتهيئة (قسم/منطقة/قناة/موظف) بتخزينٍ مفهرس للأبعاد الساخنة وJSONB للبقية مع إلزام الاكتمال عند الترحيل (INV-037)، تجميعٌ هرمي لمراكز التكلفة، محركُ إعادة تقييم عملات كامل بعكسٍ تلقائي للفترة التالية (G-69، والسياسة الافتراضية تبقى إيقاف التشغيل)، قوائمُ أرباح مرحلية لكل فرع، مقاصةُ ذمم مدينة/دائنة للطرف المزدوج (G-70)، إيصالاتُ بين الشركات عبر قارئ المنصة المُدقَّق دون أي كتابة عابرة للمستأجرين (G-71)، وحزمةُ خزينة كاملة: توقعات التدفق النقدي، المركز النقدي اليومي، الضمانات البنكية، بيانات الحسابات المصرفية (IBAN/SWIFT)، الخزائن الحديدية، الصناديق متعددة العملات، تسوية البطاقات والبوابات، الدفعات المقسّمة، وعُهد الموظفين.

## 2. Scope

In scope:

1. **`analytic_dimension_definitions` + journal-line dimension storage** (A-01):
   configurable dimensions (department / region / channel / employee and up to N
   tenant-defined others); `journal_lines` gains dedicated indexed columns for the hot
   dimensions and a jsonb bag for the rest; posting-time completeness enforcement per
   account/dimension configuration (INV-037) and a budget-availability enforcement
   option at posting (A-11 — BR-051 advisory becomes enforceable when configured).
2. **`cost_center_hierarchies`** (A-02): hierarchy closure + rollup reporting with
   recursive aggregation and materialized rollup snapshots for large trees.
3. **`fx_revaluation_runs`** (A-03): the full revaluation engine replacing the minimal
   G-19 behavior — per-period runs computing unrealized gain/loss per account by
   currency, posting through the golden journal rules, auto-reversed next period;
   the default stays OFF per the existing policy. `fx_hedge_contracts` records hedge
   positions (S-19, DF-55) that participate in runs; an FX exposure report shows
   unrealized positions by currency across AR/AP/cash.
4. **Branch P&L segment reporting** (A-06): a per-branch statement set (income
   statement with branch dimension filtering) and a segment report picker on the
   financial statements; management-vs-statutory views are served through dimensions
   and segments (A-05 served; duplicate dual ledgers recorded as a deferred decision).
5. **`partner_netting_documents`** (A-09): AR/AP offset documents for dual-role
   partners with paired subledger application on both sides (G-70 zero-sum); partial
   application and currency handling defined.
6. **`intercompany_vouchers`** (A-10): paired journals — IC AP in one tenant, IC AR in
   the counterparty tenant — posted through the audited platform-plane reader pattern;
   zero cross-tenant writes preserved (G-71 pairing).
7. **`cash_flow_forecasts`** (A-08, T-01): forecast documents assembled from AR/AP
   aging, recurring entries, and budget schedules; the daily cash-position dashboard
   (T-02) with per-account and per-currency drill-down.
8. **`bank_guarantees`** (T-03): issue/expiry/margin tracking with expiry alerts into
   the notification system.
9. **`cash_accounts` banking columns** (T-04): IBAN / SWIFT / bank / branch / account
   number; inter-account transfer netting with an in-transit clearing account (T-06).
10. **`vault_registers`** (T-07): safes with custody assignment and
    `vault_transactions`; multi-currency cash boxes (T-08) — balances per currency per
    box with the decimal discipline preserved.
11. **Card/gateway reconciliation surfaces** (T-09, T-10) and
    **`split_payment_allocments`** (T-13): settlement statement surfaces that reconcile
    card/gateway batches to receipts; split payments allocated across tenders. Live
    gateway event ingestion lands with the payment integrations phase (056).
12. **Employee custody/advances** (T-11, A-12): custody documents issued from treasury
    with settlement against expense documents.
13. **Accountant polish** (PP-05, PP-09, A-14, A-07, A-04): one-click period-vs-period
    comparison, a closing checklist per period (tasks + verification steps), the
    indirect-method cash-flow statement, and group period-close orchestration across
    tenants through the platform-plane reader.

Out of scope: live bank-feed aggregation import (056) · budget what-if scenarios
(A-15 — served by the BI phase 057; this phase feeds budget schedules into
forecasting) · accounting document archival (A-13 — ECM surfaces land with the UX
phase 062) · duplicate statutory/management ledgers (deferred decision) · open-banking
APIs.

## 3. Prerequisites

| Prerequisite | Status |
|---|---|
| PHASE-052 (Workflow & Approvals Engine) COMPLETE | REQUIRED — NOT_STARTED (planned, Wave 3) |
| Posting engine + 8-step verification + decimal discipline | SHIPPED stages 1–11 (audit §21 — do not touch) |
| Consolidation platform-plane reader (multi-entity) | SHIPPED — reused for intercompany, never altered |
| Multi-currency core (currencies, FX rates, G-19 minimal revaluation) | SHIPPED — replaced by the full engine, default OFF preserved |

Per [COMPLETENESS_ROADMAP.md](../../planning/COMPLETENESS_ROADMAP.md) §5, 052 before
053 is a hard rule: approval chains gate treasury operations (revaluation runs,
netting, intercompany vouchers are approval-gated documents).

## 4. Design Impact

- **Migrations**: 7, next in sequence — `0094_analytic_dimensions.sql` (definitions +
  `journal_lines` dimension columns + hot-dim indexes), `0095_cost_center_hierarchies.sql`,
  `0096_fx_revaluation.sql` (runs + lines + hedge contracts),
  `0097_partner_netting.sql`, `0098_intercompany_vouchers.sql`,
  `0099_treasury.sql` (forecasts + lines, guarantees, vaults + transactions, custody),
  `0100_cash_accounts_banking.sql` (banking columns + split payment allocments). The
  journal continues from the Wave-1/2 sequence (expected 0049…0093 after phases
  036–052); exact numbers assigned at implementation as the next free sequence,
  strictly increasing, with `_journal.json` + `migrations.ts/spec` updated.
- **Entities/catalog**: +16 tables (dimension definitions; hierarchy closure;
  revaluation runs/lines; hedge contracts; netting documents/applications;
  intercompany vouchers/pairs; forecasts/lines; guarantees; vaults/transactions;
  split payment allocments; custody documents) + 2 column extensions
  (`journal_lines`, `cash_accounts`) — SQL + Drizzle mirror + `ENTITY_CATALOG.md`
  rows (CR-36 a). Performance budgets per table with EXPLAIN-verified hot paths
  (OA-06), especially the `journal_lines` extension.
- **Permissions**: +14 keys across `accounting.*` and `treasury.*` (dimensions,
  revaluation, netting, intercompany, segments, period close/compare, forecasts,
  position, guarantees, vaults, transfers, reconciliation, custody); zero-drift check
  re-extended (registry = seed, cumulative v3.0 count).
- **i18n**: ~260 new AR/EN keys (dimension admin, segment picker, treasury screens,
  closing checklist, netting/IC documents); parity check extended.
- **Docs**: `ACCOUNTING_ENGINE_SPECIFICATION.md`, `JOURNAL_RULES.md` (G-69…G-71),
  `ACCOUNTING_INVARIANTS.md` (INV-037), `CHART_OF_ACCOUNTS.md` (IC AP/IC AR
  guidance), `PERIOD_CLOSING.md`, `RECONCILIATION.md`, `ENTITY_CATALOG.md`,
  `REPORT_CATALOG.md`, `FEATURE_CATALOG.md`, `NAVIGATION_MODEL.md`.
- **Reports**: +8 contracts — `accounting.segment-pnl`,
  `accounting.cash-flow-indirect`, `accounting.fx-revaluation`,
  `accounting.dimension-analysis`, `treasury.cash-flow-forecast`,
  `treasury.cash-position`, `treasury.guarantees-register`,
  `treasury.netting-statement` (catalog rows mandatory).
- **Feature flags**: `accounting.dimensions`, `accounting.revaluation`,
  `accounting.netting`, `accounting.intercompany`, `treasury.forecasts`,
  `treasury.position`, `treasury.guarantees`, `treasury.vaults` — template-composable
  grants.
- **No architectural change** — treasury is a new module inside the modular monolith
  over the existing posting engine; intercompany reuses the consolidation platform
  reader unchanged. Offline sync assessment: statement/report surfaces are read-only
  web surfaces (N/A recorded for sync clients per CR-36 g).

## 5. Implementation Plan

| Task | Description | Layer |
|---|---|---|
| T-01 | Author migrations 0094–0100 + journal/spec updates; backfill job for dimension columns | api |
| T-02 | Drizzle mirrors + `ENTITY_CATALOG.md` rows + RLS policies + attack tests A1–A10 (incl. cross-tenant IC attack) | api |
| T-03 | Dimension engine: definitions CRUD, document-context population of journal-line dimensions, INV-037 posting check, budget-availability option | api |
| T-04 | Cost-center hierarchy closure + recursive rollup aggregation + materialized snapshots | api |
| T-05 | FX revaluation engine: per-period runs, unrealized per account by currency, auto-reversal, hedge participation, G-69 | api |
| T-06 | Segment P&L statements + segment picker + indirect cash-flow statement + period-vs-period compare | api |
| T-07 | Netting documents: paired AR/AP subledger application, partial application, G-70 | api |
| T-08 | Intercompany vouchers through the platform-plane reader: paired per-tenant journals, G-71, zero cross-tenant writes | api |
| T-09 | Cash-flow forecast assembly (AR/AP aging + recurring + budget schedules) + daily cash-position computation | api |
| T-10 | Treasury registers: guarantees (issue/expiry/margin + alerts), vaults + transactions, multi-currency cash boxes, banking columns, inter-account transfers | api |
| T-11 | Card/gateway reconciliation surfaces + split payment allocments + employee custody documents | api |
| T-12 | Closing checklist + group period-close orchestration (A-04, PP-09) | api |
| T-13 | Screens: `/accounting/dimensions`, netting document UI, intercompany voucher UI, segment report picker | web |
| T-14 | Screens: `/treasury/forecasts`, `/treasury/position`, `/treasury/guarantees`, vault register screens | web |
| T-15 | Report contracts (+8) with tests + `REPORT_CATALOG.md` rows | api |
| T-16 | Goldens G-69/G-70/G-71 + INV-037 into `JOURNAL_RULES.md` / `ACCOUNTING_INVARIANTS.md`; update accounting docs | docs |
| T-17 | Run full local gates (typecheck/lint/boundaries/tests/docs/i18n parity/permissions drift/manifests/EXPLAIN budgets) and record evidence | all |

## 6. Verification

Acceptance criteria (all must pass with recorded evidence):

1. Migrations 0094–0100 apply cleanly; Drizzle mirrors and `ENTITY_CATALOG.md` rows
   present; RLS attack tests A1–A10 pass — including an explicit cross-tenant attack
   against intercompany vouchers proving zero cross-tenant writes.
2. Dimension completeness (INV-037): posting a journal line missing a required
   dimension (per account configuration) is rejected by the posting engine; hot-dim
   queries are EXPLAIN-verified against the OA-06 budgets on seeded volumes.
3. Cost-center rollups: a three-level hierarchy aggregates child balances to parents
   exactly (recursive test), and the materialized snapshot matches the live
   computation after refresh.
4. FX revaluation: a seeded multi-currency period produces per-account unrealized
   gain/loss entries that balance per run (G-69), auto-reverse in the next period,
   and hedge contracts net into the run; the default remains OFF until a tenant
   enables it (policy preserved).
5. Segment reporting: two branches produce independent P&L statement sets with the
   segment picker; consolidated totals equal the single-book totals (tie-out test).
6. Netting: a dual-role partner's AR and AP documents offset through a netting
   document whose applications sum to zero on both subledgers (G-70); partial
   application and currency cases covered by tests.
7. Intercompany: a voucher between two group tenants creates exactly two journals —
   IC AP in one, IC AR in the other — mirrored and sign-inverted (G-71), both posted
   through the audited platform-plane reader with no cross-tenant session writes.
8. Treasury surfaces render with AR/EN parity and RTL: forecast vs actual, daily
   cash position with per-account/currency drill-down, guarantees with expiry alerts,
   vault transactions, multi-currency cash boxes; the closing checklist drives
   period close with verification steps.
9. All CR-36 discipline gates green (catalog parity, permissions zero-drift, AR/EN
   parity, `docs:validate`, RLS tests, feature flags, sync-surface N/A recorded).
10. Completion report `reports/PHASE-053-COMPLETION.md` appended with evidence;
    `IMPLEMENTATION_STATUS.md` row flipped; archive delivered as
    `ERP_PLATFORM_PHASE053.zip` (OA-07).

## 7. Risks and Constraints

- **`journal_lines` is the hottest table** — adding dimension columns must not regress
  posting paths; mitigated by additive nullable columns, a controlled backfill job,
  and EXPLAIN-verified budgets as acceptance criteria (OA-06).
- **Revaluation correctness** — auto-reversal and per-account currency math are classic
  error sources; mitigated by G-69 balancing, seeded multi-currency fixtures, and the
  default-OFF policy until verified.
- **Intercompany security** — any cross-tenant write would break the RLS invariant the
  platform is praised for; mitigated by reusing the consolidation platform-plane
  reader unchanged, paired per-tenant posting, and a dedicated attack test.
- **Netting edge cases** — partial application, mixed currencies, and crossed periods
  can corrupt subledger aging; mitigated by paired application semantics, period
  guards, and golden G-70.
- **Migration size** — seven migrations with backfills in one phase; mitigated by
  splitting per domain and keeping every migration reversible or additive.

## 8. Completion and Handoff

- Completion report: `docs/implementation/phases/reports/PHASE-053-COMPLETION.md`
  (evidence per criterion, gate output, the EXPLAIN budget table, the dimension
  configuration guide).
- Status flip: `IMPLEMENTATION_STATUS.md` PHASE-053 row → COMPLETE; `NEXT_ACTION.md`
  → PHASE-054 (Tax & Corporate Compliance) with its prerequisites.
- Delivery: repository state archived as `ERP_PLATFORM_PHASE053.zip` (OA-07) and
  handed to the owner; the owner continues with «ابدأ تنفيذ المرحلة PHASE-054».
- Handoff notes for PHASE-054: the dimension storage and segment statements shipped
  here feed the tax provision engine's dimension filters; revaluation runs supply
  FX positions the tax pack must not double-count; netting and intercompany surfaces
  are the pattern templates for withholding and declaration documents.
