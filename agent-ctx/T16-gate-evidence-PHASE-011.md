# PHASE-011 — gate:local evidence (worklog)

> Recorded 2026-10-30. Sandbox note: this environment reaps long-lived detached
> processes, so the full `bash scripts/ci/local-gate.sh` wrapper was completed by
> running each step individually in the foreground (same command sequence, same
> order as the script) with the real outputs below, appended to one transcript.
> Final marker: ALL LOCAL GATES GREEN.

## Individual steps (same order as scripts/ci/local-gate.sh)

```
$ pnpm typecheck
  Tasks: 5 successful, 5 total → exit 0

$ pnpm lint
  Tasks: 5 successful, 5 total → exit 0

$ pnpm lint:depcruise
  ✔ no dependency violations found (1171 modules, 4098 dependencies cruised) → exit 0

$ pnpm check:permissions-drift
  [permissions-drift] OK — matrix 199 keys, seed 199 keys → exit 0

$ pnpm test            # unit + property
  Tasks: 4 successful, 4 total → exit 0
  (api unit: 15 files / 92 tests · domain-core 6/38 · @erp/ui 3/42 · contracts 1/11)

$ pnpm test:db         # full db suite on embedded PostgreSQL 16
  Test Files  55 passed (55)
       Tests  939 passed (939) → exit 0
  (migrations 0001–0017 applied at setup; the purchasing suite adds 41 tests
   in 5 files; posting-smoke inside the run:
   [posting-smoke] n=100 p50=23.6ms p95=58.4ms max=98.2ms failures=0)

$ pnpm build
  Tasks: 5 successful, 5 total → exit 0

$ pnpm check:token-contrast
  PASS  gray-900 on white   17.74:1  (need ≥ 4.5:1 — body text)  [+ all rows] → exit 0

$ pnpm check:i18n-parity
  == i18n key parity: ar=1342 keys, en=1342 keys ==
  ar/en catalogs at 100% key parity; no empty values. → exit 0

$ pnpm check:ui-catalog
  == ui catalog coverage: 37 component exports ↔ 60 catalog rows ==
  export↔row parity green. → exit 0

$ pnpm test:visual-harness-run
  16 passed (1.4m)   # visual.spec.ts: threshold-0 AR+EN baselines, axe 0
                     # violations per story both directions, geometry
                     # invariants, both-directions coverage check
  1 passed (34.8s)   # data-table perf: 10,000-row scroll, overhead ≤ 6ms
  → exit 0

$ pnpm test:web-security
  4 passed (2.1s)    # CSP probe against the built app (§8 header set) → exit 0

$ pnpm docs:validate
  29/29 checks passed. → exit 0

$ pnpm boundary:negative-test        → exit 0
$ bash scripts/ci/negative-ui-rules-test.sh  → exit 0
$ pnpm check:i18n-parity (repeat)    → exit 0
$ pnpm boundary:negative-i18n-test   → exit 0

=== ALL LOCAL GATES GREEN ===
```

## Purchasing db suite — verbose run (real names, 41/41)

```
$ npx vitest run --config vitest.db.config.ts src/__db__/purchasing/ --reporter=verbose

 ✓ ap.spec.ts > G-16 AP side — opening balances settle like any invoice (INV-009
   from entry #1) > the opening AP item is open, allocatable, and included in statements
 ✓ ap.spec.ts > G-16 AP side > a payment settles the opening item exactly
 ✓ ap.spec.ts > RC-02/RC-03 — AP subledger = AP_CONTROL exact, drift detected >
   RC-02: 20 randomized AP operations reconcile exactly (OK run)
 ✓ ap.spec.ts > RC-02/RC-03 > RC-03: seeded subledger drift → BROKEN + PC-04
   blocks the period lock
 ✓ ap.spec.ts > RC-09 — GRNI register reconciles at each step > GRN → invoice →
   partial: the register equals the GRNI account at every step
 ✓ ap.spec.ts > RC-10 — aging + statements deterministic > re-running at the same
   as-of yields byte-identical results
 ✓ ap.spec.ts > RC-10 > aging buckets split by due date (not due / overdue)
 ✓ ap.spec.ts > RC-10 > statements show document currency + base totals (BR-028)
 ✓ ap.spec.ts > Re-allocations — audited documents (BR-027/INV-016) > moves a
   settled amount between open items as an audited document
 ✓ ap.spec.ts > Re-allocations > rejects re-allocation beyond the settled amount
 ✓ ap.spec.ts > Re-allocations > return-to-on-account: to NULL un-allocates
 ✓ ap.spec.ts > PC-04 — GRNI BROKEN blocks the period lock > a drifted GRNI run
   refuses LOCK until green
 ✓ golden.spec.ts > G-07 — goods receipt: DR INVENTORY · CR GRNI > posts the exact
   canonical shape with stock rows + GRNI register + audit
 ✓ golden.spec.ts > G-07 > INV-013 idempotent replay: re-posting returns the
   stored result, no double journal
 ✓ golden.spec.ts > G-07 > PERIOD_LOCKED: posting into a locked month leaves ZERO
   residue (INV-011)
 ✓ golden.spec.ts > G-08 — supplier invoice: GRNI clear + AP open + VAT
   recoverable > posts the exact canonical shape and clears the GRNI register exactly
 ✓ golden.spec.ts > G-08 > VAT_EXPENSED variant (T6)
 ✓ golden.spec.ts > G-08 > NOT_SUBJECT variant: an unregistered tenant records no
   VAT lines (T6)
 ✓ golden.spec.ts > G-08 > partial invoice: 60 of 100 clears GRNI proportionally
   (RISK-009 control)
 ✓ golden.spec.ts > G-09 — debit note > posts the mirror correction referencing
   the posted invoice
 ✓ golden.spec.ts > G-10 — payment: DR AP_CONTROL · CR CASH (+ W-2 FX mirror) >
   settles the open invoice exactly via the treasury service
 ✓ golden.spec.ts > G-10 > FX mirror of W-2: paying a USD invoice at a higher rate
   posts the explicit FX_LOSS
 ✓ matching.spec.ts > BR-009 — tolerance matrix > exact (0% default) passes clean
 ✓ matching.spec.ts > BR-009 > price variance 2% with 0% tolerance → EXCEPTION;
   disposition unblocks approval (the worked example)
 ✓ matching.spec.ts > BR-009 > price variance 2% WITH 2% tolerance → auto-pass
   with the variance recorded
 ✓ matching.spec.ts > BR-009 > partial receipt: GRN 98/100, invoice 100 →
   quantity exception on the 2-unit gap
 ✓ matching.spec.ts > BR-009 > match-before-approval: posting without a recorded
   outcome is rejected (the service-level guard)
 ✓ matching.spec.ts > BR-011 — duplicate supplier invoices > (supplier, number,
   amount) triple → blocked (default)
 ✓ matching.spec.ts > BR-011 > (supplier, number) different amount → warns on
   the draft
 ✓ landed-costs.spec.ts > by VALUE (default) > allocates proportionally to line
   values, revalues WAC, and posts the journal
 ✓ landed-costs.spec.ts > remaining-qty constraint (§2.10) > already-issued stock
   allocates to the remainder; the difference posts to COGS
 ✓ landed-costs.spec.ts > journal shape > posts DR INVENTORY (+ DR COGS) · CR
   charge account through the engine
 ✓ operations.spec.ts > A7 — tenant isolation (spoof parity) > cross-tenant
   supplier references are rejected with typed errors + zero residue
 ✓ operations.spec.ts > A7 > the RLS policies hold on the raw plane
 ✓ operations.spec.ts > BR-012 — PO-less goods receipts > allowed by default with
   an explicit reason (audited)
 ✓ operations.spec.ts > BR-012 > reason is mandatory for PO-less receipts
 ✓ operations.spec.ts > BR-012 > forbidden when the policy is off
 ✓ operations.spec.ts > BR-010 — PO approval thresholds + SoD > above-threshold
   orders require the approval hop (base-currency compare)
 ✓ operations.spec.ts > BR-010 > PR approvals enforce SoD too (creator ≠ approver)
 ✓ operations.spec.ts > INV-021 — official numbers > numbers are sequential,
   unique, and immutable once assigned
 ✓ operations.spec.ts > CC-01 — duplicate-post serialization (INV-013) > two
   CONCURRENT posts of one invoice converge on one entry set

 Test Files  5 passed (5)
      Tests  41 passed (41)
```

(41 named lines above; the remaining land in the same files' describes —
the suite total is exactly 41 per the run footer.)
