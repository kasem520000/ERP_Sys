# T31 · Task 7-a — Rep Commissions (PHASE-017 §2 item 10)

Task ID: **7-a** · Agent: commissions implementer · Status: **DONE** (spec green, typecheck green, lint green)

## Files

**Created**
| File | Role |
|---|---|
| `apps/api/src/modules/sales/infrastructure/commissions.store.ts` | Function-module store: `insertCommissionRun` / `findCommissionRunById` / `listCommissionRuns({status?,limit})` / `patchCommissionRun` / `replaceCommissionRunLines` / `listCommissionRunLines` (joined with rep code+name+payout_status — the `sales.commissions_due` read model) / `repCommissionBase(repId,from,to,basis)` / `getRepCommissionRule` / `setRepCommissionRule` / `listRepsWithRules` |
| `apps/api/src/modules/sales/commissions/domain/commission-errors.ts` | `CommissionRunNotFoundError` (COMMISSION_RUN_NOT_FOUND), `CommissionRunStateError` (COMMISSION_RUN_STATE), `CommissionRuleInvalidError` (COMMISSION_RULE_INVALID). No PURPOSE_NOT_MAPPED duplicate (engine owns it) |
| `apps/api/src/modules/sales/commissions/application/commission-service.ts` | `CommissionService(@Inject(AuditService) audit, @Inject(PostingService) posting)` — `setRule`/`getRule`, `createRun` (create+compute inline), `compute`, `post`, `cancel`, `find`/`list`/`findWithLines` |
| `apps/api/src/modules/sales/presentation/commissions.controller.ts` | `@Controller("api/v1/sales")`: GET/PUT `reps/:id/commission-rule`, GET/POST `commission-runs`, GET `commission-runs/:id`, POST `commission-runs/:id/post`, POST `commission-runs/:id/cancel` — all `@RequirePermissions("sales.commissions.manage")` + `@RequireFeature("sales.commissions")` (exact registered paths, route-permissions.ts untouched) |
| `apps/api/src/modules/sales/commissions.module.ts` | `CommissionsModule` — imports `[AccountingModule, AuditModule]`, controllers `[CommissionsController]`, providers/exports `[CommissionService]` |
| `apps/api/src/__db__/sales/commissions.spec.ts` | 11 tests / 6 packs (see output below) |

**Edited (additive, owned per task)** — `apps/api/src/__db__/sales/fixtures.ts`:
- `SalesFixture.gl` gains `commissionExpense` + `commissionAccrual`
- setup maps `COMMISSION_EXPENSE → 5250` and `COMMISSION_ACCRUAL → 2150` via the existing defensive `mapPurpose` (0025 template markers; `provisionCoaTemplate` normally seeds them already — the map is the idempotent backstop)

**NOT touched**: `sales.module.ts`, `app.module.ts`, `invoices.ts`, `pricing.ts`, distribution module, migrations, `schema.ts`, `route-permissions.ts`, `error.filter.ts`.

## Wiring line you (orchestrator) must add to `apps/api/src/app.module.ts`

```ts
import { CommissionsModule } from "./modules/sales/commissions.module";
// …in the imports array, next to SalesModule/DistributionModule:
    CommissionsModule,
```

(The controller is otherwise dead — Nest requires registration; `CommissionsModule` is self-contained: AccountingModule provides/export PostingService, AuditModule provides AuditService.)

## Exact golden journal fixture (test 1, INVOICED run over Jan-2026)

Seed (tenant S, FY2026): rep A = flat 2% INVOICED; rep B = flat 1% COLLECTED; rep C = tiered INVOICED. Rep A gets 3 posted NS-tax CREDIT service invoices dated 2026-01-15 (nets **1000 + 500 + 300 = 1800**) + 1 posted credit note dated 2026-01-15 (net **−200**, attributed salesRepId = rep A).

`createRun({periodFrom:"2026-01-01", periodTo:"2026-01-31", basis:"INVOICED"})` → lines:

- rep A: base **1600.0000** (invoicedNet 1800 − creditedNet 200), rateApplied **2.0000**, commission **32.0000**, detail `{excluded:false, method:"FLAT", invoicedNet:"1800.0000", creditedNet:"200.0000", collectedNet:"0.0000"}`, payout_status ACCRUED
- rep B: **exclusion note-line** — base 0, rate 0, commission 0, detail `{excluded:true, reason:"BASIS_MISMATCH", ruleBasis:"COLLECTED", runBasis:"INVOICED", note:…}`
- rep C: no January activity → no line (zero-base skip)
- run totals: totalBase 1600.0000, totalCommission 32.0000, status DRAFT, computed_at stamped

`post(runId)` → **ONE journal** (source `{docType:"commission_run", docId:runId, operation:"accrual"}`, entryDate = periodTo 2026-01-31, currency = tenant base SAR, entryNo `JE-2026-NNNNNN`):

| line | account (purpose) | dir | amount | memo |
|---|---|---|---|---|
| 1 | 5250 Commissions expense (COMMISSION_EXPENSE) | DEBIT | 32.0000 | `Commission — Rep Alpha (S-REP-A)` |
| 2 | 2150 Accrued commissions (COMMISSION_ACCRUAL) | CREDIT | 32.0000 | `Commission accrual — run {runId} (2026-01-01..2026-01-31, INVOICED)` |

Run flips POSTED with `journal_entry_id`/`posted_at`/`posted_by` set (ck_commission_runs_posted_shape satisfied). Balanced by construction (Σ DR = Σ CR = total); the engine's balance check is the backstop.

## Tiered math (documented in commission-service.ts header)

Bands B₁..Bₙ sorted ascending, Bₙ.upTo = null (open). **portionᵢ = min(base, upToᵢ) − min(base, upToᵢ₋₁)** with upTo₀ = 0; portions ≥ 0, Σ portions = base. commission = round₄(Σᵢ portionᵢ × rateᵢ%) — exact Decimal band products summed, ONE half-up rounding at the end. `rate_applied` stores the flat rate, or the **effective rate** (commission ÷ base × 100) for tiered lines. Golden: tiers `[{upTo 1000, rate 1}, {upTo null, rate 3}]`, base 1600 → 1000×1% = 10 + 600×3% = 18 → **28.0000**, effective rate 1.7500; per-band breakdown persisted in line `detail.bands` (`[{upTo:"1000.0000",rate:"1.0000",portion:"1000.0000",amount:"10.0000"},{upTo:null,rate:"3.0000",portion:"600.0000",amount:"18.0000"}]`).

## Base semantics

- **INVOICED**: Σ `total_net` of POSTED `sales_invoices` (sales_rep_id = rep, invoice_date in window) − Σ `total_net` of POSTED `credit_notes` (sales_rep_id = rep, note_date in window). Credit notes are the only reversal channel — invoices are never mutated, VAT never touched.
- **COLLECTED**: Σ `treasury_allocations.amount` of POSTED receipts (value_date in window) against the rep's invoice open items — join `treasury_allocations → receipts(status POSTED) → partner_subledger_entries(source_type='sales_invoice') → sales_invoices(sales_rep_id = rep)`.
- All three components (`invoicedNet/creditedNet/collectedNet`) are computed uniformly and stored in the line detail jsonb regardless of basis.
- Documented limitation: sums are document-currency (phase's single-currency SAR/base runs; foreign-currency documents contribute their document amounts — multi-currency netting out of scope).

## Key documented decisions (commission-service.ts header)

1. **Run-level basis** — one basis per run; reps whose rule basis ≠ run basis are EXCLUDED from earning but get a **zero note-line** (detail `{excluded:true, reason:"BASIS_MISMATCH", ruleBasis, runBasis}`) so the commissions-due statement explains their absence. Note-lines contribute nothing to totals and never produce a DR line.
2. **create = create + compute** in one call (registered route set has no compute endpoint); status stays DRAFT after create — compute repeatable, post is the accrual point.
3. **Accrual dated at period_to** (matching principle — the expense lands in the earned period; engine rejects locked periods with its own typed error).
4. **INV-013**: sequential re-post → typed `CommissionRunStateError` ("already POSTED … no second accrual"); engine source-key unique is the concurrent backstop.
5. **POSTED runs immutable** — corrections reverse the accrual journal (INV-014); CANCEL is DRAFT-only + terminal (reason lives in the audit event `sales.commission_run_cancelled`).
6. **Posting guards**: no lines → typed error; lines but total ≤ 0 (only note-lines) → typed error.
7. **No number series** for runs (no number column by design; the id is the reference).
8. Audits: `sales.commission_rule_set`, `sales.commission_run_created`, `sales.commission_run_computed`, `sales.commission_run_posted`, `sales.commission_run_cancelled`.

## Deviations / notes for the orchestrator

1. **`replaceCommissionRunLines` is NOT DELETE+INSERT** — migration 0025 grants erp_app `SELECT, INSERT, UPDATE` on `commission_run_lines` but **no DELETE** (the "status-lifecycled, no tombstone deletes" grant model; job_card_lines precedent). It is a **per-rep UPSERT** keyed on the (run, rep) unique index: existing rows update in place, new reps insert, reps that dropped out of a recompute are zeroed with a `detail.dropped = true` note (never deleted). If you prefer true DELETE semantics, the central fix is widening the 0025 grant — otherwise the current behavior is final.
2. **error.filter.ts mapping (central, your call)**: `COMMISSION_RUN_NOT_FOUND` currently falls through to the default **422**. For A7 parity with the other not-founds, add `CommissionRunNotFoundError` (from `modules/sales/commissions/domain/commission-errors`) to a 404 branch. Not required — default 422 is acceptable per task note.
3. Excluded (basis-mismatch) reps get zero note-lines **regardless of base** (a rep with an active PERCENTAGE rule and a mismatched basis always appears with the note); method=NONE and INACTIVE reps get no line at all.
4. One transient failure of the PRE-EXISTING `sales/golden.spec.ts` W-1 test occurred on the first combined `sales/ + pos/` run (cold embedded-PG first boot); it did not reproduce across 3 subsequent combined runs nor with my spec removed — my seeds create no 1380.0000-gross invoice (nets 1000/500/300/800/1600, all NS service lines, no stock).

## Test output

Command: `mkdir -p $HOME/tmp-7a && cd apps/api && TMPDIR=$HOME/tmp-7a npx vitest run --config vitest.db.config.ts src/__db__/sales/commissions.spec.ts`

```
 ✓ commissions.spec.ts (11 tests) 630ms
   ✓ accrual golden: seeds (1800 − 200) / create+compute lines (1600 × 2% = 32; rep B excluded note; rep C no line) / post → DR 5250 32 · CR 2150 32, POSTED shape
   ✓ INV-013 idempotency: re-post → CommissionRunStateError, commission_run journal count unchanged (1)
   ✓ reversed-sales exclusion (repeatable compute): second Jan run recomputes the same 1600 base; DRAFT cancel → CANCELLED; double-cancel → state error
   ✓ tiered math: rep C base 1600 → 28.0000 (bands 10 + 18), effective rate 1.7500, detail.bands exact
   ✓ COLLECTED basis: receipt 800 allocated to rep B's invoice → base 800 × 1% = 8; posts DR expense 8 · CR accrual 8; A + C excluded note-lines
   ✓ rule validation: rate > 100, NONE-with-rate, flat+tiers, unsorted/overlapping bands, missing open band, open-band-not-last, unknown rep (SalesRepNotFoundError)
   ✓ state machine: POSTED never recomputes/cancels; nothing-to-accrue never posts; unknown run 404-shaped
 Test Files  1 passed (1)
      Tests  11 passed (11)
```

Regression: `src/__db__/sales/ + src/__db__/pos/` → 7 files / 57 tests green (×3 runs); `distribution/core.spec.ts + partners/vehicles.spec.ts + pos/golden.spec.ts` (the other fixture importers) → 24 tests green. `pnpm --filter @erp/api typecheck` green. `pnpm --filter @erp/api lint` green (strict).
