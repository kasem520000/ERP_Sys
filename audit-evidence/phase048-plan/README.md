# PHASE-048 plan-wave evidence — 2026-11-19 (this session, fresh clone at `5b73bd1`)

Every log below was generated THIS session (the same-session evidence rule,
the FIFTEENTH consecutive wave) in `/home/z/erp-p48` (a fresh clone at the
remote head `5b73bd1` — the OA-07 delivery head), captured through
`scripts/capture-evidence.sh` (the W-6 vitest-summary-guarded wrapper) unless
noted. The four quarters of every test session (command, stdout+stderr, exit
stamp, timestamps in the log headers) are preserved verbatim — NF-7's
permanent rule.

## The logs

| Log | What it proves | Stamp |
|---|---|---|
| `typecheck.log` | typecheck 8/8 packages at `5b73bd1` | EXIT=0 |
| `lint.log` | lint 8/8 packages | EXIT=0 |
| `depcruise.log` | no violations — 1,993 modules · 14,855 dependencies | EXIT=0 |
| `unit-workspace.log` | unit 8/8 packages — api 60·712 · web 13·122 · mobile 27·393 · desktop 16·274 · ui 3·43 · contracts 2·56 · domain-core 6·38 · sync-core 5·36 | EXIT=0 |
| `db-suite-full-verbose-259files.log` | **THE FULL DB SUITE** 259/259 files · 3,621 passed \| 2 skipped (3,623) — the embedded-PG16 chain from zero, this session | VITEST_EXIT=0 |
| `nf9-green-current-head.log` | the NF-9 regression spec (with the (d4) adversarial arm) at the CURRENT head `5b73bd1`: 10/10 green | VITEST_EXIT=0 |
| `nf9-red-prefix-head-7d22c49.log` | **THE NF-9 RED RUN** — the pre-fix head `7d22c49` (W-3) rebuilt as a worktree, the regression spec applied from the post-fix head: **1 failed \| 9 passed — (d4) FAILS BY NAME**, the nine others green | VITEST_EXIT=1 |
| `id-ledger.log` | implemented G 54 · INV 32 · BR 91 · 0 errors | EXIT=0 |
| `id-ledger-self-test.log` | the self-test 9d all-probes-OK | EXIT=0 |
| `permissions-drift.log` | matrix 312 = seed 312 | EXIT=0 |
| `i18n-parity.log` | ar=6,433 = en=6,433 | EXIT=0 |
| `mobile-i18n.log` | mobile ar=371 = en=371 | EXIT=0 |
| `mobile-tokens.log` | 50/50 token derivations | EXIT=0 |
| `manifests.log` | 13/13 valid | EXIT=0 |
| `docs-validate.log` | 33/33 checks | EXIT=0 |
| `history-secrets.log` | 0 violations | EXIT=0 |
| `capabilities.log` | capabilities matrix and fixture agree | EXIT=0 |
| `desktop-shell.log` / `mobile-shell.log` | PASS / PASS | EXIT=0 |
| `docs-validate-final.log` | docs:validate 33/33 AFTER the plan + NEXT_ACTION changes | EXIT=0 |

Static recounts this session (no run needed): migrations journal **0099**
(idx 98, 99 files) · `ROUTE_PERMISSIONS` **988** rows · `REPORT_CONTRACTS`
**110** · `ENTITY_CATALOG` **307** table rows.

## The two honest notes

1. **The full-suite skips:** this session's fresh-clone run reports
   `3,621 passed | 2 skipped` — the two skips are
   `src/__db__/reporting/render.spec.ts` (browser-render-gated,
   environment-conditional). The W-7 sweep's `0 skipped` was that session's
   environment; both records are true in their environments (the F1 law —
   recorded, never silently reconciled).
2. **The false-stamp re-discovery (the NF-4/W-6 class, live at the W-3
   head):** the FIRST red-run attempt invoked the test through
   `pnpm --filter @erp/api run test:db` captured by the **W-3-era**
   `scripts/capture-evidence.sh` (the worktree's own copy at `7d22c49` —
   which predates the W-6 vitest summary guard). pnpm swallowed vitest's
   exit 1 and the W-3-era wrapper stamped `VITEST_EXIT=0` on a genuinely
   red run (the log's own summary said `1 failed | 9 passed`). The kept
   artifact of that attempt is preserved in the session transcript; the
   shipped `nf9-red-prefix-head-7d22c49.log` is the RE-RUN in the correct
   shape (direct vitest binary, the guarded wrapper) and carries the true
   `VITEST_EXIT=1`. **Consequence for any verifier re-running at the
   pre-fix head: use the direct vitest invocation or a post-W-6 wrapper —
   never the W-3-era wrapper with the pnpm layer.**

## The NF-9 regression protocol — the verifier's exact commands

Green side (any post-W-4 head; here the current remote head):

```bash
git clone https://github.com/kasem520000/ERP_Sys.git && cd ERP_Sys
pnpm install --frozen-lockfile
cd apps/api && ./node_modules/.bin/vitest run --config vitest.db.config.ts \
  src/__db__/hr/talent-training-org.db.spec.ts
# expect: 10/10 passed, exit 0 — (d4) among them
```

Red side (the pre-fix head `7d22c49` — the owner's W-3-accepted head, the
state the owner's verification reproduced the defect on):

```bash
git worktree add ../prefix 7d22c49 && cd ../prefix
pnpm install --frozen-lockfile
git checkout 83362ff -- apps/api/src/__db__/hr/talent-training-org.db.spec.ts
cd apps/api && ./node_modules/.bin/vitest run --config vitest.db.config.ts \
  src/__db__/hr/talent-training-org.db.spec.ts; echo "exit=$?"
# expect: 1 failed | 9 passed — the failure is EXACTLY
#   "(d4) THE NF-9 ADVERSARIAL CLOSE-CODE ARM …" — exit 1
```

The delta between the two trees for this file is ONLY the (d4) block (the
W-4 commit `83362ff` added it; the file is unchanged since — verified by
`git log --follow`), so the red run isolates the defect with no other
variable.
