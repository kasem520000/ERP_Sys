# NEXT ACTION — PHASE-046 IN PROGRESS (the owner's approval + corrections received)

**THE CURRENT STATE (2026-11-16):** PHASE-045 is **ACCEPTED & CLOSED** by
the owner (content head `248039e` / delivery head `d74edaa`; the five
concurrency defects confirmed fixed; DB suite 240/240 · 3,329/3,329;
archives byte-verified; the three final-audit documentation remarks are
NON-BLOCKING and fold into PHASE-046's W-7/T-15 — their text is an open
input, no PHASE-045 task opens). **PHASE-046 (HR Payroll Compliance —
GOSI/PIT/EOSB, CR-16) is APPROVED with corrections** — the owner approved
the MASTER-PLAN (`agent-ctx/PHASE-046-MASTER-PLAN.md`, delivered at main
c71aa9d5) with these binding amendments:

1. **GOSI correction (W-1, before the W-2 engine specs and the W-6 golden
   pinning):** the `GOSI-OH` row applies to **ALL** (employee 0%, employer
   2%); Saudi = employer 11.75% total (9% pension + 0.75% SANED + 2% OH),
   employee 9.75%; non-Saudi = OH-only (employer 2%, employee 0). The
   ruleset/seed + the canonical unit + the tests + the affected examples
   all move together — not the example alone. The OH wage cap is verified
   against the official schedule with the citation (expected 45,000 — pin
   what the official source confirms). The Saudi worked example: employer
   total 1,410.0000; the salary journal DR SALARIES_EXPENSE 12,000 · DR
   EMPLOYER_CONTRIBUTIONS 1,410 · CR DEDUCTIONS_PAYABLE 2,580 · CR
   SALARIES_PAYABLE 10,830; the remittance settlement 2,580; non-Saudi OH
   240.0000 unchanged.
2. **`employees.nationality` (D-02) APPROVED** — NULL fails closed with the
   specified warning; the field joins the PII inventory.
3. **The D-01/D-11 work-basis text + every affected example** update in the
   same change, with the OH rate+cap citation attached.
4. **The T-20 pinned technical notes — BEFORE the payroll writers adopt the
   floor** (these are NOT the §7(b) documentation remarks; they are not
   deferred, not resolved by W-7):
   - UUID canonicalization before the lock-key derivation + TWO permanent
     DB tests (overlapping attendance + overlapping leave in parallel, the
     SAME uuid in two letter cases — the illegal state must not save);
   - the day-import × overlapping-derivation deadlock probability: no
     lock-set expansion after a partial set is reserved in-transaction, the
     acquisition order guaranteed at the DB level (not app-side sorting
     alone), re-tested as two transactions on days 22/24 and 23/24 with the
     range derivation 22–24 — no 40P01, correct final state;
   - the race-suite sync hardening: `anyLockWaiter()` (whole-DB ungranted
     lock) becomes bound to the intended transaction/lock or a test
     barrier — no false-positive greens.
5. **Tag `phase/046`** (not `phase-046`); the waves/gates per the plan with
   no softening; separate evidence per step; PHASE-043 and
   RISK-031/RISK-032 stay OPEN — NOT production adoption.

**W-0 (delivered 2026-11-16):** the clean-environment baseline proof on the
untouched `d74edaa` head — typecheck 8/8, lint 8/8, depcruise clean
(1,908 modules · 14,140 deps), unit 8/8 packages (1,542 tests; the missing
chromium headless-shell 1248 installed here for the zatca-qr-decode spec),
and THE FULL DB SUITE 240/240 files · 3,329/3,329 · 0 failed · 0 skipped
(chunked foreground invocations; the two load-shaped performance assertions
re-proven green in the isolated perf chunk per the T-20 runbook precedent —
both failing logs kept). Evidence:
[gate-evidence/2026-11-16-phase046-w0.md](../docs/operations/gate-evidence/2026-11-16-phase046-w0.md)
+ `audit-evidence/phase046-w0/`.

**W-1 (delivered 2026-11-16 — Foundation):** migrations **0089–0092** (the
journal's honest slots; 0093 reserved) — `statutory_contribution_profiles`
(the D-01 row-set) + `payroll_tax_brackets` (D-03) + `eosb_rules`/
`eosb_calculations` (D-04) + the employees extension (`nationality` D-02
FAIL-CLOSED + PII-registered; `pit_exemptions`) + the run/line statutory
breakdown columns (D-05, additive only) + the DATA-ONLY seed 0092 (the 3
permission keys 297 → 300 + role grants + the 2 plan grants + THE CANONICAL
STATUTORY MATERIALIZATION for every existing tenant). **THE OWNER'S
CORRECTED GOSI SCHEDULE seeded VERIFIED**: GOSI-PENSION 9%/9% CITIZEN
1,500…45,000 · GOSI-SANED 0.75%/0.75% CITIZEN 1,500…15,000 (the dual-cap
law) · **GOSI-OH 0%/2% ALL** 1,500…**45,000** → Saudi employer 11.75% /
employee 9.75%, non-Saudi OH-only; contributory = basic + HOUSING; NO KSA
PIT rows (the honest no-bracket state); KSA EOSB tiers VERIFIED (0–5 × 15 +
>5 × 30 days); AE/EG/JO = 0-rate REQUIRES_VERIFICATION placeholders (the
blocked-state surface, never a guessed rate). The OH cap 45,000 pinned
corroborated (Royal Decree M/33 Part 1 Art. 8(2) + published
implementations); gosi.gov.sa unreachable from this sandbox — the honest
note + the register's open item recorded in every verification record.
The code mirrors: Drizzle +4 tables + the extensions; tables.registry +4
(the A-suite auto-extended, the isolation fixtures extended the 0087
pattern); statutory-canonical.ts (D-11's ONE source) + the tenancy
onboarding hook (step 1c); FEATURE_DEPS +2 + the layer-fixtures
transcription (the BR-040 closure surfaced the un-mirrored 029 substrate —
salary_structures/runs/eos_provision transcribed with the 0092 grants) +
**ALL 37 golden pins re-pinned** (41/41); the two variable-knob policy keys
(absence/late — enum off/on, default off; the overtime divisor rides tenant
settings with NO default, the weekend_days precedent); matrix §3.24 + the
drift lists + the identity-flows 300-pin moved together; ENTITY_CATALOG
284 → 288 + the extension notes; FEATURE_CATALOG §22 + the entitlements
note; the PII inventory row; the MASTER-PLAN §1a records the approval
amendments + the corrected worked example (employer 1,410.0000 ·
DEDUCTIONS_PAYABLE 2,580 · the remittance 2,580 · non-Saudi OH 240.0000).
Evidence: [gate-evidence/2026-11-16-phase046-w1.md](../docs/operations/gate-evidence/2026-11-16-phase046-w1.md)
— typecheck/lint 8/8, depcruise clean (1,909 · 14,146), api unit 626/626,
migrations 7/7 (the 92-chain, check:rls clean at 288), isolation +
entitlements + tenancy 5 files · 1,642/1,642, hr/payroll/spoof/identity
178/178, drift 300 = 300, manifests 13/13, docs 33/33, i18n parity,
capabilities agree. **Next: W-2 — the engines (statutory-profile-service,
pit-engine, eosb-service, the error taxonomy, the unit specs).**

**The audit-reconciliation fix wave (delivered 2026-11-16 — the four
adopted findings, BEFORE W-2):** (1) the race-suite evidence corrected —
the STANDALONE 20/20 artifact re-proven
(`audit-evidence/phase046-audit-fixes/race-suite-standalone-20-20.log`),
`pinned-notes-race-suite.log` labeled as the kept INTERMEDIATE DISCOVERY RUN
(18/20 — duels (12) and (19) failed, ended 20:09), and the fixed-vs-flaky
record stated: duel (12) = a TEST-EXPECTATION re-binding only (advisory-tag
→ winner-tx; the loser was provably blocked on the winner's row lock the
whole window — the log's statement-timeout cancel is the evidence; no
production change; deterministic under the old expectation, not flaky),
duel (19) = a PRODUCTION fix (the import commit's whole-derive-window
reservation — attendance-import-service.ts backed by atomic.ts's
DB-guaranteed order + the reservation ledger; the duel's test code
unchanged). (2) THE GOSI CITATION CLOSED — the PwC source (Saudi Arabia:
Individual — Other taxes, fetched by the owner's verifier 2026-11-16 21:34
UTC) independently corroborates the corrected schedule + the SAR 45,000
ceiling; **migration 0093** (the reserved slot, DATA-ONLY, 0089–0092
byte-stable) reclassifies the three GOSI rows' verification records
(CITATION = PwC; DECISION RECORD = the owner's dispatch) + the canonical
source + the journal/manifest/spec pins — the 93-chain re-proven 7/7 from
zero; the register's open items narrow to EXACTLY TWO (the SANED 15,000
ceiling + the EOSB official text, Labor Law M/51 Art. 84). **+ THE HONEST
RLS FINDING (proven by probe)**: under FORCE RLS erp_migrate sees no
tenants and no cross-tenant rows — every per-tenant migration sweep
(incl. 0092 §3's existing-tenant materialization) is a silent no-op on
tenant-ful databases; 0093 repairs the GOSI family through a temporary
self-dropped migration-plane policy gate (verified end-to-end:
materialization + reclassification + idempotence + the policy set
restored); the older sweeps (0009 et al.) recorded for the owner, NOT
redesigned here. (3) PHASE-045 reconciled — the phase doc's header flipped
to ACCEPTED & CLOSED (the owner's acceptance dispatch cited verbatim) + the
closure re-affirmed (duel (12)'s vacuous pass → the truthful proof, strictly
stronger, no reopen) + the status header's stale REOPENED text reconciled.
(4) the W-1 evidence doc's scope labeled (TARGETED suites at cc2f2f3; the
full DB suite runs at W-7's final head). Gates: typecheck/lint 8/8,
depcruise clean (1,909 · 14,146), unit 626/626 (the first attempt's one red
= the known chromium-1248 env-prep gap, re-run green), migrations 7/7 (the
93-chain), the affected DB groups 5 files · 1,642/1,642 + 16 files ·
123/123, the race suite standalone 20/20, docs 33/33, drift 300, manifests
13/13, i18n parity, capabilities agree, id-ledger 0 errors. Evidence:
[gate-evidence/2026-11-16-phase046-audit-fixes.md](../docs/operations/gate-evidence/2026-11-16-phase046-audit-fixes.md)
+ `audit-evidence/phase046-audit-fixes/`.

**W-2 (delivered 2026-11-16 — The engines, T-03+T-04+T-06):** the PURE
statutory math (`domain/statutory-math.ts`) pinned by the unit spec FIRST
**25/25** (the GOSI worked example employee 1,170.0000/employer
1,410.0000; the dual-cap clamp 45,000/15,000/45,000; the PIT example
3,000.0000 → 2,600.0000; the EOSB fold 135 days → 40,500.0000); the typed
error taxonomy (the 404 A7 family + the 409 verify-CAS/SoD family + the
422 fail-closed family, registered in-phase); the **statutory-profile-
service** (the effective-dated resolution — expired/future never match,
RETIRED neither prices nor blocks; the BR-085 typed refusal audited in its
OWN UoW — the evidence survives the caller's rollback; the verify CAS +
SoD + the citation + the audit trail); the **pit-engine** (the
SET-CONSISTENT tiling validation typed; the honest no-bracket zero state;
BR-085); the **eosb-service** (the contract-aware tier resolution —
contract rows REPLACE the default set; the 029 eosBase snapshot; THE
STANDING PROVISION = the 029 balance + the accumulated true-up deltas —
the zero-delta no-journal law; BR-087's guards; the G-54 delta-only
posting + the release mirror; the reconciliation view); the statutory
store; employees.nationality + pit_exemptions exposed (the ISO-3166
alphabet law); the DB specs: statutory 7/7 + pit 6/6 + eosb 9/9 **on the
DEDICATED EOSB TENANT** (the race-suite precedent — no PAY-world
pollution; the termination sequence: run → provision 900 → terminate →
true-up +48,600 → G-31 settles 900 green → further true-ups refuse).
Gates: typecheck/lint 8/8, depcruise clean (1,919 · 14,219), api unit
**651/651** (626 + 25), the new specs 3 files · 22/22, the payroll+hr
regression 18 files · 124/124 (the 029 goldens + spoof + the hr specs all
green with the engines in the tree), isolation+entitlements+tenancy+
migrations+identity 6 files · 1,663/1,663. Evidence:
[gate-evidence/2026-11-16-phase046-w2.md](../docs/operations/gate-evidence/2026-11-16-phase046-w2.md)
+ `audit-evidence/phase046-w2/`. **Next: W-3 — the run integration + the
floor (the run-calculation extension, the G-52/G-53 legs through the G-29
machinery, the remittance settlement + the statutory_summary liability,
the run gate in atomic.ts (D-09), the feed-called-ONCE boundary).**

**THE 0094 RULING (the owner's dispatch, 2026-11-16 — recorded with the
W-3 greenlight):** the RLS latent no-op finding is a CLASS, not an
incident — a general repair migration **0094 ships in the W-7 CLOSURE
WAVE**: one file, the 0093 pattern (the temporary self-dropped
migration-plane policy gate), sweeping EVERY affected family (the
0009-era master-data seeds — uoms, credit_terms, and every other
INSERT…SELECT…FROM tenants sweep in the chain — AND 0092's remaining
families: AE/EG/JO profiles, PIT bracket sets, EOSB tiers), with (a)
the exhaustive inventory of every FROM-tenants sweep 0001…0093 listed
in the 0094 header, (b) idempotent ON CONFLICT DO NOTHING
re-materialization against the CANONICAL current shapes (the 0093
citation records for GOSI — never the pre-0093 shape), (c) the 0093
end-to-end pre-state verification script pattern with its output kept,
(d) journal/manifest/spec pins to 94 + the chain re-proven from zero;
a genuinely ambiguous family is flagged + excluded with the reasoning —
never a guess. This closes the class; NO per-family drip. Recorded in
the MASTER-PLAN §1a.6 + the migration inventory.

**W-3 (delivered 2026-11-16 — Run integration + the floor,
T-05+T-07+D-09):** the run-calculation extension — statutory + variable
columns computed during `calculate`, **the feed called ONCE via the
service boundary** (`FeedService.variableFeed` — the handoff contract),
the INV-025 fold extended (deductions += the statutory employee share +
PIT + the gated variable docks; the employer column += the statutory
employer share; net = gross − deductions exactly — the CHECKs
unwidened), the breakdowns + the `statutory_summary` frozen on the
run/lines; **the G-29 fold extension** — G-52's employee/PIT legs (CR
DEDUCTIONS_PAYABLE at employee share + PIT) + G-53's pair (DR
EMPLOYER_CONTRIBUTIONS at the employer share; the existing CR
DEDUCTIONS_PAYABLE bump at the employer column is its liability leg) +
the overtime earning (DR SALARIES_EXPENSE, the G-50 family) + the
absence/late docks (CR the salary expense account — the G-54
release-mirror precedent) — additive lines in the SAME journal, ZERO
new account purposes, the six-key pre-flight already fail-closed (the
unmapped-path law verified in place); **the remittance settlement**
(`PayoutService.remit`) — DR DEDUCTIONS_PAYABLE · CR cash through the
payout machinery + the `payroll_payout` movement (INV-019 exact), the
source key `(payroll_remittance, remittanceId, post)` under INV-013,
the summary's liability accrued → remitted (a partial allocates
first-summary-row-first), the over-remit typed refusal; **D-09's
gates** — `payroll.run|{runId}` (calculate's DRAFT reset, post,
reverse, the remittance) + `payroll.eosb-employee|{employeeId}` (the
true-up AND the G-31 settle — the provision read + the delta write
under one lock) on the SAME T-20 floor (dep-cruise CLEAN on the
payroll → hr edge: 1,923 · 14,273, no promotion needed — recorded);
**the pg-boss payload compatibility check** — the queue contract
UNCHANGED (`{tenantId, runId}` ids-only; only the worker's construction
grew); the route `POST runs/:id/remit` on `payroll.runs.post`
(§8-registered). THE PURE variable math unit-spec FIRST (9/9 — the
§4 numbers: 4.50 × 37.5000 = 168.7500; 2 × 300.0000; 60 × 0.6250; the
UNPRICED states; MISSING_PUNCH informational; the clamps; the summary
fold). THE DB SPECS on the dedicated tenants (RUNSTAT/VAR — the
eosb.spec precedent, never the PAY world's registers): run-statutory
**7/7** (the KSA worked example end-to-end: employee 1,170.0000 /
employer 1,410.0000 → the journal DR SALARIES 12,000 · DR
EMPLOYER_CONTRIBUTIONS 1,410 · CR DEDUCTIONS_PAYABLE 2,580 · CR
SALARIES_PAYABLE 10,830; INV-032(a)/(b) + INV-025; the full remittance
2,580 + the partial allocation + the over-remit typed; the non-Saudi
OH-only arm; the NULL-nationality fail-closed arm; BR-085 AT THE RUN
LEVEL — the typed refusal + the surviving audit event + zero residue,
withdrawn ⇒ green) + variable-lines **5/5** (the feed boundary + THE
NEGATIVE LEDGER PROOF — the registers' md5 digests byte-identical
through the full run cycle; the unpriced → priced → gated sequence on
ONE DRAFT run's recalcs; the post's balanced journal with the dock
release; the encashment non-invention — used_days 0, one journal in
the tenant, G-51 untouched; D-07's no-profile state). **THE HONEST
RESTRUCTURE RECORD**: the new gates made two pre-existing spec
sequences illegal (the no-expansion law refused the G-31 test's and
the eosb termination sequence's run-writer + settle batching in one
UoW — exactly the shape the floor exists to refuse) — both
restructured to the production one-writer-per-UoW shape (the T-20
self-service.spec precedent), the ASSERTIONS byte-identical (the 029
golden pack 14/14, untouched laws). GATES: typecheck/lint 8/8,
depcruise clean (1,923 · 14,273), unit 8/8 packages · api **660/660**
(626 + 25 + 9), the payroll folder 7 files · 53/53, the hr folder 13
files · 83/83 (the race suite 20/20 — the floor's extension green),
isolation + entitlements + tenancy + migrations + identity 6 files ·
1,663/1,663 (migrations 7/7 — the 93-chain), docs 33/33, drift
300 = 300, manifests 13/13, i18n parity 6,007 = 6,007, capabilities
agree, id-ledger 0 errors, history-secrets 0, check:rls clean (the
standalone run on a temp embedded PG16: 0 violations). Evidence:
[gate-evidence/2026-11-16-phase046-w3.md](../docs/operations/gate-evidence/2026-11-16-phase046-w3.md)
+ `audit-evidence/phase046-w3/`. **Next: W-4 — the verification
workflow surface (the verify route on payroll.statutory.verify) + the
GOSI remittance export (XLSX/CSV, the 028 pattern) + the
integration-profile readiness surface (IN-06 — exports only, NO
live-government-API claims).**

**The T-20 pinned technical notes (delivered 2026-11-16, the second
W-0-wave increment — BEFORE the floor's payroll adoption):** (a) THE
CANONICAL KEY LAW — `canonicalUuid()` in `atomic.ts` normalizes every
uuid component of every lock key (upper/mixed case and the undashed
32-hex spelling are ONE key; a non-uuid fails loud), pinned by the
permanent duels 17 (mixed-case attendance — one canonical day gate, the
overlap never lands) and 18 (mixed-case leave — one canonical span gate,
exactly one request); (b) THE NO-EXPANSION LAW + THE DB-GUARANTEED ORDER
— the lock statement sorts the keys INSIDE PostgreSQL (`ORDER BY k
COLLATE "C"` in a MATERIALIZED CTE — byte order, the same total order as
the TypeScript ledger) and the per-transaction RESERVATION LEDGER
refuses any key at-or-before the held maximum with the typed
`hr/lock-order-violation` (re-entry + strictly-ascending expansion are
the legal shapes); the leave approve restructured to ONE whole-set call
(`lockLeaveApproval` — span + start-year cell together) and THE IMPORT
COMMIT NOW RESERVES ITS WHOLE DERIVE WINDOW UP FRONT (the file's
min…max dates × the file's employees — the internal derivation is pure
re-entry; pre-fix a file holding {22,24} deriving 23 against a
concurrent {23,24} import was the exact 40P01 recipe), pinned by the
permanent duel 19 (import A {22,24} × import B {23,24} × derivation
22–24 in flight — no 40P01, all arms fulfilled, the final state exact)
and duel 20 (the ledger's legal/illegal shapes); (c) THE BOUND WAITER
PROOF — anyLockWaiter() (any ungranted lock in the cluster) is replaced
by per-duel bound expectations (the raced key's own advisory tag
computed in-database, or the winner's own xact id for the bridge's
row-lock duels) — and the hardening honestly found that duel (12) had
always been proving the winner's ROW lock (the accrual's
ensureBalanceCell index probe), now recorded truthfully as winner-tx;
the ledger also caught self-service.spec's fixture-batching two
employees' writers into one UoW (restructured to the production shape —
one writer per UoW). Evidence:
[gate-evidence/2026-11-16-phase046-t20-pinned-notes.md](../docs/operations/gate-evidence/2026-11-16-phase046-t20-pinned-notes.md)
— typecheck/lint 8/8, depcruise clean, api unit 626/626, the race suite
**20/20**, the hr folder 13/13 · 83/83, payroll+isolation+spoof 10/10 ·
1,649/1,649, and THE FULL DB SUITE **240/240 files · 3,333/3,333 · 0
failed · 0 skipped** (3,329 + the 4 new permanent tests). **The floor is
ready for W-3's payroll adoption (D-09).**

The delivered substrate (context for the re-review): migrations
`0080`–`0088` (schema_version 88; the shift/attendance/overtime/leave/
holiday families + the employee↔user bridge + the seeds + the import log +
the workforce manifests), +12 RLS'd tables, the roster grid with the
rotation generator, the DERIVED daily status (HOLIDAY > ON_LEAVE >
ABSENT/MISSING_PUNCH/LATE/PRESENT — the day is the unit, INV-031's
non-overlap at every capture, the T-19 classification law
order-independent), the device-agnostic import (the sha256 fingerprint
floor — the same file never commits twice), the overtime engine (BR-084's
feeding law), the leave family (the simple approval — DR-045-01, PHASE-052
is the upgrade path), the identity bridge (the SoD law pinned: linking
grants nothing), the variable feeds + leave-balance snapshots, the goldens
G-50/G-51, and the web plane (four office boards + the self-service tabs).
Permissions 297=297; i18n 6,007=6,007; report registry 104; DB suite
240/240 files · 3,329/3,329; api unit 626/626; docs 33/33; typecheck/lint
8/8; OA-06 budgets 6/6. The OA-07 archive is `ERP_PLATFORM_PHASE045.zip`.

**PHASE-046 (HR Payroll Compliance — GOSI/PIT/EOSB, CR-16) IS APPROVED**
(its only hard prerequisite PHASE-045 is accepted; the roadmap's hard
ordering "045 before 046 before 047" holds). The MASTER-PLAN
(`agent-ctx/PHASE-046-MASTER-PLAN.md`, at main c71aa9d5) governs with the
owner's five approval amendments + the 0094 ruling (the sixth, recorded 2026-11-16 with the W-3 greenlight — the RLS latent no-op class repair ships as migration 0094 in the W-7 closure wave) recorded in the header above. The canon
spine stays `docs/implementation/phases/PHASE-046.md` (T-01…T-16; goldens
G-52…G-54, INV-032, BR-085…087 — the id-ledger's coordinated slots).
**The immediate work order: the T-20 pinned technical notes first (the
UUID canonicalization + the two mixed-case permanent DB tests; the
lock-set-expansion/deadlock fix proven by the 22/24 × 23/24 × 22–24
three-way duel — no 40P01; the anyLockWaiter() hardening), then W-1 with
the GOSI corrections.**

Key handoffs from 045 (read the PHASE-045 completion report first):

- **The variable feeds are the exact statutory inputs**: the per-pay-period
  overtime / absence / late feeds + the leave-balance snapshots
  (`feed.store`, the `payroll.runs.view` read) land as PHASE-046's
  variable lines with run-time multiplier application; leave encashment
  rides the G-51 settlement delivered here — no new machinery.
- **The derivation's six-verdict vocabulary is the absence truth**: the
  compliance engine consumes PRESENT/LATE/ABSENT/MISSING_PUNCH/HOLIDAY/
  ON_LEAVE + the minute facts as computed (MISSING_PUNCH is its own count,
  never folded into absence — the T-10 law).
- **The `employees.user_id` bridge enables per-employee payslip delivery**
  through the existing notification channels; the SoD law keeps HR
  visibility on the hr keys (a user-administration role holds no
  hr.*/payroll.employees.* key — reuse the pattern when 046's screens
  scope per-employee views).
- **The holiday calendars feed PIT/EOSB period boundaries**; the
  jurisdiction-scoped calendar (one per jurisdiction, the active flag) is
  the same shape the statutory profiles should follow — and the
  REQUIRES_VERIFICATION discipline is the BR-055 no-fabrication law
  extended to rates (only the officially verified GOSI profile seeds
  active; UAE/Egypt/Jordan stay blocked until verified, fail-closed).
- **The BR-055 family discipline**: accrual 0.00 until configured, no
  fabricated defaults, tenant-configurable policies — 046's rates, caps,
  and tiers must not invent statutory numbers (the phase doc's own
  verification regime is the enforcement).
- **The T-14 envelope law**: every controller site awaits its service call
  INSIDE envelope(...) — the hr controllers' 69 repaired sites are the
  reference implementation; NEW controllers must never hand Express a
  floating promise.
- **Watch items carried** (the owner's dispatch, unchanged): the shipped
  modules' unawaited controller sites (the envelope-law sibling pattern —
  sales/inventory/purchasing/sourcing/wms/tax/…), SF-026-001/002, the
  028/029/030/037 environmental items, RISK-031/RISK-032 (the 043 hard
  review — OPEN; completing 045 was NOT its closure), and the 043 review
  round's standing rule: separate commits + separate evidence per phase,
  the shared gates re-run on the unified head, each its own run.
