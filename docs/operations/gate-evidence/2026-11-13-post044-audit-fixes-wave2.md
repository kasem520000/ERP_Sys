# Gate Evidence — PHASE-044 Post-Closure Audit Fixes, Wave 2 (2026-11-13)

> **Scope:** the evidence ledger for the second post-closure audit-fix wave
> (the owner's review of the five-commit wave at head `6f44ee4`): the
> migration-vs-movement race (the review's top priority), the serial
> location-proof strictness, the partial-migration vs binless-grace
> consequence, the ID-checker honesty fixes, the renumbering-regression doc
> corrections, and the re-evaluation of the prior wave's email-flake and
> p95-environmental claims. Every row states WHAT WAS RUN (command +
> environment + result) vs what was INFERRED from reading the code. No
> secrets; no bulky outputs — the distilled lines that matter, re-runnable
> via the cited commands.
>
> **Commits:** `b1e29c5` (the race + strictness + runbook) · `77d0d7d`
> (the checker + the doc corrections) · this wave's remaining commits carry
> the evidence-ledger, gates and the CHANGELOG.

## 1. Environment

- Embedded PostgreSQL 16 (the suite's `global-setup.ts` boot), migrations
  0001–0073 applied by `drizzle-kit migrate` per run — unless a row states
  otherwise. Commands run from the repository root or `apps/api` as stated;
  Node 24, pnpm 9.15.9, the repo's locked workspace install.
- CPU class (the p95 rows' context): 2 vCPU Intel Xeon — the same sandbox
  class the prior wave's §5 batched run measured on.

## 2. RUN — the migration-vs-movement race (the review's top priority)

The advisory backfill lock only serialized backfill-vs-backfill; movements
serialize on the `item_stock` row lock. Both failure shapes were REPRODUCED
on the pre-fix code, then fixed, then re-proven — every step run-verified:

| # | Command (cwd `apps/api`) | Result |
|---|---|---|
| 2.1 | `pnpm exec vitest run --config vitest.db.config.ts src/__db__/inventory/wms-backfill-races.spec.ts` (on the fix) | **5/5 passed** — the mid-pass ISSUE rendezvous (120-filler corpus, racing SKU sorts last: fold EXACT 25 == stock 25); the mid-pass RECEIPT rendezvous (200-filler corpus: fold EXACT 35 == stock 35, no spurious rollback, idempotent calm re-run); the deterministic gate rendezvous (a superuser-parked GATE lock sorts last canonically — the pass holds TARGET when it parks, a real `manualIssue` for TARGET queues on the pass's own row lock, and once unblocked its move row carries `source_bin_id` — the binned-path signature); the serial-proof strictness corpus; the partial-vs-binless corpus |
| 2.2 | The REGRESSION PROOF — `git stash push` of `wms.service.ts` + `wms-store.ts` (the pre-fix service), same vitest invocation, then `git stash pop` | **2 failed exactly as predicted**: the ISSUE race measured fold **30.000000 vs the asserted 25.000000** (the oversubscribed fold the stale `row.stockQty` shipped silently) and the proof-strictness test expected `[CLEAN, ZEROBIN]` but got **3 planned writes** (the netHere-2/netTotal-1 serial classified PROVEN — the pre-fix conditions did not enforce both == 1 — and the zero-qty-history serial skipped as "already binned"); the RECEIPT race initially passed on the pre-fix code (the single-item pass completed before the movement's commit), the corpus was widened to 200 fillers + an 80ms movement start, and the re-run of the stash proof showed the pass **rejected** (the spurious `BinContentStateError` whole-tenant rollback) — the second predicted failure shape |
| 2.3 | `pnpm exec vitest run --config vitest.db.config.ts src/__db__/inventory/wms-backfill-races.spec.ts src/__db__/inventory/wms-budgets-backfill.spec.ts src/__db__/inventory/wms-tracked-backfill.spec.ts src/__db__/inventory/wms-core.spec.ts src/__db__/inventory/wms-inv029.spec.ts` | **34/34 passed** (the surrounding WMS corpus unaffected by the protocol change) |
| 2.4 | `… wms-backfill-races.spec.ts wms-serial-ledger.spec.ts` (alphabetical order — the races corpus precedes the T-11 property) | **10/10 passed** — the tenant-wide T-11 serialized-move completeness property stays CLEAN over the races corpus (the afterAll orphan-leg hygiene, the tracked-backfill spec's precedent) |

The deadlock retry contract in the operator tool (`isDeadlockError` walking
the cause chain for SQLSTATE 40P01, bounded 3-attempt retry with backoff):
**code-verified only, not run-verified** — a deterministic two-movement
deadlock rendezvous was judged out of proportion for this wave (§5b records
it as the honest limitation; the runbook §6 documents the protocol and the
retry contract).

## 3. RUN — the checker honesty fixes + the doc corrections

| # | Command | Result |
|---|---|---|
| 3.1 | `pnpm exec tsx scripts/check-id-ledger.ts --self-test` (on the fix) | **10/10 probes OK · 0 errors, 0 warnings** — implemented G 46 · INV 29 · BR 77; reservations 21 phases / 79 ids; 68 phase docs scanned (43 claim ids, 2,527 reference ids — the logical-block scanner counts differently by design: wrapped claims join, the proximity rule narrows `gains`) |
| 3.2 | The same command on the PRE-FIX checker (the worktree method: `git worktree add … 6f44ee4`, run from the worktree) | **0 errors, 0 warnings · self-test 3/3** — `implemented G 46 · INV 29 · BR 77; 68 docs (73 claim ids, 2503 reference ids)`. This pins the prior ledger's §6.1 numbers: its (77 claim ids, 2,486 reference ids) were the MID-WAVE tree (pre-a457f5e doc touches), and the checker on the final prior-wave head `6f44ee4` re-runs green at 73/2,503 — see the amendment in the prior ledger's §6 |
| 3.3 | The pre-fix checker against the CURRENT docs (the worktree checker, current tree) — the diagnostic-proof run before the doc fixes | **4 FAIL rows, each an `inverted-range` finding pinned to file:line**: PHASE-042.md:185 `BR-068…060`, PHASE-043.md:170 `BR-078…063`, PHASE-045.md:166 `BR-081…070`, PHASE-046.md:165 `BR-084…073` — exactly the review's list. After the doc corrections (commit `77d0d7d`) the NEW checker runs green (3.1). The four ranges were corrected to the re-coordinated ladder: BR-068…071 (the implemented canon, verified against BUSINESS_RULES BR-068…071), BR-078…080, BR-081…083, BR-084…086 |
| 3.4 | A repo-wide sweep (a one-off tsx script over ALL `docs/**/*.md`, all separators normalized: `…`, `...`, `..`, `–`, `—`) | **NO inverted or family-mismatched ranges anywhere in docs/** and **NO same-id duplications** (`G-50/G-50`-shaped) in any phase doc — the renumbering-regression sweep the review demanded, beyond the checker's phase-doc scope |
| 3.5 | `pnpm exec eslint scripts/check-id-ledger.ts` · `python3 scripts/validate_docs.py` | **0 problems · 33/33 checks passed** |

## 4. RUN — the re-evaluation of the prior wave's email-flake claim

The prior ledger's §5 batch-2 row claimed the 3 crm/tasks failures were "a
timing flake, not a defect" on the strength of a standalone + neighbors
re-run. Re-evaluated THIS wave with fresh runs and the mechanism read:

| # | Command (cwd `apps/api`) | Result |
|---|---|---|
| 4.1 | `pnpm exec vitest run --config vitest.db.config.ts src/__db__/crm/tasks.spec.ts` — **three consecutive invocations** | **10/10 passed · 10/10 passed · 10/10 passed** (30/30 cumulative) — the file is green standalone on this environment too; the prior failures remain confined to the batched (41-file, shared-CPU) context |
| 4.2 | The mechanism read (INFERRED from code, labeled as such): `waitForMailMatching`/`waitForMailCount` poll the in-process SMTP capture every 100 ms against a **hard 10-second WALL-CLOCK deadline** | A wall-clock ceiling under CPU contention is exactly the shape that degrades in a batched run: the reminder job + the SMTP session get starved past 10 s while 41 files share 2 vCPUs. **What is proven:** standalone green (3/3 this wave, twice in the prior wave); **what is NOT proven:** that no defect exists — the batched context was not re-run this wave (§5b). The honest classification is "load-sensitive timing — a wall-clock deadline under contention, defect neither demonstrated nor excluded", recorded as such; the prior ledger's flat "a timing flake, not a defect" phrasing is amended below |

## 5. RUN — the re-evaluation of the prior wave's p95-environmental claim

The prior ledger's §5 batch-3 row recorded ga-full-load T-04's statement
tier at **34.9 s against the 10 s budget** and classified it "the documented
environmental class… recorded, not repaired". Re-evaluated with a fresh
STANDALONE run:

| # | Command (cwd `apps/api`) | Result |
|---|---|---|
| 5.1 | `pnpm exec vitest run --config vitest.db.config.ts src/__db__/performance/ga-full-load.db.spec.ts` (standalone, this wave's tree) | **13/13 passed** — T-04 standard-statement-tier **p95 = 1,693 ms** (p50 906 / p99 1,693, n=6, TB/IS/BS @100k, distinct params) against the 10,000 ms budget — **5.9× under budget**; interactive tier p95 = 1 ms (cached steady state; first-pass compute tb=354 ms); T-01 45 ms / T-02 22 ms / T-05 62 ms / T-06 153+187 ms / T-08 118.5 posts/s — all green |
| 5.2 | The CPU record: `lscpu` | 2 vCPU Intel Xeon — the SAME sandbox class as the prior batched run |

**Conclusion (run-verified):** the prior miss was context-dependent on this
sandbox class — the identical spec on the same 2-vCPU CPU measures 1.69 s
standalone vs 34.9 s inside the batched 41-file run (shared CPU across
embedded-PG boots, teardowns and background jobs during the statement-tier
window). This is now EVIDENCE for the environmental classification, not an
assertion: the code path was untouched between the two measurements (the
wave's changes are inventory-side). **What is NOT re-proven:** the batched
context itself (a second full batched run was out of this wave's time
budget — §5b); the classification therefore reads "context-sensitive
sandbox measurement — standalone re-run green at 5.9× margin; the batched
miss was not reproduced this wave".

## 5b. Not run in this wave (honest limitations)

- A second BATCHED full-suite invocation (the prior wave's §5 five-batch
  equivalent) — out of the sandbox time budget; the affected specs were run
  individually (§2, §4, §5) and the surrounding WMS corpus together (§2.3).
- A deterministic deadlock E2E (backfill vs a two-position movement in
  inverse canonical order) — the retry contract is code-verified and
  documented (runbook §6); the rendezvous construction was judged
  disproportionate to the residual risk.
- The non-api workspace gates (build, the design-token contrast gate, the
  storybook visual harness, the web secure-headers probe, i18n parity,
  manifests, the negative boundary meta-tests) — no web/ui/i18n surface
  changed in this wave; the api-relevant gates are §6.
- `pnpm --filter @erp/api backfill:bins` against a live DATABASE_URL — the
  operator tool's runtime paths (advisory lock, classification, writes) are
  exercised through the same service in §2's specs; the script's own
  fail-fast contract was run-verified by the prior wave (its §2.4).

ENVIRONMENT NOTE (resolved mid-wave): the api unit run initially failed ONE
suite — `tax/__tests__/zatca-qr-decode.spec.ts` — with Playwright's
"Executable doesn't exist" (the sandbox had no browser binaries). After
`pnpm exec playwright install chromium-headless-shell` the suite passes
3/3 and the FULL api unit run is green (§6.5) — a missing-binary
environmental gap, not a code failure, unrelated to this wave's changes.

## 6. RUN — the standing gates on this wave's tree

| # | Command | Result |
|---|---|---|
| 6.1 | `pnpm typecheck` (root — all 8 workspaces) | **8/8 successful** |
| 6.2 | `pnpm lint` (root — all 8 workspaces) | **8/8 successful** |
| 6.3 | `pnpm lint:depcruise` | **0 violations — 1,787 modules, 13,157 dependencies cruised** |
| 6.4 | `python3 scripts/validate_docs.py` | **33/33 checks passed** (the runbook, ID_LEDGER, the phase docs, ACCOUNTING_TESTS) |
| 6.5 | `pnpm exec vitest run` (cwd `apps/api` — the unit + property suite) | **51/51 files · 576/576 tests passed** (3 skipped as designed; incl. the browser-dependent QR suite after the binary install — §5b note) |
| 6.6 | `pnpm exec tsx scripts/check-id-ledger.ts --self-test` | **10/10 self-test probes · 0 errors · 0 warnings** (§3.1) |
| 6.7 | `pnpm exec eslint scripts/check-id-ledger.ts` | **0 problems** |
