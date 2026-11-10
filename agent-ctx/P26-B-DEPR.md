# P26-B (DEPR) — Work Record — Depreciation Engine: T6 (calc + assembly job) + T7 (run post/reverse)

> Phase: PHASE-026 · Task ID: `P26-B` · Status: **COMPLETE**
> Re-run note (P26-B second pass, time-boxed): the first pass landed all five
> files + the module append but timed out before the orchestrator saw closure;
> this pass RE-VERIFIED everything (tsc GREEN · spec 17/17 · eslint GREEN) and
> CLOSED the one open wiring item — the P26-B marker slot in
> `presentation/fixed-assets.controller.ts` now carries the depreciation-run
> routes (see §5, updated: routes are LANDED, no longer orchestrator-owned).
> Verification: `pnpm exec tsc --noEmit -p tsconfig.json` GREEN (whole api project, incl. the
> parallel-landed P26-A/P26-C files) · `pnpm exec vitest run
> src/modules/fixed_assets/application/depreciation-math.spec.ts` **17/17 GREEN** (pure unit —
> no DB; confirmed NOT under the db config: `vitest.config.ts` includes `src/**/*.spec.ts`
> excluding `src/__db__/**`, while `vitest.db.config.ts` includes only `src/__db__/**`) · `pnpm exec eslint
> src/modules/fixed_assets/` GREEN. NO `test:db` / embedded-PG touched (orchestrator-only).
> Files touched: ONLY the five P26-B files below + the sanctioned clearly-marked appends to
> `fixed_assets.module.ts` (providers/exports/onModuleInit) and the P26-B marker slot in
> `presentation/fixed-assets.controller.ts`. Store, migration, schema.ts, docs, web: UNTOUCHED.

## 1. Files + line counts (all under `apps/api/src/modules/fixed_assets/`)

| File | Lines | Content |
|---|---|---|
| `application/depreciation-errors.ts` | 169 | Error contract: `DepreciationRunNotFoundError` (DEPRECIATION_RUN_NOT_FOUND), `RunAlreadyExistsError` (DEPRECIATION_RUN_PERIOD_TAKEN), `RunNotPostableError` (DEPRECIATION_RUN_NOT_POSTABLE), `PeriodLockedForRunError` (**code PERIOD_LOCKED** — wraps the engine taxonomy shape), `AssemblyValidationError` (DEPRECIATION_ASSEMBLY_REJECTED, carries per-asset `rejections[]`), `UoPUnitsRequiredError` (UOP_UNITS_REQUIRED, lists assets), `NbvFloorViolationError` (NBV_FLOOR_VIOLATION), `AssemblyCancelledError` (DEPRECIATION_ASSEMBLY_CANCELLED), `DepreciationAssetInvalidError` (DEPRECIATION_ASSET_INVALID). Asset lookups throw **P26-A's** `AssetNotFoundError` (imported — see §6.1). |
| `application/depreciation-service.ts` | 901 | T6: pure month arithmetic, the 3-method kernel `computeMonthlyAmount`, `runBasisOf` (DR-002 §4 revalued basis), `eligibleAssetsForPeriod`, `DepreciationService.assembleRun` (create-or-reuse + chunked/cancelable compute + totals + at-floor flips), `recomputeDraftLine` (workspace edit), `cumulativePostedUnits`. |
| `infrastructure/depreciation-assembly.job.ts` | 284 | ADR-0008 bounded job: queue `fixed-assets.depreciation.assembly`, `enqueueAssembly(runId, actorId, extras?)`, `startAssembly` (controller entry — create-or-reuse + enqueue + `assembly_job_id` stamp), `cancelAssembly`/`isAssemblyCancelled` (in-process flag + best-effort `boss.cancel`), `runAssemblyJob` (plain-callable body), `registerDepreciationJobs(boss)` (PHASE-023 pattern: tolerant createQueue + work handler; cancel ≠ failure). |
| `application/run-service.ts` | 576 | T7: `postRun` (G-22 via PostingService, period-locked, INV-013 replay, floor flips, audit `fixed_assets.depreciation_run_posted`), `reverseRun` (engine INV-014 counter-entry, run reversal columns, un-flip, audit `fixed_assets.depreciation_run_reversed`), `listRuns`/`getRun`/`getRunWorkspace` (workspace view: lines + asset/category context + live basis NBV preview). |
| `application/depreciation-math.spec.ts` | 380 | INV-023 property battery (fast-check v3, PURE unit — no DB): SL/DB/UoP Σ-exactness ×120 tuples each + goldens + month-convention + half-up monotonicity/bound ×200. |
| `fixed_assets.module.ts` | +marked block | **Append only** (P26-B markers): providers+exports `DepreciationService`, `RunService`; `onModuleInit` → `registerDepreciationJobs(getBoss()).catch(degrade)` (tax-module circuit-breaker pattern). |

## 2. The exact derivations encoded (DR-002 pointers)

- **Month convention — NEXT-MONTH (the acquisition month does NOT depreciate).** DR-002 fixes
  the authority but no numeric rule; the conservative Arabic-market standard (Qoyod et al.) is
  encoded: eligible iff `monthIndexOf(acquisitionDate, period.startDate) ≥ 1` (pure integer
  year×12+month arithmetic — no Date, no Math.*). Golden fixture: 12,000 / 0 salvage / 60m SL
  acquired 2026-01-15 → 2026-01 run EXCLUDES it; first run 2026-02 at 200.0000/month.
- **STRAIGHT_LINE**: `round4(base / life)` capped at headroom (BR-043 floor).
- **DECLINING_BALANCE**: DR-002 names "rate on opening NBV" without a number — the documented
  default shipped is the **straight-line-equivalent monthly fraction `rate = 12 /
  useful_life_months`** (60m asset → 20%/month of opening NBV). Amount =
  `min(round4(openingNBV × rate), openingNBV − salvage)` — the cap IS the floor enforcement.
  Golden: 12,000/2,000/48m → rate 0.25, month 1 = 3,000.0000.
- **UNITS_OF_PRODUCTION**: `round4(base × period_units / total_estimated_units)` capped at
  headroom; usage is MANUAL per line (`unitsByAssetId`, DR-002 no-metering; missing →
  UOP_UNITS_REQUIRED listing the assets; the workspace edits then re-assembles).
- **Final-period residual absorption (INV-023)**: the period at monthIndex ≥ life (SL/DB) or
  where cumulative units reach the estimate (UoP) takes the WHOLE remaining headroom →
  **Σ over the life = cost − salvage EXACTLY**; every other period is min(formula, headroom)
  so accumulated ≤ base always. Property-proven across 3×120 randomized tuples.
- **Revalued basis (DR-002 §4, per P26-C's wiring gap)**: runs compute on `runBasisOf(asset)` —
  gross = last POSTED revaluation's `new_gross_value` (else `cost`); accumulated =
  `new_accumulated + (history − revaluation-time oldAccum)` (oldAccum via P26-C's frozen-delta
  `revaluationOldAccumulated`). That composition equals the RC-10 GL side (history + r) exactly;
  salvage stays the register's (the revaluation model restates no salvage). NOTE: P26-C's
  `currentBasis()` alone freezes at reval time (drops post-reval posted lines) — the runs use
  the corrected composition; flag to P26-C/orchestrator for any other consumer.
- **Rounding**: half-up 4dp via `@erp/domain-core` Decimal everywhere; **zero `Math.*`** in all
  five files (lint clean).

## 3. G-22 journal shape (line list, goldens assert this)

One journal per run: source `{ docType: "DEPRECIATION_RUN", docId: runId, operation: "post" }`,
entryDate = period.end_date, explicit `fiscalPeriodId` (engine re-validates), currency = base,
`softCloseReason` passthrough (PC-02 — permission `accounting.periods.post_to_soft_closed` is
the route's duty). Golden (12,000/0/60m, one asset, category VEH):

| Line | Direction | Purpose | Amount | Memo |
|---|---|---|---|---|
| 1 | DEBIT | `DEPRECIATION_EXPENSE` (category expense key) | 200.0000 | `Depreciation — A-001 … (2026-02)` / `إهلاك — …` |
| 2 | CREDIT | `ACCUM_DEPRECIATION` (category accum key) | 200.0000 | `Accumulated depreciation — A-001 (2026-02)` / `مجمع الإهلاك — …` |

Per-asset DR/CR pairs (balanced by construction) for runs ≤ **50 assets**; above that, pairs
collapse per category (2 lines per category, Σ amounts) — bounded journal size, documented
(`PER_ASSET_LINE_CAP`). After post: run → POSTED + posted_at/by + journal_entry_id; assets
hitting the basis floor flip FULLY_DEPRECIATED (ACTIVE only — disposal locks win); audit. The
failure packs: LOCKED → PERIOD_LOCKED; SOFT_CLOSED without reason → PERIOD_LOCKED; unmap a
category purpose → engine PURPOSE_NOT_MAPPED; duplicate post → INV-013 replay of the stored
entry; empty/unassembled run → DEPRECIATION_RUN_NOT_POSTABLE.

## 4. Property-suite results (17/17 green)

- SL: 120 randomized (cost 1..10M, salvage < cost, life 1..600) tuples → Σ = base EXACTLY,
  floor never crossed, flip reached; goldens 200.0000×60 = 12,000; 1000.0001/36 → 27.7778×35 +
  27.7771; 1000/900/12 → Σ = 100.
- DB: 120 tuples → Σ = base EXACTLY (rate 12/life); at-floor kernel returns 0.0000+flip.
- UoP: 120 tuples (random usage partitions landing exactly on the estimate) → Σ = base
  EXACTLY; golden 250/750 units → 1125.0000 + absorbed 3375.0000; zero-usage = 0.0000 (no
  line); missing units → UOP_UNITS_REQUIRED.
- Month convention goldens (index 0 ineligible, 1 first eligible, 60 = life end) + pure
  addMonths rollovers.
- Half-up: monotone ×200, error ≤ 0.00005 ×200, boundary cases.

## 5. Wiring — controller routes LANDED this pass; the rest is the orchestrator's

**Controller routes** (this pass appended at the P26-B marker slot at the bottom of
`presentation/fixed-assets.controller.ts` — the seam P26-A left; constructor now injects
`DepreciationService` + `RunService`, imports `startAssembly`/`cancelAssembly` from the job
file, `ForbiddenError` from the identity api barrel):

| Route | Permission | Calls |
|---|---|---|
| `GET /api/v1/fixed-assets/depreciation-runs` (`?status=DRAFT\|POSTED&limit=`) | `fixed_assets.depreciation_runs.view` | `RunService.listRuns` |
| `GET /api/v1/fixed-assets/depreciation-runs/:id` | `fixed_assets.depreciation_runs.view` | `RunService.getRunWorkspace` (run + period + lines + NBV preview) |
| `POST /api/v1/fixed-assets/depreciation-runs/assemble` (body: `fiscalPeriodId`, `unitsByAssetId?` uuid→units map) | `fixed_assets.depreciation_runs.run` | `startAssembly({...body, actorId})` (job file) — returns `{ runId, jobId, reusedDraft }`; the UOP_UNITS_REQUIRED / ASSEMBLY_REJECTED errors carry the asset lists for the workspace |
| `POST /api/v1/fixed-assets/depreciation-runs/:id/cancel-assembly` | `fixed_assets.depreciation_runs.run` | `cancelAssembly(id)` (ADR-0008 cancel surface) |
| `POST /api/v1/fixed-assets/depreciation-runs/:id/lines/:assetId/units` (body: `periodUnits` ≤ 6dp) | `fixed_assets.depreciation_runs.run` | `DepreciationService.recomputeDraftLine(id, assetId, periodUnits)` (whole-DRAFT reset+recompute — the append-only 🔒 sanctioned edit) |
| `POST /api/v1/fixed-assets/depreciation-runs/:id/post` (body: `softCloseReason?` 3..500) | `fixed_assets.depreciation_runs.post` | `RunService.postRun` — **PC-02 at the route**: a present `softCloseReason` additionally requires `accounting.periods.post_to_soft_closed` (imperative check on the guard-resolved `identity.permissions`, fail-closed `ForbiddenError` — the journals route passes the reason through without the extra key; here the service comment demanded the route-side check) |
| `POST /api/v1/fixed-assets/depreciation-runs/:id/reverse` (body: `reason` 1..500) | `fixed_assets.depreciation_runs.run` | `RunService.reverseRun` |

All POSTs ride the global Idempotency-Key header guard (presence-only — no route
registration needed; callers send `dep:run:{runId}` per the key convention).

**Error-filter statuses** (`infra/http/error.filter.ts` — none of my classes are mapped yet;
unmapped DomainError defaults to 422): add 404 → `DepreciationRunNotFoundError` (+
`DepreciationAssetNotFoundError` is GONE — I import P26-A's `AssetNotFoundError`, already
mapped); 409 → `RunAlreadyExistsError`, `RunNotPostableError`, `AssemblyCancelledError`;
422 → `PeriodLockedForRunError` (code PERIOD_LOCKED), `AssemblyValidationError`,
`UoPUnitsRequiredError`, `NbvFloorViolationError`, `DepreciationAssetInvalidError`.

**Pre-existing failure (not mine, proven isolated):** `src/infra/db/migrations.spec.ts` 4/4
failures exist at HEAD with the whole fixed_assets folder removed (stash-verified) — the
migration-0037 journal/manifest gate item belongs to P26-0/orchestrator.

10. **Route-permissions registry gap (orchestrator item, whole-module)**:
    `src/infra/auth/route-permissions.ts` (600 rows) has NO fixed-assets rows at
    all — P26-A's categories/assets/capitalization routes are unregistered too,
    so the registry append is a module-wide wiring decision (the checklist
    test iterates it; the file is outside P26-B's sanctioned edit surface).
    The 13 permission keys themselves ARE seeded (P26-0 catalog work) — only
    the route rows are missing for all P26 waves.

## 6. Deviations + justification

1. **Revalued-basis composition differs from P26-C's `currentBasis()`** (their §5 asked for a
   one-line swap): their function freezes at reval time and would re-depreciate post-reval
   months. `runBasisOf` = newAccum + (history − oldAccum), which mirrors the RC-10 GL side
   exactly (verified algebra in the service header). The kernel signature stays exactly
   `computeMonthlyAmount(asset, accumulatedBefore, periodUnits?, context?)` — the basis is
   applied by substituting `cost` at the call site.
2. **`asset_count` = line count** (assets with amount > 0); assets computing to 0.0000 are
   excluded AND listed (`excluded[]` with reason ZERO_AMOUNT) — the DB CHECK
   (`period_amount > 0`) forbids zero lines. An EMPTY assembled run (0 lines) is NOT postable
   (DEPRECIATION_RUN_NOT_POSTABLE — an empty journal cannot exist); it stays DRAFT as the
   month's honest record.
3. **Assembly-time at-floor flip**: ACTIVE assets found already at the floor flip
   FULLY_DEPRECIATED during assembly (they dropped out of the run; covers the opening-variant
   + reversed-run gaps). Post-time flips cover assets that REACH the floor via the run's own
   lines; reverseRun UN-FLIPS (FULLY_DEPRECIATED → ACTIVE) when the live basis falls below the
   floor again (never touching DISPOSED/WRITTEN_OFF) — without this, reversed assets would be
   wrongly excluded from future runs.
4. **recomputeDraftLine re-assembles the whole DRAFT** (units from existing lines preserved,
   target overridden, unlined eligible UoP assets default "0"): depreciation_lines is
   append-only — a single-line edit is impossible without the sanctioned whole-run DRAFT reset.
5. **Cancel flag is process-local + queued-job cancel** (`boss.cancel` reaches only unstarted
   jobs; an in-flight job stops at its next 500-asset chunk probe; the throw rolls the whole
   withTenant transaction back — zero residue, run stays DRAFT). No singletonKey on the queue
   send: it would also suppress legitimate fast re-assembly after a workspace units edit;
   duplicate jobs converge (deterministic assembly + uq_depreciation_lines_run_asset retry →
   reset+recompute of an identical set).
6. **`reversal entryDate`**: the run's period end while the period is still OPEN (same-date
   reversal stays in the original period), else TODAY (ReversalInput carries no soft-close
   reason, so SOFT_CLOSED originals fall to today; the engine's open-period rule governs and
   rejects honestly if today's period is closed). Future-dated OPEN periods clamp to today.
7. **Assembly rejects LOCKED periods early** (fail-fast PERIOD_LOCKED before any write);
   SOFT_CLOSED periods may assemble (post gates). Concurrent same-period assembly races
   converge via the 23505 catch (409 only when the winner's run is not a DRAFT).
8. **Known race (SF-candidate, documented in-code)**: the FULLY_DEPRECIATED flip re-reads the
   asset before updating status, but the store exposes no conditional `UPDATE … WHERE status =
   'ACTIVE'` — a disposal committing in the same milliseconds-wide window could be overwritten.
   Disposals re-validate in their own flow; a conditional-update store helper is the follow-up.
9. **BR-041 at assembly checks ALL THREE category purposes** (BR-041's letter: "a category is
   unusable until all three purposes resolve"; the check blocks posting) — collected per asset
   into DEPRECIATION_ASSEMBLY_REJECTED with the missing keys named; the G-22 journal itself
   only hits expense + accum (the engine re-checks at post → PURPOSE_NOT_MAPPED).
