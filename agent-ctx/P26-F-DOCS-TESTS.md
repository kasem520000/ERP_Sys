# P26-F (DOCS+TESTS) — Work Record — T12 rules suite + T14 attack registration + docs sync

> Phase: PHASE-026 · Task ID: `P26-F` · Status: **COMPLETE** (my deliverables verified;
> the DB-suite RUN is orchestrator-only per the embedded-PG exclusivity rule).
> Siblings: P26-A (core), P26-B (depreciation), P26-C (lifecycle), P26-D (reports —
> IN FLIGHT while I worked; see deviations §7), P26-E (web — landed).

## 1. Files created/edited (mine only)

| File | LOC | Content |
|---|---|---|
| `apps/api/src/__db__/fixed-assets/fixtures.ts` | 274 | NEW — tenant F (6a6a6a6a…) + the S-04 spoof-target tenant (6b6b6b6b…) with fixed foreign fixture ids; the CoA substrate (0037's six FA purposes, belt-and-braces mapping per the manufacturing precedent), FY2026 + periods, MAIN branch, the mapped F-VEH category; service instances (categories/assets/capitalization/depreciation/runs/revaluations/disposals + periods) |
| `apps/api/src/__db__/fixed-assets/fixed-assets-rules.spec.ts` | 440 | NEW — BR-041…BR-044 (BUSINESS_RULES §8 row; ACCOUNTING_TESTS §1 conventions) |
| `apps/api/src/__db__/fixed-assets/spoof.spec.ts` | 198 | NEW — S-04 foreign-reference attacks + A7 unknown-vs-foreign parity (SECURITY_TEST_PLAN §2 PHASE-026 row) |
| `apps/api/src/__db__/isolation/tables.registry.ts` | +15 | the six PHASE-026 tables registered |
| `apps/api/src/__db__/isolation/identity-isolation.db.spec.ts` | +149 | NO_UPDATE_GRANT += depreciation_lines; seedFixtures ×6 tables ×2 tenants; OWN_ROW ×6; MISMATCHED_INSERT ×6 |
| `docs/database/TABLES/fixed-assets.md` | 156 | NEW — the in-phase TABLES spec (grow-per-phase rule; the manufacturing.md shape) |
| `docs/security/SECURITY_TEST_PLAN.md` | +3 | §2 per-phase attack table: PHASE-026 row |
| `docs/accounting/RECONCILIATION.md` | +7/−3 | §1 row 10 deferred → PHASE-026 (RC-10 `FIXED_ASSETS` activation, per-category algebra named); §3 item 3 close-block list += fixed assets |
| `docs/accounting/PERIOD_CLOSING.md` | +5/−1 | §2 checklist item 8 — the advisory "depreciation run POSTED for the closing period" (never blocks; NOT_APPLICABLE without live assets) |
| `docs/testing/ACCOUNTING_TESTS.md` | +9/−1 | §1 module-rule-suite bullet (`fixed-assets-rules.spec` + the spoof battery); §5 RC-11 fixed-assets row (RC-10 in this doc's own numbering is already "determinism" — the new row points at the authoritative RECONCILIATION §1 row-10 name) |
| `docs/database/DATA_DICTIONARY.md` | +7/−1 | §14 += the five fixed-assets column-semantics rows (opening_accumulated, period_amount/accumulated_amount, period_units, disposal snapshots, revaluation basis) |
| `docs/implementation/phases/PHASE-026.md` | +1/−1 | header Status: PLANNED → **IN PROGRESS** (COMPLETION left to the orchestrator) |
| `docs/planning/IMPLEMENTATION_STATUS.md` | +1/−1 | PHASE-026 row NOT_STARTED → IN_PROGRESS with the landed-scope note |
| `docs/handoff/CHANGELOG.md` | +51 | the PHASE-026 entry (IN-PROGRESS marker; gate evidence slots left to the orchestrator) |

Untouched (verified pre-authored, matching what was built — my checklist items that
needed NO change): BUSINESS_WORKFLOWS §11 (the asset-lifecycle mermaid already
covers categories → register → G-21 → G-22 → revaluation → G-23 incl. the loss
mirror), SCOPE_AND_NON_GOALS ED-18 (already "moved out of the deferral table into
planned scope — delivered by PHASE-0026 (DR-002)"), ENTITY_CATALOG §fixed_assets
(six rows pre-authored; the doc carries NO table-count statement — nothing to bump),
and the whole pre-authored set JOURNAL_RULES §7 / ACCOUNTING_INVARIANTS INV-023 /
POSTING_ENGINE §4.1 / FEATURE_CATALOG §19 / AUTHORIZATION_MATRIX §3.11+§4 /
NAVIGATION_MODEL / REPORT_CATALOG / BUSINESS_RULES BR-041..044 (constraint item 12).

## 2. The isolation registry mechanism + what was added per table

Mechanism (unchanged): `tables.registry.ts` is the single enumeration the generated
suite iterates — `TENANT_TABLE_NAMES` drives (a) the registry-completeness proof
(every `tenant_id`-bearing `public` table must be registered), (b) the structural
catalog assertions (FORCE RLS + `tenant_isolation` USING/WITH CHECK applicable to
erp_app), (c) the per-table A1–A10 loop, which reads three local maps: `OWN_ROW`
(id pairs for the A4/A7 probes), `MISMATCHED_INSERT` (the A3 shapes — single `$1` =
the foreign tenant id, FK refs pointing at the attacker's OWN tenant rows so the
RLS WITH CHECK is the isolated rejection), and the policy sets
(`NO_UPDATE_GRANT` / `DELETE_GRANTED` / `variantTemplateRows`). `seedFixtures`
seeds one FK-consistent row per registered table per tenant; A2's count expectation
defaults to 1/table (`EXPECTED_ROWS_PER_TENANT` needed no additions).

Added per table (migration 0037 facts):
- **asset_categories** — registered plain; seeded VEH category (three standard
  purpose keys, active); mismatched INSERT 'ATK-FA'. Grants S/I/U → default
  A4 `updated_at` probe, A5 42501 (no DELETE).
- **assets** — registered plain; seeded 'A-ISO-001' (cost 12000/salvage 0/opening
  0/60m SL/ACTIVE) with composite FKs to the tenant's OWN category + branch;
  mismatched INSERT references tenant B's category+branch.
- **depreciation_runs** — registered plain; seeded DRAFT run on the tenant's OWN
  fiscal period (the c2c2c2c2 fixture); mismatched INSERT targets tenant B's period
  (RLS WITH CHECK fires before the uq_tenant_period index — CHECK+policy precede
  index insertion, so 42501 stays the isolated rejection).
- **depreciation_lines** 🔒 — registered + **NO_UPDATE_GRANT** (erp_app holds
  SELECT/INSERT only — the journal_lines/stock_moves append-only precedent; the
  `erp.depreciation_lines_guard` trigger is the defense-in-depth layer behind the
  grant denial; the table's own `updated_at` column satisfies the A4 probe's
  default fallback). A5 proves the missing DELETE grant (42501). Seeded line (run +
  asset composite FKs, period_amount 200 > 0 CHECK).
- **asset_disposals** — registered plain; seeded DRAFT SCRAP (proceeds 0, frozen
  NBV/accum/gain-loss honoring the ≥ 0 CHECKs, disposal_no NULL under the partial
  unique index); mismatched INSERT on tenant B's asset.
- **asset_revaluations** — registered plain; seeded DRAFT (basis CHECKs satisfied,
  reason 'iso fixture'); mismatched INSERT on tenant B's asset.

The registry-completeness test now demands all six names — the negative proof the
phase requires (a new tenant-owned table shipping unregistered fails the build).

## 3. fixed-assets-rules.spec coverage map (BR → test)

| Rule | Test | Assertion core |
|---|---|---|
| BR-041 | `unmapped category blocks asset creation` | category staging allowed; `assertCategoryUsable` (the shared posting gate) throws `CATEGORY_NOT_USABLE` with `details.missingPurposeKeys = [FA_ACCUM_UNMAPPED]`; `assets.create` under it → same typed error; zero register rows |
| BR-041 | `IN-USE category steering` | an asset-holding category patched onto the unmapped accum key → `CATEGORY_NOT_USABLE`; mapping unchanged after the rejection (a live category can never produce invalid journals) |
| BR-041 | `map it → works` | `insertAccountPurpose(FA_ACCUM_UNMAPPED → 1220)` then `assets.create` under the previously-unusable category → ACTIVE |
| BR-042 | `run posts G-22 via the DEPRECIATION_RUN source` | next-month convention (Jan acquisition → first line Feb 200.0000); postRun → run POSTED + journalEntryId; `findEntryBySourceKey("DEPRECIATION_RUN", runId, "post")` exists (depreciation enters the ledger ONLY through run documents); lines exactly `[5300 DEBIT 200.0000, 1220 CREDIT 200.0000]`; entryDate = 2026-02-28 |
| BR-042 | `one run per period` | second `assembleRun` after the run POSTED → 409 `DEPRECIATION_RUN_PERIOD_TAKEN` |
| BR-042 | `period-locked` | softClose+lock March → `postRun` → `PERIOD_LOCKED` (INV-011); INV-020 reopen restores the period (cross-suite hygiene) |
| BR-043 | `salvage floor` | asset at cost−salvage (opening_accumulated = base) → April assembly excludes it `AT_FLOOR`, no line, `flippedToFullyDepreciated` contains it, register flips FULLY_DEPRECIATED |
| BR-043 | `disposal locks` | draft freezes NBV 10000/gain −2000; SoD: creator approve → `SELF_APPROVAL_BLOCKED`, second user approve OK; post → POSTED + `DSP-2026-\d{6}`; asset DISPOSED + disposedAt; G-23 legs exactly `[CASH DR 8000, FIXED_ASSET CR 10000, ASSET_DISPOSAL_LOSS DR 2000]` (mandatory loss mirror); second disposal → `DISPOSED_ASSET_REUSE` |
| BR-044 | `audited, delta to reserve` | blank reason → `FIXED_ASSET_LIFECYCLE_INPUT_INVALID`; draft freezes delta 2000.0000; post → POSTED; journal exactly `[FIXED_ASSET DR 2000, REVALUATION_RESERVE CR 2000]` (never P&L); `audit_events` carries `fixed_assets.asset_revaluation_posted` for the entity |
| BR-044 | `DISPOSED rejection` | draft on the BR-043-disposed asset → `ASSET_STATUS_INVALID` (INV-023 terminal states) |

Suite placement note: the phase doc names `tests/fixed-assets/fixed-assets-rules.spec.ts`;
the db-suite config includes only `src/__db__/**/*.spec.ts`, so the file lives at
`apps/api/src/__db__/fixed-assets/fixed-assets-rules.spec.ts` — exactly where the
sibling rule specs live (`src/__db__/treasury/treasury-rules.spec.ts`).

The S-04 spoof battery (`spoof.spec.ts`, SECURITY_TEST_PLAN §2 PHASE-026 row):
foreign category → `ASSET_CATEGORY_NOT_FOUND`; foreign branch → `BRANCH_NOT_FOUND`;
foreign-tenant custodian (a user that EXISTS globally, member of the spoof tenant
only — membership-scoped A7) → `USER_NOT_FOUND`; foreign asset on disposal/revaluation
draft → `ASSET_NOT_FOUND`; foreign fiscal period on assembly → `PERIOD_NOT_FOUND`;
each with zero-partial-creation proofs (tenant-F register scans / superuser counts
keyed on the FOREIGN id — order-independent against the rules spec), plus the A7
unknown-vs-foreign parity probes on assets + categories. The foreign fixtures are
SELF-SEEDED by the fixed-assets fixtures (a dedicated spoof-target tenant), because
this folder sorts BEFORE `isolation/` in the serial suite — referencing the
isolation suite's tenant-B rows would be order-fragile (the treasury spoof could
lean on them only because `treasury/` sorts after `isolation/`).

## 4. Docs diff summary

| File | Change |
|---|---|
| SECURITY_TEST_PLAN §2 | PHASE-026 API-spoofing row (the phase-doc §2 item-12 text: the three asset-create foreign refs incl. the membership-scoped custodian note, the disposal/revaluation foreign asset, the foreign-period run — typed 404 + S-04 + A7 + the registry note) |
| RECONCILIATION | row 10 "deferred" → RC-10 `FIXED_ASSETS` PHASE-026 with the per-category Σgross = FIXED_ASSET / Σaccumulated = ACCUM_DEPRECIATION algebra; §3 close-block list += fixed assets (PC-04 — matches the wired `assertCoreChecksGreen` kind list) |
| PERIOD_CLOSING §2 | advisory item 8 (non-blocking by design — mirrors `depreciationRunAdvisory`'s never-BROKEN contract) |
| ACCOUNTING_TESTS | §1 module-rule-suite bullet; §5 RC-11 row (naming collision avoided: this doc's RC-10 is "determinism" — the new row cites the authoritative RECONCILIATION §1 row-10 identity) |
| DATA_DICTIONARY §14 | five fixed-assets rows (opening_accumulated; period_amount/accumulated_amount; period_units; disposal snapshots; revaluation basis incl. the frozen-delta rule) |
| TABLES/fixed-assets.md | NEW: six tables' column-level specs (constraints, uniques incl. the partial-index lesson, the append-only grants + guard, RLS + purge path, the RC-10 widening, the six CoA markers, the 13-key permission seeds + plan/role grants) |
| PHASE-026.md | Status PLANNED → IN PROGRESS |
| IMPLEMENTATION_STATUS | PHASE-026 row → IN_PROGRESS (landed scope; orchestrator flips COMPLETE on gate evidence) |
| CHANGELOG | PHASE-026 entry (IN-PROGRESS marker; everything landed, gate slots open) |
| Updated-date bumps | the six materially-edited docs → 2026-11-07 |

## 5. docs:validate output

`pnpm run docs:validate` → **29/29 checks passed** (305 markdown files — +1 for the
new TABLES spec; no broken links introduced; all v2.0 cross-reference checks still
green). Also run: `check:permissions-drift` → OK (matrix 244 = seed 244 — the §3.11
pre-authoring + 0037 seeds agree). `check:rls` requires MIGRATE_DATABASE_URL (live
DB) — orchestrator's serial gate leg, not run here per the embedded-PG exclusivity.

## 6. Typecheck output

`pnpm exec tsc --noEmit -p tsconfig.json` (apps/api — the db specs ARE in the
tsconfig include): **my files produce ZERO errors** — verified twice; the first run
(19:26) was green for the whole project, and a second run (19:30) surfaced errors
ONLY in `src/modules/reporting/registry/fixed-assets/*.contract.ts` — the P26-D
agent's files landing mid-flight (timestamps 19:27–19:29, minutes before the run;
see deviations). `pnpm exec eslint src/__db__/fixed-assets/ src/__db__/isolation/` →
clean (exit 0). NO db-suite run, NO embedded-PG boot, NO `Math.*` anywhere in my
specs (Decimal-exact string assertions only).

## 7. Deviations + honest notes

1. **P26-D (REPORTS) was landing in parallel** — their
   `reporting/registry/fixed-assets/*.contract.ts` files appeared DURING my final
   typecheck and currently carry zod-typing errors (`ZodOptional<ZodNullable<…>>` vs
   the `ReportParams` contract — nullable-vs-optional on categoryId/movementKind).
   NOT my file ownership (constraint: never modify api service files); flagged here
   so the orchestrator gates on it. My CHANGELOG entry deliberately does NOT claim
   the three report contracts (it lists only the P26-A/B/C/E/F slices).
2. **ACCOUNTING_TESTS RC numbering**: the phase docs call the fixed-assets check
   "RC-10" (RECONCILIATION §1 row 10), but ACCOUNTING_TESTS §5 already uses RC-10
   for "determinism" (pre-authored). Added the check as **RC-11** with the
   authoritative pointer — no pre-authored row was renumbered.
3. **Spoof fixtures are self-seeded** (a dedicated spoof-target tenant with fixed
   ids) rather than borrowing the isolation suite's tenant-B rows — the
   fixed-assets folder sorts before `isolation/` in the serial suite, so the
   treasury spoof's cross-folder dependency pattern would be order-fragile here.
4. **BR-042's "no manual asset journals"**: read the manual-journal surface —
   manual journals post arbitrary purposes through the same engine (no FA-purpose
   block exists, by design — the engine is source-agnostic). The proof encoded is
   therefore the mission's sanctioned fallback: G-22 posts ONLY via the
   `DEPRECIATION_RUN:{runId}:post` source (asserted), period-locked, one run per
   period. The policy note itself lives in the phase doc §7 (constraint text) —
   no code change needed or made.
5. **The steering test seeds a far-future asset** (F-BR041-SEED, acquired
   2026-12-01) so the BR-041 in-use proof never perturbs the BR-042/043/044 run
   math (BEFORE_ACQUISITION exclusion keeps assemblies deterministic).
6. **CHANGELOG/status honesty**: the entry + IMPLEMENTATION_STATUS row mark the
   phase IN PROGRESS with the serial orchestrator gate pending — the completion
   flip, gate numbers, and the PHASE-026-COMPLETION.md report remain the
   orchestrator's (my instructions: leave COMPLETION to the orchestrator).
7. **The `F_JAN`/`F_DISPOSAL_DATE`/`F_REV_DATE` fixture date exports** are
   documented constants (the treasury-fixture T_FEB pattern); the specs inline the
   few dates they need — left for the orchestrator's golden suites to consume.
