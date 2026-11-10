# Regression Strategy

> **Status:** STABLE · **Owner:** Quality Engineering · **Updated:** 2026-10-27

How the platform proves that changes did not break what already worked: golden-dataset
regression packs, migration regression, visual regression (both directions), the
release-candidate checklist, the bug-fix regression policy, docs-drift checks, flaky
quarantine, and the regression budget rule for releases. Gates ride on
[../planning/RELEASE_STRATEGY.md](../planning/RELEASE_STRATEGY.md) quality gates; suites
live in [TEST_STRATEGY.md](TEST_STRATEGY.md) (architecture),
[ACCOUNTING_TESTS.md](ACCOUNTING_TESTS.md) (financial core),
[SYNC_TESTS.md](SYNC_TESTS.md) (offline), [TENANT_ISOLATION_TESTS.md](TENANT_ISOLATION_TESTS.md)
(isolation).

## 1. Regression model (what "not broken" means here)

| Surface | Regression proof | Owner suite |
|---------|------------------|-------------|
| Ledger math | Golden posting outputs identical for identical inputs + invariants green | [ACCOUNTING_TESTS.md](ACCOUNTING_TESTS.md) §2–3 |
| Statements & reports | Report outputs byte-stable against golden datasets | §2 below |
| Tax per country | Pack fixtures produce identical tax summaries/VAT returns | §2 |
| Schema & data | Migrations apply cleanly on yesterday's snapshot; invariant smoke after | §3 |
| UI (AR/EN) | Visual snapshots both directions + a11y regressions | §4 |
| Offline behavior | Chaos matrix green | [SYNC_TESTS.md](SYNC_TESTS.md) |
| Isolation | A1–A11 + catalog assertions green | [TENANT_ISOLATION_TESTS.md](TENANT_ISOLATION_TESTS.md) |
| Docs ↔ implementation | Catalog/seed/matrix drift checks | §6 |

## 2. Golden-dataset regression packs

- **Accounting pack**: the seeded golden dataset
  ([TEST_STRATEGY.md](TEST_STRATEGY.md) §5) runs through the posting pipeline; expected
  outputs are **byte-stable**: journal lines (serialized in a canonical form: sorted by
  entry, then line no.), GL balances, partner/item subledger states, and the resulting
  statements (trial balance, income statement, balance sheet per period). Any diff — even
  a "harmless" amount reordering — fails the pack and demands an explicit, reviewed
  expectation update.
- **Report-output pack**: every report contract
  ([../reporting/REPORT_CATALOG.md](../reporting/REPORT_CATALOG.md) at implementation)
  runs against the golden dataset in AR and EN; expected render files (PDF text layer,
  XLSX cell grid, CSV) are committed artifacts. Print-template changes are the most
  common intentional diffs; the PR must show the visual delta in both languages.
- **Tax packs per country**: one pack per jurisdiction (SA 15%, EG 14%, AE 5%, zero-rated,
  no-VAT) — same canonical document set produces expected tax summaries and VAT-return
  numbers. A rate change (RISK-006) lands as a **new pack version with new effective
  dates** — old-period outputs must NOT change (immutability); the pack tests assert
  both: old dates → old rates, new dates → new rates.
- **Expectation updates are reviewed artifacts**: updating a golden expectation requires
  the PR to justify WHY behavior legitimately changed (link to decision record or ticket);
  "update the numbers so it passes" is a code-review blocker.

## 3. Migration regression

1. **Apply-on-snapshot**: every migration PR applies the full chain onto a dump of the
   previous released schema (with data) in CI; asserts: no destructive failure, RLS
   policies + composite FKs on new tables, `pg_policies` catalog assertions
   ([../database/MIGRATION_STRATEGY.md](../database/MIGRATION_STRATEGY.md) §2).
2. **Invariant smoke after migration**: the accounting invariant suite (fast subset:
   INV-001/002/003/011/013) + reconciliation jobs run against the migrated data; drift
   introduced by a migration is a release blocker (RISK-009).
3. **Staging rehearsal**: the release gate rehearsal
   ([../planning/RELEASE_STRATEGY.md](../planning/RELEASE_STRATEGY.md)) records migration
   duration + lock observations — a migration 3× slower than rehearsal on prod-sized data
   triggers investigation before deploy.
4. **Expand-contract discipline check**: contract steps annotated `-- CONTRACT:` are
   verified to run only after their grace release; CI enforces the config gate.

## 4. Visual regression (both directions)

- Snapshot suites run AR (RTL) and EN (LTR) for every page archetype + print templates;
  harness and thresholds: [../ui/VISUAL_TESTING.md](../ui/VISUAL_TESTING.md).
- **Both-directions rule**: a PR that only updates EN baselines fails; Arabic snapshots
  are first-class (RISK-015: Hijri/numeral/bidi regressions are exactly what this catches).
- Baseline updates are explicit PR actions with human review of the rendered diff gallery
  — never automatic on CI "flakiness".

## 5. Bug-fix policy (regression test per ticket)

1. **Every fixed bug gets a regression test named after the ticket**: e.g.
   `regression/BUG-2026-0417-receipt-fx-gain-lost.spec.ts` — asserting the original
   reproduction fails on the old code and passes on the fix.
2. The test lives in the suite matching the surface (accounting/sync/isolation/UI) so it
   participates in all future runs — not in a "fixed bugs" ghetto folder.
3. Incident-driven fixes follow [../security/INCIDENT_RESPONSE.md](../security/INCIDENT_RESPONSE.md)
   §8 action items and RISK-009/010/011 discipline: the postmortem action item is closed
   only when the named regression is merged and green.
4. Bugs found by pen test / hardening (PHASE-024) additionally require retest proof
   ([../security/SECURITY_TEST_PLAN.md](../security/SECURITY_TEST_PLAN.md) §13).

## 6. Docs-drift checks (CI-enforced)

| Check | Compares | Fails when |
|-------|----------|------------|
| Schema catalog | `pg_catalog`/Drizzle schema of a fresh migrated DB vs. [../database/ENTITY_CATALOG.md](../database/ENTITY_CATALOG.md) + TABLES specs | new/changed table or column missing from docs (stubs tolerated with explicit TODO marker per phase plan — silent divergence is not) |
| Permissions seed | `permissions` table seed vs. [../security/AUTHORIZATION_MATRIX.md](../security/AUTHORIZATION_MATRIX.md) catalog | permission key exists on one side only; risky flag mismatch |
| Route ↔ contract | route registry vs. `packages/contracts` + matrix permission annotations | route without contract test or permission test (generated checklist gap) |
| Invariant mapping | test files matching `INV-xxx` vs. [../accounting/ACCOUNTING_INVARIANTS.md](../accounting/ACCOUNTING_INVARIANTS.md) | invariant without suite, or suite referencing a removed invariant |
| Sync chaos ↔ protocol | scenario catalog ([SYNC_TESTS.md](SYNC_TESTS.md) §2) vs. [../offline/SYNC_PROTOCOL.md](../offline/SYNC_PROTOCOL.md) rules | protocol behavior without a scenario |
| Link/heading validation | all markdown (the `scripts/validate-docs.py` from PHASE-001) | broken links, missing phase headings |

These checks implement the README sync rule and directive §8 (never mark docs complete
without checking against implemented structures).

## 7. Known-flaky quarantine process

Quarantine rules are defined in [TEST_STRATEGY.md](TEST_STRATEGY.md) §7 (same-day
quarantine, ticket, one-week fix window, never delete). Regression-specific additions:

1. A quarantined regression pack is treated as **absent coverage** for release decisions —
   the RC checklist (§8) shows it as a red/absent row, requiring explicit RC sign-off.
2. Quarantine age > 1 week escalates in the phase review; > 2 weeks blocks the next
   release of the affected module.
3. Re-admission requires 3 consecutive green runs on main + reviewer approval.

## 8. Release-candidate regression checklist

Per [../planning/RELEASE_STRATEGY.md](../planning/RELEASE_STRATEGY.md) quality gates, an
RC is regression-complete only when every row is green or explicitly waived (§9):

| # | Check | Evidence |
|---|-------|----------|
| 1 | CI green: unit + integration + contract + invariants + isolation + chaos | CI run permalink |
| 2 | Golden packs (accounting/report/tax per pack) byte-stable or justified-diff | pack diff report |
| 3 | Migration rehearsal on staging succeeded + invariant smoke | rehearsal record |
| 4 | Visual regression AR+EN baselines reviewed | diff gallery link |
| 5 | E2E bilingual journeys green (nightly + RC run) | run permalink |
| 6 | Performance smoke vs NFR-006 budgets | [PERFORMANCE_TEST_PLAN.md](PERFORMANCE_TEST_PLAN.md) report |
| 7 | Security gates: audit/SAST/gitleaks + new-endpoint permission review | [../security/SECURITY_TEST_PLAN.md](../security/SECURITY_TEST_PLAN.md) evidence |
| 8 | Docs-drift checks green (§6) | CI job output |
| 9 | Open-regression ledger: every bug-fix regression merged for tickets in the release | ticket list cross-ref |
| 10 | Previous release's waived items re-verified or re-waived | decision records |

## 9. The regression budget rule

1. **A release ships with zero NEW regression failures.** A "new failure" is any pack,
   suite, or checklist row that was green on the previous release tag and is red now.
2. Existing known failures (with tickets) don't count against the budget, but the count
   must be trending down between releases.
3. **Waivers** are exceptional and only valid via a **decision record** under
   [../decisions/](../decisions/README.md) naming: the failing check, the business
   justification, the compensating control, the expiry (max one release), and the owner.
   A waiver expires automatically — re-waiving the same item twice requires product-owner
   sign-off.
4. Emergency hotfixes (SEV-1/2) may ship with one waived row max, post-annotated with the
   decision record within 24 h, and the waived row returns to the top of the next RC.

## 10. Maintenance protocol

1. New golden pack rows: any new posting rule (ACCOUNTING_TESTS.md §3), report, or
   jurisdiction pack adds its pack entry in the same phase.
2. Retired behavior: expectations are archived (git history is the archive), never edited
   in place without the justification note (§2).
3. Quarterly audit: quarantine age, waiver count, drift-check findings, and golden-pack
   update frequency (a pack updated every PR signals churn worth investigating).
