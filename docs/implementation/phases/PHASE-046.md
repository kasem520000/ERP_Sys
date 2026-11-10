# PHASE-046 — HR Payroll Compliance

> **Status:** NOT_STARTED — PLANNED (Blueprint v3.0) · **Wave:** 2 / Stage 13 · **Register:** [CR-16](../../planning/COMPLETENESS_REGISTER.md)
> **Evidence base:** [gap-analysis/ERP_FULL_GAP_ANALYSIS.md](../../planning/gap-analysis/ERP_FULL_GAP_ANALYSIS.md) §2 H-05 (payroll/legal-risk part) · §10 HR-11/HR-12 · §13 X-02 · §17 IN-06 · [gap-analysis/ERP_COMPLETENESS_GAP_REPORT.md](../../planning/gap-analysis/ERP_COMPLETENESS_GAP_REPORT.md) §2 «الفجوة 2»

## 1. Phase Overview

- **Phase ID:** PHASE-046
- **Title:** HR Payroll Compliance (الامتثال الرواتبي — GOSI/الضريبة/نهاية الخدمة)
- **Objective:** Close the audit's **legal-risk gap in payroll**: statutory
  contribution profiles per jurisdiction (employee / employer rates, wage-base caps,
  effective dates) under a strict **REQUIRES_VERIFICATION discipline** — only
  officially verified rates are seeded active (GOSI, KSA), while UAE / Egypt / Jordan
  profiles carry verification records and are blocked from posting until verified
  (fail-closed, the BR-055 no-fabrication discipline extended); a progressive **PIT
  withholding engine** over jurisdiction brackets with exemption fields; **EOSB
  automation** — service-year tier rules per labor law, per-employee entitlement
  calculations, and a provision true-up that automates and reconciles the mechanism
  delivered in PHASE-029 (which posted provision per tenant policy but computed
  nothing); and the **variable-line feeds** — attendance / overtime / absence from
  PHASE-045 flow into payroll runs as statutory-aware variable components.
- **Business value:** The audit flagged payroll taxes and social insurance as "zero —
  legally dangerous": every statutory amount was a manually typed component, meaning
  every filing was hand math. With this phase, a KSA tenant runs GOSI-compliant
  payroll out of the box (employee + employer shares, caps, remittance-ready export),
  PIT withholding computes per brackets, and end-of-service provisions stop being a
  manual figure — they become a computed, reconciled liability. The verification
  discipline turns "we don't know Jordan's rates" from a silent wrong number into an
  explicit blocked state with an audit trail.
- **الملخص التنفيذي (AR):** الامتثال الرواتبي تحت انضباط «يتطلب تحققاً»: ملفات
  مساهمات قانونية بمعدلات موظف/صاحب عمل وسقوف وتواريخ سريان — بروفايل GOSI السعودي
  وحده مُوثَّق رسمياً، وملفات الإمارات ومصر والأردن تُعلَّم REQUIRES_VERIFICATION
  حتى التحقق فلا تُرحَّل إلى قيود إلا بعد التحقق. محرك استقطاع ضريبة الدخل على
  الرواتب بشرائح تصاعدية وحقول إعفاءات، وأتمتة حساب مكافأة نهاية الخدمة حسب طبقات
  سنوات الخدمة مع تسوية المخصص القائم منذ المرحلة 029، وربط أرصدة الحضور والعمل
  الإضافي بخطوط متغيرة في مسير الرواتب — مع تصدير جاهز للتقديم يغطي جاهزية تكامل
  GOSI.

## 2. Scope

In scope:

1. **Statutory contribution profiles** (`statutory_contribution_profiles`) (HR-11,
   X-02, IN-06): jurisdiction, `employee_rate`, `employer_rate`, wage-base caps
   (min / max), contributory-component mapping (which salary components count toward
   the wage base), and effective-dated versions. **REQUIRES_VERIFICATION
   discipline**: only officially verified rates are seeded active — the GOSI (KSA)
   profile; UAE / Egypt / Jordan profiles are created with verification records
   (source, status, reviewer, date) and a `REQUIRES_VERIFICATION` status that blocks
   selection for posting until verified — fail-closed, never a silent default.
2. **Payroll income tax brackets** (`payroll_tax_brackets`) (X-02): progressive PIT
   bracket tables per jurisdiction with effective dates; exemption fields
   (personal allowance, dependents, other) on the employee/profile; the withholding
   engine computes per-bracket tax with exemption deduction and cap clamps.
3. **EOSB rules** (`eosb_rules`) (HR-12): service-year tiers per labor law (e.g.,
   half-month per year for the first tier, full month thereafter) scoped per
   jurisdiction under the same verification discipline; contract-type overrides
   (tenant-configurable — the BR-055 discipline preserved).
4. **Payroll run statutory extension** (payroll run extension columns / statutory
   line types) (HR-11, HR-12): runs gain statutory line types — employee share,
   employer share, PIT withholding — computed during the run and posted through the
   existing G-29 machinery (the BR-053 runs-only monopoly is preserved and extended
   to the statutory line types); remittance liability tracking per profile.
5. **EOSB calculations** (`eosb_calculations`) (HR-12): per-employee entitlement
   computed per rules on termination events and period runs; the **provision delta**
   (true-up) posts against the existing `EOS_PROVISION` mechanism from PHASE-029 —
   this phase automates the calculation and reconciles the provision, it does not
   invent a new one.
6. **Variable-line consumption** (feeds from PHASE-045): overtime / absence / late
   feeds land as variable lines with multiplier application at run time; leave
   encashment rides the G-52 settlement delivered in PHASE-045.
7. **GOSI integration profile** (IN-06): remittance-ready exports (file + report)
   with the contribution breakdown per employee, plus the integration profile
   configuration surface — readiness only, no live government API claims (exports +
   the PHASE-055 integration platform are the path).
8. **Screens** (12-template discipline, AR/EN parity, RTL, ⌘K registration):
    `/payroll/statutory-profiles` (with verification badges and the verify action),
    `/payroll/eosb` (calculations + true-up + reconciliation view), and the payroll
    run screen extension showing statutory lines per employee; the remittance export
    from the run screen.

Out of scope: Zakat and corporate income tax provisioning (PHASE-054) ·
withholding tax on suppliers (PHASE-054) · live e-government integrations (exports
only — the integration platform is PHASE-055) · HR growth: performance /
recruitment / training (PHASE-047) · multi-step approval chains (PHASE-052) ·
payroll bank-file formats beyond the existing payout path.

## 3. Prerequisites

| Prerequisite | Status |
|---|---|
| PHASE-045 (HR Core) COMPLETE | NOT_STARTED — hard prerequisite (attendance/overtime/leave feeds, `employees.user_id` bridge, holiday calendars) |
| Payroll substrate (029 baseline: employees, salary structure, components, runs, G-29/G-30/G-31, EOS provision mechanism) | delivered in the 034 baseline |
| PHASE-034 (Enterprise-Depth consolidation) baseline | delivered 2026-11-09 |
| v3.0 planning artifacts (register + roadmap + this document) | authored 2026-11-10 |

Per the [COMPLETENESS_ROADMAP.md](../../planning/COMPLETENESS_ROADMAP.md) dependency
graph, the hard chain is 045 → 046 → 047: this phase consumes the feeds and the
identity bridge delivered by PHASE-045. The posting canon extends the PHASE-029
payroll goldens — the 029 regression packs must stay green throughout.

## 4. Design Impact

- **Migrations**: the sequence continues from PHASE-045's last journal entry (≈ 0088;
  exact numbers taken at implementation time — planned ≈ 0089…0093):
  `statutory_contribution_profiles` (+ verification records) ·
  `payroll_tax_brackets` · `eosb_rules` · `eosb_calculations` · payroll run/line
  extension columns (statutory line types) · seed migration (the verified GOSI
  profile, the REQUIRES_VERIFICATION UAE/Egypt/Jordan profiles, PIT brackets,
  permissions, feature grants — DATA-ONLY). Drizzle `_journal.json` +
  `migrations.ts/spec` updated per house convention.
- **Entities/catalog parity**: +4 tables (`statutory_contribution_profiles`,
  `payroll_tax_brackets`, `eosb_rules`, `eosb_calculations`) — each with SQL +
  Drizzle mirror + `ENTITY_CATALOG.md` row (CR-36 (a)); payroll runs/lines gain
  extension columns (no new document type).
- **Permissions**: +3 keys (`payroll.statutory`, `payroll.eosb`,
  `payroll.statutory.verify` — the verification act is itself permission-gated and
  audited); zero-drift check extended to the new baseline — seeded set equal on both
  sides (CR-36 (b)).
- **i18n**: ~110 new AR/EN dictionary keys (profile forms, verification badges,
  EOSB views, run-screen statutory columns, remittance export); parity check
  extended.
- **Reports**: +2 contracts into `REPORT_CATALOG.md`
  (`payroll.statutory-summary`, `payroll.eosb-liability`); catalog ↔ registry
  reconciliation check extended.
- **Posting canon**: goldens G-53 (statutory accrual — employee share withheld to a
  statutory payable with the remittance settlement leg), G-54 (employer contribution
  expense), G-55 (EOSB true-up — provision delta only) added to `JOURNAL_RULES.md`
  §7 as the extension of the G-29 family; invariant INV-031 (statutory exactness)
  added to `ACCOUNTING_INVARIANTS.md`; BR-071…BR-073 added to
  `BUSINESS_RULES.md`.
- **Feature flags**: `payroll.statutory.*`, `payroll.eosb.*` — template-composable
  grants (CR-36 (f)); enabled by market/jurisdiction configuration rather than plan
  tier alone (documented in the entitlements note).
- **Custom fields**: statutory profiles and EOSB calculations registered as
  custom-field surfaces in the PHASE-036 entity registry.
- **Sync surface (CR-36 (g))**: N/A-recorded — payroll compliance is an office
  surface; no synced entities added.
- **Docs touched**: `JOURNAL_RULES.md` · `ACCOUNTING_INVARIANTS.md` ·
  `BUSINESS_RULES.md` · `ENTITY_CATALOG.md` · `FEATURE_CATALOG.md` ·
  `REPORT_CATALOG.md` · `NAVIGATION_MODEL.md` · the statutory verification register
  (new decision-doc under `docs/decisions/product/`) · `IMPLEMENTATION_STATUS.md` ·
  `NEXT_ACTION.md`.
- **No new ADR** — the verification discipline extends the decided BR-055 pattern;
  CR-36 gates apply.

## 5. Implementation Plan

| Task | Description | Layer |
|---|---|---|
| T-01 | Author migrations ≈ 0089…0093 (statutory profiles + verification records, PIT brackets, EOSB rules, EOSB calculations, run/line extension, seeds incl. verified GOSI + REQUIRES_VERIFICATION profiles) + journal/spec updates | api |
| T-02 | Drizzle mirrors, `ENTITY_CATALOG.md` rows, RLS policies + attack tests A1–A10 for the four new tables | api |
| T-03 | Statutory profile service: effective-dated resolution, wage-base component mapping, cap clamps, fail-closed REQUIRES_VERIFICATION gate (BR-071) | api |
| T-04 | PIT withholding engine: bracket resolution per period, exemption fields, marginal computation, rounding discipline | api |
| T-05 | Payroll run integration: statutory line types computed during the run, G-53/G-54 postings through the G-29 machinery, remittance liability tracking (BR-072) | api |
| T-06 | EOSB engine: tier resolution per rules, per-employee entitlement calculations (event + period runs), provision delta true-up (G-55), reconciliation view vs the 029 provision balance (BR-073) | api |
| T-07 | Variable-line consumption: overtime/absence/late feeds from PHASE-045 as run-time variable lines with multiplier application; encashment via G-52 | api |
| T-08 | GOSI remittance export (file + report) + integration profile readiness surface (IN-06) | api |
| T-09 | Verification workflow: verify action (permission + audit), status flip REQUIRES_VERIFICATION → VERIFIED, verification register doc | api |
| T-10 | Build `/payroll/statutory-profiles` (profiles, effective dates, verification badges, verify action) | web |
| T-11 | Build `/payroll/eosb` (calculations, true-up, reconciliation view) + payroll run screen extension (statutory lines per employee) | web |
| T-12 | NAV_ITEMS + ⌘K registration, permissions seeding, feature grants, i18n keys | web |
| T-13 | Implement the 2 report contracts + tests + `REPORT_CATALOG.md` rows | api |
| T-14 | Golden suites G-53/G-54/G-55 with failure packs + the 029 regression packs re-run (G-29/G-30/G-31 stay green); INV-031 suite (rate × base ≤ cap, totals equality, true-up delta exactness); BR-071…073 guards | api |
| T-15 | Docs: JOURNAL_RULES §7 rows, ACCOUNTING_INVARIANTS INV-031, BUSINESS_RULES BR rows, FEATURE_CATALOG keys, NAVIGATION_MODEL entries, statutory verification register, entitlements note | docs |
| T-16 | Run full local gates + OA-06 EXPLAIN budgets (bracket resolution, EOSB calculation queries); record evidence | all |

## 6. Verification

Acceptance criteria (all must pass with recorded evidence):

1. Migrations ≈ 0089…0093 apply cleanly; Drizzle mirrors + `ENTITY_CATALOG.md` parity
   for all 4 tables (CR-36 (a)); RLS attack tests A1–A10 pass for every new tenant
   table (CR-36 (e)).
2. INV-031 holds: every statutory line equals rate × wage base with cap clamps
   applied exactly (no line above the capped maximum); payroll run statutory totals
   equal Σ statutory lines; the true-up delta equals recalculated entitlement minus
   the standing provision balance exactly.
3. The fail-closed gate is proven: a run that selects a REQUIRES_VERIFICATION profile
   is rejected with a typed error and an audit event (BR-071); the UAE / Egypt /
   Jordan profiles cannot post until the verify action (permission + audit) flips
   them; the GOSI profile posts out of the box on a KSA tenant fixture.
4. Golden G-53 green: the run posts employee shares withheld to the statutory
   payable (extending G-29's line set) and the remittance settlement leg clears it
   through the payout machinery; failure pack red for each wrong shape.
5. Golden G-54 green: the employer share posts to the employer contribution expense
   purpose (the G-29 account family) with the liability leg; failure pack red.
6. Golden G-55 green: the EOSB true-up posts only the delta against the existing
   provision; a fixture where the provision exceeds the recalculated entitlement
   posts the release leg; the 029 regression packs (G-29/G-30/G-31) stay green.
7. PIT withholding: progressive brackets compute correctly over fixtures (marginal
   bracket sums, exemption deduction, zero-tax band); rounding residuals are
   explicit, never absorbed.
8. Variable lines: overtime / absence / late feeds from PHASE-045 land as run
   variable lines with multipliers applied at run time; encashment settles through
   G-52; nothing writes financial records outside a payroll run (BR-072).
9. All house gates green: typecheck · lint · boundaries · unit tests ·
   `docs:validate` · i18n parity · permissions drift equality · manifests; OA-06
   budgets met; sync-surface assessment N/A-recorded (CR-36 (g)).
10. Completion report `reports/PHASE-046-COMPLETION.md` appended with evidence;
    `IMPLEMENTATION_STATUS.md` row flipped; archive delivered as
    `ERP_PLATFORM_PHASE046.zip` (OA-07).

## 7. Risks and Constraints

- **Statutory-rate liability is the defining risk** — a wrong seeded rate produces
  wrong legal filings: mitigated by the REQUIRES_VERIFICATION fail-closed gate, the
  verification register, audited verify actions, and seeding only the officially
  verified GOSI profile as active.
- **Backward compatibility of payroll runs** — the G-29 extension must not break
  029-era runs (tenants already run payroll): mitigated by statutory line types
  being additive, the re-run of the 029 golden regression packs as an acceptance
  criterion, and no new account purposes (existing payroll purposes reused).
- **EOSB true-up against a hand-managed provision** — existing tenants carry manual
  provision balances that may disagree with the computed entitlement: mitigated by
  the reconciliation view, an explicit opening-true-up posting on first adoption,
  and delta-only postings thereafter (BR-073).
- **PIT and EOSB variability across jurisdictions** — laws differ and change:
  mitigated by effective-dated data-driven tables (no hard-coded math beyond the
  engine), exemption fields as data, and the same verification regime for brackets
  and tiers.
- **Rounding and caps precision** — rate × base and bracket edges are rounding
  traps: mitigated by the platform decimal discipline, cap clamps as explicit
  computed values, and property tests at bracket and cap boundaries.

## 8. Completion and Handoff

- Completion report: `docs/implementation/phases/reports/PHASE-046-COMPLETION.md`
  (evidence per acceptance criterion, gate outputs, golden pack results incl. the
  029 regression re-run, the verification register state, OA-06 EXPLAIN evidence).
- Status flip: `IMPLEMENTATION_STATUS.md` PHASE-046 row → COMPLETE; `NEXT_ACTION.md`
  → next eligible phase per the roadmap — PHASE-047 (HR Growth) is now unblocked
  (045 → 046 → 047 chain complete).
- Delivery: repository state archived as `ERP_PLATFORM_PHASE046.zip` (OA-07); the
  owner continues with «ابدأ تنفيذ المرحلة PHASE-047».
- Handoff notes for PHASE-047: the `employees.user_id` bridge and self-service tabs
  from PHASE-045 plus the statutory-aware run screen delivered here are the substrate
  for the talent surfaces; org structure attaches to employees without touching
  payroll. Handoff notes for PHASE-054: the REQUIRES_VERIFICATION discipline
  established here (profiles, brackets, EOSB tiers, verification register) is the
  exact pattern the corporate-tax and Zakat profiles will follow. Open item for the
  owner: sourcing official rate confirmations for UAE / Egypt / Jordan (and any
  additional market) — the register lists each pending verification with its
  blocking effect made explicit.
