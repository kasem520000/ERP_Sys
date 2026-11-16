# PHASE-046 W-0 — The clean-environment baseline proof (owner's dispatch, 2026-11-16)

Head under test: **d74edaa** (the PHASE-045 T-20 delivery head — the unmodified
code head; `main`'s c71aa9d5 adds only this phase's plan document, no code).
Environment: fresh sandbox after PHASE-045 acceptance; node v24.22.3,
pnpm 9.15.9, embedded PostgreSQL 16 (16.14.0-beta.17, booted per chunk by
`src/__db__/global-setup.ts`), Playwright Chromium + headless-shell (1200 for
the UI harness tier, **1248 installed this session** for the api unit tier —
see the honest note below).

Every number below is from a run **in this environment, this session** — no
result transferred from a previous green log (the standing rule).

## Commands and actual results

| Gate | Command | Result |
|---|---|---|
| install | `pnpm install --frozen-lockfile` | clean, 24.6s (store warm) |
| typecheck | `pnpm typecheck` | **8/8 packages** green (1m02s) — `typecheck.log` |
| lint | `pnpm lint` | **8/8 packages** green (46s) — `lint.log` |
| boundaries | `pnpm lint:depcruise` | ✔ no violations (1,908 modules, 14,140 deps) — `depcruise.log` |
| unit | `pnpm test` | **8/8 packages green** — `unit-full.log` (api 626 · web 77 · mobile 393 · desktop 274 · ui 42 · contracts 56 · domain-core 38 · sync-core 36 = **1,542 tests**) |
| DB suite | `pnpm exec vitest run --config vitest.db.config.ts <chunks>` (foreground, serial, per-chunk embedded-PG boot, 600s ceiling) | **240/240 files · 3,329/3,329 tests green** — logs in `db-suite/` |

## The honest environment notes

1. **First unit attempt: 1 api file red** (`src/modules/tax/__tests__/zatca-qr-decode.spec.ts`
   — `chromium_headless_shell-1248` missing; the sandbox image carried 1200
   only). Fixed by `pnpm --filter @erp/api exec playwright install chromium`
   (downloads 1248). Re-ran: api 55/55 files · 626/626 tests green
   (`unit-api-rerun.log`), then the **full 8/8 sweep re-ran green**
   (`unit-full.log`). Not a code regression — an environment-prep gap, closed
   this session.
2. **DB-suite chunking + the known serial-order sensitivity:** the first
   5-way split put the five `src/__db__/performance/*` specs together with 44
   other heavy suites in one chunk (same embedded-PG instance). Two load-shaped
   assertions failed under the accumulated PG write pressure (checkpoint
   write=72.8s in that instance's log):
   - `ga-full-load.db.spec.ts` T-04 standard-statement tier p95=36,637ms vs
     the 10,000ms budget (chunk-03.log);
   - `soak-shaped.db.spec.ts` queue-depth lastDepth=4 vs baseline+2
     (chunk-03b.log).
   Both are the plan §6 watch item ("DB-suite serial-order sensitivities").
   Resolution — the runbook pattern, applied: **the performance specs run as
   their own chunk** (own PG boot, no preceding write pressure):
   - `ga-full-load` alone: 13/13 green, T-04 standard-statement **p95=1,643ms**
     (`db-suite/ga-full-load-rerun.log`);
   - the five-spec performance chunk: **5/5 files · 21/21 tests green**
     (`db-suite/chunk-perf.log`), including both specs above.
   All failing logs are kept in place — nothing overwritten.

## The DB-suite chunk record (all foreground, every log kept)

| Chunk | Files | Tests | Log |
|---|---|---|---|
| 00 | 45 | 331 | `db-suite/chunk-00.log` |
| 01 | 49 | 327 | `db-suite/chunk-01.log` |
| 02 | 43 | 1,868 | `db-suite/chunk-02.log` |
| 03c (03 minus the perf specs) | 44 | 336 | `db-suite/chunk-03c.log` |
| perf (the 5 `performance/*` specs, isolated) | 5 | 21 | `db-suite/chunk-perf.log` + `ga-full-load-rerun.log` |
| 04 | 54 | 446 | `db-suite/chunk-04.log` |
| **Total** | **240** | **3,329** | **0 failed · 0 skipped** |

(For the record, the superseded groupings — `chunk-03.log` and `chunk-03b.log`
— are retained as the honest history of the two load-sensitivity finds above.)

## Baseline moved

migrations 88 (journal idx 87) · catalog 284 tables · permissions 297 · report
registry 104 · i18n 6,007 · DB suite 240/240 · 3,329/3,329 · id-ledger
implemented G-51/INV-031/BR-084 — all as the plan §0 records. **W-0 exit met;
the baseline is proven before any code change.**
