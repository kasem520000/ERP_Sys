# Gate Evidence — PHASE-044 Post-Closure Audit Fixes (2026-11-13)

> **Scope:** the evidence ledger for the post-closure audit-fix wave (the
> tracked-item backfill, the operator tool, the docs corrections, the ID
> ledger). Every row states WHAT WAS RUN (command + environment + result) vs
> what was INFERRED from reading the code. No secrets; no bulky outputs —
> the distilled lines that matter, re-runnable via the cited commands.

## 1. Environment

- Embedded PostgreSQL 16 (the suite's `global-setup.ts` boot; same major as
  the compose stack), migrations 0001–0073 applied by `drizzle-kit migrate`
  per run — unless a row states otherwise.
- Commands run from the repository root or `apps/api` as stated; Node 24,
  pnpm 9.15.9, the repo's locked workspace install.

## 2. RUN — the tracked-item backfill evidence (audit fix 1)

| # | Command (cwd `apps/api`) | Result |
|---|---|---|
| 2.1 | `pnpm exec vitest run --config vitest.db.config.ts src/__db__/inventory/wms-budgets-backfill.spec.ts src/__db__/inventory/wms-tracked-backfill.spec.ts` | **12/12 passed** (the T-20 original re-pinned + the 7 new audit-fix tests: dry-run no-write + classification, batch distribution + explicit-batch and FEFO spends, serial distribution + named-unit spend, residue stays in the probe, idempotent re-run, concurrent convergence, the audit counts) |
| 2.2 | `pnpm exec vitest run --config vitest.db.config.ts src/__db__/inventory/wms-core.spec.ts src/__db__/inventory/wms-inv029.spec.ts` | **17/17 passed** (the surrounding corpus unaffected) |
| 2.3 | `pnpm exec tsc --noEmit -p tsconfig.json` | **0 errors** (incl. the rewritten script) |
| 2.4 | `env -u DATABASE_URL pnpm exec tsx scripts/backfill-bins.ts --dry-run` | **exit 1** with the runbook §2 pointer (the fail-fast contract) |

## 3. RUN — the isolation baseline verification (audit fix 3)

The audit's contradiction: the 042 report announced **1,332/1,332** while the
registry history shows 219 tables and the suite structure suggests
219 × 6 + 6 = **1,320**. Both sides were RE-RUN, not inferred:

| # | Command | Result |
|---|---|---|
| 3.1 | Current tree (`apps/api`): `pnpm exec vitest run --config vitest.db.config.ts src/__db__/isolation/identity-isolation.db.spec.ts` | **1452 passed (1452)** — exit 0. Structure: 241 registry tables × 6 generated `it()` blocks (A1 · A2 · A3 · A4/A7 · A5 · A8/A9/A10) + 6 fixed tests (2 registry-completeness + 1 structural + 2 template-guards + A6) = 1,452. |
| 3.2 | The HISTORICAL 042-era suite: `git worktree add … e175987` (the "PHASE-042 implementation" commit), workspace install, then the same vitest invocation inside the worktree (its own embedded PG16 + its own 66-entry migration chain) | **1320 passed (1320)** — exit 0. Structure at that commit: 219 registry tables × 6 + 6 fixed = 1,320. |

**Conclusions (both run-verified):**
- The 042 baseline was **1,320**, not 1,332 — the 042 report's figure (and
  the T-02 commit message's "A-suite 1,332→1,464") was a miscount; both
  documents are corrected with errata notes in this wave.
- The 044 delta is **+132 = 22 tables × 6 generated tests** (NOT "the 22
  tables × the 10 attacks" — the A1–A10 attack classes are packed into SIX
  generated `it()` blocks per table); 1,320 + 132 = 1,452 ✓ consistent.
- The announced current figures **1,452 (isolation) stand as run**; the
  full-suite 2,979 figure was NOT re-run in this wave's environment within
  the sandbox time budget (§5 records the honest limitation — the changed
  specs and the isolation suite were; the per-suite runs above are the
  run-verified subset).

## 4. INFERRED (code-reading, no run) — the structural counts

- The "+132 = 22 × 6" decomposition and the fixed-test count were derived
  from reading `identity-isolation.db.spec.ts`'s generation loop + registry
  BEFORE the runs; the runs in §3 then confirmed them (the derivation is
  documented here because the auditor asked for the distinction).
- The 041-era registry count (212 tables → 1,278 tests) is INFERRED from
  `git show e68ab59:…tables.registry.ts` + the same structure math; it was
  NOT re-run (no 041-era baseline dispute is open).

## 5. Not run in this wave (honest limitations)

- The FULL 202-file DB suite (2,979 tests) — the sandbox's per-command time
  budget; the wave's changed specs (§2), the isolation suite (§3), and the
  historical re-run were. The 2,979 figure remains the phase-closure
  announcement, not re-proven here.
- Browser-level Playwright assertions — out of scope for this wave (no web
  surface changed).
