# PHASE-047 W-0 — The clean-environment baseline proof (the owner's plan-approval dispatch, 2026-11-18)

Head under test: **2956c27** (origin/main at the W-0 boot — the PHASE-047
master-plan delivery head; per amendment **A-5** of the owner's plan-approval
dispatch, the baseline runs at the then-current head and records it as such:
`2956c27` is docs-only above the W-9 code head `8fab3ed` — the plan's original
"untouched W-9 head 8fab3ed" phrasing was corrected at implementation, the
dated note in the plan §3 W-0).

Environment: **fresh clone** (`/home/z/erp_p047`, this session — the
same-session evidence rule, the SIXTH consecutive wave); node v24.22.3,
corepack pnpm 9.15.9 (`~/.local/bin` shim), frozen install **6.5s** (store
warm), Playwright Chromium + headless-shell 1200/1248 both present (1248 left
by the W-8 session — the known sandbox gap, already closed here), embedded
PostgreSQL 16.14.0-beta.17 booted per chunk by `src/__db__/global-setup.ts`.

Every number below is from a run **in this environment, this session** — no
result transferred from a previous green log (the standing rule).

## Commands and actual results

| Gate | Command | Result |
|---|---|---|
| install | `pnpm install --frozen-lockfile` | clean, 6.5s (store warm) |
| typecheck | `pnpm typecheck` | **8/8 packages** green, 0 cached (1m02s) — `typecheck.log` |
| lint | `pnpm lint` | **8/8 packages** green, 0 cached (1m02s) — `lint.log` |
| boundaries | `pnpm lint:depcruise` | ✔ no violations (**1,939 modules, 14,434 deps**) — `depcruise.log` — the fresh-clone count re-baselined for the 047 gate list per plan §5 (the environmental-delta disclosure law: the W-7 delivery-session cruise logged 1,940 · 14,441; the verifier's fresh clones and this session's both say 1,939 · 14,434) |
| unit | `pnpm test` | **8/8 packages green**, 0 cached — `unit-workspace.log` (api 58 files · 667 · web 87 · mobile 393 · desktop 274 · ui 42 · contracts 56 · domain-core 38 · sync-core 36 = **1,557 tests**) |
| DB suite | `pnpm exec vitest run --config vitest.db.config.ts <chunks>` (foreground, serial, per-chunk embedded-PG boot, 600s ceiling) | **250/250 files · 3,436/3,436 tests green** — logs in `db-suite/` |

## The DB-suite chunk record (all foreground, every log kept, `VITEST_EXIT` stamped per the NF-3 convention)

| Chunk | Files | Tests | Log |
|---|---|---|---|
| 00 | 59 | 438 | `db-suite/chunk-00.log` |
| 01 | 57 | 1,952 | `db-suite/chunk-01.log` |
| 02 | 60 | 482 | `db-suite/chunk-02.log` (the first run: 1 flake, see below) → **`db-suite/chunk-02-rerun.log` 60/60 · 482/482 green** |
| 03 | 66 | 536 | `db-suite/chunk-03.log` |
| perf (the 8 load-shaped specs, isolated per the T-20 runbook) | 8 | 28 | `db-suite/chunk-perf.log` |
| **Total** | **250** | **3,436** | **0 failed · 0 skipped on the green sweep** |

Chunk file lists: the 250 `src/__db__/**/*.spec.ts` files sorted, the 8-file
load-shaped family isolated (`performance/*` ×5, `notes/pdc-calendar-perf`,
`accounting/gl-perf`, `master-data-perf`), the remaining 242 split `l/4` —
59/57/60/66 (the 046 W-7 split shape).

## The honest environment note — ONE flake, kept and closed

**First chunk-02 run: 1 test red** —
`src/__db__/notifications/fcm-channel.spec.ts` test (1) "locale resolution —
the AR device gets the AR title byte-for-byte" failed at
`expect(outcome.sent).toBe(true)` (`expected false to be true`, log line
kept: `db-suite/chunk-02.log`); the other 7 tests of the file and the other
59 files of the chunk green. Diagnosis, all in-session:

- **Standalone re-run: 8/8 green** (`db-suite/fcm-channel-standalone-rerun.log`).
- **Pair re-run (the alphabetical neighbors `notifications-email.db.spec.ts` →
  `fcm-channel.spec.ts` in one process): 13/13 green**
  (`db-suite/fcm-pair-repro-1.log`).
- **Full chunk-02 re-run, identical command: 60/60 · 482/482 green**
  (`db-suite/chunk-02-rerun.log`).

The failure mode: `sendToDevice` returned a refusal (`sent:false`) on a device
whose opt-in PUT had just returned 200 + `optedIn:true` in the same test body —
a shared-process state/timing sensitivity (singleFork + `isolate:false`:
one worker process across all files of the chunk; vitest's internal file
ordering is timing-shaped, so the spec's position within the chunk varies run
to run — in the red run it was the 19th file to complete, after a
payroll/manufacturing/reporting-heavy prefix). This is the standing
**"DB-suite serial-order sensitivities" watch item** (the 046 W-0 precedent
class: the two load-shaped perf finds, resolved by the same runbook — isolate,
re-run, keep every log). NOT a code regression at the head: the head is the
W-9-accepted `2956c27`, untouched by this wave; the same file is green
standalone, in-pair, and in the full-chunk re-run, and was green in the 046
W-7 full-suite sweep at the same content. No production change and no test
change was made for it (the baseline wave touches nothing); the flake class is
recorded here for the watch item's ledger.

## The standing checks (the baselines to move — recounted this session, every log kept)

| Check | Result | Log |
|---|---|---|
| migrations journal | ends at **0094** (idx 93) — `meta/_journal.json` | (file inspection; the chain re-proven by every chunk boot) |
| permissions drift | **matrix 300 keys, seed 300 keys — OK** | `permissions-drift.log` |
| `check:rls` | **OK — 292 catalog tables, 0 violations** (the standalone scratch-PG16 run + the in-suite co-proof via `migrations.db.spec.ts`, green in chunk-02) | `check-rls-scratch.log` (+ the failed no-PG attempt `check-rls.log`, kept for the record) |
| i18n parity | **ar=6,121 · en=6,121**, no empty values | `i18n-parity.log` |
| mobile i18n | **371 = 371**, no empty values | `mobile-i18n.log` |
| id-ledger | **0 errors — implemented G 54 · INV 32 · BR 87**; reservations 18 phases · 59 ids; self-test all-probes-OK | `id-ledger.log` + `id-ledger-self-test.log` |
| history-secrets | 0 violations (the local pattern-set substitute; CI gitleaks is the authoritative gate) | `history-secrets.log` |
| docs:validate | **33/33 checks passed** | `docs-validate.log` |
| manifests | **13/13 valid** | `manifests.log` |
| capabilities matrix | agree — every implemented claim carries a gate | `capabilities.log` |
| desktop/mobile shells | PASS · PASS | `desktop-shell.log` · `mobile-shell.log` |
| negative boundary | **PASS** (ESLint exited 1 on the violating fixture, as required) | `boundary-negative.log` |
| report registry | **106 frozen contracts** (the `reporting/golden.spec.ts` snapshot assertion, green in the DB-suite sweep) | (in-suite) |

## Baseline moved (all as the plan §0 records — zero drift found)

migrations journal **0094** (idx 93) · DB suite **250/250 files · 3,436/3,436**
· permissions **300** · report registry **106** · i18n **6,121** (web) +
**371** (mobile) · ENTITY_CATALOG / `check:rls` **292** · id-ledger implemented
**G 54 · INV 32 · BR 87** · depcruise fresh-clone baseline **1,939 · 14,434** ·
docs **33/33**. **W-0 exit met — the baseline is proven before any code
change, at the head 2956c27, in this session's fresh clone.**
