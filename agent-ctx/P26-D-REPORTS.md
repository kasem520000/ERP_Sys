# P26-D (REPORTS) — T11: the 3 fixed-assets report contracts

Task ID `P26-D` · PHASE-026 (Fixed Assets & Depreciation) · ERP monorepo
`/home/z/phase017_work`. Status: **DONE** — `pnpm exec tsc --noEmit` clean;
reporting unit suite + fixed-assets math suites green (86 tests, incl. the
registry meta-tests at the new count).

## 1. Files + LOC

NEW (all under `apps/api/src/modules/reporting/registry/fixed-assets/`):

| File | LOC | Content |
|---|---|---|
| `fixed-assets-queries.ts` | 805 | The reporting-owned query surface (`FixedAssetsQueriesService`, `@Injectable`, ambient tenant tx — the manufacturing-queries precedent): `assetRegister`, `assetRegisterTies`, `depreciationSchedule`, `assetMovements` + shared date-anchored CTEs (`cap`/`disp`/`lines_asof`/`units_asof`/`rev_asof`) |
| `asset-register.contract.ts` | 232 | `fixed_assets.asset-register` — as-of register, filters (asOf/branches/category/status/custodian), footer totals + INV-023 note, `fa-cost-tie` + `fa-accum-tie` block-on-fail |
| `depreciation-schedule.contract.ts` | 189 | `fixed_assets.depreciation-schedule` — posted-to-date (current basis) + method-aware remaining (SL months / DB base at rate / UoP units) + next-period projection |
| `movements.contract.ts` | 252 | `fixed_assets.movements` — acquisitions/revaluations/depreciation(+reversals)/disposals with journal provenance + per-kind totals + journal drill |

EDITED (marked `// PHASE-026` appends, all mirror the PHASE-016→019 precedent
in the same lists — +37/−6 lines total):

- `reporting/application/contract.ts` — `DataSourceModule` gains
  `"fixed_assets"`; `ReportParams` gains `categoryId`/`custodianUserId`/
  `method`/`movementKind`/`fiscalPeriodId` (the phase017/019 param-addition
  precedent).
- `reporting/registry/runtime.ts` — `SOURCE_MODULES` + `MODULE_DATA_PHASE
  [fixed_assets] = 26` + `REGISTERED_PHASE_WINDOW` 19 → 26 (boot validation
  refuses the contracts without this — the §13 phase-readiness cross-check).
- `reporting/registry/services.ts` — `fixedAssets: FixedAssetsQueriesService`
  in the lazy singleton bundle.
- `reporting/registry/index.ts` — the three contracts appended to
  `REPORT_CONTRACTS` under a §9 marker.
- `reporting/reporting.module.ts` — `"fixed_assets.reports.view"` appended to
  the boot-validation `KNOWN_PERMISSION_KEYS` (without it the app fails at
  startup; the key IS seeded — migrations 0004/0037).
- `reporting/__tests__/reporting-unit.spec.ts` — registry meta-test count
  68 → 71 + the same permission key in the spec's mirror list (the file's own
  PHASE-018/019 precedent). No new test specs authored.

Untouched (verified via `git diff`): the store, P26-A/B/C service files, the
fixed-assets controller/module, migrations, docs, web.

## 2. Registry mechanism + where registered

The PHASE-013 pattern, mirrored exactly: a contract IS a `defineReport({...})`
module (kit defaults fill localization/posted-rates/tenant scope); boot
validation (`ReportingModule.onModuleInit` → `validateRegistry`) checks shape,
unique ids, permission existence, and §13 phase readiness. Registration needed
SIX coordinated edits (all listed in §1) — the anticipated index.ts append
plus the five enumerations the boot validation reads (DataSourceModule type,
SOURCE_MODULES, MODULE_DATA_PHASE, the phase window, the module's
KNOWN_PERMISSION_KEYS, and the meta-test's mirror of it). Every edit is a
pure append with a `PHASE-026` comment. Provenance per the catalog: dataSources
= `fixed_assets` (owned tables) + `accounting` (journal tie-out), permission
`fixed_assets.reports.view`, category `financial` (REPORT_CATALOG §9 "Financial
depth"), PDF/XLSX/CSV via the standard pipeline, `a4-report` print template,
as-of determinism declared via `freshness.semantics: "as-of"` (register +
schedule; movements is a window report → current/60s like the manufacturing
precedent).

## 3. The tie algebra (both sides, per category purpose key, whole tenant)

Register side (SQL fold over dated source rows; canonical 4dp, tolerance 0):

```
fa    = Σ cost of assets LIVE as-of + Σ (new_gross − cost) over POSTED revaluations with entry_date ≤ asOf
accum = Σ (opening_accumulated + L(asOf)) of live assets + Σ ((new_gross − cost) − delta) over the same revaluations
L(asOf) = Σ period_amount of POSTED runs' lines whose ORIGINAL entry (entry_date = period end) ≤ asOf
          − Σ lines whose REVERSAL entry has its OWN entry_date ≤ asOf
live-as-of = (no G-21 entry [uncaptured drift row — deliberately counted] OR G-21 entry_date ≤ asOf)
             AND NOT derecognized-as-of (posted disposal entry_date ≤ asOf, or terminal status with disposed_at/written_off_at::date ≤ asOf)
```

GL side: `journal.accountBalancesAt({ asOfDate, asOf: null })` (the
statement-queries entry-date anchor) over the accounts mapped (via
`journal.accountsForPurposes`) to the categories' `asset_purpose_key` /
`accum_depreciation_purpose_key` sets — FA side: Σ signed (DEBIT−CREDIT);
accum side: Σ **negated** signed balances (credit-positive register
convention — the GRNI RC-09 sign precedent). Categories with no assets fold
register=0 against the mapped account's balance (RC-10 loop-2 catch). Both
assertions (`fa-cost-tie`, `fa-accum-tie`) are `onFailure: "block-export"`
(`assertDecl`); the run-level FAIL blocks export server-side; the assertion
`detail` names the broken purpose keys with both values.

Deviation note (deliberate, documented in the contract notes): the ties are
computed WHOLE-TENANT at the same asOf — display filters (branch/category/
status/custodian) never narrow the ledger check, because journal_lines carry
no branch and RC-10 itself is tenant-wide.

## 4. GL as-of balance approach

REUSED the existing helper — no new balance SQL: `journal.accountBalancesAt`
(from `accounting/infrastructure/journal.store`) already returns per-account
`signedBalance` + `purposeKeys` with `entry_date ≤ asOfDate` (+ optional
posted_at timestamp anchor, passed `null` for pure date determinism), and
`journal.accountsForPurposes` resolves keys → accounts. The only journal SQL
written inside my query service is PROVENANCE/anchor reads (the G-21/G-23/G-22
entry dates + movements rows), mirroring how manufacturing-queries reads
journal_entries for its tie.

## 5. Deviations + justification

1. **Reversal anchoring by entry date, not `reversed_at`**: the store's live
   read model drops reversed-run lines unconditionally; the as-of
   reconstruction subtracts a reversal only when the reversal ENTRY's date ≤
   asOf (INV-014 lets a LOCKED-period reversal be dated "TODAY"). This is the
   only interpretation that ties to the GL as-of read on legitimate data;
   documented in the queries header + a register note.
2. **Status is derived as-of** (DISPOSED via the dated G-23 entry;
   FULLY_DEPRECIATED at the current-basis floor), never the live row — an
   asset disposed AFTER asOf shows its pre-disposal as-of state. The status
   filter matches the derived state.
3. **Register `accumulated` column is history-based** (opening + lines, no
   revaluation restatements) per the mission wording; the TIE adds the
   restatements separately — exactly the mission's "Σ accumulated +
   revaluation accum restatements" split. The schedule shows the
   current-basis (restated) figures since it mirrors the run math.
4. **Ties on the register only** — schedule/movements carry no GL assertion
   (the mission + catalog assign the ties to the register's footer; the
   schedule/movements are derived/provenance surfaces, like the operational
   manufacturing rows).
5. **Movements depreciation rows are per RUN ENTRY** (the journal is the
   movement; per-asset lines live in the run workspace/register) with INV-014
   reversals as signed rows; a run appears when any line asset is in the
   branch scope and keeps its whole-journal total (documented note). The
   per-kind totals net reversals.
6. **Schedule next-amount reuses P26-B's pure kernel** (`computeMonthlyAmount`
   + `monthIndexOf`/`addMonths`/`monthStartOf`/`round4` — consume-only
   imports) so the projection is exactly what the run would compute
   (revalued gross replaces cost, salvage stays, next-month convention,
   final-period residual absorption); UoP stays blank (manual usage, DR-002).
7. **RC-10 sign observation (SF candidate, NOT fixed — P26-C's file)**:
   `registerExpectedSides` folds the accum side POSITIVE while
   `controlAccountBalance` returns DEBIT−CREDIT (negative for the
   credit-natured accum account) and the comparison does not negate — unlike
   the GRNI precedent ("the comparison negates the GL side"). RC-10's live
   accum check may therefore report BROKEN on any tenant with posted
   depreciation. My report ties use the correct negated convention. Recommend
   P26-C/orchestrator confirm against the RC-10 golden DB spec before the
   serial gate.
8. **reporting.module.ts edit** (one marked line): required — the boot
   validation's KNOWN_PERMISSION_KEYS would fail startup for the new
   contracts; same registration-surface class as the index append.

## Verification

- `pnpm exec tsc --noEmit -p tsconfig.json` — clean (run 3×, final clean).
- `vitest run src/modules/reporting/__tests__/` — 50/50 (meta-tests at 71).
- `vitest run depreciation-math.spec.ts disposal-math.spec.ts` — green
  (imports of the P26-B kernel unchanged).
- ESLint on all touched files — clean.
- No DB specs touched (embedded-PG exclusivity respected; DB-suite proof of
  the seeded-mismatch block + byte-identical determinism runs at the
  orchestrator's serial gate).
