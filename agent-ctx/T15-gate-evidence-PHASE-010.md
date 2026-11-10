# PHASE-010 — gate:local evidence (worklog)

> Recorded 2026-10-30. Sandbox note: this environment reaps long-lived detached
> processes, so the full `bash scripts/ci/local-gate.sh` wrapper was completed in the
> foreground; each step was ALSO run individually (same command sequence, same order as
> the script) with the real outputs below. Final wrapper run: ALL LOCAL GATES GREEN.

## Individual steps (same order as scripts/ci/local-gate.sh)

```
$ pnpm typecheck
  Tasks: 5 successful, 5 total → exit 0

$ pnpm lint
  Tasks: 5 successful, 5 total → exit 0

$ pnpm lint:depcruise
  ✔ no dependency violations found (1066 modules, 3714 dependencies cruised) → exit 0

$ pnpm check:permissions-drift
  [permissions-drift] OK — matrix 199 keys, seed 199 keys → exit 0

$ pnpm test            # unit + property
  Tasks: 4 successful, 4 total → exit 0
  (api unit: 15 files / 92 tests — incl. the 12-test inventory valuation property suite)

$ pnpm test:db         # full db suite on embedded PostgreSQL 16
  Test Files  50 passed (50)
       Tests  814 passed (814) → exit 0
  (migrations 0001–0015 applied at setup; two consecutive clean full runs;
   the inventory suite: 8 files / 37 tests green)

$ pnpm build
  Tasks: 5 successful, 5 total → exit 0   (web compiled successfully)

$ pnpm check:token-contrast
  all §16 pairs pass the AA floor. → exit 0

$ pnpm check:i18n-parity
  ar=1231 keys, en=1231 keys — 100% parity; no empty values. → exit 0

$ pnpm check:ui-catalog
  ui catalog coverage: 37 component exports ↔ 60 catalog rows — parity green. → exit 0

$ pnpm test:visual-harness-run
  storybook build + visual (threshold-0) + axe (0 violations) + coverage + perf → exit 0
  perf: floor=16.56ms table=17.23ms overhead=0.67ms (interleaved best-of-3)

$ pnpm test:web-security
  4 passed — §8 header set, per-request nonce rotation, no third-party assets,
  nonce'd scripts execute (CSP not breaking the app) → exit 0

$ pnpm docs:validate
  29/29 checks passed → exit 0

$ pnpm boundary:negative-test
  PASS: ESLint exited 1 on the violating fixture (expected failure).
  Boundary enforcement is active. → exit 0

$ bash scripts/ci/negative-ui-rules-test.sh
  NEGATIVE-UI-RULES: all four rules fail their fixtures (proof complete) → exit 0

$ pnpm boundary:negative-i18n-test
  NEGATIVE-I18N: parity checker fails its drifting fixture (proof complete) → exit 0
```

## Full wrapper run

The first complete foreground wrapper run reached docs validation and failed ONLY on
the not-yet-written completion-report links (1a: 2 broken — NEXT_ACTION +
IMPLEMENTATION pointing at PHASE-010-COMPLETION.md before this report existed). After
writing the report (and fixing its own three-up relative links), the wrapper re-run
completed end-to-end:

```
$ bash scripts/ci/local-gate.sh
=== typecheck ===
=== lint (incl. module boundaries) ===
=== lint:depcruise (dependency graph rules) ===
=== permissions docs-drift (seed ↔ AUTHORIZATION_MATRIX) ===
=== unit + property tests ===
=== db suite (embedded PostgreSQL 16: RLS attacks, identity flows, jobs, files, readiness) ===
   Test Files 50 passed (50) · Tests 814 passed (814)
=== build ===
=== design-token contrast gate (§16) ===
=== i18n key parity + negative proof ===
=== ui catalog coverage (export ↔ row) ===
=== design-system harness (storybook → visual/axe/coverage → perf) ===
=== web secure-headers/CSP probe (§8) ===
=== docs validation (29 checks) === 29/29 PASS
=== negative boundary meta-test ===
=== negative erp-ui lint meta-test ===
=== i18n key parity (ar/en) ===
=== negative i18n parity meta-test ===

=== ALL LOCAL GATES GREEN ===
exit 0
```

## db-suite stability note (recorded honestly)

During development the full db suite surfaced two file-order dependencies inside the
inventory suite, both fixed and re-verified:
1. `golden.spec` created the `MAIN-WH2` warehouse blind where `recon.spec` creates it
   idempotently — creation is now find-first in both (order-independent).
2. The T-01 perf smoke left its 100k seeded (unjournaled, superuser-tooling) moves in
   tenant I; their as-of-truncated IN/OUT parity nets non-zero, poisoning every later
   INV-010 check, the PC-04 lock gate, and exact-balance assertions in whichever file
   order vitest picked. The smoke now removes the seeded moves/stock/items after its
   measurements (the same documented trigger-disable tooling RC-05's repair uses) and
   re-ANALYZEs — verified by the previously-failing `operations.spec → golden.spec`
   pair and two consecutive clean full runs (814/814 twice).
