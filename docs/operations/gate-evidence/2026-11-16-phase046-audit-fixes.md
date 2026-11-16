# PHASE-046 — the audit-reconciliation fix wave (2026-11-16): the four adopted findings + the GOSI citation closed

Owner dispatch (adopted in full, with the one factual correction of §5 — "no
explicit owner acceptance" is NOT an open question: PHASE-045's acceptance is
closed by the owner's dispatch, recorded in ITEM 3 below): the independent
auditor's report is adopted; items 1, 3, 4 are documentation + evidence
corrections; item 2 is a data correction through the reserved 0093 slot. All
land BEFORE W-2's engine code. Evidence folder:
`audit-evidence/phase046-audit-fixes/`.

## ITEM 1 — THE RACE-SUITE EVIDENCE (the auditor's finding; also found by the owner's verifier)

- **(a) The standalone 20/20 artifact now exists**:
  `audit-evidence/phase046-audit-fixes/race-suite-standalone-20-20.log` —
  `pnpm --filter @erp/api exec vitest run --config vitest.db.config.ts
  src/__db__/hr/hr-writer-races.spec.ts`, **20/20 green** (2026-11-16 22:14
  UTC, at the fix-wave head; the race-relevant code — the duels, the harness,
  `atomic.ts`, the import service — is byte-identical to `e6f7cfe`).
- **(b) WHAT changed between the 20:09 discovery run and the 20:24+ green
  chunks** — the fixed-vs-flaky record (full text in the T-20 pinned-notes
  gate doc; the intermediate 20:09 code state was never committed — the
  reconstruction is from the discovery log's own stack frames + line
  arithmetic against `e6f7cfe`):
  - **Duel (12): a TEST EXPECTATION change only — not a production fix, not
    flakiness.** The DB log proves the loser was BLOCKED the whole 15s window
    (the statement-timeout cancel of the accrual's `ensureBalanceCell`
    INSERT…ON CONFLICT at 20:09:52.290 — the winner's ROW lock); the
    then-current waiter expectation was still bound to the cell's advisory
    tag and never fired; the loser's rejection rendered "(fulfilled)" because
    the drizzle wrapper hides the pg SQLSTATE from `.code`. The fix: the
    expectation re-bound to `{ winnerTx: true }` + the 9-line comment
    (spec lines 1199–1207 — the exact line shift 1218→1227 in the log's
    stack frame). **No production code changed for duel (12)**; the failure
    was deterministic under the wrong expectation.
  - **Duel (19): a PRODUCTION CODE fix — not a test change, not flakiness.**
    At 20:09 import A died as the deadlock victim of the owner's exact 40P01
    recipe (a file holding {22,24} whose internal derivation wanted 23 — a
    backwards expansion — against {23} wanting {24}). The fix (named):
    `attendance-import-service.ts` — the commit now reserves its WHOLE derive
    window up front (min…max dates × file employees, the import-horizon
    bound); backed by `atomic.ts` — the DB-guaranteed acquisition order (the
    MATERIALIZED-CTE `ORDER BY k COLLATE "C"`) + the reservation ledger. The
    duel's test code was UNCHANGED (its 1710→1719 shift is exactly the
    duel-(12) comment block above it).
- **(c) The evidence row's citation is fixed** (the T-20 pinned-notes gate
  doc): the standalone 20/20 artifact is the citation; chunk-01 named as the
  wave's batch green. `pinned-notes-race-suite.log` is labeled in the
  inventory (`audit-evidence/phase046-w0/BASELINE.md`, the new pinned-notes
  logs section) as **the kept INTERMEDIATE DISCOVERY RUN — 18/20, duels (12)
  and (19) failed, ended 20:09**.
- **(d) Summaries to the owner now carry intermediate states when they
  exist** (the previous summary's flat "16 → 20/20" was wrong): the honest
  chain is **16 → 18/20 (the discovery run: 12 and 19 red) → 20/20** — the
  18/20 kept, the two fixes distinguished above, the final standalone green
  re-proven.

## ITEM 2 — THE GOSI CITATION, CLOSED (migration 0093, the reserved slot)

The PwC source (fetched by the owner's verifier — their environment ALSO
cannot reach gosi.gov.sa: all Saudi gov domains TCP-blocked, attempts
documented; PwC Worldwide Tax Summaries IS reachable): "Saudi Arabia:
Individual — Other taxes" (https://taxsummaries.pwc.com/saudi-arabia/
individual/other-taxes, fetched 2026-11-16 21:34 UTC, page title "Saudi
Arabia - Individual - Other taxes") states verbatim: "Social insurance
contributions are paid monthly based on the monthly basic salary plus housing
(paid or in kind) with an upper limit of SAR 45,000, are computed at 2% for
non-Saudi employees (note that this is not social insurance, it is
occupational hazard), and are paid by the employer. For Saudi employees, the
rate is 21.5% and is paid by both the employee (9.75% = 9% social insurance
+ 0.75% unemployment insurance [SANED]) and the employer (11.75% = 9% social
insurance + 2% occupational hazard + 0.75% unemployment insurance [SANED])."

- **(a) The three GOSI rows' verification records reclassified** —
  **CITATION** = the PwC source (name + URL + fetch date + the verbatim
  sentence, each row's source_ref naming its arm); **DECISION RECORD** = the
  owner's 2026-11-16 dispatch (why the correction happened — no longer
  presented as the citation itself).
- **(b) Migration `0093_statutory_gosi_citation.sql`** — DATA-ONLY, 0089–0092
  byte-stable; the journal/manifest/spec pins moved (journal idx 92, the
  `MIGRATIONS` manifest + the last-tag pin + the migrations.db.spec count →
  93); `migrations.db.spec` re-proves the 93-chain from zero — **7/7 green**.
  The canonical source (`statutory-canonical.ts`) carries the same records
  (the one-source law — new tenants materialize the closed citation).
- **The register's open items NARROW to exactly two**: the SANED-specific
  15,000 ceiling (PwC does not state it; the owner's confirmation pending)
  and the EOSB official text (Labor Law M/51 Art. 84 — the 15/30-days tiers;
  unreachable from both environments). **The GOSI rates + the 45,000 OH
  ceiling are CLOSED.**

**THE HONEST RLS FINDING (new, proven by probe this session — a latent
defect the citation update surfaced):** under FORCE ROW LEVEL SECURITY,
`erp_migrate` sees NO rows of `tenants` and NO cross-tenant rows of the
tenant tables (the purge-path policies are tenant-GUC-scoped; a migration
runs with no tenant set) — so EVERY per-tenant `INSERT…SELECT…FROM "tenants"`
sweep inside a migration is a **silent no-op on tenant-ful databases**,
including 0092 §3's canonical statutory materialization for existing tenants
(the test environment never sees it: its tenants are created per-spec AFTER
the migrations; only the onboarding hook's materialization — as erp_app
inside the tenant scope — ever lands rows). **0093 repairs the GOSI family
through an explicit, temporary, self-dropped migration-plane policy gate**
(created + dropped inside the one file, both sides DROP IF EXISTS — the
final policy set is EXACTLY the pre-0093 set; the RLS checker's world is
unchanged): §1 completes the GOSI materialization for every tenant the sweep
missed (with the final citation records), §2 reclassifies any pre-existing
GOSI rows. **Verified end-to-end against the realistic pre-states** (a
one-off script, not committed: the missed tenant gets its three rows; the
old-shape rows are reclassified; the temporary policies drop; schema_version
93; the re-run is idempotent; drizzle re-apply is a no-op). The same latent
no-op exists in the older per-tenant sweeps (0009's uoms/credit_terms et
al.) and in 0092's other families (the AE/EG/JO placeholders, the PIT
brackets, the EOSB tiers — all fail closed, all seeded by the onboarding
path) — **RECORDED for the owner as a platform-level finding; NOT redesigned
in this wave.**

## ITEM 3 — PHASE-045 STATUS RECONCILIATION

The acceptance is NOT in question: the owner's dispatch (2026-11-16), verbatim
— "PHASE-045 is ACCEPTED and CLOSED at content head 248039e / delivery head
d74edaa" — acknowledged. Actions landed:

- `PHASE-045.md`'s header flipped to **ACCEPTED & CLOSED**, citing the
  acceptance dispatch verbatim (the docs' contradiction the auditor found is
  reconciled);
- The owner's re-affirmation recorded in the closure record (PHASE-045.md §8
  + the IMPLEMENTATION_STATUS row): *"PHASE-045 closure re-affirmed by the
  owner 2026-11-16, with the note that duel (12)'s vacuous pass — discovered
  in the e6f7cfe hardening — was replaced by a truthful proof while the
  cell-gate law stayed pinned by the post-window legs; the final state is
  strictly stronger than the accepted state. No reopen."* The acceptance
  history now documents the vacuous-pass replacement explicitly (the
  anyLockWaiter-era proof vs the bound proof);
- `IMPLEMENTATION_STATUS.md`'s header line (still carrying the stale
  "REOPENED… awaiting re-review" text) reconciled with the accepted state.

## ITEM 4 — THE W-1 EVIDENCE DOC'S SCOPE, LABELED

The W-1 gate doc's evidence section now carries the explicit scope label:
**"TARGETED suites at `cc2f2f3` — the isolation/entitlements/tenancy group
1,642 · the hr/payroll/spoof/identity-flows group 178 · migrations 7/7 · api
unit 626. THE FULL DB SUITE RUNS AT THE W-7 FINAL HEAD per the plan — no
full-suite-at-cc2f2f3 claim exists or may be implied."** (The full-suite
greens on record: W-0 at `d74edaa` 240/240 · 3,329/3,329 and the
pinned-notes wave at `e6f7cfe` 240/240 · 3,333/3,333 — each its own head.)

## The gates (this environment, this session — the fix-wave head)

| Gate | Result |
|---|---|
| `pnpm typecheck` / `pnpm lint` | **8/8 packages** green |
| `pnpm lint:depcruise` | clean — 1,909 modules · 14,146 dependencies |
| `pnpm --filter @erp/api test` (unit) | **626/626** (the first attempt's one red file = the known chromium-headless-shell-1248 env-prep gap, re-run green after `playwright install chromium` — the W-0 record's pattern, not a regression) |
| `migrations.db.spec` | **7/7** — the **93-chain** applies from zero + re-applies no-op; the RLS/catalog checker clean at 288 |
| **The 0093 pre-state verification** (one-off script, kept output) | the missed tenant materialized · the old-shape rows reclassified · the temporary policies dropped (0 remain) · schema_version 93 · the re-run idempotent · drizzle re-apply no-op |
| The race suite (STANDALONE) | **20/20** — `race-suite-standalone-20-20.log` |
| isolation + entitlements + tenancy-provisioning + migrations | **5 files · 1,642/1,642** — `db-affected-suites.log` |
| hr + payroll + identity-flows folders | **16 files · 123/123** — `hr-payroll-spoof-identity.log` (this wave's affected folder set; the W-1 group's extra identity files ride the 300-pin, untouched here) |
| `docs:validate` · `check:permissions-drift` · `validate:manifests` · `check:history-secrets` · `check:i18n-parity` · `check:capabilities-matrix` · `check:id-ledger` | 33/33 docs · 300 = 300 · 13/13 · 0 violations · parity 100% (6,007 = 6,007) · agree · 0 errors |

**Then W-2** — the engines, the taxonomy, the unit specs, exactly per the
plan. Standing: PHASE-043 and RISK-031/RISK-032 OPEN; §7(b) remains the
owner input for W-7/T-15; the SANED ceiling + the EOSB text remain the two
narrowed register items — NOT production approval.
