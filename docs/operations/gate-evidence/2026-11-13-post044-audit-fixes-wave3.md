# Gate Evidence — PHASE-044 Post-Closure Audit Fixes, Wave 3 (2026-11-13)

> **Scope:** the evidence ledger for the third post-closure audit-fix wave —
> the owner's review of the second wave at head `a8db23e` named TWO points:
> (1) the ID checker's claim/reference classification inside ONE paragraph
> (the posting-canon shape: an `original plan's` note demoting the whole
> unit, claims included — the owner's G-47→G-44 reproduction), and (2) the
> batch-balance conflict hiding in `listBatchDistribution` (the clamped
> negative per-batch difference letting a totals-matching write silence the
> nightly probe). Both were reproduced on the pre-fix code, fixed, and
> re-proven — every row states WHAT WAS RUN (command + environment +
> result) vs what was INFERRED from reading the code. No secrets; no bulky
> outputs — the distilled lines that matter, re-runnable via the cited
> commands.
>
> **Commits:** `47bafe5` (the checker's clause-level classification + the
> ID_LEDGER conventions) · `0b88d89` (the batch-conflict fix + the spec +
> the runbook) · this commit (the evidence ledger + the CHANGELOG entry).

## 1. Environment

- Embedded PostgreSQL 16 (the suite's `global-setup.ts` boot), migrations
  0001–0073 applied by `drizzle-kit migrate` per run — unless a row states
  otherwise. Commands run from the repository root or `apps/api` as stated;
  Node 24, pnpm 9.15.9, the repo's locked workspace install. The one-time
  `playwright install chromium` sandbox bootstrap (the prior wave's recorded
  environment note) was applied once this session; every unit-suite row
  below ran after it.

## 2. RUN — the checker's same-unit claim/note split (the review's point 1)

The owner's reproduction, re-verified on the PRE-FIX code before any fix
(the `a8db23e` worktree checker, the mutated current doc):

| # | Command | Result |
|---|---|---|
| 2.1 | `git worktree add /tmp/wt-prefix a8db23e`; PHASE-043.md's claim sentence mutated (`goldens G-47` → `goldens G-44`, the implemented id); `pnpm exec tsx scripts/check-id-ledger.ts` in the worktree; doc restored after | **0 errors, 0 warnings (43 claim ids, 2,527 reference ids)** — the pre-fix checker passed the owner's mutation exactly as reported: the note's `original plan's` marker demoted the ENTIRE logical unit to references, claims included. (A stronger variant — ALL the paragraph's claims swapped for implemented ids: G-43/G-42/G-41, INV-029, BR-072…074 — also passed 0 errors pre-fix.) |
| 2.2 | The same mutation against the FIXED checker (`pnpm check:id-ledger` at the repo root) | **1 error — `stale-claim: PHASE-043 (PHASE-043.md:129) claims G-44 as new, but it is already implemented (PHASE-044)`** — and 0 errors again after `git checkout` restored the doc. The same file-level proof ran for PHASE-045.md:124 (G-50→G-44) and PHASE-046.md:126 (G-52→G-44): each fails with exactly one stale-claim, each restored runs clean |
| 2.3 | `pnpm exec tsx scripts/check-id-ledger.ts --self-test` (on the fix) | **14/14 probes OK · 0 errors, 0 warnings** — the prior wave's ten probes (1, 2, 3, 4, 5, 5b, 5c, 6, 7, 8) all still green, plus the four wave-3 probes: (9) the REAL 043 posting-canon paragraph verbatim — 7 claims (G-47…G-49, INV-030, BR-078…080) + 7 references (the note's G-44…G-46/INV-028/BR-061…063), 0 findings; (9b) the owner's exact mutation — one stale-claim on the claim sentence's G-44 while the note's G-44…G-46 mention produces NO finding; (9c) the 045 shape clean (6 claims/0 findings) + the G-50→G-44 mutation rejected; (9d) the 046 shape clean (7 claims/0 findings — G-29 stays a REFERENCE inside the claim clause via the ±45-char proximity demotion, G-51 stays a reference inside the parenthetical note) + the G-52→G-44 mutation rejected with G-29 never flagged |
| 2.4 | The corpus run: `pnpm check:id-ledger` | **0 errors, 0 warnings — 115 claim ids, 2,455 reference ids over 68 phase docs** (was 43 / 2,527 at `a8db23e`). The +72 is the demotion bug unmasking, every site reviewed (2.5) |
| 2.5 | The per-block old-vs-new audit (a one-off tsx harness: both checkers imported, `buildBlocks` + `classifyLine` per block, every divergence listed) | **11 blocks changed, all intended**: the 043/045/046 posting-canons (7+6+7 claims — the fix's target), the 048/049/050/051 posting-rules paragraphs (10+8+7+8 — the SAME `original plan's` shape, their reserved claims now claimed), the completed-phase as-implemented claims now counted as claims (042:144 +8, 044:160 +7, 008:186 +3 — historical plan text, skipped by the future-phase rules), and 055:10's INV-040 claim surfacing from behind a "mirror the existing" clause (INV-040 IS 055's reservation). **The audit also caught one real splitter defect**: PHASE-039.md:141's ASCII-dots range `G-35..G-37` was being split at the dots (G-36 dropped from the count) — fixed by the dot-run skip (`..`/`...` are id-range syntax, never clause separators); the re-run diff shows PHASE-039 back to its old classification and the totals at 115/2,455 |
| 2.6 | `pnpm exec eslint scripts/check-id-ledger.ts` · `pnpm exec prettier --check scripts/check-id-ledger.ts` · `python3 scripts/validate_docs.py` | **0 problems · clean · 33/33** (ID_LEDGER §4/§5 updated to the clause-scoped conventions in the same commit) |

## 3. RUN — the batch-balance conflict hiding (the review's point 2)

The owner's case, reproduced on the PRE-FIX service before any fix (the
stash-and-run method — the prior wave's regression-proof precedent):

| # | Command (cwd `apps/api`) | Result |
|---|---|---|
| 3.1 | `git stash push apps/api/src/modules/inventory/application/wms.service.ts`; `pnpm exec vitest run --config vitest.db.config.ts src/__db__/inventory/wms-backfill-conflicts.spec.ts`; `git stash pop` | **6 failed / 1 passed** — exactly the predicted hiding shapes: the owner's case **"expected 'WRITABLE' to be 'NON_RECONCILABLE'"** (the pre-fix pass wrote 2 for batch B and classified the position WRITABLE); the post-migration probe row **"expected a length of 1 but got +0"** (Σ bins 10 == item_stock 10 — the conflict VANISHED from the only recurring detector); the re-run still WRITABLE; the concurrent passes healed the position (the second pass found no row); the PARTIAL case's notes **missing the BFC-PA conflict** (the silent clamp-to-zero skip); the serialized analogue placed the provable unit (WRITABLE, the over-placement swallowed). The healthy-WRITABLE test passed pre-fix (unchanged behavior — the guard's negative control) |
| 3.2 | The same command on the FIX | **7/7 passed** — the owner's case NON_RECONCILABLE with the conflict NAMED ("batch BFC-A: bins hold 8 but the ledger nets 5 here — the per-batch sources disagree") and the refusal explained ("writing the proven parts would make Σ bins == item_stock and HIDE the named conflict(s) from the nightly probe"); the live pass writes NOTHING (fold stays 8 vs stock 10); the probe keeps the position; the audit row counts it; the re-run is a byte-identical idempotent refusal; two concurrent passes both refuse; PARTIAL-with-conflict still writes the PROVEN batch (B, ledger 2) with the conflict named and the 10-unit residue visible; the serialized analogue refuses with the over-placed serial named; the healthy position still lands WRITABLE |
| 3.3 | The sibling WMS corpus: `pnpm exec vitest run --config vitest.db.config.ts src/__db__/inventory/wms-backfill-conflicts.spec.ts src/__db__/inventory/wms-backfill-races.spec.ts src/__db__/inventory/wms-budgets-backfill.spec.ts src/__db__/inventory/wms-tracked-backfill.spec.ts src/__db__/inventory/wms-core.spec.ts src/__db__/inventory/wms-inv029.spec.ts src/__db__/inventory/wms-serial-ledger.spec.ts` | **46/46 passed (7 files)** — the surrounding corpus unaffected by the classification change: the wave-2 race corpus 5/5 (the movement-vs-pass protocol untouched), the tracked-backfill corpus 7/7 (the TBF-S-0004 PARTIAL-with-conflict-note shape deliberately unchanged — its residue keeps the probe visible), budgets 5/5, core 15/15, inv029 2/2, the T-11 serial-ledger property 5/5 (the spec's afterAll removes the seeded orphan legs — the tracked-backfill hygiene precedent) |
| 3.4 | `pnpm exec tsc --noEmit -p tsconfig.json` (cwd `apps/api`) · `pnpm --filter @erp/api lint` · `pnpm exec prettier --check` on both changed files | **0 errors · clean · clean** |
| 3.5 | The api unit suite: `pnpm vitest run` (cwd `apps/api`) | **51/51 files, 576/576 tests** — after the sandbox's one-time `playwright install chromium` (the prior wave's recorded environment bootstrap; before it, zatca-qr-decode fails on the missing binary — an environment miss, not a code defect) |
| 3.6 | `pnpm lint:depcruise` (repo root) | **0 violations — 1,788 modules, 13,168 dependencies** (+1 module: the new spec) |

## 4. The standing gates (this wave)

docs:validate **33/33** · check:id-ledger **0 errors / 0 warnings** (14/14
self-test probes) · api typecheck **0** · api lint **0** · depcruise **0** ·
api unit **51/51 files 576/576** · the WMS db corpus **46/46**. NOT re-run
this wave (no surface touched): i18n parity, permissions drift, manifests,
isolation suites — the changed files are one script, two docs, one service,
one new spec; none of those gates read them.

## 5. The honest limitations

- **The checker's clause model is corpus-tuned, not general NLP.** The
  separator set (`; : . ·` and SPACED dashes at paren-depth 0, outside code
  spans), the marker-less inheritance rule, and the ±45-char proximity
  window were fitted to this corpus and reviewed block-by-block (2.5) — the
  11 divergences are all intended, but future prose shapes may need new
  markers (the CLAIM/REFERENCE marker lists remain the maintained surface).
  A SPACED ellipsis range ("G-35 … G-37") still does not expand —
  pre-existing behavior, unchanged and unexamined this wave.
- **The concurrency proof is backfill-vs-backfill on the conflicted
  position.** A movement interleaving ON a conflicted position (a receipt
  racing the pass while the position stays NON_RECONCILABLE) was not
  separately rendezvoused — the position-lock protocol is untouched by this
  wave and the wave-2 races corpus (5/5, re-run green in 3.3) covers the
  movement interleavings on healthy positions; the conflicted case writes
  nothing, so the write-path race surface does not apply to it.
- **The probe's own semantics are unchanged** — `reconcileBins` remains the
  aggregate (warehouse, item) fold. This wave guarantees a named conflict
  can no longer be HIDDEN from it by the backfill; a per-batch/per-serial
  recurring detector (folding bins against the ledger per batch/serial
  every night, not just per position) is a plausible future hardening and
  is NOT built here.
- **The batch-with-bins-but-no-ledger shape is outside
  `listBatchDistribution`'s population** (the query is ledger-driven: FROM
  the per-batch ledger fold). A batch whose bins exist with ZERO ledger
  legs at the warehouse is not listed and therefore not named as a conflict
  by this fix — at the position level such bins still count toward Σ bins,
  so the aggregate probe keeps reporting the position until the shortfall
  is zero; recording the gap here rather than widening the query.
- The prior wave's §5b limitations (no second batched full-suite run; the
  email-flake and p95-environmental classifications resting on the
  standalone re-runs) remain standing — no code or corpus touching those
  areas changed this wave.
