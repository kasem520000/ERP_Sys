# PHASE-048 W-8 evidence — 2026-11-20 (this session, fresh clone at `765e481`)

Every log below was generated THIS session (the same-session evidence rule,
the SIXTEENTH consecutive wave) in `/home/z/ERP_Sys_w8` (a fresh clone at
the owner-approved plan head `765e481` — the §7-rulings amendment head),
captured through `scripts/capture-evidence.sh` (the W-6 vitest-summary-
guarded wrapper — and per the owner's A-2 amendment, the VERDICT rule
everywhere: the summary lines or the guarded stamp, never the raw process
code alone). The four quarters of every test session (command, stdout+
stderr, exit stamp, timestamps in the log headers) are preserved verbatim —
NF-7's permanent rule.

## The logs (20 files — every physical file declared)

| Log | What it proves | Stamp |
|---|---|---|
| `typecheck.log` | typecheck 8/8 packages at the W-8 head | EXIT=0 |
| `lint.log` | lint 8/8 packages | EXIT=0 |
| `depcruise.log` | no violations — 1,993 modules · 14,855 dependencies | EXIT=0 |
| `unit-workspace.log` | unit 8/8 packages — api 60·712 · web 13·122 · mobile 27·393 · desktop 16·274 · ui 3·43 · contracts 2·56 · domain-core 6·38 · sync-core 5·36 | EXIT=0 |
| `db-suite-full.log` | **THE FULL DB SUITE 259/259 files · 3,689/3,689 · 0 failed · 0 skipped** — the 103-chain applied from zero on the embedded PG16; the new count = the 3,623 baseline + the A-suite's 66 new arms (the eleven registered tables); chromium_headless_shell-1248 present (the render pair green) | VITEST_EXIT=0 |
| `db-suite-full-first-run-red.log` | **THE HONEST FIRST-RUN RED, kept verbatim** — 258 passed · 1 file failed (templates-019: 2 tests, the 047 W-1 starter-chain-extension class the 048 enablement extends — the automotive CRM-revocation degradation + the starter missing-chain pin) · `Test Files 1 failed (259)` with the summary guard forcing the stamp red | VITEST_EXIT=1 |
| `check-rls-scratch.log` | **THE STANDALONE SCRATCH PROOF** — initdb → the 103-chain from zero → `[check-rls] OK — 318 catalog tables` (0 violations; 307 → 318 with the eleven new tables) → the clean shutdown | EXIT=0 |
| `permissions-drift.log` | matrix **326 = seed 326** (312 + the fourteen projects.* keys, matrix §3.26) | EXIT=0 |
| `id-ledger.log` | 0 errors (the 048 reservations G-55…58 · INV-033 · BR-092…096 STAND — the flip is W-15's) | EXIT=0 |
| `id-ledger-self-test.log` | the self-test all-probes-OK | EXIT=0 |
| `i18n-parity.log` | ar=6,433 = en=6,433 (no delta — migrations-only wave, the API-only precedent) | EXIT=0 |
| `mobile-i18n.log` | mobile ar=371 = en=371 | EXIT=0 |
| `mobile-tokens.log` | 50/50 token derivations | EXIT=0 |
| `manifests.log` | 13/13 valid (the three enabled templates at their new hashes) | EXIT=0 |
| `docs-validate.log` | 33/33 checks | EXIT=0 |
| `history-secrets.log` | 0 violations | EXIT=0 |
| `capabilities.log` | capabilities matrix and fixture agree | EXIT=0 |
| `desktop-shell.log` / `mobile-shell.log` | PASS / PASS | EXIT=0 |
| `boundary-negative.log` | the negative boundary meta-test PASS | EXIT=0 |

Static recounts this session (no run needed): the migrations journal **0103**
(idx 102, 103 files) · `ROUTE_PERMISSIONS` **988** rows (keys-seed-first —
zero new routes at W-8, matrix §3.26's dated note) · `REPORT_CONTRACTS`
**110** (the +4 contracts are W-14's) · `ENTITY_CATALOG` **318** table rows
· the registry **293** tenant-owned tables (282 + 11).

## The two honest notes

1. **The first-run red + the re-pin (both logs kept, §5 of the gate
   doc):** the full DB suite's FIRST run failed 2 tests in
   `templates-019.spec.ts` — both the 047 W-1 "starter-chain extension"
   class this wave's enablement extends again: the automotive
   CRM-revocation degradation test (the W-5 shape expected the OPTIONAL
   service_contracts capability to hide while the apply proceeds; the
   0103 §3 enablement put `projects.fieldservice` in automotive's REQUIRED
   chain, and fieldservice rides the service-orders substrate
   (crm.service_orders → crm.service_contracts), so the CRM-revoked
   tenant now BLOCKS with exactly those two keys — re-pinned to the new
   truth with the dated note; the hidden-not-phase-gated arm remains
   covered at five other sites) and the starter missing-chain pin
   (extended with the three flags + the closure's crm.service_orders —
   the 047 W-1 precedent exactly). The RE-RUN: 259/259 · 3,689/3,689 ·
   0 failed · 0 skipped · VITEST_EXIT=0.
2. **The forward-progressive repair (§1a(a) — a 047 W-5 latent date
   defect the wave's own unit battery caught):** the two web clock-pin
   test blocks (`employee-talent-360.test.tsx` + `hr-org-board.test.tsx`)
   pinned 2026-11-19 and then IMMEDIATELY un-pinned it
   (`vi.useRealTimers()` on the line below `vi.setSystemTime`) — the pin
   only held while real time WAS 2026-11-19 (why every earlier run,
   including the owner's own verification, was green). The session
   crossed UTC midnight 11-19 → 11-20 mid-wave; "6 days remaining"
   became "5 days remaining" and three chip tests went red. REPAIRED
   test-only (the `shouldAdvanceTime` pins hold + the real restore in
   `afterEach`); zero production change; the dated notes at both sites.

## The scratch check:rls — the verifier's exact commands

```bash
git clone https://github.com/kasem520000/ERP_Sys.git && cd ERP_Sys
pnpm install --frozen-lockfile
# initdb a scratch PG16 (the embedded-postgres binary), start it, create
# the erp database, then apply the WHOLE chain and run the checker:
cd apps/api && MIGRATE_DATABASE_URL=<scratch-url> ./node_modules/.bin/drizzle-kit migrate
MIGRATE_DATABASE_URL=<scratch-url> ../../node_modules/.bin/tsx ../../scripts/check-rls.ts
# expect: the 103-entry chain applies; [check-rls] OK — 318 catalog tables; exit 0
```

(The in-suite co-proof: the full DB suite boots its own embedded PG16 and
applies the same chain from zero on every run — `db-suite-full.log`.)

**The verdict rule (the owner's A-2 amendment, binding on every
DB-configured vitest run):** judge by the SUMMARY LINES (`Test Files …
failed` / `Tests … failed` / `Unhandled Error`) or the guarded wrapper's
stamp — never the raw process exit code alone (NF-12: the DB-configured
vitest can exit 0 on actually-red runs, single-test failures included).
This envelope's own first-run red is the proof the discipline works: the
guard stamped `VITEST_EXIT=1` on a run whose process code the summary
overruled.
