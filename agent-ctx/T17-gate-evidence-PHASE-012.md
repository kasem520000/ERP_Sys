# T17 — PHASE-012 gate evidence worklog

> Run date: 2026-10-31 · Command: `pnpm gate:local` (17 steps) · Final exit
> code: **0** · Transcript: 2,660 lines (excerpted below verbatim).

## Step-by-step transcript (verbatim excerpts)

```
=== typecheck ===
 Tasks:    5 successful, 5 total            (turbo, exit 0)

=== lint (incl. module boundaries) ===
 Tasks:    5 successful, 5 total            (exit 0; one ADR-0009
                                            no-restricted-properties error in
                                            credit-notes.ts caught + fixed
                                            in-phase before this run)

=== lint:depcruise (dependency graph rules) ===
✔ no dependency violations found (1234 modules, 4416 dependencies cruised)

=== permissions docs-drift (seed ↔ AUTHORIZATION_MATRIX) ===
[permissions-drift] OK — matrix 199 keys, seed 199 keys

=== unit + property tests ===
@erp/api:test:        Test Files  15 passed (15)   Tests  92 passed (92)
@erp/contracts:test:  Test Files  1 passed (1)     Tests  11 passed (11)
@erp/domain-core:test:Test Files  6 passed (6)     Tests  38 passed (38)
@erp/ui:test:         Test Files  3 passed (3)     Tests  42 passed (42)

=== db suite (embedded PostgreSQL 16: RLS attacks, identity flows, jobs, files, readiness) ===
@erp/api:test:db:  Test Files  57 passed (57)
@erp/api:test:db:       Tests  1044 passed (1044)
   (includes the 27 sales tests — golden 10/10 + operations 17/17 — and the
    generated isolation A1–A10 suite over the 13 newly registered tables)

=== build ===
 Tasks:    5 successful, 5 total            (exit 0)

=== design-token contrast gate (§16) ===
 all §16 pairs pass the AA floor.

=== i18n key parity + negative proof ===
== i18n key parity: ar=1465 keys, en=1465 keys ==
ar/en catalogs at 100% key parity; no empty values.

=== ui catalog coverage (export ↔ row) ===
== ui catalog coverage: 37 component exports ↔ 60 catalog rows ==
export↔row parity green.

=== design-system harness (storybook → visual/axe/coverage → perf) ===
  16 passed (1.5m)      (visual/axe/coverage suites)
   1 passed (34.8s)     (10,000-row perf: floor=16.56ms table=17.50ms
                         overhead=0.93ms interleaved best-of-3)

=== web secure-headers/CSP probe (§8) ===
  4 passed (2.0s)       (headers set, nonce rotation, no third-party assets,
                         nonce'd scripts execute)

=== docs validation (29 checks) ===
 29/29 checks passed.

=== negative boundary meta-test ===
PASS: ESLint exited 1 on the violating fixture (expected failure).
      Boundary enforcement is active (DEPENDENCY_RULES.md §3).

=== negative erp-ui lint meta-test ===
NEGATIVE-UI-RULES: all four rules fail their fixtures (proof complete)

=== i18n key parity (ar/en) ===
== i18n key parity: ar=1465 keys, en=1465 keys ==

=== negative i18n parity meta-test ===
NEGATIVE-I18N: parity checker fails its drifting fixture (proof complete)

=== ALL LOCAL GATES GREEN ===
```

Confirmation run exit code (re-executed end-to-end after the transcript run):

```
FINAL_GATE_EXIT_CODE=0
```

## Scope-guard grep proofs (PHASE-012 §8: "grep-clean proof that no
commission/POS code was added")

```
$ grep -rn "commission" apps/api/src/modules/sales/ \
    "apps/web/app/[locale]/sales/" apps/web/components/sales-*.tsx
apps/api/src/modules/sales/application/reps.ts:13: * surface. Commissions are explicitly PHASE-017 scope — NO commission
apps/api/src/modules/sales/sales.module.ts:30: * the invoice.overdue exactly-once job; rep attribution (commissions are
→ 2 comment hits only (deferred-scope pointers); ZERO computation code — no
  commission rate fields, no statements, no calculation paths.

$ grep -rn "offline_receipt_no" apps/api/src/modules/sales/ apps/api/src/db/schema.ts
apps/api/src/db/schema.ts:2939:    offlineReceiptNo: text("offline_receipt_no"),
→ only the schema column (+ the migration comment); no route reads or
  writes it — the POS reservation holds.
```

## Reality-audit finding (documented, not silenced)

While re-verifying the PHASE-011 baseline before running this gate, the
`@erp/ui` navigation unit test (`behavior.test.ts` — "renders everything when
entitled…") was found stale at tag `phase/011`: the expected group list
pre-dated the PHASE-011 purchasing nav group, so the committed `pnpm test`
step could not have been green at that tag (the PHASE-011 evidence's unit-test
step was inaccurate). Resolution: the test now asserts the full shipped set
(home, sales, purchasing, inventory, accounting, treasury, reports, partners,
settings) and this phase's gate runs it green (42/42 @erp/ui). Recorded here
per the protocol's documentation-vs-reality reconciliation rule; no silent
side-picking.
