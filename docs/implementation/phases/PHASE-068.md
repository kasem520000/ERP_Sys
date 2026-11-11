# PHASE-068 — Accrual Engine, Revenue Recognition & Recurring Commerce

> **Status:** NOT_STARTED — PLANNED (Blueprint v3.1) · **Wave:** 3 / Stage 14 · **Register:** [CR-44](../../planning/COMPLETENESS_REGISTER.md)
> **Evidence base:** [gap-analysis/GAP_ANALYSIS_LAYER1_23_GAPS.md](../../planning/gap-analysis/GAP_ANALYSIS_LAYER1_23_GAPS.md) (L1-01…L1-05 residuals, L1-15, L1-16) · [gap-analysis/GAP_ANALYSIS_LAYER2_IFRS_ADVANCED.md](../../planning/gap-analysis/GAP_ANALYSIS_LAYER2_IFRS_ADVANCED.md) (L2-14, L2-17) · [COMPLETENESS_ROADMAP.md](../../planning/COMPLETENESS_ROADMAP.md) §3/§6.5

## 1. Phase Overview

- **Phase ID:** PHASE-068
- **Title:** Accrual Engine, Revenue Recognition & Recurring Commerce (محرك الاستحقاق والاعتراف بالإيراد والتجارة المتكررة)
- **Objective:** Close the accrual/deferral automation family the
  second-round audits found missing, **without ballooning PHASE-053** (the
  new-phase rule in the owner's linking guidance, CR-44). One engine —
  **periodic allocation schedules** (an amount, a recognition rule, a
  period grid) — powers: deferred revenue with period release (L1-01),
  revenue recognition over time/milestones/deliverables (L1-02), prepaid
  expense amortization (L1-03), monthly accrual templates with
  auto-reversal (L1-05 — extending the shipped `recurring_journals`
  DRAFT-only machinery), and the time-release interfaces consumed by
  PHASE-066 (grants, provisions). A second engine — **recurring document
  generation** (the shipped `contract_invoices` idempotency pattern
  generalized) — powers generic recurring invoices (L1-04), customer
  standing orders (L1-15 — the supplier-side `blanket_orders` discipline
  mirrored), and subscription billing depth: usage-based/metered lines,
  escalation clauses, renewal repricing (L1-16 — extending the shipped
  service-contract cluster). On top of the recognition substrate, the
  IFRS-15 contract balances ship here: contract assets (recognized > billed,
  L2-14) and contract liabilities / remaining-performance-obligation
  disclosure (billed > recognized, L2-17).
- **Business value:** subscription and service tenants bill automatically,
  recognize revenue when it is earned (not merely when invoiced), close
  their month with auto-reversing accruals, and produce the IFRS-15
  contract-balance numbers their auditors ask for — all through the posting
  engine with the house exactly-once discipline.
- **الملخص التنفيذي (AR):** محرك واحد لجداول التوزيع الزمني (مبلغ + قاعدة
  اعتراف + شبكة فترات) يشغّل: الإيرادات المؤجلة بإفراجها الدوري، والاعتراف
  بالإيراد عبر الزمن/المعالم/المخرجات، واستهلاك المدفوع مسبقاً، وقوالب
  الاستحقاق الشهرية بعكس تلقائي (توسيع آلية `recurring_journals`
  الموجودة)، وواجهات الإفراج الزمني التي تستهلكها المرحلة 066 (المنح
  والمخصصات). ومحرك ثانٍ لتوليد المستندات المتكررة (تعميم نمط `contract_
  invoices` المعرّف) يشغّل: الفواتير المتكررة العامة، والأوامر الدائمة
  لجانب العملاء (مرآة انضباط `blanket_orders` الشرائية)، وعمق عقود
  الاشتراك (فوترة بالاستخدام، بنود تصاعدية، إعادة تسعير التجديد). وفوق
  ذلك: أصول العقود والتزاماتها وإفصاح الالتزامات المتبقية (IFRS 15)
  مشتقة مباشرة من الجداول — كل الترحيلات عبر محرك الترحيل بانضباط
  «مرة واحدة بالضبط».

## 2. Scope

In scope:

1. **Allocation-schedule engine** (L1-01/02/03, feeds 066): the `allocation_
   schedules` register (amount, rule: RATABLY_OVER_PERIODS / BY_MILESTONES /
   BY_DELIVERABLES / STRAIGHT_LINE_UNITS, period grid, source document link)
   + the period-run job posting each period's slice with exactly-once
   idempotency (the `contract_invoices` partial-unique precedent) +
   amendment handling (rule changes affect future periods only — never
   rewrite posted history).
2. **Deferred revenue** (L1-01): the invoice-line deferral flag (or the
   contract/subscription link) routes billed amounts to the schedule;
   release journals post DR deferred-revenue / CR revenue per period;
   the liability balance report per customer/contract.
3. **Revenue recognition** (L1-02): recognition schedules over time,
   milestones, or deliverables with the IFRS-15 alignment hooks — the
   five-step data model (contract, performance obligations, transaction
   price, allocation, recognition) in its operational (non-advanced)
   layer; the advanced contract-balance presentation is item 8.
4. **Prepaid expenses** (L1-03): supplier-invoice lines flagged prepaid
   amortize to expense over the coverage period on the same engine (DR
   prepaid-asset at invoice, CR → expense per slice).
5. **Monthly accruals with auto-reversal** (L1-05): accrual templates on
   the shipped `recurring_journals` machinery extended with the
   auto-reversal pair (accrue at close, reverse first day of the next
   period) + the period-close checklist integration + the approval path
   from DRAFT (posting approval rides the existing approval machinery).
6. **Recurring document generation** (L1-04, L1-15): generic recurring
   sales-invoice templates (customer, lines, cycle, validity — not tied to
   a service contract) + customer standing orders generating sales orders
   per period with release discipline mirroring `blanket_orders`
   (max-commitment caps, over-release typed rejection); both engines are
   idempotent per period key.
7. **Subscription billing depth** (L1-16): metered/usage-based billing
   lines (usage events → rated lines on the scheduled invoice), price
   escalation clauses (indexed or fixed-step, effective-dated), and renewal
   repricing automation (extend the shipped RENEWED contract-copy flow with
   repricing rules).
8. **Contract balances — IFRS 15** (L2-14, L2-17): the contract-asset
   (recognized > billed) and contract-liability (billed > recognized)
   derivation over the schedules + the RPO disclosure report (transaction
   price allocated to unsatisfied obligations with expected timing); the
   PHASE-048 progress-certificate interface (output-method consistency —
   L2-15's alignment rule binds here from the 048 side).
9. **Close integration**: the accrual/deferral close checklist section
   (what released, what remains, what reverses tomorrow) + the deferred/
   prepaid balances report.

Out of scope: the 066 measurement registers (provisions/grants/impairment —
they consume the schedule interface, they do not live here) · the service-
contract core (shipped, PHASE-019 — extended, never re-implemented) ·
dunning on failed recurring payments (039 owns the ladder; the recurring
engine emits the same overdue events) · usage-event ingestion adapters
(external metering systems — the 055 connector surface) · the advanced
ownership/combination family (067).

## 3. Prerequisites

| Prerequisite | Status |
|---|---|
| PHASE-053 (Accounting Depth & Treasury) COMPLETE | planned — the accountant-pack surfaces, analytic dimensions, and the schedule posting discipline's control-account mappings ride 053's substrate; hard ordering 053 → 068 |
| PHASE-036 (Extensibility Core) COMPLETE | shipped — custom fields surface on the schedule/template registers |
| Sales/service-contract machinery (invoice chain, contract billing) | shipped — PHASE-012/019; extended, never re-implemented |
| PHASE-048 progress certificates (L2-14 interface) | planned — parallel-safe: the contract-asset derivation defines the interface contract; the 048 side feeds it when live |
| v3.1 planning artifacts (this document + the two gap files) | authored 2026-11-11 |

Position in Wave 3: after 053 in the sequential lineage; parallel-safe with
054–059 and 066 (the 066 schedule interface carries a documented manual
fallback).

## 4. Design Impact

- **Migrations**: the next in sequence at implementation time (~0155+
  planning envelope; exact numbers bound at start). Expected new tables
  (~8): `allocation_schedules`, `allocation_schedule_lines` (the period
  grid), `recurring_invoice_templates`, `recurring_invoice_runs`,
  `standing_orders` (+ release ledger reuse pattern), `usage_events`,
  `contract_balances` (the derived register with its computation stamps),
  plus `recurring_journals` additive columns (auto-reversal pairing) and
  invoice-line deferral flags (additive).
- **Entities/catalog parity:** +8 rows in `ENTITY_CATALOG.md` (additive
  columns documented on their catalogued tables); SQL + Drizzle + catalog
  rows (CR-36 a).
- **Permissions:** +9 keys — `accounting.schedules.manage`,
  `accounting.schedules.post`, `accounting.accruals.manage`,
  `sales.recurring.manage`, `sales.standing-orders.manage`,
  `sales.subscriptions.manage`, `sales.usage.manage`,
  `sales.contract-balances.read`, `accounting.allocation.read`; zero-drift
  extended.
- **i18n:** ~230 new AR/EN keys (schedule surfaces, template designers,
  close checklist, contract-balance reports); parity gate as ever.
- **Reports:** +3 contracts — `accounting.deferred-prepaid-balances`,
  `sales.recurring-billing-register`, `sales.rpo-disclosure` (registry
  counts bound at implementation).
- **Feature flags:** +3 keys — `accounting.accrual-engine`,
  `sales.recurring-billing`, `sales.subscriptions-depth` (business +
  enterprise tiering per the tier-4 precedent).
- **Goldens:** the deferred-release slice, the prepaid amortization slice,
  the accrual/reversal pair, the recognition entry, and the contract-
  balance presentation entries register as new goldens (next free G-numbers
  at implementation, with worked examples + failure packs).
- **Rules:** new BR entries (next free numbers at implementation) — the
  exactly-once period-slice guard (idempotent per period key; replay is a
  typed rejection); amendments affect future periods only; the reversal
  posts exactly once paired with its accrual; metered lines never rate
  without a priced plan line.
- **Docs:** JOURNAL_RULES.md · BUSINESS_RULES.md · ENTITY_CATALOG.md ·
  FEATURE_CATALOG.md · REPORT_CATALOG.md · DATA_DICTIONARY.md (schedule/
   recurrence vocabularies) · NAVIGATION_MODEL.md · PERIOD_CLOSING.md (the
   checklist section) · ACCOUNTING_ENGINE_SPECIFICATION.md.
- **Sync surface (CR-36 g):** schedule registers and templates read-feed
   the offline clients additively; generation runs server-side; offline
   writes N/A-recorded.
- **Performance (OA-06):** EXPLAIN-verified — the period-slice scan
   (tenant, due period), the contract-balance derivation join, the usage
   rating rollup; ⌘K entries for schedules/templates/standing orders
   (OA-04).

## 5. Implementation Plan

| Task | Description | Layer |
|---|---|---|
| T-01 | Migrations (~8 RLS'd tables + additive columns) + Drizzle journal/spec | api |
| T-02 | Allocation-schedule engine: register, rules, period grid, amendments (future-only), period-run job with exactly-once idempotency | api |
| T-03 | Deferred revenue: invoice/contract deferral routing, release journals, liability balances | api |
| T-04 | Revenue recognition: performance-obligation model, recognition schedules, five-step alignment hooks | api |
| T-05 | Prepaid expenses: supplier-invoice flagging, amortization slices | api |
| T-06 | Accrual auto-reversal: recurring_journals extension, close-checklist integration, approval path | api |
| T-07 | Recurring invoice templates + generation runs (idempotent per period key) | api |
| T-08 | Customer standing orders: generation with release caps (blanket-order mirror) | api |
| T-09 | Subscription depth: usage events + rating, escalation clauses, renewal repricing | api |
| T-10 | Contract balances: asset/liability derivation + RPO disclosure + the 048 interface contract | api |
| T-11 | Goldens (5 posting families) with worked examples + failure packs | api |
| T-12 | Web screens: schedule workspace, template designers, recurring register, close checklist + NAV_ITEMS + ⌘K + AR/EN | web |
| T-13 | Rule specs (BR entries, spoof battery) + RLS A1–A10 + docs wave + full gates | all |

## 6. Verification

Acceptance criteria (all must pass with recorded evidence):

1. Migrations apply cleanly; new tables RLS'd; Drizzle + ENTITY_CATALOG
   parity; the `recurring_journals` and invoice-line extensions are
   additive with zero reshape.
2. Deferred revenue end-to-end: a seeded deferred invoice releases over its
   period grid (worked golden per slice), the liability balance report
   ties, and a replayed period run is a typed rejection (exactly once).
3. Recognition: milestone and over-time schedules recognize per rule;
   amendments shift future slices only — posted history is immutable
   (amendment test pinned).
4. Prepaid: amortization slices post DR expense / CR prepaid with the
   coverage balance report tying to the schedule grid.
5. Accrual pair: the accrue-at-close/reverse-next-period pair posts both
   legs exactly once each; the close checklist section renders over seeded
   fixtures.
6. Recurring generation: templates generate invoices idempotently per
   period key (concurrent double-fire is a graceful skip — the
   `contract_invoices` precedent test generalized); standing orders respect
   their commitment caps with over-release typed rejections.
7. Subscription depth: metered usage rates into invoice lines only against
   priced plan lines (unrated usage queues, never guesses); escalation and
   renewal repricing round-trip on seeded contracts.
8. Contract balances: recognized-vs-billed derivation produces the contract
   asset/liability register and the RPO disclosure; the 048 interface
   contract is documented and honored when progress fixtures exist.
9. House gates green (CR-36): RLS A1–A10 · typecheck · lint · unit ·
   `docs:validate` · i18n parity · permissions drift · EXPLAIN budgets.
10. Completion report appended with evidence; IMPLEMENTATION_STATUS row
    flipped; archive delivered (OA-07).

## 7. Risks and Constraints

- **Amendment correctness** — schedule changes must never rewrite posted
  slices: mitigated by future-only amendments (BR-enforced), the immutable
  posted grid, and the amendment test pack.
- **Double-generation** — concurrent recurring runs: mitigated by the
  period-key partial-uniques (the shipped pattern) + the idempotent
  run ledger.
- **Metered-data trust** — usage events arrive from tenants/integrations:
  mitigated by the rated-against-priced-line-only rule, unrated queues,
  and audit events on rating.
- **Interface timing with 048/066** — both ride documented contracts with
  manual fallbacks (the L2-14 derivation defines its input; 066's schedule
  consumption has the manual release path) — 068 never blocks a sibling.

## 8. Completion and Handoff

- Completion report: `docs/implementation/phases/reports/PHASE-068-COMPLETION.md`
  (evidence per criterion, golden worked examples, idempotency traces).
- Status flip: IMPLEMENTATION_STATUS PHASE-068 row → COMPLETE; NEXT_ACTION →
  next eligible phase.
- Delivery: `ERP_PLATFORM_PHASE068.zip` (OA-07).
- Handoff notes: for 066 — the schedule-release interface (grants/
  provisions time release) is live; for 067 — the SBP vesting recognition
  rides the schedule contract; for 041/039 — recurring-generation failures
  emit the standard overdue/notification events the dunning ladder and
  comms hub already consume.
