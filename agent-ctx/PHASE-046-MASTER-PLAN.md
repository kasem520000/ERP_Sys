# PHASE-046 Master Plan — HR Payroll Compliance (GOSI / PIT / EOSB)

Owner: orchestrator (main agent). Phase doc: `docs/implementation/phases/PHASE-046.md`
(T-01…T-16 are the canon task spine; this plan keeps those numbers and adds T-00,
T-17, T-18). Register: CR-16 · Wave 2 / Stage 13 · Roadmap ~3–4 weeks.

Authority chain: PHASE-046.md → [CR-16](../docs/planning/COMPLETENESS_REGISTER.md) →
the **binding PHASE-045 handoff contract** (the read-side feed service as the single
consumption boundary; the T-20 shared atomicity floor extended to every new payroll
writer; the permanent two-transaction race-suite pattern; JOURNAL_RULES §7 +
INV-031 + BR-082…084 as delivered canon) → the ID_LEDGER's coordinated slots
(**G-52…G-54 · INV-032 · BR-085…BR-087**) → this plan.

**Status: APPROVED 2026-11-16 (the owner's dispatch, with six binding amendments
recorded in §1a below) — W-0 + the T-20 pinned notes + W-1 + the
audit-reconciliation fix wave + W-2 + W-3 DELIVERED; W-4 NEXT (the
verification workflow + the GOSI remittance export).**

## 1a. The owner's approval amendments (binding — recorded 2026-11-16)

1. **THE GOSI CORRECTION (W-1, before the W-2 engine specs and the W-6
golden pinning):** the `GOSI-OH` row applies to **ALL** (employee 0%,
employer 2%); Saudi = employer 11.75% total (9% pension + 0.75% SANED +
2% OH), employee 9.75%; non-Saudi = OH-only (employer 2%, employee 0).
The ruleset/seed + the canonical unit + the tests + the affected
examples all moved together (W-1, migration 0092 + statutory-canonical.ts).
The OH wage cap: pinned **45,000** — **the citation CLOSED 2026-11-16**
(the audit-reconciliation round): the owner's verifier fetched PwC
Worldwide Tax Summaries — "Saudi Arabia: Individual — Other taxes"
(https://taxsummaries.pwc.com/saudi-arabia/individual/other-taxes,
2026-11-16 21:34 UTC), which states verbatim the SAR 45,000 upper limit on
basic + housing, the 2% employer-paid non-Saudi occupational-hazard rate,
and the Saudi split employer 11.75% (9% + 2% OH + 0.75% SANED) / employee
9.75% — independently corroborating the corrected schedule. The record
reclassified in **migration 0093** (the reserved slot's exact purpose,
DATA-ONLY, 0089–0092 byte-stable): CITATION = the PwC source; DECISION
RECORD = the owner's 2026-11-16 dispatch (why the correction happened —
no longer presented as the citation itself). The register's open items
NARROW to exactly two: the SANED-specific 15,000 ceiling (PwC does not
state it; the owner's confirmation pending) and the EOSB official text
(Labor Law M/51 Art. 84 — the 15/30-days tiers; unreachable from both
environments). The GOSI rates + the 45,000 ceiling are CLOSED. The Saudi
worked example (employer total **1,410.0000**; the salary journal DR
SALARIES_EXPENSE 12,000 · DR EMPLOYER_CONTRIBUTIONS 1,410 · CR
DEDUCTIONS_PAYABLE 2,580 · CR SALARIES_PAYABLE 10,830; the remittance
settlement 2,580; non-Saudi OH 240.0000) supersedes the pre-approval
figures in §4 below.
2. **`employees.nationality` (D-02) APPROVED** — NULL fails closed with
the unpricedNationality warning; registered in the PII inventory
(DATA_PROTECTION §3, W-1).
3. **The D-01/D-11 work-basis text + every affected example** updated
in the same W-1 change (migration 0092's verification records + this
§1a + the ENTITY_CATALOG rows carry the corrected basis + the OH
rate/cap citation).
4. **The T-20 pinned technical notes** — delivered BEFORE the floor's
payroll adoption (2026-11-16, gate-evidence
2026-11-16-phase046-t20-pinned-notes.md): the canonical key law +
duels 17/18; the no-expansion law + the DB-guaranteed order + duels
19/20 (the import's whole-window reservation); the bound waiter proof
(duel 12's true serialization point honestly re-recorded). NOT the
§7(b) documentation remarks — those stay the W-7/T-15 open input.
5. **Tag `phase/046`** (not `phase-046`).
6. **THE RLS LATENT NO-OP CLASS — THE OWNER'S RULING (2026-11-16, the
   W-3 greenlight dispatch; the audit-fix wave's honest finding ruled a
   CLASS, not an incident): a general repair migration `0094` ships in
   the W-7 CLOSURE WAVE — one file, the 0093 pattern (a temporary
   migration-plane policy gate, created + self-dropped inside the one
   file, both sides DROP IF EXISTS — the final policy set exactly the
   pre-0094 set), sweeping EVERY affected family: the 0009-era
   master-data seeds (uoms, credit_terms, and every other
   INSERT…SELECT…FROM tenants sweep in the chain) AND 0092's remaining
   families (AE/EG/JO profiles, PIT bracket sets, EOSB tiers). The
   requirements (binding): (a) FIRST an exhaustive inventory — scan
   every migration 0001…0093 for the FROM-tenants sweep pattern and
   list every affected family in the 0094 header; (b) idempotent
   re-materialization with ON CONFLICT DO NOTHING against the
   CANONICAL current shapes (the 0093 citation records for GOSI —
   never the pre-0093 shape); (c) the end-to-end pre-state
   verification script pattern from 0093, its output kept; (d)
   journal/manifest/spec pins to 94, the chain re-proven from zero.
   If the inventory finds a family whose correct behavior is genuinely
   ambiguous, do NOT guess — flag it in the header and exclude it,
   with the reasoning. This closes the class; NO per-family drip. The
   GOSI family itself is already repaired (0093); the class repair
   (0094) is a W-7 task, not a W-3 one.

## 0. Inputs consumed (the plan-first reads, all done)

- `docs/implementation/phases/PHASE-046.md` (spec §1–§8) · COMPLETENESS_REGISTER
  CR-16 · COMPLETENESS_ROADMAP (Wave 2, the 045 → 046 → 047 hard chain).
- PHASE-045 delivery at content head `248039e` / delivery head `d74edaa`: the
  completion report, the T-20 gate evidence (the atomicity floor + the 16-duel
  race suite), `agent-ctx/NEXT_ACTION.md` (the 045→046 handoffs).
- Canon: JOURNAL_RULES §7 (G-29/G-30/G-31 family + G-50/G-51 rows + the non-ledger
  note + §7.16), ACCOUNTING_INVARIANTS (INV-003/013/019/025/031),
  BUSINESS_RULES (BR-052/053/054/055, BR-082…084), ID_LEDGER row 43 (046's slots).
- Code research over the delivered head (three read-only passes): the payroll
  module (0043 substrate: 7 tables, the run lifecycle, G-29/G-30/G-31 machinery,
  the 6-key purpose pre-flight, the component model, the error taxonomy, the 029
  golden packs), the HR module (the feed service + `atomic.ts` + the race-suite
  idiom + G-50/G-51 + the settings seam), and the house conventions (migrations
  0080–0088, catalog/matrix/registry/i18n/web/gates/OA-06/OA-07).
- Baselines to move: migrations 88 (journal idx 87) · catalog 284 tables ·
  permissions 297 · report registry 104 (5 pin sites) · i18n 6,007 · DB suite
  240/240 · 3,329/3,329 · id-ledger implemented G-51/INV-031/BR-084.

## 1. Settled design decisions (from code research — binding for all waves)

**D-01 — Statutory profiles are a TENANT-SCOPED ROW-SET per jurisdiction, not one
row.** `statutory_contribution_profiles`: one row per contribution component —
`jurisdiction_code` (2–8, the holiday-calendar convention), `code` (tenant-unique
per jurisdiction, e.g. `GOSI-PENSION`, `GOSI-SANED`, `GOSI-OH`), `name/name_ar`,
`employee_rate`/`employer_rate` `numeric(7,4)` (0–100), `base_min`/`base_max`
`numeric(19,4)` (NULL = unbounded), `contributory_keys jsonb` (the structure
component keys that count toward the wage base — DATA, never hard-coded),
`applies_to` CHECK `('ALL','CITIZEN','NON_CITIZEN')`, `effective_from`/`effective_to`
(dates), `status` CHECK `('REQUIRES_VERIFICATION','VERIFIED','RETIRED')`, and the
verification record (`source_name`, `source_ref`, `verified_by`, `verified_at`,
`review_note`). GOSI's DUAL CAPS are honored structurally: the pension row
(employee 9% / employer 9%, cap 45,000) and the SANED row (0.75% / 0.75%, cap
15,000) are separate rows — a single rate-pair row could not express the law
(INV-032's exactness demands the real shape). Rates/caps below are the **working
basis for the worked examples**; the seed's verification records carry the
official-schedule citations and the exact parameters are confirmed at seed time
(the phase's own discipline — nothing unverified posts, D-10).

**D-02 — `employees.nationality` (nullable ISO-3166 alpha-2) — the plan-level
addition.** GOSI law splits by Saudi vs non-Saudi (pension+SANED vs the
employer-only occupational-hazard arm); the employees table today carries no
nationality. One additive column (the 0085 `user_id` precedent — an extension
column, catalog diagram-note, no new table) + `applies_to` resolution on profile
rows: `CITIZEN` rows match only nationals of the tenant's jurisdiction,
`NON_CITIZEN` the complement, `ALL` everyone. **NULL nationality is fail-closed**:
the employee gets NO statutory lines and surfaces as an explicit run warning
(`warnings.unpricedNationality`) — never a guessed rate (BR-055). The fallback if
the owner rejects this addition: jurisdiction-level application for ALL employees +
the split recorded as an open item in the verification register (the plan marks
this decision as the one explicit scope extension — see §8).

**D-03 — PIT brackets are effective-dated row-sets; exemption defaults ride the
set; employee overrides ride `employees.pit_exemptions jsonb`.**
`payroll_tax_brackets`: `jurisdiction_code`, `code`, `floor`/`ceiling`
(`numeric(19,4)`, ceiling NULL = the open top), `rate numeric(7,4)`, `sort`,
`effective_from`/`effective_to`, `status` (the same verification vocabulary), plus
the SET-level exemption defaults `personal_allowance_default` and
`per_dependent_allowance` (`numeric(19,4)`, validated SET-CONSISTENT across a
(jurisdiction, effective window) group — the service rejects an inconsistent set
typed). The engine: taxable = gross − personal allowance (set default, overridden
per employee) − dependents × per-dependent − other (employee field), floored at 0;
tax = Σ marginal bracket slices, 4dp half-up, **rounding residuals explicit in the
breakdown, never absorbed** (the G-40 discipline). KSA seeds NO bracket rows (no
employee PIT in KSA — a jurisdiction without VERIFIED brackets computes zero PIT
with an honest no-bracket state); AE/EG/JO bracket sets seed REQUIRES_VERIFICATION
with citations. Exemption overrides live as one jsonb column on employees
(`{personalAllowance?, dependents?, other?}` — absent = the set defaults; no
fabricated values).

**D-04 — EOSB tiers + calculations reuse the 029 wage-base concept; G-31 stays
the settlement.** `eosb_rules`: `jurisdiction_code`, `from_years` (`numeric(7,2)`
> 0), `to_years` (NULL = open), `days_per_year numeric(7,2)`, `contract_type`
(NULL = all — the tenant-configurable override the doc names), effective dates,
the verification vocabulary. KSA seed: 0–5 years → 15 days/year; > 5 → 30
days/year (VERIFIED with the labor-law citation; the doc's own worked shape).
`eosb_calculations`: `employee_id`, `kind` CHECK
`('TERMINATION','PERIOD_TRUE_UP','OPENING')`, `service_years numeric(7,2)`, the
tier breakdown + wage base snapshot (jsonb), `entitlement_amount`,
`provision_balance`, `delta` (±, the signed true-up), `journal_entry_id`,
`status` CHECK `('COMPUTED','POSTED')`, the run/period reference. Wage base = the
**029 eosBase** (basic + `is_eos_base` allowances — the existing concept, frozen
in the calculation snapshot). Entitlement = Σ per service year of
(tier days)/30 × base. The **G-31 settlement path is untouched** — at termination
the EOSB engine computes, the true-up aligns the provision to the entitlement
(G-54), then G-31 settles exactly as shipped (the 029 regression pack stays
green); TERMINATED never encashes (the G-51 law, unchanged).

**D-05 — Runs/lines gain EXTENSION COLUMNS only (the doc's law: no new document
type, no new tables in the run family).** `payroll_run_lines` += 
`statutory_employee_share`, `statutory_employer_share` (folds into the existing
`employer_contributions`), `pit_withheld`, `variable_overtime_amount`,
`variable_absence_amount`, `variable_late_amount` (all `numeric(19,4)` DEFAULT 0)
+ `statutory_breakdown jsonb` (per profile row: code, kind, base, rate, amount,
cappedAt) + `variable_breakdown jsonb` (multipliedHours, absenceDays,
missingPunchDays — informational, never deducted — lateMinutes, the applied
rates). `payroll_runs` += `statutory_employee_total`, `statutory_employer_total`,
`pit_total`, `variable_overtime_total`, `variable_absence_total`,
`variable_late_total`, `statutory_summary jsonb` (per profile row: accrued /
remitted — the remittance liability tracking), `eosb_trueup_total`. The INV-025
fold extends by construction: statutory employee share + PIT + gated variable
deductions are DEDUCTIONS (net = gross − deductions); the statutory employer
share + variable overtime are gross-side/employer-side (the employer column);
`ck_payroll_runs_totals` and `ck_payroll_run_lines_totals` keep holding (the new
columns are breakdowns of the existing totals — the CHECKs are not widened, the
fold law is documented in the catalog). The append-only line guard
(`erp.payroll_run_lines_guard`) is untouched: the DRAFT reset remains the only
writer path, now inside the run gate (D-09).

**D-06 — Posting shapes: G-52/G-53/G-54 with ZERO new account purposes (the doc's
risk-section law) and zero new treasury movement kinds.**
- **G-52 (statutory accrual + remittance settlement, one golden):** the run's
  employee statutory share + PIT fold into the existing G-29 line set — the
  `DEDUCTIONS_PAYABLE` credit grows by (employee share + PIT) and net shrinks
  accordingly; the remittance settlement leg (pay GOSI/the authority) posts
  **DR `DEDUCTIONS_PAYABLE` · CR the cash account (explicit accountId)** through
  the payout machinery + the treasury movement `sourceType: 'payroll_payout'`
  (the G-51 precedent — NO `cash_movements` CHECK widening), INV-019 exact
  (movement.base == the journal's cash line), source key
  `(payroll_remittance, remittanceId, post)` under INV-013.
- **G-53 (employer share):** the run posts **DR `EMPLOYER_CONTRIBUTIONS`
  (purpose) · CR `DEDUCTIONS_PAYABLE` (purpose)** at the employer statutory
  total — the G-29 account family, additive lines in the same fold/journal (the
  run's single `(payroll_run, runId, post)` INV-013 key is NOT split).
- **G-54 (EOSB true-up, delta only):** accrue leg **DR `EOS_PROVISION_EXPENSE` ·
  CR `EOS_PROVISION`** at (recalculated entitlement − standing provision) when
  positive; the release mirror **DR `EOS_PROVISION` · CR `EOS_PROVISION_EXPENSE`**
  when negative; ZERO lines when the delta is zero; source key
  `(eosb_calculation, calcId, post)`. An explicit OPENING true-up on first
  adoption (BR-087); delta-only thereafter.
- **BR-053 stays intact by construction:** no new purposes → the six-key
  `PAYROLL_PURPOSE_KEYS` pre-flight and the engine's journal_entry-source guard
  need no widening; the runs-only monopoly extends to the statutory/variable line
  types (BR-086) because they exist only inside run posts and the remittance
  settlement (the payout family).

**D-07 — The wage base resolves at run time from the structure snapshot.**
Per employee × profile row: base = `basic_salary` + Σ the run's computed component
values whose key ∈ the profile's `contributory_keys` (the snapshot the run already
freezes — BR-052 honored); clamp to [`base_min`, `base_max`]; the clamped value is
recorded in the breakdown (`cappedAt`) — INV-032(a) pins rate × clamped base ==
line, exact 4dp (Decimal half-up — the platform discipline). A structure missing
a mapped key contributes basic only + an honest run warning. The jurisdiction
resolves from the tenant's `country_code` (the holiday-calendar law); no profile
rows for the tenant's jurisdiction ⇒ zero statutory lines + the explicit
no-profile state (never a fabricated rate).

**D-08 — Variable lines consume the feed SERVICE, never the register tables (the
handoff contract), and every knob is OFF/NULL by default (BR-055).** The run
calculation calls `FeedService.variableFeed({periodId})` (the single boundary —
BR-084 already enforced in its SQL) once per run and lands:
- **overtime earning** = `totalMultipliedHours` × hourly rate, where hourly rate
  = `basic_salary / 30 / payroll.variable.overtime_hours_per_day` (new settings
  key, int 1–24, **default NULL — while unset the line lands UNPRICED as an
  explicit run warning, never a fabricated rate**);
- **absence deduction** = `absenceDays` × basic/30, gated by
  `payroll.variable.absence_deduction` (enum off/on, **default off**);
- **late deduction** = `lateMinutes` × (basic/30/hoursPerDay/60), gated by
  `payroll.variable.late_deduction` (**default off**);
- **`missingPunchDays` is informational only** in the breakdown (its own count,
  never folded — the T-10 law); leave balances ride the snapshot the feed
  already returns (the encashment path is G-51, untouched — no new machinery).
The run is an AS-OF snapshot (the standard payroll semantics): the breakdown
records the feed's period facts; register corrections after calculate surface in
the next period's run (documented in the catalog row — no register locks at run
read time; the registers' own floors keep them consistent).

**D-09 — The T-20 atomicity floor is ONE floor, extended in place, and every new
payroll writer rides it (the handoff contract).**
`hr/infrastructure/atomic.ts` gains the payroll key builders —
`payrollAtomicKeys.run(runId)` → `payroll.run|{runId}` and
`payrollAtomicKeys.eosbEmployee(employeeId)` → `payroll.eosb-employee|{employeeId}`
— with the SAME `lockHrKeys` acquisition (tenant-prefixed, deduped, globally
sorted, 500-key chunks, `pg_advisory_xact_lock(hashtextextended(k,0))`); the
file's header documents both modules' namespaces (the floor stays ONE module; the
payroll module imports it directly — the `hr/application` →
`accounting/infrastructure` cross-module infra precedent; if dep-cruise flags the
edge, the fallback is ONE mechanical promotion to `src/infra/db/` with the race
suite imports updated — decided at W-3, recorded either way). The gates:
- **run gate** (`payroll.run|{runId}`): calculate (the DRAFT reset + line write),
  post, reverse — the check-then-write windows on the same run serialize;
- **eosb employee gate**: the true-up/settlement interplay (true-up × true-up,
  true-up × G-31 settle — the provision read + the delta write under one lock);
- **verification is a conditional compare-and-set** (the bridge precedent):
  `UPDATE … SET status='VERIFIED' … WHERE id = … AND status =
  'REQUIRES_VERIFICATION' RETURNING …` — zero rows ⇒ the typed
  `STATUTORY_ALREADY_VERIFIED` naming the winner (the 23505-typed-bridge
  pattern); the remittance double-fire is INV-013's exactly-once floor + the run
  gate.
The permanent race suite extends to every new writer (T-17, §4).

**D-10 — The verification workflow (BR-085's act):** the verify action flips
REQUIRES_VERIFICATION → VERIFIED via the CAS (D-09), permission
`payroll.statutory.verify` (owner-only seed — the act unblocks legal postings),
**SoD: the verifier ≠ the row's last editor** (`updated_by` compare, the
BR-034/SoD house pattern), audited (`payroll.statutory_verified` with the source
fields), and the **statutory verification register** (a new decision-doc under
`docs/decisions/product/`) mirrors the seeded state: every profile/bracket/tier
row with its source citation, status, and blocking effect. Fail-closed is proven
both ways: a run selecting a REQUIRES_VERIFICATION row is the typed
`STATUTORY_REQUIRES_VERIFICATION` refusal + the audit event, and the AE/EG/JO
rows cannot post until verified while the GOSI rows post out of the box on a KSA
tenant fixture (acceptance #3).

**D-11 — Tenant scoping of the seed (the 0086 lesson, applied the other way):
the rates are jurisdiction facts, so they MATERIALIZE per tenant.** The canonical
verified data lives in ONE versioned TS module
(`payroll/infrastructure/statutory-canonical.ts`: the GOSI rows with citations,
the AE/EG/JO REQUIRES_VERIFICATION rows with citations, no tenant policy). The
seed migration materializes the canonical set for EVERY existing tenant
(`INSERT … SELECT gen_random_uuid(), id … FROM tenants`, idempotent on the
(tenant, jurisdiction, code) unique), and the tenant-creation provisioning step
(the `provisionCoaTemplate` site in the tenancy flow) materializes the same set
for NEW tenants — one hook, one source, auditable. Leave types stayed unseeded in
045 because accrual is tenant policy; statutory rates are NOT tenant policy —
the platform carries the verified facts (the doc's explicit GOSI-seeds-active
law).

**D-12 — Reports +2 on `payroll.reports.view` (the §12 module-register
convention — no new permission for reads):** `payroll.statutory-summary` (per
profile row × period: base totals, employee/employer shares, PIT, capped counts,
accrued vs remitted — the remittance-ready report companion; block-on-fail
assertion `statutory-totals-tie`: Σ run statutory lines == run statutory totals
== an independent SQL fold) and `payroll.eosb-liability` (per employee: service
years, tier breakdown, computed entitlement, provision balance, settled, the
delta — block-on-fail assertion `eosb-provision-tie`). Registry 104 → 106; ALL
pin sites re-pinned (reporting-unit, report-pack-wiring, consolidation-contracts,
golden, industry-018/019 — each with the dated comment); the §13 readiness window
and provenance row move; REPORT_CATALOG §payroll gains the subsection.

**D-13 — Permissions 297 → 300** (`payroll.statutory`, `payroll.eosb`,
`payroll.statutory.verify`), seeded in the seed migration with bilingual
descriptions + role grants (owner + accountant + payroll_officer for
`payroll.statutory`/`payroll.eosb`; owner-only for `payroll.statutory.verify`);
matrix §3.24 (or §3.14 extension — §3.24 keeps the per-phase section convention);
the drift checker's `PERMISSION_SEED_MIGRATIONS` list extended; every new route
§8-registered in `route-permissions.ts`. Posting acts (the remittance settlement,
the EOSB true-up trigger) ride the EXISTING `payroll.runs.post` (the G-50/G-51
law — ledger acts ride the ledger key); the run screen's statutory columns ride
`payroll.runs.view`; exports ride `payroll.statutory`; reports ride
`payroll.reports.view`.

**D-14 — Feature keys + the entitlements note + the config pins.**
`payroll.statutory` + `payroll.eosb` (tier 4, business + enterprise — the 0043/0086
plan-grant pattern), registered in `packages/contracts/src/feature-keys.ts` +
FEATURE_CATALOG §22; the **entitlements note documents the market/jurisdiction
dimension** (the plan tier grants the capability; the jurisdiction's verified
profile set decides whether it posts — a business-plan KSA tenant gets GOSI, a
business-plan AE tenant stays blocked until verification). The plan-grant +
settings keys land with the **golden-config re-pin procedure** (the T-11/0088
law: canonical + stored + docs mirrors + every pinned hash move together —
`layer-fixtures` / `golden-effective-configs` 37 pins).

**D-15 — i18n ~110 new keys/locale** (the `pay*` prefix —
`payStatutoryTitle`, `payStatutoryVerified`, `payStatutoryRequiresVerification`,
`payEosbTitle`, `payRemit*`, the run-screen statutory columns…), added to BOTH
dictionaries + the interface; parity green at every increment (6,007 → ~6,117).

**D-16 — Web follows the 045 web-plane precedents exactly:** three surfaces —
`/payroll/statutory-profiles` (archetype 2 List+Search; THREE TABS: contribution
profiles / PIT brackets / EOSB tiers — all with verification badges + the verify
action; the verify button additionally runtime-checks
`payroll.statutory.verify`), `/payroll/eosb` (archetype 11
Reconciliation/Health-Center shape: the calculations list, the per-employee
entitlement + provision reconciliation view, the true-up trigger on
`payroll.runs.post`), and the payroll run screen extension (the statutory +
variable columns per employee in the run detail, the remittance export button on
`payroll.statutory`). NAV_ITEMS +2 rows in the payroll group (featureKey +
permission pairs, the live order slot read at implementation), FALLBACK_CRUMBS +
entries, ⌘K rides the NAV registry, `api-types.ts` + the wire types, AR/EN
parity + RTL logical utilities (the `erp/no-physical-direction` law), localized
error map extended. No new packages/ui pattern is expected (the existing
patterns cover the three surfaces); if one proves necessary, its stories + AR/EN
baselines ship with it (the visual harness law).

## 2. Migration inventory (the honest slots — journal ends at 0088, idx 87)

The phase doc's "≈0089…0093" predates the journal's actual end at 0088: the
honest next slots were **0089…0092 (4 firm + 0093 reserved)** — recorded at the
kickoff in the phase doc, the journal, and the manifest (the house numbering
note). Drizzle `_journal.json` idx 88…91 + `MIGRATIONS` manifest +
`migrations.spec` pins move with each landing.

| # | File | Content |
|---|---|---|
| 0089 | `0089_payroll_statutory.sql` | `statutory_contribution_profiles` + `payroll_tax_brackets` (the D-01/D-03 shapes, the house base-column set, composite FKs, the RLS triple, purge paths, grants — SELECT/INSERT/UPDATE, NO DELETE: the verification trail is evidence) + the `employees` extension (`nationality`, `pit_exemptions`) + indexes: profiles (tenant, jurisdiction, status, effective_from), brackets (tenant, jurisdiction, effective_from, sort); the (tenant, jurisdiction, code) uniques |
| 0090 | `0090_payroll_eosb.sql` | `eosb_rules` + `eosb_calculations` (D-04; rules: master-data grants incl. DELETE; calculations: the evidence discipline — SELECT/INSERT/UPDATE, no DELETE) + indexes: rules (tenant, jurisdiction, effective), calculations (tenant, employee, kind), (tenant, journal_entry_id) |
| 0091 | `0091_payroll_run_statutory.sql` | The runs/lines extension columns (D-05) — additive, DEFAULT 0 / NULL jsonb, no CHECK widening, no guard change |
| 0092 | `0092_payroll_statutory_seeds.sql` | DATA-ONLY: the canonical materialization for existing tenants (D-11: GOSI VERIFIED — pension/SANED/OH rows with citations; AE/EG/JO profiles + bracket sets + EOSB tiers REQUIRES_VERIFICATION with citations; NO KSA PIT rows — the honest no-PIT state) + the 3 permissions + role grants + the 2 feature keys' plan grants + the schema_version marker |
| (0093) | reserved | Only if an implementation-time need surfaces (an index the OA-06 probes demand, a widening) — the 0087/0088 precedent of shipping with the feature task. **CONSUMED 2026-11-16 (the audit-reconciliation round): the GOSI citation reclassification — the PwC source as the CITATION, the owner's dispatch as the DECISION RECORD; the GOSI family's missed-tenant materialization repaired through the temporary self-dropped migration-plane policy gate (§1a.1).** |
| (0094) | reserved — **THE OWNER'S RULING (§1a.6, 2026-11-16)** | The RLS latent no-op CLASS repair, authored in the **W-7 closure wave**: the exhaustive inventory of every FROM-tenants sweep 0001…0093 + the idempotent ON CONFLICT DO NOTHING re-materialization against the CANONICAL shapes + the 0093 pre-state verification pattern + the journal/manifest/spec pins to 94 — one file, the 0093 pattern, closing the class (no per-family drip). |

Every migration: the `SET ROLE erp_migrate` frame, statement breakpoints, the
house CHECK families, `erp.apply_tenant_policy` ×N, purge-path policies, the
grants law, and the `schema_version` footer (89…92). Isolation registry +4
tables (`tables.registry.ts` — the A1–A10 auto-suite extends); Drizzle mirrors
+4 pgTables + the employees extension in `src/db/schema.ts`;
`ENTITY_CATALOG.md` 284 → 288 + the extension-column diagram notes; the
custom-field surface registrations (the PHASE-036 entity registry — statutory
profiles + EOSB calculations, per the doc's Design Impact).

## 3. Task waves (canon T-numbers; per-task exit criteria)

### W-0 — Environment preparation (T-00, orchestrator)
The sandbox was reset after PHASE-045's acceptance — the prepared-environment
law (the T-20 note) applies: `pnpm install` (pnpm 9.15.9), Playwright Chromium
headless shell, better-sqlite3 builds (desktop/mobile suites), the embedded-PG16
DB-suite rehearsal on the CLEAN head (chunked foreground invocations — the
600s-ceiling pattern: batches ≈121+31+48+40+, every log kept).
**Exit:** typecheck/lint 8/8, unit 8/8 packages, and the DB suite 240/240 ·
3,329/3,329 green on the untouched `d74edaa` head in THIS environment — the
baseline proven before any change (the honest-log law).

### W-1 — Foundation (T-01 + T-02, orchestrator)
Migrations 0089–0092 (§2) + journal/manifest/spec pins; Drizzle mirrors;
`tables.registry.ts` +4 (the A1–A10 suite auto-extends and must pass);
`ENTITY_CATALOG` rows + notes (284 → 288); the settings keys (D-08's three
variable knobs — Zod, OFF/NULL defaults, the `hr.leave_accrual_posting` frozen
shape); the canonical statutory module (D-11); the tenancy provisioning hook;
matrix §3.24 + the drift-checker list + `route-permissions.ts` rows +
feature-keys registration (the seed and its mirrors land in ONE increment so
every checker stays green — D-13/D-14).
**Exit:** migrations apply + re-apply no-op over the 92-entry chain
(`migrations.db.spec` green); mirrors/catalog parity; A1–A10 ×4 green;
permissions drift **300 = 300**; manifests valid; the effective-config 37 pins
re-pinned and green; catalog check (`check:rls`) clean at 288.

### W-2 — The engines (T-03 + T-04 + T-06, orchestrator)
`statutory-profile-service` (effective-dated resolution: the row-set valid on
the period's end date; the wage-base mapping fold + clamps as PURE functions;
the fail-closed gate; the verify action with CAS + SoD + audit),
`pit-engine` (bracket-set resolution + the marginal fold + exemptions + the
explicit-rounding breakdown — pure core in `domain/`, the 045
`attendance-classification` precedent), `eosb-service` (tier resolution, the
entitlement computation, the termination/period/opening calculations, the
true-up delta + G-54 posting through `PostingService`, the reconciliation read,
the 029 `balanceFor` interplay). The typed error taxonomy
(`payroll/domain/statutory-errors.ts` → `error.filter` registration —
`StatutoryProfileNotFoundError` 404, `STATUTORY_REQUIRES_VERIFICATION` 422,
`StatutoryAlreadyVerifiedError` 409, `PitBracketSetInvalidError` 422,
`EosbNoRuleError` 422, `StatutoryNationalityUnresolvedError` 422, …). Pure unit
specs in `payroll/__tests__/` first (the bracket fold, the tier math, the clamp
law, the exemption resolution), then the DB specs (§4).
**Exit:** the three engines' laws pinned by their unit + DB specs (§4); the
fail-closed gate proven both ways (acceptance #3); every refusal typed with
zero residue.

### W-3 — Run integration + the floor (T-05 + T-07 + the D-09 extension, orchestrator)
The run-calculation extension (statutory + variable columns computed during
`calculate`, the feed called ONCE via the service boundary, the INV-025 fold
extended, the breakdowns frozen); the G-29 fold extension (G-52's employee/PIT
legs + G-53's employer legs — additive lines, the same journal, the pre-flight
now also fails closed on an unmapped `DEDUCTIONS_PAYABLE`/`EMPLOYER_CONTRIBUTIONS`
path — already in the six-key check); the remittance settlement action + the
`statutory_summary` liability tracking; the run gate + the eosb employee gate in
`atomic.ts` (D-09); the pg-boss job compatibility check (the queue payload
unchanged — the calculation stays ids-only).
**Exit:** the run integration spec green (§4: the KSA worked example end-to-end
— calculate → submit → approve → post with the statutory line set + the
remittance settlement); INV-032(a)/(b) pinned; the 029 golden pack
(`payroll-rules.spec`) green UNTOUCHED (the additive-only law); the feed/leave-
posting hr specs green (the boundary untouched — the negative ledger proof over
the feed read: the registers' row counts byte-identical through a full run).

### W-4 — Verification + export (T-08 + T-09, orchestrator)
The verification workflow surface (the verify route on
`payroll.statutory.verify` — envelope law: EVERY controller site awaits INSIDE
`envelope(...)`, the T-14 law for new controllers); the GOSI remittance export
(XLSX + CSV via exceljs — the 028 pattern: RTL view at locale=ar, tabular-nums,
the per-employee contribution breakdown + totals, generation audited
`payroll.remittance_exported`, the file streamed under `payroll.statutory`);
the integration-profile readiness surface (the settings + the readiness
documentation — IN-06: exports + PHASE-055 are the path, NO live-government-API
claims anywhere).
**Exit:** the export round-trip spec green (§4); the verify CAS + SoD pinned;
the audit trail asserted; zero API claims beyond the export (docs review).

### W-5 — Web plane (T-10 + T-11 + T-12, orchestrator)
The three surfaces (D-16) + NAV_ITEMS +2 + FALLBACK_CRUMBS + ⌘K + api-types +
the ~110 i18n keys + the run-screen extension + the reports tab wiring.
**Exit:** AR/EN parity green at every increment; the RTL logical-utility law
clean (lint); the three routes render on both locales with the honest empty /
blocked / not-linked states; ⌘K finds the new surfaces; `api-types` complete.

### W-6 — Reports + proof (T-13 + T-14 + **T-17 — the race suite**)
T-13: the two contracts (D-12) + the registry pins 104 → 106 + the catalog
subsection + the assertion suites. T-14: the golden suites G-52/G-53/G-54 with
failure packs (each wrong shape red, zero residue — the wrong-cap shape, the
REQUIRES_VERIFICATION shape, the bracket-gap shape, the non-delta true-up
shape); the INV-032 property suite; the BR-085/086/087 guards; **the 029
regression packs re-run as an acceptance act (G-29/G-30/G-31 + spoof + the
leave goldens — all green on the unified head)**. **T-17 (the handoff
contract's addition): `__db__/payroll/payroll-writer-races.spec.ts`** — the
permanent two-transaction suite in the T-20 idiom (spy splits the winner's UoW
at the exact window; the loser a REAL service call in its OWN `withTenant` on
its own pooled connection; the world classified from `pg_locks`; every duel
closes with the NO-ILLEGAL-STATE assertions) over the new writers: (1) run
calculate × calculate (the DRAFT reset race — exactly one line set, the
INV-025 fold intact); (2) run calculate × post (the reset never eats a posted
run — the status floor); (3) EOSB true-up × true-up (exactly one G-54 journal,
the delta == the winner's); (4) EOSB true-up × G-31 settle (the provision
never double-counts — the employee gate); (5) verify × verify (the CAS — one
flip, the loser typed `STATUTORY_ALREADY_VERIFIED`, exactly one audit event);
(6) remittance × remittance (INV-013 — one journal, one movement, the liability
tracks once); (7) a smoke duel (no deadlock under three in-flight writers —
the forest argument re-asserted for the payroll namespaces).
**Exit:** every duel "blocked" (the pre-fix "slipped" shape fails the suite);
the no-illegal-state SQL assertions green; the full §4 matrix green.

### W-7 — Docs + gates + closure (T-15 + T-16 + T-18, orchestrator)
T-15 (docs): JOURNAL_RULES §7 — the canonical G-52/G-53/G-54 rows + entry 17 +
the §4.1 source-key rows (`payroll_remittance:{id}:post`,
`eosb_calculation:{id}:post`) + the non-ledger note extension (the statutory
PROFILE tables are not ledger documents; the goldens' runs/remittances are the
cluster's ledger surfaces); ACCOUNTING_INVARIANTS INV-032 (the
Statutory-exactness section); BUSINESS_RULES BR-085/086/087 (the settled
wordings below); ENTITY_CATALOG 288 + the extension notes; FEATURE_CATALOG
(§22's two new keys + the entitlements note); REPORT_CATALOG (+2 + §13);
NAVIGATION_MODEL (+2 rows); AUTHORIZATION_MATRIX §3.24 + the SoD verify row +
the guarded-routes paragraph; **the statutory verification register**
(`docs/decisions/product/STATUTORY_VERIFICATION_REGISTER.md` — every seeded
row: source citation, status, reviewer/date, blocking effect; the owner's
open item: official confirmations for AE/EG/JO + any additional market);
IMPLEMENTATION_STATUS / NEXT_ACTION / CHANGELOG; ID_LEDGER's PHASE-046 row →
DELIVERED (§1 counts + the self-test probe 8 move to G-55/047 per the
fixture-drift law); PHASE_ACCEPTANCE_CRITERIA §PHASE-046; **the owner's three
final-audit documentation remarks (PHASE-045, non-blocking) folded where
relevant — their text is an open input (§8); no PHASE-045 task opens**.
T-16 (gates): the full sweep — §5's gate list, every run its own log, the
OA-06 EXPLAIN budgets extended (the new probes pinned as the permanent
`__db__/payroll/oa06-budgets.spec.ts`: P1 bracket-set resolution, P2 the EOSB
entitlement query, P3 the statutory-summary walk, P4 the remittance liability
read — the 041/044/045 method: dedicated tenant, representative corpus,
ANALYZE, `enable_seqscan=off`, plans logged).
T-18 (closure): `reports/PHASE-046-COMPLETION.md` (the 10 acceptance criteria
evidenced, the deviations ledger, the honest deferrals); the triple flip (the
phase doc header + IMPLEMENTATION_STATUS + NEXT_ACTION → PHASE-047); the
archives **rebuilt + byte-verified** (`ERP_PLATFORM_PHASE046.zip` at the
completion head + the standing 043/045 archives re-verified at the same head —
the T-20 convention, 0 mismatches); **the tag** (annotated `phase-046` at the
delivery head — the repo's first tag per the owner's exit-criteria instruction;
name confirmed with the owner if another convention is preferred).
**Exit:** §5 all green with evidence; the completion report appended; the
flip + the archive + the tag delivered; PHASE-047 unblocked.

**BR wordings (settled for the canon rows):**
- **BR-085 — THE STATUTORY VERIFICATION GATE:** a REQUIRES_VERIFICATION
  profile/bracket/tier row is NEVER selected by a payroll run (the typed
  refusal + the audit event, zero residue); the verify act is permission-gated
  (`payroll.statutory.verify`), audited, SoD-bound (verifier ≠ last editor),
  and flips the row exactly once (the CAS — a concurrent second verify is the
  typed `STATUTORY_ALREADY_VERIFIED`); only VERIFIED rows post, and the GOSI
  rows post out of the box on a KSA tenant (the platform-carried citation is
  the seed's verification record).
- **BR-086 — THE RUNS-ONLY STATUTORY MONOPOLY (BR-053's extension):**
  statutory and variable amounts exist ONLY as run lines computed at run time
  through the feed-service boundary (the registers are never read ad hoc, never
  written by payroll); nothing writes financial records outside a payroll run;
  the remittance settles only through the payout machinery (the treasury
  movement law); the export is a read-only audited artifact.
- **BR-087 — THE EOSB DELTA-ONLY TRUE-UP:** the provision true-up posts ONLY
  the delta (recalculated entitlement − standing provision, signed, 4dp exact —
  INV-032(c)); an explicit OPENING true-up on first adoption; TERMINATED
  employees settle only through the existing G-31 path (after the true-up
  aligns the provision); the reconciliation view ties computed entitlement ↔
  provision balance ↔ settled at every row.

## 4. Test matrix (the permanent suites; worked examples pin the math)

| Suite (file) | Pins |
|---|---|
| `__db__/payroll/statutory.spec.ts` | effective-dated row-set resolution (the period-end date picks the set; future/retired rows never match); the wage-base fold + BOTH cap shapes (base 12,000 < caps; and the cap-clamped case: base 50,000 → pension at 45,000, SANED at 15,000 — the dual-cap law); the CITIZEN/NON_CITIZEN/ALL resolution incl. the NULL-nationality fail-closed warning; BR-085 both ways (the KSA fixture posts; the AE/EG/JO rows refuse typed + the audit event); the verify CAS + SoD + the audit trail; zero residue on every refusal |
| `__db__/payroll/pit.spec.ts` | the marginal fold over the spec's own VERIFIED synthetic bracket set (0% to 10k · 10% 10–30k · 20% above, allowance 5,000, per-dependent 1,000): gross 40,000 → taxable 35,000 → **3,000.0000**; +2 dependents → **2,600.0000**; the zero band; the exemption override; the set-consistency refusal; the no-bracket jurisdiction = zero PIT + the honest state; REQUIRES_VERIFICATION brackets block typed; rounding residuals explicit in the breakdown |
| `__db__/payroll/run-statutory.spec.ts` | THE KSA WORKED EXAMPLE end-to-end (the GOSI fixture: Saudi employee basic 10,000 + housing 2,000 mapped → pension 1,080.0000/1,080.0000 + SANED 90.0000/90.0000 = employee 1,170.0000 / employer 1,170.0000; the non-Saudi arm OH 240.0000 employer-only; gross 12,000, deductions 1,170, net 10,830): the run's statutory columns + breakdowns; the G-29-extended journal (DR SALARIES_EXPENSE 12,000 · DR EMPLOYER_CONTRIBUTIONS 1,170 · CR DEDUCTIONS_PAYABLE 2,340 · CR SALARIES_PAYABLE 10,830 — G-52's accrual legs + G-53's pair pinned separately); INV-025 fold + INV-032(a)/(b); the REMITTANCE SETTLEMENT (DR DEDUCTIONS_PAYABLE 2,340 · CR CASH + the payroll_payout movement, INV-019 exact, the statutory_summary liability accrued→remitted); the over-remit typed refusal |
| `__db__/payroll/variable-lines.spec.ts` | the feed boundary (the run reads the service ONCE; the registers byte-identical — the negative ledger proof); overtime 4.50 multipliedHours × 37.5000 (basic 9,000/30/8) = 168.7500 earning; the UNPRICED state while the divisor is unset (the explicit warning, zero fabricated rate); absence 2 × 300.0000 deduction OFF by default → ON when configured; late 60min × 0.6250 gated; MISSING_PUNCH informational-only (never deducted — its own count); the encashment NON-invention (G-51 untouched — the existing spec stays the pin); BR-086 |
| `__db__/payroll/eosb.spec.ts` | the KSA tier fold (7 years, eosBase 9,000 → 75 + 60 = 135 days → **40,500.0000**); the termination sequence (true-up aligns → G-31 settles — the 029 machinery green after); the PERIOD true-up (standing 30,000 → G-54 +10,500: DR EOS_PROVISION_EXPENSE · CR EOS_PROVISION); the RELEASE case (45,000 → −4,500 mirror); the OPENING true-up on adoption; the zero-delta no-journal law; the contract-type override; BR-087 + INV-032(c); TERMINATED never encashes (the G-51 cross-check) |
| `__db__/payroll/payroll-writer-races.spec.ts` | T-17's seven duels (§3 W-6) — the T-20 idiom, dedicated tenant, the no-illegal-state SQL close on every duel |
| `__db__/payroll/statutory-spoof.spec.ts` | the S-04 battery over the new surfaces (foreign + unknown profile/bracket/rule/calculation ids — identical typed 404s, zero partial writes, both tenants) |
| `__db__/reporting/payroll-compliance-reports.spec.ts` | the two contracts (run + render + exports + the block-on-fail assertions incl. the seeded-drift FAIL arm) |
| `__db__/payroll/oa06-budgets.spec.ts` | P1–P4 EXPLAIN probes (the 041/044/045 method; the plans logged to `audit-evidence/phase046-*/oa06-explain-plans.log`) |
| `payroll/__tests__/*.spec.ts` (unit) | the pure engines: the bracket fold, the tier math, the clamp law, the exemption resolution, the wage-base fold — the `attendance-classification` precedent |
| Regression (unchanged files, re-run green) | `payroll-rules.spec` 16/16 (the 029 goldens G-29/G-30/G-31 + BR-052/053/054/055 + the ×6 purpose failure packs) · `spoof.spec` · `hr/feed.spec` · `hr/leave-posting.spec` (G-50/G-51) · `hr/hr-writer-races.spec` 16/16 · `migrations.db.spec` (the 92-chain) · `identity-flows` (300) · the isolation A-suite · the golden/reporting census (106) |
| Every gate | §5 |

## 5. Gate list (the exit bar — same as 043–045, no relaxations)

1. **typecheck** 8/8 packages · **lint** 8/8 (incl. the RTL physical-direction
   rule) · **boundaries** (dependency-cruiser) clean — count recorded.
2. **unit** 8/8 packages (api grows with the new unit specs; web/contracts/ui/
   sync-core/desktop/mobile/domain-core green in THIS prepared environment).
3. **THE FULL DB SUITE** — serial, embedded PG16, the 92-migration chain,
   foreground chunked invocations under the 600s ceiling, every log kept,
   **no result ever replaced by an older green log** (the standing rule);
   0 failed · 0 skipped; the count grows with §4's files (240 → ~248).
4. **docs:validate** (the count moves with the new docs — recorded honestly) ·
   **i18n parity** 6,007+n = 6,007+n · mobile 371 = 371 · **permissions drift
   300 = 300** · **manifests** valid · **capabilities matrix** agree ·
   **id-ledger** 0 errors + self-test all-probes-OK (G-52…54 · INV-032 ·
   BR-085…087 implemented) · **check:rls** clean at 288 · **shells** PASS ·
   **history-secrets** 0 violations.
5. **Visual harness + axe + perf** (the owner's bar): the full
   `test:visual-harness-run` (every story × AR + EN, threshold 0, axe 0
   violations) + the perf tier — green in this environment.
6. **OA-06 EXPLAIN budgets** — the new probes + the standing six (the 045
   budgets stay pinned) — every probe index-driven, zero seq-scans.
7. **Race suite coverage for every new concurrent writer** (T-17) + the
   standing 16 hr duels green.
8. **Zero-residue failure packs** for every golden + every typed refusal.
9. **AR/EN parity for every new web route** (three surfaces + the run
   extension) — both locales, RTL law, honest blocked/empty states.
10. **Delivery:** the completion report with evidence; IMPLEMENTATION_STATUS
    synced; COMPLETENESS_REGISTER updated (CR-16); the archives rebuilt +
    byte-verified (046 + the standing 043/045 at the head); **the tag**.

## 6. Governance red lines (carried, unchanged)

- **PHASE-043 stays OPEN; RISK-031 and RISK-032 stay OPEN.** Completing 046 is
  NOT the 043 hard review's closure and NOT production approval — the
  completion declaration is delivery evidence only.
- Separate commits + separate gate evidence per task; the shared gates re-run
  on the unified head, each its own run; every completed step pushed to the
  repository immediately (the owner's standing dispatch).
- Watch items carried: the shipped modules' unawaited controller sites (the
  T-14 sibling pattern — NEW controllers must not add to it), SF-026-001/002,
  the 028/029/030/037 environmental items, the DB-suite serial-order
  sensitivities (the runbook note).
- Honest deferrals recorded in the completion report (the 028 precedent):
  the live-integration platform is PHASE-055 (exports only here); the
  jurisdiction sourcing is the owner's open item (the register lists it).

## 7. Open inputs for the owner (none block plan approval; (a) is the one scope decision)

- **(a) `employees.nationality` (D-02)** — the plan's one extension beyond the
  doc's migration inventory (one nullable column + the fail-closed resolution).
  Approve as planned, or direct the fallback (jurisdiction-level application +
  the split as the register's open item). The GOSI law's citizen split is the
  reason it is proposed.
- **(b) The three final-audit documentation remarks (PHASE-045)** — fold into
  the docs wave (T-15); their text is needed (or they land as the owner
  restates them). No PHASE-045 task opens.
- **(c) The seeded statutory parameters' citations** — the GOSI working basis
  (pension 9%/9% cap 45,000 · SANED 0.75%/0.75% cap 15,000 · non-Saudi OH 2%
  employer-only) and the AE/EG/JO pending sets are confirmed against the
  official schedules at seed time with the citations in the verification
  records + the register (the phase's own discipline; any correction lands as
  a seed edit BEFORE the gates, never after).
- **(d) The tag name** — `phase-046` proposed (the repo's first tag).

— End of plan. Implementation begins only on the owner's approval.
