# PHASE-046 Completion Report — HR Payroll Compliance: GOSI / PIT / EOSB

> **Status:** COMPLETE · **Date:** 2026-11-17 · **Phase doc:**
> [../PHASE-046.md](../PHASE-046.md) · **Register:** [CR-16](../../../planning/COMPLETENESS_REGISTER.md)
> · **Triple flip:** this report + the phase doc header + the IMPLEMENTATION_STATUS
> row flipped together (CR-48) · **Wave 2's fourth phase** — the platform that runs
> the daily workforce truth now runs the statutory world on top of it (the verified
> GOSI schedule posting out of the box, the fail-closed everywhere-else law, and the
> EOSB delta-only true-up over the 029 provision), and PHASE-047 (HR Growth) is
> unblocked (the 045 → 046 → 047 hard chain complete).
> **Scope discipline:** completing 046 is NOT closure of the 043 hard review and
> NOT production approval — RISK-031/RISK-032 stay OPEN per the governance record.

## 1. Executive summary

PHASE-046 closed the platform's **statutory payroll gap** (CR-16): the compliance
world now runs on **effective-dated jurisdiction row-sets** (D-01 — a tenant-scoped
profile per contribution component with its OWN caps and applies-to law; the dual-cap
GOSI schedule a single row could never express), the **PIT marginal engine** (D-03 —
SET-CONSISTENT verified bracket sets tile [0, ∞) or refuse typed; per-slice half-up
4dp with no absorbed residual; the honest no-bracket state for KSA), the **EOSB
true-up engine** (D-04 — the delta-only G-54 over the 029 provision with the
table-level `ck_eosb_calculations_delta` law), and the **run integration** (D-05/D-07/D-08
— the statutory and variable line families computed at run time through the
feed-service boundary called ONCE, frozen into the line breakdowns, and folded
through the G-29 machinery with ZERO new account purposes). The phase delivered the
**verification world** (BR-085 — the fail-closed gate, the owner-only SoD-bound CAS
verify act, the PwC-cited GOSI schedule posting out of the box, the
STATUTORY_VERIFICATION_REGISTER with exactly two open items), the **remittance
settlement + the GOSI export** (G-52's settlement leg through the payout machinery,
IN-06 read-only + audited), the **web plane** (the statutory-profiles screen with the
verify action, the EOSB reconciliation screen, the run-screen extension), the **two
report contracts** (`payroll.statutory-summary` with the three-way tie ·
`payroll.eosb-liability` with the GL tie — registry 104 → 106 on
`payroll.reports.view`, zero new permissions), the **proof wave** (the consolidated
golden with the four wrong-shape RED packs, the 6-law INV-032 property wing, the
first green end-to-end PIT-through-the-run pin), and the **permanent race suite**
(the ten duels incl. the owner's F2 payout × payout + F3 two-employees-one-run
scope additions, every new concurrent writer held on the T-20 floor). The closure
wave delivered **migration 0094 — the RLS latent no-op class repair** (the owner's
§1a.6 ruling: the exhaustive FROM-"tenants" sweep inventory 0001…0093, the
idempotent ON CONFLICT DO NOTHING re-materialization against the canonical shapes,
the 0093-pattern temporary policy gate, the pre-state verification end-to-end, the
chain re-proven from zero), the **canon docs wave** (JOURNAL_RULES §7's G-52…G-54 +
entry 17, INV-032, BR-085…087, the register, the ID_LEDGER flip), and the **one-word
record correction** the owner ordered (the goldens title 60,000 → 50,000 under the
F1 literal-truth law — the header bullet carried the same wrong number and moved
with it, disclosed in the W-7 gate doc). **Migrations 0089–0094 (schema_version 94)
· +4 RLS'd tables · permissions 297 → 300 · report registry 104 → 106 · i18n
6,121 keys/locale · INV-032 · BR-085…087 · the full DB suite 250/250 files ·
3,436/3,436.**

## 2. Mandatory code-evidence checklist (CR-48)

**New tables (SQL migration + Drizzle mirror + ENTITY_CATALOG row — CR-36 a):**
4 tables (the catalog 284 → 288, W-1), every table carrying the house RLS triple +
the master-data grants, the A-suite auto-extended via the isolation fixtures (the
0087 pattern), and the 0089 CHECK family enforcing the verification shape
(VERIFIED ⟺ source + date).

| Table | Migration | Notes |
|---|---|---|
| statutory_contribution_profiles | 0089 | the effective-dated contribution row-set (jurisdiction, code, dual caps, contributory_keys jsonb, applies_to, the verification record); the (tenant, jurisdiction, code) natural key |
| payroll_tax_brackets | 0089 | the marginal row-set (the set-sort unique; the SET-CONSISTENT validation is the engine's, the shape is the table's) |
| eosb_rules / eosb_calculations | 0090 | the tier row-set with the contract-type expression uniqueness + the computation evidence carrying `ck_eosb_calculations_delta` (delta = entitlement − provision IN SQL) |
| (extension columns only: employees.nationality + pit_exemptions — D-02; the run/line statutory + variable columns — D-05, additive, the CHECKs not widened) | 0089/0091 | NULL nationality fails closed (the unpricedNationality warning); the run totals + the frozen jsonb breakdowns |
| (DATA-ONLY: the seeds — the three permission keys, the plan grants, the canonical statutory materialization) | 0092 | the owner's corrected GOSI schedule VERIFIED + the AE/EG/JO REQUIRES_VERIFICATION placeholders (D-11) |
| (DATA-ONLY: the GOSI citation reclassification) | 0093 | the reserved slot's exact purpose — CITATION = the PwC source; DECISION RECORD = the owner's dispatch |
| (DATA-ONLY: the RLS latent no-op class repair) | 0094 | the owner's §1a.6 ruling — the class closed in one file (see §4) |

**Migrations & manifest:** journal idx 88…93 appended (94 entries); the manifest +
the spec's last-tag pin moved to 94 together; `migrations.db.spec.ts` green in the
full suite (apply + re-apply no-op + the RLS catalog drift probe) AND the
from-zero chain re-proven standalone (the pre-state verification's PHASE B).

**Permissions (CR-36 b):** the three 0092 keys (matrix §3.24) —
`payroll.statutory`, `payroll.eosb`, `payroll.statutory.verify` (owner-only, the
SoD law) — catalog 297 → 300, seed = matrix (zero drift, re-proven by the actual
run); every route §8-registered; the T-13 report contracts reuse
`payroll.reports.view` (the §12 convention — no new permission).

**Feature flags (CR-36 f):** `payroll.statutory` + `payroll.eosb` on business +
enterprise (0092 §2 — the tier-4 precedent); the entitlements note documents the
market/jurisdiction dimension (the plan tier grants the CAPABILITY; the
jurisdiction's verified profile set decides whether it posts).

**Sync surface (CR-36 g):** N/A-recorded (the statutory screens are office
surfaces; the payslip delivery rides the existing notification channels).

**i18n:** 6,121 = 6,121 (the W-5 web wave's +114; no web keys in W-6/W-7 — D-15
was W-5) · mobile 371 = 371.

**Docs:** JOURNAL_RULES §7 (the canonical G-52/G-53/G-54 rows + entry 17 + THE
NON-LEDGER NOTE — the statutory PROFILE tables are NOT ledger documents) ·
POSTING_ENGINE §4.1 (the `payroll_remittance` / `eosb_calculation` source-key
rows + the non-ledger note extension) · ACCOUNTING_INVARIANTS INV-032 (the
Statutory-exactness section) · BUSINESS_RULES BR-085…087 (the statutory section)
· ENTITY_CATALOG 288 + the extension notes (W-1) · FEATURE_CATALOG §22 +
the entitlements note (W-1) · REPORT_CATALOG +2 + §13 (W-6) · NAVIGATION_MODEL
(+2 registry rows + the §9 LIVE row — W-7) · AUTHORIZATION_MATRIX §3.24 + the
SoD verify row + the guarded-routes paragraph (W-1) · **the
STATUTORY_VERIFICATION_REGISTER** (new — every seeded row: citation, status,
reviewer/date, blocking effect; the open items exactly two) ·
PHASE_ACCEPTANCE_CRITERIA §PHASE-046 (the first v3.0 register entry) ·
ID_LEDGER's PHASE-046 row DELIVERED (G-01…G-54 · INV-001…032 · BR-001…087;
the checker's probe 7 moved to G-55/PHASE-048 per the fixture-drift law,
self-test all-probes-OK).

## 3. Acceptance criteria vs. evidence (§6 of the phase doc)

| # | Criterion | Evidence |
|---|---|---|
| 1 | Migrations apply cleanly; Drizzle + catalog parity for all 4 tables; RLS A1–A10 per new tenant table | 0089–0094 apply + re-apply no-op over the 94-entry chain (`migrations.db.spec.ts` in the 250/250 run; the from-zero chain re-proven standalone — the pre-state verification PHASE B); the catalog's 4 rows complete (288, W-1); the generated A1–A10 attacks cover every new table (the isolation suite green in the 250/250 run); the RLS/catalog checker clean at **292 catalog tables** (the standalone scratch-PG16 run + the in-suite co-proof) |
| 2 | INV-032 holds: every statutory line == rate × clamped base exact; run totals == Σ lines; the true-up delta exact | The writer-path pins (`statutory.spec` 7/7 · `pit.spec` 6/6 · `run-statutory.spec` 8/8 · `eosb.spec` 9/9 · `variable-lines.spec` 5/5) + the consolidated golden (`statutory-goldens.spec` 5/5 — INV-032(a) recomputed in-test with exact BigInt) + **the property wing 6/6** (`__tests__/statutory-properties.spec.ts`: the contribution law, the clamp law, the fold law, the PIT marginal law, the EOSB tier law, the signed delta law — fast-check, deterministic) + the TABLE-LEVEL LAW (a raw violating INSERT rejects on `ck_eosb_calculations_delta`, pinned by the goldens' (e) pack) + the reports' render-time re-checks with the block-on-fail exports |
| 3 | The fail-closed gate proven: a REQUIRES_VERIFICATION profile rejects the run typed + audited; AE/EG/JO cannot post until verify; GOSI posts out of the box on KSA | `statutory.spec` (BR-085 both ways — the AE placeholder refuses typed + the audit event in its own UoW + zero residue; the verify CAS + SoD + the A7 404) · `pit.spec` (blocked brackets) · `statutory-goldens.spec` (c) the flip-and-restore pack · the KSA worked example end-to-end (`run-statutory.spec`) with the PwC-cited seeded schedule |
| 4 | Golden G-52 green: the employee shares withheld to the statutory payable + the remittance settlement leg through the payout machinery; failure pack red | `statutory-goldens.spec` (a) the consolidated golden (the Saudi 1,170/1,410 beside the non-Saudi 0/240 in ONE posted run — the balanced 25,650 journal, G-52's employee/PIT legs + G-53's pair pinned separately, the full 2,820 settlement + INV-013's double-settle refusal) + the four wrong-shape RED packs with zero residue; the KSA worked example in `run-statutory.spec` (DR SALARIES_EXPENSE 12,000 · DR EMPLOYER_CONTRIBUTIONS 1,410 · CR DEDUCTIONS_PAYABLE 2,580 · CR SALARIES_PAYABLE 10,830; the remittance 2,580) |
| 5 | Golden G-53 green: the employer share to the contribution expense purpose with the liability leg; failure pack red | The same consolidated golden + the worked example (the employer pair pinned separately inside the one fold — zero new purposes, BR-053's six-key pre-flight untouched, proven by the ×6 purpose failure packs staying green in `payroll-rules.spec` 16/16) |
| 6 | Golden G-54 green: the delta-only true-up; the release leg; the 029 regression packs stay green | `eosb.spec` 9/9 (the fold 40,500.0000; the OPENING; the PERIOD true-up + the zero-delta no-journal law; the release mirror −13,500; the CONTRACTOR override; the guards; the TERMINATION sequence — the true-up aligns → G-31 settles 900 → the 029 machinery green after; the reconciliation tie; the no-rule refusal) + the goldens' (e) pack + the 029 regression acceptance act green on the unified head (G-29/G-30/G-31 + BR-052…055 + the spoof battery in the 250/250 run) |
| 7 | PIT: progressive brackets over fixtures (marginal sums, exemption deduction, zero band); residuals explicit | `pit.spec` 6/6 (the synthetic VERIFIED set: gross 40,000 → taxable 35,000 → **3,000.0000**; +2 dependents → 2,600.0000; the zero band; the override; the gapped-set typed refusal; the honest no-bracket state; the AE blocked brackets) + **the first green end-to-end PIT-through-the-run pin** (tenant BH, the W-6 T-13 spec: `pit.employeeShare === "3000.0000"`) + the property wing's marginal law (no absorbed residual) |
| 8 | Variable lines: the feeds land as run-time variable lines with multipliers; encashment stays G-51; nothing writes outside a run (BR-086) | `variable-lines.spec` 5/5 (the feed boundary — the run reads the service ONCE, the registers byte-identical: the negative ledger proof; overtime 4.50 × 37.5000 = 168.7500; the UNPRICED state while the divisor is unset — zero fabricated rate; absence/late OFF by default → ON when configured; MISSING_PUNCH informational-only; the encashment NON-invention) |
| 9 | All house gates green; OA-06 budgets met; sync-surface N/A-recorded | §5 below — the full sweep + the OA-06 EXPLAIN budgets P1–P4 (the new permanent `__db__/payroll/oa06-budgets.spec.ts` 4/4: the bracket-set resolution · the EOSB entitlement query (tier set + evidence walk) · the statutory-summary walk · the remittance liability read — every probe index-driven, zero seq-scans, plans logged); the N/A record in the phase doc §4 |
| 10 | Completion report appended with evidence; the status row flipped; the OA-07 archive | This report; the triple flip (the phase doc header + IMPLEMENTATION_STATUS + NEXT_ACTION → PHASE-047); `ERP_PLATFORM_PHASE046.zip` (the archives rebuilt + byte-verified, 0 mismatches); **the tag `phase/046`** (the repo's first tag, the owner's exit-criteria instruction) |

## 4. Deviations & decisions (documented)

- **Migration numbering 0089–0094, not the planned ≈0089…0093.** The plan's
  "≈ 0089…0093" narrowed to the honest 0089–0092 + the reserved 0093 (consumed by
  its exact purpose — the GOSI citation reclassification, the audit-reconciliation
  round) + **0094** (the owner's §1a.6 ruling — the RLS class repair shipped in
  this closure wave, never a per-family drip). 0089–0093 stayed byte-stable
  through 0094's authoring.
- **THE 0092 ↔ canonical-SOURCE SHAPE DRIFT (disclosed in 0094's header, never
  silently resolved).** 0092 §3e's placeholder names embedded the jurisdiction
  LABEL ('UAE'/'Egypt'/'Jordan'); the canonical one-source (statutory-canonical.ts
  — D-11's law) uses the CODE ('AE'/'EG/JO'…) — since 0092's sweep never landed a
  single row (the very no-op class 0094 repairs), no existing row carries the 0092
  text shape; 0094 materialized the CANONICAL shapes per the ruling's
  "CANONICAL current shapes" law.
- **THE 0071 EXCLUSION (the ruling's never-guess law honored).** The exhaustive
  inventory discovered the same latent class outside the ruled FROM-"tenants"
  pattern: 0071 §5's default warehouse location tree reads FROM "warehouses"
  (RLS-scoped). EXCLUDED and flagged in the 0094 header: (a) the §1a.6 ruling
  enumerates the FROM-tenants class + 0092's families — the warehouses sweep is
  neither; (b) the runtime canonical seeder exists (`ensureDefaultBin` — "the
  exact shape the migration seeded for existing warehouses", on the first
  bin-aware write); (c) repairing beyond the ruled scope would be a guess. A
  0095-class ruling sweeps it in one statement if the owner wants it.
- **THE PLATFORM OPERATIONS TENANT — the class harm's visible proof in the test
  env itself.** The pre-state verification's PHASE B found the ONE tenant that
  exists at migration time in any fresh chain (the platform operations tenant,
  seeded by the erp_definer path in 0006) carrying the full repaired set after
  0094 — pre-0094 it was silently missed by 0009/0092 exactly like any real
  pre-migration tenant (the 0093 finding's "the test environment never sees it"
  was true for every OTHER tenant; the platform tenant was the hidden in-env
  instance of the harm). Recorded in the verification log + the 0094 header.
- **§7(b) — the owner's three 045 final-audit documentation remarks remain the
  owner's open input.** Their text never entered the record (the acceptance
  dispatch referenced them; no restatement exists in the repo or the W-7 order);
  nothing was folded and nothing fabricated — they stay a standing open item for
  the owner's restatement, to land wherever the owner directs (no PHASE-045 task
  opens).
- **The register's two narrowed open items stand:** the SANED-specific 15,000
  ceiling (PwC does not state it; the owner's confirmation pending) + the EOSB
  official text (Labor Law M/51 Art. 84 — unreachable from both environments).
  The GOSI rates + the 45,000 ceiling are CLOSED (0093).
- **The 029-era `payroll.eos-provision` report's honest record (the W-3/W-6
  design point, dated on its contract):** on a true-ups tenant its register fold
  no longer ties to the GL alone — block-on-fail engages (the SAFE direction);
  `payroll.eosb-liability` is the 046-correct view; the semantic update of the
  029 report is the owner's open input, NOT changed unilaterally.
- **The owner's one-word record correction (the W-6 verification's finding):**
  the statutory-goldens (b) title said "a base of 60,000" while the fixture
  (48,000 basic + 2,000 housing) and every assertion pin 50,000 — fixed under
  the F1 literal-truth law with the dated in-code note; the file-header bullet
  carried the same wrong number and moved with it (disclosed in the W-7 gate
  doc — the owner's verifier had found the title; the header bullet was the same
  wrong number in a second place). Zero behavior change — the suite green before
  and after.
- **The known chromium env gap re-appeared in this fresh clone and resolved
  identically** (`playwright install chromium` — the W-0 record's pattern; the
  zatca-qr-decode spec green after, the unit workspace 8/8 on the first full
  attempt after the install).

## 5. Gate evidence (the full sweep — the W-7 final head, 2026-11-17)

Every log kept in `audit-evidence/phase046-w7/` (same-session, pushed with the
code — the binding process rule honored). The DB suite ran serially in five
foreground invocations (4 + the isolated perf chunk per the T-20 runbook
precedent — the two load-shaped perf assertions green in their own chunk).

| Gate | Result |
|---|---|
| `pnpm typecheck` / `pnpm lint` | **8/8 packages** green |
| `pnpm lint:depcruise` | clean — **1,940 modules · 14,441 dependencies** |
| unit workspace (`pnpm test`) | **8/8 packages** — api **666/666** · web 87 · mobile 393 · ui 42 · domain-core 38 · contracts 56 · sync-core 36 · desktop 274 (first full attempt after the chromium env prep) |
| **THE FULL DB SUITE** | **250/250 files · 3,436/3,436 · 0 failed · 0 skipped** (59+57+60+66 files + the 8-file isolated perf chunk; every chunk its own embedded-PG16 boot; the payroll folder 11 files incl. the new oa06-budgets 4/4, the goldens 5/5 re-titled, the races 10/10; migrations.db.spec green — the 94-chain + re-apply no-op) |
| **the 0094 pre-state verification** (the 0093 pattern, output kept) | **ALL ASSERTIONS PASSED** — S1 the pre-0009 tenant repaired · S2 the post-0009 tenant idempotent (ids byte-identical) · S3 the onboarded tenant untouched (every row id identical) · GOSI untouched (0093's records stand) · the temporary policies dropped (0 remain) · the full policy inventory identical pre/post · the 0071 exclusion honored · the data statements idempotent · drizzle re-apply no-op · the from-zero chain clean with the platform tenant carrying the full repaired set |
| the OA-06 EXPLAIN budgets | **P1–P4 green** (the permanent `__db__/payroll/oa06-budgets.spec.ts`; the plans logged in the suite output) + the standing six (045) green in the full suite |
| `docs:validate` · `check:permissions-drift` · `validate:manifests` · `check:capabilities-matrix` · `check:id-ledger --self-test` | 33/33 docs · **300 = 300** · 13/13 · agree · **0 errors + self-test all-probes-OK** (implemented G 54 · INV 32 · BR 87) |
| `check:history-secrets` · `check:i18n-parity` (+ mobile) · shells | 0 violations · **6,121 = 6,121** · 371 = 371 · desktop PASS · mobile PASS |
| the negative boundary meta-test | **PASS** |
| `check:rls` | **clean — 292 catalog tables, 0 violations** (the standalone scratch-PG16 run + the in-suite co-proof) |

## 6. Delivery and handoff

- **The triple flip (CR-48):** the phase doc header → COMPLETE; the
  IMPLEMENTATION_STATUS row → COMPLETE (with the W-6 + W-7 history blocks — the
  W-6 block lands with this closure, one wave late, disclosed in the row);
  NEXT_ACTION → PHASE-047 (HR Growth) unblocked.
- **The archives:** `ERP_PLATFORM_PHASE046.zip` rebuilt at the completion head +
  the standing `ERP_PLATFORM_PHASE043.zip` / `ERP_PLATFORM_PHASE045.zip`
  re-verified at the same head — all members byte-verified (0 mismatches, the
  T-20 convention).
- **The tag:** annotated `phase/046` at the delivery head (the repo's first tag
  per the owner's exit-criteria instruction).
- **Handoff notes for PHASE-047:** the `employees.user_id` bridge + self-service
  tabs (045) and the statutory-aware run screen + the verification world (046)
  are the substrate for the talent surfaces; org structure attaches to employees
  without touching payroll. **Handoff for PHASE-054:** the REQUIRES_VERIFICATION
  discipline (profiles, brackets, tiers, the register) is the exact pattern the
  corporate-tax and Zakat profiles follow.
- **Open items for the owner:** the register's exactly-two (the SANED 15,000
  ceiling + the EOSB M/51 Art. 84 text); the AE/EG/JO official schedules (+
  any additional market); §7(b)'s three 045 remarks (text pending); the 0071
  warehouses-sweep ruling (flagged in 0094's header — a 0095-class repair if
  wanted); the 029 eos-provision report's semantic update.
- **Standing:** PHASE-043's hard review and RISK-031/RISK-032 stay OPEN — this
  report is delivery evidence only, NOT production approval.
