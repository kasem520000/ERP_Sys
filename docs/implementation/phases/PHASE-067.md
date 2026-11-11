# PHASE-067 — IFRS Advanced Compliance II — Business, Ownership & Disclosure

> **Status:** NOT_STARTED — PLANNED (Blueprint v3.1) · **Wave:** 4 / Stage 15 · **Register:** [CR-43](../../planning/COMPLETENESS_REGISTER.md)
> **Evidence base:** [gap-analysis/GAP_ANALYSIS_LAYER2_IFRS_ADVANCED.md](../../planning/gap-analysis/GAP_ANALYSIS_LAYER2_IFRS_ADVANCED.md) (L2-06…L2-10, L2-16, L2-18) · [COMPLETENESS_ROADMAP.md](../../planning/COMPLETENESS_ROADMAP.md) §3/§6.5

## 1. Phase Overview

- **Phase ID:** PHASE-067
- **Title:** IFRS Advanced Compliance II — Business, Ownership & Disclosure (الامتثال المتقدم ٢ — الأعمال والملكية والإفصاح)
- **Objective:** Close the second half of the advanced IFRS/IAS gap layer:
  the **transaction/ownership family**. This phase ships business-combination
  accounting (IFRS 3, L2-06 — purchase-price allocation with fair-value
  worksheets, goodwill/non-goodwill split feeding the PHASE-066 register,
  contingent consideration, and the consolidation entry), share-based
  payments (IFRS 2, L2-07 — equity/cash-settled plans with vesting
  recognition riding the PHASE-068 schedule engine), defined-benefit plan
  accounting with the actuarial assumption register and sensitivity
  analysis (IAS 19, L2-08/L2-09 — service/interest in P&L, remeasurements
  in the equity reserve), hyperinflation restatement mode (IAS 29, L2-10 —
  index-based restatement plus the net-monetary-position gain/loss, gated on
  a verified official designation), non-controlling-interest presentation
  (IFRS 10/IFRS 3, L2-16 — ownership split over the PHASE-034 consolidation
  machinery), and XBRL-tagged statutory statements (L2-18 — taxonomy
  mapping, tagged facts, validation report over the shipped statement
  engine).
- **Business value:** group-owning tenants and their auditors get the
  transaction-side machinery that 066's measurement registers imply:
  combinations that actually create the goodwill 066 tests, ownership
  splits that make consolidated statements presentable, IAS 19 plans for
  multinational reporting, and structured (XBRL) regulator-ready statements.
- **الملخص التنفيذي (AR):** تسدّ هذه المرحلة النصف الثاني من فجوات المعايير
  المتقدمة — عائلة العمليات والملكية والإفصاح: محاسبة اندماج الأعمال بتوزيع
  ثمن الشراء على الأصول والالتزامات بالقيمة العادلة وولادة الشهرة في سجل
  المرحلة 066 (IFRS 3)، المدفوعات على أساس الأسهم بأسلوبَي التسوية ومع الاعتراف
  عبر فترات الاستحقاق (IFRS 2)، مزايا الموظفين المحددة بمكوناتها الخدمية
  والفوائد وإعادة القياس في الاحتياطي، مع سجل الافتراضات الاكتوارية وتحليل
  الحساسية (IAS 19)، إعادة عرض القوائم في اقتصادات التضخم المفرط بقرار designate
  موثق فقط (IAS 29)، عرض الحصص غير المسيطرة على آلية التوحيد (IFRS 10)،
  والقوائم المالية الموسومة بصيغة XBRL للجهات التنظيمية.

## 2. Scope

In scope:

1. **Business combinations** (L2-06 / IFRS 3): `business_combinations`
   (acquirer, acquiree, acquisition date, consideration breakdown) +
   `ppa_allocations` (identifiable assets/liabilities at fair value with
   source-evidenced worksheets — REQUIRES_VERIFICATION) + contingent
   consideration (fair value at acquisition, subsequent changes per
   instrument type) + the goodwill computation feeding the PHASE-066
   `goodwill_records` register and the consolidation entry into the
   PHASE-034 machinery.
2. **Share-based payments** (L2-07 / IFRS 2): `sbp_plans` + `sbp_grants`
   (equity-settled and cash-settled), fair value at grant date (source-
   evidenced model inputs; no fabricated prices), vesting-condition
   tracking, expense recognition over the vesting period via the PHASE-068
   recognition-schedule engine, forfeiture handling, and the
   cash-settled remeasurement discipline.
3. **Defined-benefit plans** (L2-08 / IAS 19): `db_plans` (plan register,
   benefit formula per plan) + the net-DB-liability computation — service
   cost and net interest in P&L, remeasurements in the equity reserve (the
   OCI-style reserve account discipline), reconciling to the PHASE-029/046
   payroll EOS data without duplicating it (read-only consumption).
4. **Actuarial assumptions & sensitivity** (L2-09 / IAS 19):
   `actuarial_assumptions` (versioned: discount rate, salary growth,
   mortality, turnover) with documented sources, run history, and the
   sensitivity analysis disclosure (±reasonable shifts per assumption).
5. **Hyperinflation accounting** (L2-10 / IAS 29): `inflation_indices`
   (index series register) + the restatement run mode for a designated
   entity — index restatement of historical-cost statements and the
   gain/loss on the net monetary position. Activation requires a verified
   official designation of the entity's functional-currency economy
   (REQUIRES_VERIFICATION — no tenant is flagged by guesswork).
6. **Non-controlling interests** (L2-16 / IFRS 10/IFRS 3): ownership
   percentage register per group entity (PHASE-034 additive —
   `group_entities` extension), NCI share of profit and equity in the
   consolidated statements, partial-goodwill allocation consistent with
   066's register.
7. **XBRL reporting** (L2-18): the taxonomy mapping layer over the shipped
   statement engine — `xbrl_mappings` (statement line → taxonomy concept),
   tagged-fact generation for the statutory statements, and the validation
   report (unmapped/failing facts block the export with typed errors).
8. **Disclosure pack**: combination, SBP, DB-plan, NCI, and hyperinflation
   disclosures as report contracts; the XBRL export surface registered with
   the export wizard (054 SAF-T precedent).

Out of scope: the measurement registers themselves (066 — impairment,
provisions, grants, RP registry) · contract balances (068 — L2-14/17) ·
statutory e-filing submission adapters beyond the XBRL file (054/063
territory) · plan-design consulting features (the register computes; it
does not advise).

## 3. Prerequisites

| Prerequisite | Status |
|---|---|
| PHASE-054 (Tax & Corporate Compliance) COMPLETE | planned — the compliance/export precedents (SAF-T wizard) and the intangibles register feed PPA allocations |
| PHASE-066 (IFRS Advanced I) COMPLETE | planned — the goodwill/CGU machinery is the landing zone for combination balances; hard ordering 066 → 067 |
| PHASE-046 (HR Payroll Compliance) COMPLETE | planned — IAS 19 consumes payroll/EOS data read-only |
| PHASE-068 recognition-schedule engine | planned — parallel-safe sibling (SBP vesting recognition rides its contract; manual fallback documented if sequencing inverts) |
| PHASE-034 consolidation (group machinery) | shipped — NCI and combination entries extend it additively |
| v3.1 planning artifacts (this document + the L2 gap file) | authored 2026-11-11 |

Position in Wave 4: after 054/066 in the sequential lineage; parallel-safe
with 060–065 once prerequisites land.

## 4. Design Impact

- **Migrations**: the next in sequence at implementation time (~0160+
  planning envelope; exact numbers bound at start). Expected new tables
  (~10): `business_combinations`, `ppa_allocations`, `sbp_plans`,
  `sbp_grants`, `db_plans`, `actuarial_assumptions`, `inflation_indices`,
  `hyperinflation_runs`, `xbrl_mappings`, plus the `group_entities`
  ownership extension (additive columns).
- **Entities/catalog parity:** +9…10 rows in `ENTITY_CATALOG.md` (the
  ownership extension is additive on a catalogued table); SQL + Drizzle +
  catalog rows (CR-36 a).
- **Permissions:** +9 keys — `ifrs.combinations.manage`,
  `ifrs.combinations.approve`, `ifrs.sbp.manage`, `ifrs.db-plans.manage`,
  `ifrs.actuarial.manage`, `ifrs.hyperinflation.manage`,
  `ifrs.nci.manage`, `ifrs.xbrl.manage`, `ifrs.xbrl.export`; zero-drift
  extended.
- **i18n:** ~220 new AR/EN keys; parity gate as ever.
- **Reports:** +5 contracts — `ifrs.combination-note`,
  `ifrs.db-plan-position`, `ifrs.sbp.expense`, `ifrs.nci.statement`,
  `ifrs.xbrl.validation` (registry counts bound at implementation).
- **Feature flags:** +2 keys — `ifrs.ownership` (enterprise),
  `ifrs.structured-reporting` (enterprise).
- **Goldens:** the combination entry (consideration → net identifiable
  assets → goodwill), the SBP vesting-slice, the DB service/interest and
  remeasurement postings, and the hyperinflation restatement entries
  register as new goldens (next free G-numbers at implementation).
- **Rules:** new BR entries (next free numbers at implementation) — PPA
  completeness before goodwill computation (INV-style: the combination
  journal balances only against a complete allocation); designation-gated
  hyperinflation; XBRL export blocked on validation failure.
- **Docs:** JOURNAL_RULES.md · BUSINESS_RULES.md · ENTITY_CATALOG.md ·
  FEATURE_CATALOG.md · REPORT_CATALOG.md · DATA_DICTIONARY.md ·
  NAVIGATION_MODEL.md · CONSOLIDATION docs (NCI presentation) ·
  ARCHITECTURE decisions if the XBRL mapping layer introduces a boundary.
- **Sync surface (CR-36 g):** server-side registers; read feeds additive;
  offline writes N/A-recorded.
- **Performance (OA-06):** EXPLAIN-verified — the PPA allocation join, the
  DB-plan position computation over payroll history, the XBRL fact
  generation over statement queries; ⌘K entries (OA-04).

## 5. Implementation Plan

| Task | Description | Layer |
|---|---|---|
| T-01 | Migrations (~10 RLS'd tables + group_entities extension) + Drizzle journal/spec | api |
| T-02 | Combination workflow: header, PPA allocation worksheet, consideration breakdown, approval with SoD | api |
| T-03 | Combination posting engine: net identifiable assets → goodwill (into the 066 register) / bargain-purchase gain + consolidation entry | api |
| T-04 | Contingent consideration: initial recognition and subsequent remeasurement rules | api |
| T-05 | SBP plans/grants: vesting schedules (068 engine contract), equity vs cash-settled journals, forfeiture | api |
| T-06 | DB plans: plan register, service/interest computation, remeasurement reserve, payroll read-only reconciliation | api |
| T-07 | Actuarial assumptions: versioning, sourced rates, run history, sensitivity disclosure | api |
| T-08 | Hyperinflation: index register, designation gate, restatement run mode, monetary gain/loss posting | api |
| T-09 | NCI: ownership register on group entities, consolidated-statement split presentation, partial goodwill | api |
| T-10 | XBRL: taxonomy mapping layer, tagged-fact generation, validation report, export wizard integration | api |
| T-11 | Disclosure report contracts (5) + catalog rows + bilingual rendering | api |
| T-12 | Web screens: the ownership & structured-reporting workspace + NAV_ITEMS + ⌘K + AR/EN | web |
| T-13 | Goldens (combination, SBP, DB, restatement) + rule specs + RLS A1–A10 + docs wave + full gates | all |

## 6. Verification

Acceptance criteria (all must pass with recorded evidence):

1. Migrations apply cleanly; new tables RLS'd; Drizzle + ENTITY_CATALOG
   parity; the group_entities extension is additive.
2. Combination end-to-end: a seeded acquisition allocates consideration over
   fair-valued assets/liabilities (worksheet-sourced), computes goodwill
   into the 066 register, posts the balanced combination golden, and appears
   in the consolidation entry; an incomplete allocation is a typed
   rejection (no partial combinations).
3. SBP: a grant with vesting conditions recognizes expense over the
   schedule (worked example with the golden), forfeiture reverses the
   remaining schedule, and cash-settled remeasurement posts correctly.
4. DB plan: service cost + net interest post to P&L and remeasurements to
   the reserve (balanced golden); the position reconciles read-only against
   payroll EOS fixtures; assumption sensitivity renders the disclosure.
5. Hyperinflation: on a designated test entity, the restatement run produces
   index-restated statements and the net-monetary gain/loss posting;
   without a verified designation the mode refuses to activate (typed
   rejection).
6. NCI: consolidated fixtures with <100% ownership split profit and equity
   correctly (worked example pinned); partial goodwill consistent with the
   066 register.
7. XBRL: the statutory statements export as tagged facts with the mapping
   layer; unmapped/failing facts block the export with typed errors; the
   validation report lists every failure.
8. House gates green (CR-36): RLS A1–A10 · typecheck · lint · unit ·
   `docs:validate` · i18n parity · permissions drift · EXPLAIN budgets.
9. Completion report appended with evidence; IMPLEMENTATION_STATUS row
   flipped; archive delivered (OA-07).

## 7. Risks and Constraints

- **Fair-value input quality** (PPA, SBP grant value, contingent
  consideration): mitigated by source-evidenced worksheets
  (REQUIRES_VERIFICATION), approval gates with SoD, and disclosures that
  never print unsourced numbers.
- **Consolidation interplay** — combination entries and NCI sit on the
  shipped PHASE-034 machinery: mitigated by additive-only extensions and
  reconciliation tests against INV-026 (consolidated = Σ members −
  eliminations) extended with the ownership split.
- **IAS 19 data weight** — remeasurement runs over payroll history: mitigated
  by bounded runs, EXPLAIN budgets, and read-only consumption (no payroll
  duplication).

## 8. Completion and Handoff

- Completion report: `docs/implementation/phases/reports/PHASE-067-COMPLETION.md`
  (evidence per criterion, golden worked examples, gate output).
- Status flip: IMPLEMENTATION_STATUS PHASE-067 row → COMPLETE; NEXT_ACTION →
  next eligible phase.
- Delivery: `ERP_PLATFORM_PHASE067.zip` (OA-07).
- Handoff notes: closes the L2 gap layer with 066; the XBRL surface is the
  structured-reporting substrate any future regulator-filing adapters build
  on (054/063 adapter patterns).
