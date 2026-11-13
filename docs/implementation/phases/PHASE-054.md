# PHASE-054 — Tax & Corporate Compliance

> **Status:** NOT_STARTED — PLANNED (Blueprint v3.0, scope extended by v3.1/CR-46 and v3.2/CR-50) · **Wave:** 3 / Stage 14 · **Register:** [CR-24](../../planning/COMPLETENESS_REGISTER.md)
> **Evidence base:** [gap-analysis/ERP_FULL_GAP_ANALYSIS.md](../../planning/gap-analysis/ERP_FULL_GAP_ANALYSIS.md) §2 H-16 · §13 X-01…X-13 · §17 N-02 · §19 G-08 · [gap-analysis/ERP_COMPLETENESS_GAP_REPORT.md](../../planning/gap-analysis/ERP_COMPLETENESS_GAP_REPORT.md) §5 ZATCA-stub honesty row · [gap-analysis/GAP_ANALYSIS_LAYER1_23_GAPS.md](../../planning/gap-analysis/GAP_ANALYSIS_LAYER1_23_GAPS.md) (L1-22 intangible assets — the v3.1 scope extension) · [gap-analysis/GAP_ANALYSIS_LAYER3_RESIDUAL.md](../../planning/gap-analysis/GAP_ANALYSIS_LAYER3_RESIDUAL.md) (R-05 EPS — the v3.2 scope extension · R-06 IAS 34 shipped-by-design binding) · [COMPLETENESS_ROADMAP.md](../../planning/COMPLETENESS_ROADMAP.md) §6.1/§6.2/§6.5

## 1. Phase Overview

- **Phase ID:** PHASE-054
- **Title:** Tax & Corporate Compliance (الضرائب والامتثال المؤسسي)
- **Objective:** Extend the platform from "excellent at VAT, zero at everything else"
  (the audit's 62% tax score) to a corporate compliance pack: corporate income tax
  provisioning per jurisdiction profile under the REQUIRES_VERIFICATION discipline,
  the Zakat declaration worksheet (KSA), withholding tax rules and certificates,
  excise positions, stamp duty registers, a tax calendar with obligations tracking,
  multi-year tax statements, SAF-T-style audit file export, and transfer-pricing
  disclosure extracts — plus the Phase-2 e-invoicing integrations: the ZATCA
  clearance/reporting API with CSID certificate lifecycle, UBL 2.1 generation and
  XAdES-EPES signing, and the Egypt ETA adapter under the identical GATE discipline.
- **Business value:** VAT alone no longer clears procurement checklists: a KSA entity
  must file Zakat/CIT and clear B2B invoices on ZATCA Phase-2 rails; an Egypt entity
  needs ETA; every entity needs an obligations calendar that does not rely on the
  accountant's memory. This phase converts legal blockers (the audit's "sellable in
  KSA" gate) into product surfaces, while preserving the platform's celebrated
  honesty: nothing posts with fabricated rates, and adapters stay stubs until
  verified against real endpoints.
- **الملخص التنفيذي (AR):** تنقل هذه المرحلة النظام من «ممتاز في ضريبة القيمة المضافة وصفر فيما عداها» إلى حزمة امتثال مؤسسي كاملة: احتياطي ضريبة أرباح الشركات بملفاتٍ لكل ولاية ضريبية موثّقة بلا أي معدلٍ مُختلَق (REQUIRES_VERIFICATION)، ورقةُ إقرار الزكاة السعودية، قواعدُ الاستقطاع من المنبع مع الشهادات، مراكزُ الضريبة الانتقائية وسجلات رسوم الدمغة، تقويمُ الالتزامات الضريبية (G-08)، بياناتٌ ضريبية متعددة السنوات، تصديرُ ملف تدقيق بنمط SAF-T، ومستخرجاتُ تسعير التحويل — إضافةً إلى المرحلة الثانية من الفوترة الإلكترونية السعودية: عرضُ الفواتير المعيارية على واجهات المخالصة/الإبلاغ مع دورة حياة شهادة CSID وتوليد UBL 2.1 والتوقيع XAdES-EPES وسلسلة حالة الفاتورة مع معالجة الرفض وإعادة الإرسال، ومحوّلُ هيئة الضرائب المصرية بالانضباط ذاته: بقاء المحوّل كـ stub موثَّق يرفض الإرسال الفعلي حتى التحقق الحقيقي.

## 2. Scope

In scope:

1. **`tax_provision_runs`** (X-01): corporate income tax provisioning per jurisdiction
   profile — computed bases over the GL with rate profiles sourced only from the
   verified compliance matrices; unverified jurisdictions run in worksheet mode and
   refuse to post (REQUIRES_VERIFICATION, no fabricated rates); provisions post as
   balanced accrual journals (G-71). Line detail in `tax_provision_lines`.
2. **Zakat declaration worksheet** (X-06): the KSA base computation (Zakat base
   components, adjustments, final base) producing a declaration document in
   `tax_declarations` — immutable once filed (INV-039).
3. **`withholding_tax_rules` + `withholding_certificates`** (X-03): rule-driven
   deduction at invoice posting (rate per partner/jurisdiction/nature), certificate
   issuance, and a WHT payable liability that always balances the deducted amounts
   (G-72).
4. **Excise positions and stamp duty registers** (X-04, X-05): `excise_positions`
   for excise-tagged items and `stamp_duty_registers` for stamped documents, both
   feeding declarations.
5. **`tax_calendar` + obligations tracker** (X-11, G-08): jurisdiction-aware
   obligation events (returns, renewals, instalments) with reminders into the
   notification system and a completion state per obligation.
6. **Multi-year tax statements** (X-10): comparative tax position statements across
   years per jurisdiction, building on the dimension storage from PHASE-053.
7. **SAF-T-style audit file export** (X-12): structured XML export per a documented
   schema map (master files, transaction lines, tax details), delivered through an
   export wizard with schema validation in tests.
8. **Transfer-pricing disclosure extracts** (X-13): related-party transaction extracts
   per counterparty/value band for disclosure preparation — data extracts only, no
   TP documentation authoring.
9. **ZATCA Phase-2 — standard invoices** (X-08 Phase-2, H-01): the B2B
   clearance/reporting API client over the EIAS rails; `zatca_certificates` for the
   CSID lifecycle (enrollment, renewal, status); UBL 2.1 XML generation from invoice
   documents; XAdES-EPES signing through a dedicated crypto module; the invoice
   status pipeline SUBMITTED → CLEARED / REPORTED with structured rejection handling
   and resubmission in `zatca_submissions`; device/invoice counters (PIH/ICV)
   hardened against concurrent submission; builds on the Phase-1 QR/hash chain
   delivered by PHASE-037.
10. **Egypt ETA adapter** (X-09, N-02): the identical GATE discipline — a documented
    stub that refuses live submission until the real endpoints and credentials are
    verified; `eta_submissions` mirrors the ZATCA pipeline shape so activation is a
    provider swap, not a rework.
11. **Non-VAT declarations surface** (X-07): declaration documents (CIT, Zakat, WHT,
    excise, stamp) as first-class printable/appendable records with the filing
    workflow (prepare → verify → file → archive).
12. **Fixed-asset tax pack hooks** (F-10/F-14/F-15): tax depreciation profiles feed
    provision runs, partial-disposal tax treatment extracts, and IFRS-16 lease tax
    adjustment extracts — consumed from the fixed-asset surfaces, not re-implemented
    here.
13. **Intangible assets & amortization** (**L1-22 — added by v3.1/CR-46**, following
    the F-10/F-14/F-15 → 054 precedent for asset-accounting extensions): the
    INTANGIBLE asset class on the PHASE-026 register (software, licences, trademarks,
    capitalized development) with amortization schedules (straight-line and
    units-of-production where meaningful) replacing depreciation for the class,
    finite vs indefinite-life flags (indefinite = no amortization, impairment-tested),
    and the **impairment interface stub** for PHASE-066 (L2-13 consumes the register).
    Tax-amortization profiles feed the provision runs exactly as F-10 does for
    tangibles.
14. **Earnings per share** (**IAS 33 · R-05 — added by v3.2/CR-50**): basic and
    diluted EPS on the statutory statement set — weighted-average shares computed
    from the equity/share-register data (tenant-entered share capital and movements
    with source evidence, REQUIRES_VERIFICATION), the dilution layer from
    convertible/equity-instrument registers where they exist (the PHASE-067
    instruments interface — computed when present, cleanly omitted when not),
    EPS lines rendered on the income statement with the IAS 33 disclosure note.
    **R-06 (IAS 34 interim reporting) is SHIPPED-BY-DESIGN** and binds here for the
    record: every statement renders over arbitrary `dateFrom`/`dateTo` ranges
    (`apps/api/src/modules/reporting/application/contract.ts` lines 154–155) beside
    the `fiscal_periods` calendar (schema.ts line 888) — interim reporting needs no
    new machinery.

Out of scope: payroll income tax withholding (PIT — 046) · VAT engine changes
(shipped, do not touch) · TP documentation authoring · other jurisdictions'
e-invoicing (JoFotara lands with the Gulf differentiators phase 063) · live ETA
submission until verification (GATE discipline preserved).

**v3.1 scope note (CR-46):** the intangible-asset class with amortization (L1-22) was
consolidated into this phase — it extends the fixed-asset register exactly where the
F-10/F-14/F-15 extensions already live, and its impairment interface prepares the
PHASE-066 landing; the effort estimate moves from ~5–7 to ~6–8 weeks.

**v3.2 scope note (CR-50):** the IAS 33 earnings-per-share computation (R-05) was
added by the owner's residual-layer decision — statutory/corporate reporting is this
phase's territory; the effort estimate moves from ~6–8 to **~6.5–8.5 weeks**. The
same decision records R-06 (IAS 34) as shipped-by-design (item 14's evidence) — no
scope, ID bound.

## 3. Prerequisites

| Prerequisite | Status |
|---|---|
| PHASE-037 (ZATCA Phase-1 & QR Compliance) COMPLETE | REQUIRED — NOT_STARTED (planned, Wave 1) |
| Tax engine with 10-jurisdiction packs + REQUIRES_VERIFICATION | SHIPPED stages 1–11 (audit §21 item 5) |
| Phase-1 QR/TLV + invoice counter (PIH/ICV) chain | SHIPPED by PHASE-037 — Phase-2 builds on it |
| Verified compliance matrices (sa/eg and neighbors) | SHIPPED — the only rate source for this phase |
| Secrets management baseline | SHIPPED — extended usage for CSID/ETA credentials |

Per [COMPLETENESS_ROADMAP.md](../../planning/COMPLETENESS_ROADMAP.md) §5, 037 before
054 is a hard rule: Phase-2 clearance builds on the Phase-1 generation and counter
chain, and the GATE discipline must survive the transition from stub to client.

## 4. Design Impact

- **Migrations**: 4, next in sequence — `0101_tax_provisions.sql` (runs + lines +
  declarations), `0102_withholding_excise_stamp.sql`, `0103_tax_calendar.sql`
  (calendar + obligations), `0104_zatca_phase2.sql` (certificates + submissions +
  eta submissions + counter hardening). The journal continues from the Wave sequence
  (expected 0049…0100 after phases 036–053); exact numbers assigned at
  implementation as the next free sequence, strictly increasing, with
  `_journal.json` + `migrations.ts/spec` updated.
- **Entities/catalog**: +12 tables (`tax_provision_runs`, `tax_provision_lines`,
  `tax_declarations`, `withholding_tax_rules`, `withholding_certificates`,
  `excise_positions`, `stamp_duty_registers`, `tax_calendar`, `tax_obligations`,
  `zatca_certificates`, `zatca_submissions`, `eta_submissions`) — SQL + Drizzle
  mirror + `ENTITY_CATALOG.md` rows (CR-36 a).
- **Permissions**: +11 `tax.*` keys (provisions, declarations, withholding, excise,
  stamp, calendar, audit export, transfer-pricing extracts, zatca manage, zatca
  submit, eta manage); zero-drift check re-extended (registry = seed, cumulative
  v3.0 count).
- **i18n**: ~240 new AR/EN keys (provision UI, worksheets, calendar, declarations,
  ZATCA dashboard, rejection triage); parity check extended.
- **Docs**: `TAX_ENGINE.md`, `COUNTRY_PACKS.md`, `E_INVOICING_ARCHITECTURE.md`
  (Phase-2), compliance-matrix `sa.md`/`eg.md` + `verification-log.md`,
  `JOURNAL_RULES.md` (G-71/G-72 — reservations re-coordinated 2026-11-13 per [../../planning/ID_LEDGER.md](../../planning/ID_LEDGER.md) — the original plan's G-72/G-73/INV-038 predate the 044 wave's consumption of those slots),
  `ACCOUNTING_INVARIANTS.md` (INV-039),
  `ENTITY_CATALOG.md`, `REPORT_CATALOG.md`, `FEATURE_CATALOG.md`,
  `NAVIGATION_MODEL.md`, decision records for provider verification gates.
- **Reports**: +5 contracts — `tax.provision-summary`, `tax.withholding-statement`,
  `tax.calendar-obligations`, `tax.multi-year-statement`,
  `tax.transfer-pricing-extract` (catalog rows mandatory).
- **Feature flags**: `tax.corporate`, `tax.withholding`, `tax.calendar`,
  `tax.audit-file`, `tax.zatca-phase2`, `tax.eta` — template-composable grants; the
  ZATCA Phase-2 flag additionally gates on a per-tenant CSID enrollment state.
- **No architectural change** — a compliance module over the existing tax engine and
  posting engine; the crypto signing module is new code but sits behind the module
  boundary. Offline sync assessment: read-only surfaces (calendar, declarations) are
  web-first (N/A recorded per CR-36 g); submission actions are online-only by
  definition.

## 5. Implementation Plan

| Task | Description | Layer |
|---|---|---|
| T-01 | Author migrations 0101–0104 + journal/spec updates | api |
| T-02 | Drizzle mirrors + `ENTITY_CATALOG.md` rows + RLS policies + attack tests A1–A10 | api |
| T-03 | CIT provision engine: jurisdiction profiles from verified matrices, worksheet mode for unverified, G-71 posting | api |
| T-04 | Zakat worksheet (KSA base computation) + declaration document lifecycle with INV-039 immutability | api |
| T-05 | WHT rules engine: deduction at posting, certificates, G-72 payable balance | api |
| T-06 | Excise positions + stamp duty registers feeding declarations | api |
| T-07 | Tax calendar + obligations tracker with reminders | api |
| T-08 | Multi-year tax statements + transfer-pricing extracts (dimension filters from 053) | api |
| T-09 | SAF-T-style audit file export wizard: schema map, XML generation, validation in tests | api |
| T-10 | ZATCA-2: UBL 2.1 XML generation from invoice documents (standard invoices) | api |
| T-11 | ZATCA-2: crypto module — XAdES-EPES signing + CSID lifecycle (EIAS enrollment/renewal) in `zatca_certificates` | api |
| T-12 | ZATCA-2: clearance/reporting API client, status pipeline with rejection triage + resubmission, hardened PIH/ICV counters | api |
| T-13 | Egypt ETA adapter under GATE discipline (stub-until-verified) + `eta_submissions` pipeline | api |
| T-14 | Screens: `/tax/provisions`, `/tax/calendar`, `/tax/declarations` with AR/EN parity and RTL | web |
| T-15 | Screens: audit-file export wizard + ZATCA dashboard (submission pipeline, rejection triage, CSID status) | web |
| T-16 | Docs: tax/e-invoicing/compliance-matrix updates + goldens G-71/G-72 + INV-039 + decision records | docs |
| T-17 | Run full local gates (typecheck/lint/boundaries/tests/docs/i18n parity/permissions drift/manifests) and record evidence | all |

## 6. Verification

Acceptance criteria (all must pass with recorded evidence):

1. Migrations 0101–0104 apply cleanly; Drizzle mirrors and `ENTITY_CATALOG.md` rows
   present; RLS attack tests A1–A10 pass for all twelve new tables.
2. A CIT provision run over a seeded jurisdiction with a verified rate profile posts a
   balanced accrual journal (G-71); the same run against an unverified jurisdiction
   stays in worksheet mode and refuses to post — REQUIRES_VERIFICATION honored, zero
   fabricated rates in the codebase (grep check).
3. The Zakat worksheet computes the KSA base from seeded GL data; the resulting
   declaration is immutable once filed (INV-039 invariant test).
4. WHT: a rule-matched invoice deducts at posting, issues a certificate, and the WHT
   payable liability equals the sum of deductions (G-72) across the seeded fixture
   set.
5. The tax calendar tracks obligations per jurisdiction with reminders and completion
   states — G-08 closed; the multi-year statement and transfer-pricing extract
   render over multi-year seeded data.
6. The SAF-T-style audit file export produces schema-valid XML per the documented
   schema map (validation executed in the test suite, not by eye).
7. ZATCA Phase-2: a standard invoice generates valid UBL 2.1 XML, signs it with
   XAdES-EPES through the crypto module, and traverses SUBMITTED → CLEARED (and the
   REPORTED path for the reported flow) against the simulation environment;
   the Phase-1 QR/hash chain remains intact on cleared documents.
8. Rejection handling: a seeded rejection produces a structured triage entry, and
   resubmission succeeds without incrementing the invoice counter twice (hardened
   PIH/ICV concurrency test).
9. The Egypt ETA adapter refuses live submission with the documented stub reason
   until verification is recorded — GATE discipline preserved and tested.
10. All CR-36 discipline gates green; completion report
    `reports/PHASE-054-COMPLETION.md` appended with evidence; `IMPLEMENTATION_STATUS.md`
    row flipped; archive delivered as `ERP_PLATFORM_PHASE054.zip` (OA-07).

## 7. Risks and Constraints

- **XAdES-EPES signing complexity** — signature formats are exacting and ZATCA
  validates them strictly; mitigated by a dedicated crypto module, ZATCA sample
  fixtures as golden tests, and keeping the module isolated behind a boundary.
- **Simulation-to-production drift** — the simulation portal is not the production
  rail; mitigated by the GATE discipline: counters and payload shapes verified
  against published schemas, production cutover recorded as a decision with
  evidence.
- **Rate honesty** — the phase's headline promise is no fabricated rates; mitigated
  by sourcing every profile from the verified compliance matrices only, with
  worksheet-mode fallback and a grep-based acceptance check.
- **Credential secrecy** — CSID private keys are sensitive material; mitigated by
  storage through the existing secrets-management baseline (encrypted at rest, never
  in plain columns or logs).
- **Double-submission risk** — rejected-then-resubmitted invoices must not consume
  counters twice or double-post; mitigated by idempotent submission keys and the
  hardened-counter concurrency test.

## 8. Completion and Handoff

- Completion report: `docs/implementation/phases/reports/PHASE-054-COMPLETION.md`
  (evidence per criterion, gate output, the verification log entries for every rate
  profile used, the ZATCA simulation evidence bundle).
- Status flip: `IMPLEMENTATION_STATUS.md` PHASE-054 row → COMPLETE; `NEXT_ACTION.md`
  → PHASE-055 (Public API & Webhooks Platform) with its prerequisites.
- Delivery: repository state archived as `ERP_PLATFORM_PHASE054.zip` (OA-07) and
  handed to the owner; the owner continues with «ابدأ تنفيذ المرحلة PHASE-055».
- Handoff notes for PHASE-055: the ZATCA/ETA submission pipelines and the tax
  calendar are the first consumers of outbound event notifications once the webhook
  platform lands; the audit-file export demonstrates the document-generation pattern
  the OpenAPI publication flow will reuse.
