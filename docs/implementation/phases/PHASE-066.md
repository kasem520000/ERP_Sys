# PHASE-066 — IFRS Advanced Compliance I — Measurements & Provisions

> **Status:** NOT_STARTED — PLANNED (Blueprint v3.1, scope extended by v3.2/CR-50) · **Wave:** 3 / Stage 14 · **Register:** [CR-42](../../planning/COMPLETENESS_REGISTER.md)
> **Evidence base:** [gap-analysis/GAP_ANALYSIS_LAYER2_IFRS_ADVANCED.md](../../planning/gap-analysis/GAP_ANALYSIS_LAYER2_IFRS_ADVANCED.md) (L2-01…L2-05, L2-11, L2-13, L2-19) · [gap-analysis/GAP_ANALYSIS_LAYER3_RESIDUAL.md](../../planning/gap-analysis/GAP_ANALYSIS_LAYER3_RESIDUAL.md) (R-01 ECL — the v3.2 scope extension) · [COMPLETENESS_ROADMAP.md](../../planning/COMPLETENESS_ROADMAP.md) §3/§6.5

## 1. Phase Overview

- **Phase ID:** PHASE-066
- **Title:** IFRS Advanced Compliance I — Measurements & Provisions (الامتثال المتقدم ١ — القياسات والمخصصات)
- **Objective:** Close the first half of the advanced IFRS/IAS gap layer the
  second-round audits found entirely absent from the platform: the
  **estimate/measurement family**. This phase ships the related-party registry
  and disclosure (IAS 24, L2-01), government grants with both recognition
  methods (IAS 20, L2-02), held-for-sale classification and
  discontinued-operations presentation (IFRS 5, L2-03), investment property
  with the fair-value/cost model election (IAS 40, L2-04), the goodwill
  register with CGU allocation and annual-test discipline (IFRS 3
  measurement side, L2-05), the provisions & contingencies register with
  movements and disclosure (IAS 37, L2-11), the impairment machinery —
  indicators, CGU allocation, recoverable amount, loss and reversal postings
  (IAS 36, L2-13) — and the going-concern assessment integrated into period
  close (IAS 1, L2-19). Every measurement rule follows the
  **REQUIRES_VERIFICATION** discipline inherited from the compliance
  matrices: no fabricated rates or assumptions — frameworks are built from
  the standard's own criteria, and tenant-entered estimates carry their
  source evidence.
- **Business value:** enterprises reporting under IFRS (and their auditors)
  get the measurement/disclosure registers that decide whether the statements
  are signable: related-party disclosures, provision movements, impairment
  testing with documented CGUs, and going-concern evidence — currently all
  maintained outside the system in spreadsheets.
- **الملخص التنفيذي (AR):** تسدّ هذه المرحلة النصف الأول من فجوات المعايير
  المتقدمة — عائلة القياسات والتقديرات: سجل الأطراف ذات العلاقة وإفصاحها
  (IAS 24)، المنح الحكومية بأسلوبي اعترافها (IAS 20)، الأصول المحتفظ بها للبيع
  والتوقفات (IFRS 5)، العقارات الاستثمارية بنموذجي القيمة العادلة والتكلفة
  (IAS 40)، سجل الشهرة وتوزيعها على وحدات توليد النقد واختبارها السنوي
  (IFRS 3)، المخصصات والأحداث الطارئة بحركاتها وإفصاحها (IAS 37)، إضمحلال
  الأصول بمؤشراته وقيوده وترحيلاته (IAS 36)، وتقييم افتراض الاستمرارية عند
  الإقفال (IAS 1). كل معدل أو افتراض يخضع لقاعدة «لا اختلاق» (REQUIRES_
  VERIFICATION): إما مصدر موثق أو وضع ورقة عمل يرفض الترحيل.

## 2. Scope

In scope:

1. **Related-party registry & disclosure** (L2-01 / IAS 24):
   `related_party_relations` (typed relation graph: ownership, control,
   key-management-personnel, family — between partners, employees, and
   group entities) + the disclosure report contract over RP transactions and
   balances (building on the PHASE-054 transfer-pricing extracts).
2. **Government grants** (L2-02 / IAS 20): `government_grants` (grant,
   conditions, vesting, recognition method elected per grant) — deferred-
   income amortization (riding the PHASE-068 schedule engine) or
   deduction-from-asset; condition tracking with forfeiture risk flags.
3. **Held for sale & discontinued operations** (L2-03 / IFRS 5):
   held-for-sale status on fixed assets and intangibles with the
   sale-active + within-a-year criteria checklist, measurement at carrying
   value minus costs to sell (remeasurement through the engine), and the
   discontinued-operations presentation split in the income statement
   (statement-engine extension, no new source tables beyond the status).
4. **Investment property** (L2-04 / IAS 40): asset-class flag + the
   fair-value/cost model election per property, riding the PHASE-026
   revaluation machinery for fair-value updates; the disclosure pack
   (additions, transfers, rental income) as a report contract.
5. **Goodwill register & annual test** (L2-05 / IFRS 3): `goodwill_records`
   with CGU allocation and the annual impairment-test workflow (no
   amortization — test-only). Balances populate when PHASE-067 records
   business combinations; the machinery and registers ship here.
6. **Provisions & contingencies** (L2-11 / IAS 37): `provisions` (typed:
   warranty, litigation, onerous contract, restructuring, other) with
   measurement, movements (addition, use, release, reversal), time-based
   release schedules (PHASE-068 engine), and the contingency disclosure
   register (possible obligations without recognition). Warranty provisions
   formalize the PHASE-039 warranty liability.
7. **Impairment** (L2-13 / IAS 36): `impairment_tests` — indicator
   checklist, `cgus` (cash-generating-unit register with asset/CGU
   allocation), recoverable amount (higher of FVCTS and VIU — VIU from
   documented cash-flow projections with the PHASE-053 forecasting feed),
   loss posting and reversal discipline (reversal capped at
   carrying-value-absent-impairment), covering fixed assets, intangibles
   (PHASE-054), investment property, and goodwill (L2-05).
8. **Going concern** (L2-19 / IAS 1): the structured assessment template at
   period close — indicator checklist, management evaluation record with
   evidence attachments (cash-flow forecast link), material-uncertainty
   disclosure drafting surface; the assessment result links to the risk
   register (PHASE-058 L1-18).
9. **Disclosure pack**: the IFRS disclosure report contracts (related
   parties, provisions movement schedule, impairment summary, going concern)
   registered in REPORT_CATALOG with bilingual rendering.
10. **Expected credit losses — the ECL allowance** (**IFRS 9 · R-01 — added by
    v3.2/CR-50**, per the owner the strongest remaining accounting gap): the
    simplified-approach **provision matrix** — aging buckets × tenant-configured
    loss rates (**REQUIRES_VERIFICATION**: each rate carries source evidence or the
    run refuses to post — worksheet mode, no fabricated rates) — computing the AR
    expected-credit-loss allowance per the `ar.aging` machinery and posting it
    through the engine as a periodic ECL run (`ecl_runs` + `ecl_rates`), with the
    movement (charge/release) disclosed in the provisions family's movement
    schedule and the matrix rendered as a report contract.

Out of scope: business-combination transaction accounting (067 — L2-06) ·
share-based payments (067 — L2-07) · defined-benefit/actuarial (067 —
L2-08/09) · hyperinflation restatement (067 — L2-10) · NCI (067 — L2-16) ·
XBRL (067 — L2-18) · contract assets/liabilities presentation (068 —
L2-14/17) · statutory e-filing adapters (054 territory).

**v3.2 scope note (CR-50):** the IFRS-9 expected-credit-loss allowance (R-01 —
the simplified provision matrix, per the owner the strongest remaining accounting
gap) was added by the owner's residual-layer decision — it completes this phase's
measurement/provision family exactly where the aging machinery feeds it; the
effort estimate moves from ~5–7 to **~6.5–8.5 weeks**.

## 3. Prerequisites

| Prerequisite | Status |
|---|---|
| PHASE-053 (Accounting Depth & Treasury) COMPLETE | planned — analytic dimensions, segment reporting, and cash-flow forecasting feed CGU/VIU computations and disclosures |
| PHASE-054 (Tax & Corporate Compliance) COMPLETE | planned — intangible-asset register (L1-22) is an impairment object; the compliance-calendar/export-wizard precedents are reused |
| PHASE-039 warranties (provision input) | planned — wave 1; the warranty provision type formalizes its liability |
| PHASE-068 schedule engine (grant/provision time-release) | planned — parallel-safe sibling; the interface is the documented schedule contract, so 066 may ship with manual release if 068 lands later |
| v3.1 planning artifacts (this document + the L2 gap file) | authored 2026-11-11 |

Position in Wave 3: after 053/054 in the sequential lineage; parallel-safe
with 055–059 and 068 once prerequisites land.

## 4. Design Impact

- **Migrations**: the next in sequence at implementation time (~0150+
  planning envelope; exact numbers bound at start, strictly increasing, with
  `_journal.json` + Drizzle spec updated). Expected new tables (~9):
  `related_party_relations`, `government_grants`, `goodwill_records`,
  `cgus`, `impairment_tests`, `provisions`, `provision_movements`,
  `contingencies`, `going_concern_assessments`; held-for-sale and
  investment-property ride existing asset tables as additive columns/flags.
- **Entities/catalog parity:** +9 rows in `ENTITY_CATALOG.md`; SQL + Drizzle
  mirror + catalog row per table (CR-36 a).
- **Permissions:** +10 keys — `ifrs.related-parties.manage`,
  `ifrs.grants.manage`, `ifrs.held-for-sale.manage`,
  `ifrs.investment-property.manage`, `ifrs.goodwill.manage`,
  `ifrs.provisions.manage`, `ifrs.impairment.manage`,
  `ifrs.impairment.approve`, `ifrs.going-concern.manage`,
  `ifrs.disclosures.read`; zero-drift discipline extended (seed = catalog =
  matrix).
- **i18n:** ~200 new AR/EN keys (registers, checklists, disclosure
  surfaces); parity gate as ever.
- **Reports:** +4 contracts — `ifrs.related-party-disclosure`,
  `ifrs.provision-movements`, `ifrs.impairment-summary`,
  `ifrs.going-concern` (registry counts bound at implementation).
- **Feature flags:** +2 keys — `ifrs.measurements` (business + enterprise),
  `ifrs.disclosures` (enterprise) — FEATURE_CATALOG rows + dependency edges.
- **Goldens:** the impairment loss/reversal and provision
  addition/use/release postings register as new goldens (next free G-numbers
  at implementation; worked examples + failure packs per the JOURNAL_RULES
  discipline).
- **Rules:** new BR entries (next free numbers after the shipped/planned
  tail at implementation) — impairment reversal cap; provision recognition
  only with a present-obligation checklist complete; grant forfeiture flips
  recognition; HFS reversal limited to the prior-write-down carrying value.
- **Docs:** JOURNAL_RULES.md · BUSINESS_RULES.md · ENTITY_CATALOG.md ·
  FEATURE_CATALOG.md · REPORT_CATALOG.md · DATA_DICTIONARY.md (provision/
  relation vocabularies) · NAVIGATION_MODEL.md (the IFRS compliance section)
  · ACCOUNTING_ENGINE_SPECIFICATION.md (measurement postings).
- **Sync surface (CR-36 g):** registers are server-side; read feeds add to
  offline clients additively; offline writes N/A-recorded.
- **Performance (OA-06):** EXPLAIN-verified hot paths — the RP transaction
  join (partner × relation graph), the provision movement ledger scan, the
  CGU allocation view; ⌘K entries for every new entity (OA-04).

## 5. Implementation Plan

| Task | Description | Layer |
|---|---|---|
| T-01 | Migrations (~9 RLS'd tables + asset additive columns) + Drizzle journal/spec | api |
| T-02 | Related-party relation graph service + RP transaction/balance derivation + SoD on relation authoring | api |
| T-03 | Government grants: register, both recognition methods, condition tracking, forfeiture rules | api |
| T-04 | Held-for-sale & investment-property asset extensions (criteria checklists, remeasurement, model election) | api |
| T-05 | CGU register + allocation + impairment test workflow (indicators → recoverable amount → loss/reversal postings) | api |
| T-06 | Goodwill register + CGU allocation + annual-test scheduling (balances from 067 when live) | api |
| T-07 | Provisions register + movements + time-release schedules (068 engine or manual fallback) + contingencies | api |
| T-08 | Going-concern assessment template + period-close integration + risk-register linkage | api |
| T-09 | Disclosure report contracts (4) + catalog rows + bilingual rendering | api |
| T-10 | Goldens (impairment loss/reversal, provision movements) with worked examples + failure packs | api |
| T-11 | Web screens: the IFRS compliance workspace (registers, tests, disclosures) + NAV_ITEMS + ⌘K + AR/EN | web |
| T-12 | Rule specs (BR entries, spoof battery) + RLS A1–A10 + docs wave + full gates | all |

## 6. Verification

Acceptance criteria (all must pass with recorded evidence):

1. Migrations apply cleanly; the new tables are RLS'd with composite tenant
   FKs; Drizzle + ENTITY_CATALOG parity.
2. Related parties: a seeded relation graph produces the disclosure report
   with transactions and balances per counterparty; unauthorized relation
   authoring is a typed rejection (SoD).
3. Grants: both recognition methods round-trip; the deferred-income variant
   releases over the vesting schedule (068 engine or the manual fallback
   with the same journals); forfeiture reverses correctly.
4. HFS: an asset meeting the criteria (sale-active checklist complete)
   remeasures to carrying-minus-costs-to-sell with the write-down posted;
   reversal is capped per the BR; discontinued operations split renders in
   the income statement over seeded data.
5. Impairment: an end-to-end test — indicators checklist → CGU allocation →
   recoverable amount (FVCTS vs VIU) → loss posting (balanced golden) →
   capped reversal; failure packs (no checklist, unmapped accounts → typed
   rejections, zero partial writes).
6. Provisions: addition/use/release movements balance; the warranty type
   formalizes the 039 liability on seeded fixtures; contingencies record
   without recognition.
7. Going concern: the assessment completes at close with evidence links and
   surfaces the material-uncertainty disclosure draft when indicators fire.
8. House gates green (CR-36): RLS A1–A10 · typecheck · lint · unit ·
   `docs:validate` · i18n parity · permissions drift · EXPLAIN budgets.
9. Completion report appended with evidence; IMPLEMENTATION_STATUS row
   flipped; archive delivered (OA-07).

## 7. Risks and Constraints

- **Estimate fabrication risk** — the highest risk in this family: mitigated
  by REQUIRES_VERIFICATION (no rate/assumption without a cited source;
  worksheet mode refuses to post), tenant-entered estimates carry source
  evidence, and the disclosure pack never auto-generates numbers an auditor
  cannot trace.
- **CGU definition quality** — arbitrary CGU splits distort impairment;
  mitigated by an approval gate on CGU changes and movement history on the
  allocation.
- **Interplay with 067/068 sequencing** — goodwill balances arrive only with
  067 and grant/provision schedules prefer 068: both interfaces are
  documented contracts with manual fallbacks, so 066 never blocks.

## 8. Completion and Handoff

- Completion report: `docs/implementation/phases/reports/PHASE-066-COMPLETION.md`
  (evidence per criterion, golden worked examples, gate output).
- Status flip: IMPLEMENTATION_STATUS PHASE-066 row → COMPLETE; NEXT_ACTION →
  next eligible phase.
- Delivery: `ERP_PLATFORM_PHASE066.zip` (OA-07).
- Handoff notes: for PHASE-067 — the goodwill register and CGU machinery are
  the landing zone for combination balances; for PHASE-068 — the
  schedule-contract interface (manual fallback documented).
