# PHASE-051 W-37 (THE CUSTOMS ENGINE) evidence — 2026-11-25 (T-10; the gate record per the ratified عرف 049 option (a))

Every log below was generated THIS session against the W-36 gate head
`5270b93`'s tree + this wave's own increments (the same-session evidence
rule, the **FORTY-NINTH** consecutive wave — the owner's standing record
counts forty-eight through the W-36 gate). The wave is the APPROVED PLAN's
§3 W-37 under the owner's launch authorization (the plan ratified as the
binding phase program — إذن إطلاق ONLY, NEVER production approval; the
rulings (a)–(د) carried; the standing order «عند الانتهاء من أي خطوة
ادفعها إلى المستودع» honored — every step pushed at its own commit).

## §0a FIRST — the local-vs-remote verification (the wave's first act)

- The remote verified first: `main @ bb3a3fb` at the wave's spec head (the
  W-37 step-2 head, pushed at its own commit); `phase/050` @ `01f61a7` ·
  `phase/049` @ `41c3701` · `phase/048` @ `ba459ff` · `phase/047` @
  `5b73bd1` · `phase/046` @ `4ddb39f` — **the four annotated tags' six
  identifiers + the 050 tag intact, local = remote** (the owner's standing
  rule; re-verified by the history-secrets run: all FIVE anchors walked,
  0 violations).
- The working tree IS the W-36 gate's own clone (the ninth-reset recovery
  of the prior gate — `git status` clean at the verification moment, 0
  tracked changes; this gate increment's own files land in THIS commit).
  Env-prep standing from the W-36 gate (pnpm 9.15.9 · the workspace
  install with the embedded-PG16 16.14 binaries · the chromium 1248
  pair) — 0 skipped on every run below.

## The wave's acts (two delivery commits + this gate increment — every step pushed at its own commit per the owner's standing order)

1. **THE CUSTOMS ENGINE** (`af76c7b`, T-10): THE PURE FOLD FIRST (D-06 —
   the unit-first law): `duty-vat-fold.ts` (the line math on Decimal —
   ADR-0009, 4dp ROUND_HALF_UP; the no-hardcoded-rates law; the totals =
   the G-65 amount's own source) with 11 property tests → the customs
   service (the declarations ladder with the DRAFT-only lines window ·
   **THE G-65 COMPLETION** through the REAL LandedCostService VERBATIM
   (D-15(a)'s documented contract — the PurchasingModule import
   one-directional, zero cycles) · the FX ride at the contract rate · the
   fail-closed CUSTOMS_DUTY_PAYABLE · the exactly-once CAS + the zero-duty
   completion) → **THE SHARED CUSTOMS LANDED-COST FLOOR**
   (`trade-customs-gate.ts` — INV-036/D-07's honest interpretation: the
   plain-function gate consumed by the purchasing LandedCostService's
   POST act; the line-level tie with the one-line-per-item exactness
   laws) → **MIGRATION 0125** (landed_costs.declaration_id + the partial
   unique uq_landed_costs_tenant_declaration + the declaration's linkage
   pair + the allocation rows' declaration_line_id — the chain 124 → 125;
   the manifest + journal + the spec's dated chain note together) → THE
   ELEVEN-ROUTE CONTROLLER (trade.customs.view/manage) + the error
   filter's W-37 codes (ROUTE_PERMISSIONS 1,188 + 11 = **1,199** — the
   keys-seed-first FOURTH trade binding wave, dated at the block) + the
   purchasing store/service extensions (the declaration source + the tie
   — D-15(a)'s documented contract).
2. **THE DB SPECS** (`bb3a3fb`): `trade-customs.db.spec` — 10 arms, every
   arm on ITS OWN world per the owner's «أذرع الرفض كلٌّ على عالمه» law
   (the golden G-65 arm with the journal asserted line-by-line + the tie
   + the linkage pair + the exactly-once · the INV-036 completeness
   refusals with ZERO residue · the non-duty untouched · the tie's
   exactness laws with the INV-018 rollback · the fail-closed purpose
   flip-and-restore · the FX ride · the zero-duty completion · the
   ladder + the HS registry · the flag-off boundary on the boundary
   tenant's own full substrate).
3. **THE GATE INCREMENT** (this commit): the evidence envelope + the
   acceptance ledger's W-37 dated note (criterion #3's engine arms GREEN)
   + the NEXT_ACTION + IMPLEMENTATION_STATUS dated headers.

## THE SIX ISOLATES STANDALONE FIRST (the owner's عزل مسبق order — §0c (2); the set standing since W-34)

soak 1 · 1 (`db-isolate-soak.log`, 229.55s) · fcm 1 · 8
(`db-isolate-fcm.log`, 15.40s) · email 1 · 5 (`db-isolate-email.log`,
12.75s) · the cmms sweep 1 · 4 (`db-isolate-sweep.log`, 7.31s) · the
quality calibration sweep 1 · 4 (`db-isolate-quality-sweep.log`, 7.86s) ·
the trade expiry sweep 1 · 6 (`db-isolate-trade-sweep.log`, 7.36s) —
every stamp through THE GUARDED WRAPPER (the W-36 gate's hardened shape:
the vitest summary lines verified in addition to the exit code).

## THE ELEVEN-PART ENVELOPE — 308 files · 4,432 tests · 0 failed · 0 skipped

**The coverage verified BEFORE the first load run (the W-15 law):**
`coverage-inventory.txt` · `coverage-union.txt` ·
`coverage-proof.txt` — 308 = 308, missing NONE, extra NONE, duplicates
NONE, **VERDICT: COVERED** (roster: `parts.json` — the W-36 partition
standing + the ONE declared movement: the trade-customs spec joins
chunk-a at its alphabetical position, 119 → 120 — the
W-24/W-34/W-35/W-36 precedent's own move).

| Part | Files · Tests | Time (inside the 570s ceiling) | Log |
|---|---|---|---|
| isolate-soak (standalone FIRST) | 1 · 1 | 229.55s | `db-isolate-soak.log` |
| isolate-fcm (standalone FIRST) | 1 · 8 | 15.40s | `db-isolate-fcm.log` |
| isolate-email (standalone FIRST) | 1 · 5 | 12.75s | `db-isolate-email.log` |
| isolate-sweep (standalone FIRST) | 1 · 4 | 7.31s | `db-isolate-sweep.log` |
| isolate-quality-sweep (standalone FIRST) | 1 · 4 | 7.86s | `db-isolate-quality-sweep.log` |
| isolate-trade-sweep (standalone FIRST) | 1 · 6 | 7.36s | `db-isolate-trade-sweep.log` |
| chunk-smoke | 3 · 1,999 | 21.36s | `db-chunk-smoke.log` |
| chunk-perf-rest | 5 · 23 | 97.03s | `db-chunk-perf-rest.log` |
| chunk-a | 120 · 1,046 | 164.18s | `db-chunk-a.log` |
| chunk-b-rest | 86 · 625 | 63.86s | `db-chunk-b-rest.log` |
| chunk-c | 88 · 711 | 76.88s | `db-chunk-c.log` |

The arithmetic: 308 = 1+1+1+1+1+1+3+5+120+86+88 EXACT · 4,432 =
1+8+5+4+4+6+1,999+23+1,046+625+711 EXACT. **The provenance declared:**
4,432 = 4,422 (the W-36 envelope) + 10 (the trade-customs spec's arms)
EXACT (declared BEFORE the first load run in `coverage-proof.txt`; the
run confirms it). The durations are the vitest summaries' own printed
figures. The single-process full-suite run was NOT attempted — the
amended ceiling law's own prescription: split before attempted. The
eleven parts above ARE the split.

## The 125-chain scratch from zero — TWICE (السلسلة من الصفر مرتين)

`scratch-rls-proof.ts` (the W-19/W-22/W-0/W-33/W-34/W-36 shape, the
invocation through `pnpm --filter @erp/api exec tsx
../../audit-evidence/phase051-w37/scratch-rls-proof.ts`, the path
relative to the filter's apps/api cwd — the FIRST try, no invocation
slip this wave): initdb a scratch embedded PG16 → apply the chain from
zero (the W-37 additive slot 0125 — the chain 125) → `check:rls` →
clean shutdown — run TWICE, both logs kept: **run 1**
`check-rls-scratch-125-run1.log` and **run 2**
`check-rls-scratch-125-run2.log` (run 2 at its own SCRATCH_PORT 5498),
each CHAIN_125_APPLIED → **[check-rls] OK — 354 catalog tables** →
SCRATCH_STOPPED, EXIT=0.

## THE HONEST CATCH (one this wave, first-RED-proven then repaired, disclosed at the claim sites — no battery red standing anywhere)

**THE CATCH-INSIDE-THE-TRANSACTION (the customs spec's first RED — the
step-2 DB run):** the completion-refusal arms' first shape caught the
refusal INSIDE the `withTenant` callback (`.catch((error) => error)`
within the transaction) — the refusal was swallowed before the drizzle
transaction boundary, so the transaction SUCCEEDED and COMMITTED the
completion stamp: the tie-law arms found the declarations COMPLETED
instead of rolled back (INV-036's all-or-nothing NOT proven by that
shape). The repair moves the catch OUTSIDE the `withTenant` so the
refusal propagates through the transaction and the ROLLBACK actually
happens (the declaration stays ACCEPTED, zero landed-cost documents,
zero journals — INV-018 proven for real). Also disclosed in the same
first RED: the fail-closed arm's expected arithmetic (72 × 5% = 3.6 +
5 = 8.6000 — the expectation was mis-summed to 8.5600) and the
cancel-after-submit arm's message (the generic raced wording — the
service now carries the SPECIFIC 0121 stamp-shape floor reason BEFORE
the CAS). All three repaired in the step-2 commit; the re-run GREEN.

## The standing battery (every log this session, every stamp green — captured at the FINAL code state)

| Check | Verdict | Log |
|---|---|---|
| typecheck | **8/8** (0 cached — the turbo `--force` re-run) | `typecheck.log` |
| lint | **8/8** (0 cached — the turbo `--force` re-run) | `lint.log` |
| depcruise | clean — **2,234 modules · 16,668 dependencies** (+1/+22 dated — the customs spec joins; zero cycles: the PurchasingModule import one-directional) | `depcruise.log` |
| unit workspace | 8/8 — **173 files · 2,093 tests** (api 84·1,049 · web 30·204 · mobile 27·393 · desktop 16·274 · ui 3·43 · contracts 2·56 · domain-core 6·38 · sync-core 5·36 — the ledger arithmetic **2,093 = 1,049+204+840 EXACT**, an API-DB wave) | `unit-workspace.log` |
| permissions drift | **357 = 357** (unchanged — no key this wave; the W-37 routes bind the EXISTING 0122-seeded keys: trade.customs.view over the reads, trade.customs.manage over the register acts) | `permissions-drift.log` |
| i18n parity | ar=en catalogs 100% key parity (no delta, as declared — an API-DB wave) | `i18n-parity.log` |
| mobile i18n / tokens | parity standing (371 = 371) · canonical ⊆ mobile | `mobile-i18n.log` / `mobile-tokens.log` |
| manifests | 13/13 | `manifests.log` |
| capabilities | agree | `capabilities-matrix.log` |
| docs:validate | 33/33 (re-run green AFTER this wave's doc edits — the log the post-edit run's own) | `docs-validate.log` |
| id-ledger | 0 errors — implemented G 63 · INV 35 · BR 104 · reservations 14 phases · 30 ids | `id-ledger.log` |
| id-ledger self-test | all probes OK ✓ (probe 7 stands at G-64/PHASE-051 — the 051 flip is W-42's) | `id-ledger-self-test.log` |
| history-secrets | **0 violations** · 7,154 allowlisted hits (the window's shift: the W-37 session's commits entering the last-200 sample; the FIVE tag anchors untouched — phase/046 `4ddb39f` · phase/047 `5b73bd1` · phase/048 `ba459ff` · phase/049 `41c3701` · phase/050 `01f61a7`) | `history-secrets.log` |
| ROUTE_PERMISSIONS | **1,188 + 11 = 1,199** (the keys-seed-first FOURTH trade binding wave, dated at the block — the customs family's eleven routes; the tsx recount this session, ROUTE_PERMISSIONS_COUNT=1199) | (the static recount, this session) |
| desktop-shell / mobile-shell | PASS / PASS | `desktop-shell.log` / `mobile-shell.log` |
| boundary-negative | PASS | `boundary-negative.log` |

**The static constants (recounted this session):** the chain **124 →
125** (0125 — the landed-cost declaration source + the line-level tie +
the exactly-once partial unique) · ENTITY_CATALOG **354** (no change —
no tables this wave, only additive columns) · the drift **357 = 357**
(no key change) · ROUTE_PERMISSIONS **1,199** (+11, dated) · the report
registry **122** (zero change — the +4 are W-40's) · the unit ledger
**173 · 2,093** (+1/+11 — the duty/VAT fold's property tests) · the DB
suite **307 → 308 · 4,422 → 4,432** (+1/+10 — the trade-customs spec)
· the i18n catalogs **7,253 standing** (an API-DB wave) · the tenancy
CoA pins **82 accounts · 59 purposes** (unchanged — the 0122 markers
standing).

## The physical-file census (the exact-commit-count law)

The wave's commits, in order: `af76c7b` (the customs engine — 16 files:
the fold + its spec · the service · the gate · the store extension ·
the controller · the module wiring · the migration 0125 + the journal ·
the manifest + the migrations spec + the route permissions + the error
filter + the purchasing store/service extensions) · `bb3a3fb` (the DB
spec — 2 files: the trade-customs spec + the service's cancel-reason
repair) · this gate increment (the evidence envelope — the README +
parts.json + the three coverage files + the scratch proof ts + the logs
— + the acceptance ledger + NEXT_ACTION + IMPLEMENTATION_STATUS).
Every push declared its copy count at the time; the battery evidence is
this final increment's own session.

**NOT production approval — تسليم لا قبول.** W-38 (the bonded
warehouse + duty drawback — T-11 + T-12: the in-bond transfer with NO
duty entry through the REAL movement core (G-66 — D-08) + THE SHARED
GATE at planIssue blocking the duty-suspended stock from customer issue
+ the release recognizing the duty EXACTLY ONCE (BR-107) + the drawback
claims' export-evidence gate (BR-108 — D-12)) waits on the owner's
dispatch under the standing order. RISK-033: EIGHT incidents, ZERO new
this wave — the row stays OPEN, closing only by the owner's order. The
standing recalls ride the 050 completion report §4. The reservations
G-64…G-66 · INV-036 · BR-105…BR-108 — لا كتابة خارجها — as reserved,
never narrower.
