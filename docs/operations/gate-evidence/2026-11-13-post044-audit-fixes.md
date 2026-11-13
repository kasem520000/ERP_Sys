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

## 6. RUN — the ID-ledger collision check (audit fix 4, 2026-11-13)

| # | Command | Result |
|---|---|---|
| 6.1 | `pnpm exec tsx scripts/check-id-ledger.ts --self-test` | **0 errors, 0 warnings — OK**. Self-test: (1) the conflicting claim (PHASE-043 claiming G-50/G-51, reserved for PHASE-045) **DETECTED**; (2) the legitimate reference (PHASE-046 referencing the implemented G-13/G-14) **PASSED**; (3) the shorthand ranges `BR-068…070` and `G-47…G-50` both expand correctly. Parsed: implemented G 46 (the split canon: ACCOUNTING_TESTS §3 G-01…G-20 + JOURNAL_RULES §7 G-21…G-46) · INV 29 · BR 77; reservations 21 phases / 79 ids; 68 phase docs scanned (77 claim ids, 2,486 reference ids). |
| 6.2 | `pnpm exec eslint scripts/check-id-ledger.ts` | **0 problems** |
| 6.3 | The FIRST checker run (before the phase-doc re-coordination) | **40 unique failures** — the stale claims (043's G-44…G-46/INV-028/BR-061…063; 045's G-51/G-52/INV-030/BR-068…070; 046's G-53…G-55/INV-031/BR-071…073; 047's BR-057…060; 048's G-56…G-59/INV-032/BR-061…065; 049's G-60…G-62/INV-033/BR-066…069; 050's G-63/G-64/INV-034/BR-070…073; 051's G-65…G-67/INV-035/BR-074…077; plus the 052–064 invariant/golden shifts) — every one re-coordinated onto the ID_LEDGER §2 ladder, then the check went green (6.1). |
| 6.4 | `pnpm check:id-ledger` wired into `scripts/ci/local-gate.sh` (after permissions-drift) | The standing gate now runs the collision check on every local gate pass. |

## 7. RUN — the 035-era isolation re-run (the legacy-contradiction sweep, audit fix 5)

The auditor's legacy-contradiction list named phases 035/036 (the undecodable
"ترويستا" term — see §8), the payments-ready phrase, and PHASE-042.md:144. The
035/036 evidence chain was swept: every count claim in the two reports was
re-derived against the tree structure; ONE contradiction was found and
re-run-verified:

| # | Command | Result |
|---|---|---|
| 7.1 | The 035-era suites, historically: `git worktree add … e84003a` (the "PHASE-035 code" commit), workspace install, `pnpm exec vitest run --config vitest.db.config.ts src/__db__/isolation/` inside the worktree (its own embedded PG16 + its own migration chain) | **1086 passed (1086)** — exit 0 (identity-isolation 178 tables × 6 + 6 fixed = 1,074, platform-isolation 12). The 035 report's announced **1,095/1,095 was a miscount** (off by 9); the derived fresh-chain-critical total 1,145 corrects to **1,136**. Both now carry errata notes in the report. |
| 7.2 | The 036 report's claims, structurally verified (no run needed — the report announces only deltas) | "+30 auto-generated" = 5 tables × 6 ✓ consistent; no total-count claim, no contradiction found. |
| 7.3 | PHASE-042.md:144 (the goldens/invariant/BR claim line) | Re-pinned to the implemented slots (G-40/G-41/G-42, INV-028, BR-068…071) with the as-implemented note — matching JOURNAL_RULES note 13 and the INV-028 canon row (the doc previously claimed the planned G-38/G-39/G-40, INV-027, BR-057…060). |
| 7.4 | The payments-ready phrase (COMPLETENESS_ROADMAP §2 Wave-1 gate + COMPLETENESS_REGISTER CR-38) | Corrected to the honest "payments path STAGED — the DR-002 production adapter ships with PHASE-056; the gate's payments leg is a staged path, not a delivered rail" (matching PHASE-041.md's own "staged for 056" wording and PHASE-056's scope). |

## 8. The undecodable term — reported honestly

The auditor's list contains one term that could not be decoded with certainty:
"ترويستا 035 و036". It matches no identifier, tenant, company, or artifact in
the repository (searched AR/EN, all docs and specs). The 035/036 evidence
chain was nevertheless swept end-to-end (§7.1/§7.2: the reports' counts,
deltas, and claims re-derived against the actual tree), the ONE material
contradiction found (the 1,095 miscount) was re-run-verified and corrected
with errata, and the 036 report came back clean. If the term names a specific
artifact the owner has in mind, the sweep is repeatable on request — nothing
in this wave was marked "done" on the strength of a guess.
