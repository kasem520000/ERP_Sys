# P26-C (LIFE) — Fixed-asset lifecycle tail: T8 revaluation, T9 disposal, T10 RC-10

> Status: **COMPLETE** (typecheck green, pure unit spec 19/19 green, api-package lint green).
> Owner: subagent P26-C (LIFE). Siblings: P26-A (categories/assets/capitalization — landed),
> P26-B (depreciation/runs — landed), P26-E (web), P26-D (reports), P26-F (suites/docs).
> Files touched: ONLY the six P26-C application files + the sanctioned marked append to
> `fixed_assets.module.ts`. No store/migration/schema/docs/web/purchasing/accounting edits.

## 1. Files + line counts (all under `apps/api/src/modules/fixed_assets/`)

| File | Lines | Content |
|---|---|---|
| `application/lifecycle-errors.ts` | 125 | T8/T9 error set (see §3) |
| `application/current-basis.ts` | 197 | `currentBasis(assetId)` + PURE `computeRevaluationLines` + algebra helpers (`revaluationGrossDelta/AccumRestatement/OldAccumulated/Delta`, `sumDirection`) |
| `application/revaluation-service.ts` | 298 | T8: draft (basis validation, one-live-draft, frozen delta) + post (BR-041, engine journal, replay-safe) |
| `application/disposal-service.ts` | 466 | T9: draft (freeze NBV/accum/gain-loss, INV-023 gates) + approve (SoD) + post (G-23, DSP number, asset lock) + PURE `computeDisposalLines` |
| `application/fixed-assets-reconciliation.ts` | 505 | T10: RC-10 check (kind `FIXED_ASSETS`) + PURE `registerExpectedSides` fold + `fixedAssetsCheckItem` + `depreciationRunAdvisory` |
| `application/disposal-math.spec.ts` | 406 | PURE unit spec — NO DB: 19 tests (G-23 four shapes + break-even + sweep; revaluation both directions + reclass + no-op; RC-10 fold algebra) |
| `fixed_assets.module.ts` | 84 | **Marked append only** (P26-C block): providers+exports `RevaluationService`, `DisposalService`, `FixedAssetsReconciliationService`; imports += `NotificationsModule` (InboxService for the RC-10 BROKEN notification — the manufacturing WIP-check wiring precedent) |

Verify commands used: `pnpm exec tsc --noEmit -p tsconfig.json` (green, whole project),
`pnpm exec vitest run src/modules/fixed_assets/application/disposal-math.spec.ts` (19/19),
`pnpm run lint` in apps/api (exit 0). No `test:db` / embedded-PG touched (orchestrator-only).

## 2. Journal shapes (the pure builders are the contract; the DB golden suite should assert these exact legs)

**G-23 disposal** (`computeDisposalLines`, purposes per category / CASH / gain / loss; zero legs omitted — engine requires amount > 0):

| Shape | Lines |
|---|---|
| Gain sale (cost 10000, accum 4000, NBV 6000, proceeds 8000) | DR CASH 8000 · DR ACCUM_DEPRECIATION 4000 · CR FIXED_ASSET 10000 · CR ASSET_DISPOSAL_GAIN 2000 |
| Loss sale (proceeds 5000) | DR CASH 5000 · DR ACCUM_DEPRECIATION 4000 · CR FIXED_ASSET 10000 · **DR ASSET_DISPOSAL_LOSS 1000** (mandatory mirror) |
| Zero-proceeds SCRAP, fully depreciated (accum 10000 = cost) | DR ACCUM_DEPRECIATION 10000 · CR FIXED_ASSET 10000 (cash + residual omitted at 0) |
| SCRAP with proceeds (cost 8000, accum 6000, NBV 2000, proceeds 1500) | DR CASH 1500 · DR ACCUM_DEPRECIATION 6000 · CR FIXED_ASSET 8000 · **DR ASSET_DISPOSAL_LOSS 500** |
| Break-even (proceeds = NBV) | DR CASH · DR ACCUM · CR FIXED_ASSET (no gain/loss leg) |

Balance: `proceeds + accum − cost − (proceeds − NBV) = 0` with `NBV = cost − accum` — by construction.

**Revaluation** (`computeRevaluationLines`; g = newGross − cost, r = (newGross − cost) − delta, delta = newNBV − oldNBV; **g = r + delta always**):

| Shape | Lines |
|---|---|
| Up (cost 10000, accum 4000 → 12000/4000, delta +2000) | DR FIXED_ASSET 2000 · CR REVALUATION_RESERVE 2000 |
| Up + accum restated DOWN (→ 12000/3000, delta +3000) | DR FIXED_ASSET 2000 · **DR ACCUM_DEPRECIATION 1000** · CR REVALUATION_RESERVE 3000 |
| Down (→ 9000/4000, delta −1000) | CR FIXED_ASSET 1000 · DR REVALUATION_RESERVE 1000 |
| Down + accum restated UP (→ 9000/5000, delta −2000) | CR FIXED_ASSET 1000 · **CR ACCUM_DEPRECIATION 1000** · DR REVALUATION_RESERVE 2000 |
| Zero-delta pure reclass (→ 11000/5000, delta 0) | DR FIXED_ASSET 1000 · CR ACCUM_DEPRECIATION 1000 (reserve line SKIPPED) |
| Full no-op | zero lines → service rejects `REVALUATION_NOT_POSTABLE` |

Direction convention: accum restatement DOWN (accum drops) = **DEBIT**; UP = CREDIT (accum is credit-normal) — exactly the task's `accumulated − newAccum if positive → DEBIT` rule.

## 3. SoD enforcement points (AUTHORIZATION_MATRIX §4)

1. **`DisposalService.approve(disposalId, approverId)`**: rejects when `createdBy === approverId` (both non-null) → `SelfApprovalBlockedError` (`SELF_APPROVAL_BLOCKED`, module-local twin of accounting's code — kept in `lifecycle-errors.ts` per the task's file list). Treasury expense-approve pattern.
2. **`DisposalService.post`**: refuses any disposal with `approvedBy === null` → `DisposalNotApprovedError` (`DISPOSAL_NOT_APPROVED`) — the G-23 post gate.
3. Approval records `approved_by/approved_at` + audit `fixed_assets.asset_disposal_approved` (audited on use); approve on POSTED/double-approve → `DisposalStateError` (`DISPOSAL_STATE_INVALID`).
4. Controller keys (P26-A's controller appends, see §6): `fixed_assets.disposals.approve` (owner-only, §3.11 RISKY row) — the service guards are the backstop behind the permission decorator.
5. Revaluation post takes `actorId` (permission `fixed_assets.revaluations.post` is owner-only at the controller; `revaluations.create` drafts).

Other lifecycle errors shipped: `RevaluationNotFoundError`, `LiveDraftConflictError` (`REVALUATION_DRAFT_EXISTS`), `RevaluationNotPostableError`, `DisposalNotFoundError`, `DisposedAssetReuseError` (`DISPOSED_ASSET_REUSE` — both the status gate and the existing-disposal-row gate: ANY disposal row (DRAFT or POSTED; no rejected state exists) blocks), `ScrapProceedsRequiredError` (proceeds is an explicit required field; SALE with 0 → "use SCRAP with explicit 0"), `LifecycleInputInvalidError` (structural). Register-level errors are IMPORTED from P26-A's `domain/fixed-assets-errors.ts` (AssetNotFoundError, AssetStatusError, CategoryNotUsable via `assertCategoryUsable`, InvalidAssetInputError for money-shape).

**INV-023 lock**: disposal post → `updateAsset(status: "DISPOSED", disposedAt)` + P26-A's `assertCanTransitionTo(asset.status, "DISPOSED")` machine gate; WRITTEN_OFF policy = zero-proceeds SCRAP lands **DISPOSED** for both kinds (`written_off_at` stays NULL; the disposal row's kind+proceeds is the audit trail) — documented in-code.

## 4. RC-10 registration mechanism + both sides' algebra

**Mechanism (exact RC-09/WIP precedent — zero accounting-file edits):** `FixedAssetsReconciliationService.runFixedAssetsCheck({asOf, runMode, checkedBy})` writes the run row via `journalStore.insertReconciliationRun` with **kind `FIXED_ASSETS`**; on BROKEN it records audit `fixed_assets.reconciliation_broken` + an InboxService notification (category `reconciliation`, severity `critical`, bilingual, `actionUrl: /fixed-assets`, dedupeKey `fa-reconciliation-broken:{runId}`). Live (as-of-now) semantics on both sides — the AR-check precedent (`controlAccountBalance`, no as-of window) — so there are no temporal edge cases; `input.asOf` rides the run row for the framework's latest-run gate. Zero tolerance (exact 4dp string equality). Read-only imports: `findActivePurpose` (accounting.store), `controlAccountBalance` (journal.store) — the same cross-module read pattern as purchasing/manufacturing.

**Algebra (per category account; documented in-code, unit-tested via the pure fold):**
- FIXED_ASSET expected = Σ_{assets not DISPOSED} cost + Σ_{all POSTED revaluations} (newGross − cost)
- ACCUM_DEPRECIATION expected = Σ_{assets not DISPOSED} (opening + Σ live posted non-reversed lines = store.assetAccumulated) + Σ_{POSTED revals} r where **r = (newGross − cost) − delta** (the frozen row delta reconstructs the restatement — no temporal re-fold needed)
- A DISPOSED asset contributes ONLY its revaluation residue {Σg on FA, Σr on ACCUM}: the G-23 journal derecognizes the RAW basis (CR FA cost, DR ACCUM frozen snapshot) and the reval legs stay on GL against REVALUATION_RESERVE (DR-002 no-recycling policy; residue nets to zero: g − r − delta = 0).
- Aggregation is per resolved ACCOUNT (categories sharing a purpose key merge; diff rows carry side/purposeKey/accountCode/contributing categories/expected/actual/diff). Unmapped purpose + nonzero register → BROKEN ("register without GL"); mapped account with GL balance but no register side → BROKEN ("external journals on a FA-purpose account"). A mid-life purpose remap therefore reports BROKEN until the tenant completes the GL side of the configuration correction (intentional, RECONCILIATION §3.2).
- Check runs even with zero categories/assets (OK run with note — checklist renders NOT_APPLICABLE, the AR unmapped precedent).

**Close-checklist rows (exported from my module for accounting to wire — I did NOT edit accounting's reconciliation-service):**
- `fixedAssetsCheckItem(run?)` → the `reconciliation.fixed_assets` ChecklistItem (NOT_RUN / NOT_APPLICABLE / OK / BROKEN, mirroring the GRNI/WIP item shape).
- `depreciationRunAdvisory(periodId)` → the PERIOD_CLOSING §2 advisory `depreciation.run_posted`: OK+detail when POSTED; OK+advisory-detail when DRAFT/missing (deliberately never BROKEN/NOT_RUN so `allSatisfied` is unaffected — non-blocking by design); NOT_APPLICABLE when no live assets.

## 5. currentBasis contract for P26-B (WIRING GAP — orchestrator verify)

`currentBasis(assetId): { grossValue, accumulated }` (current-basis.ts):
- last POSTED revaluation exists → `{ newGrossValue, newAccumulated }` (the revalued basis);
- else → `{ asset.cost, store.assetAccumulated(assetId) }` (register + live history).

**Verified 2026-11-28: P26-B's `depreciation-service.ts` does NOT consume it** (their STRAIGHT_LINE uses raw `cost − salvage`; DECLINING_BALANCE uses `openingNBV = cost − assetAccumulated` — history-based). Consequence: after a revaluation, the next run computes on the OLD basis — phase verification §6 item 5 ("the next run uses the new basis") FAILS until P26-B switches their per-asset basis reads to `currentBasis` (and their accum bookkeeping accordingly). RC-10 stays green either way (both sides derive from source rows). **Action: orchestrator to task P26-B with the one-line-per-read swap.**

## 6. Controller routes + providers for orchestrator wiring

Providers: **appended to `fixed_assets.module.ts`** (marked `P26-C` block): `RevaluationService`, `DisposalService`, `FixedAssetsReconciliationService` (providers + exports); imports += `NotificationsModule` (InboxService). 

Controller routes (P26-A's `presentation/fixed-assets.controller.ts` already carries marked append slots — I did not edit it). Routes + permission keys + Idempotency-Key conventions:

| Route | Permission | Notes |
|---|---|---|
| `POST /api/v1/fixed-assets/revaluations` | `fixed_assets.revaluations.create` | body: assetId, revaluationDate, newGrossValue, newAccumulated, reason (mandatory 1..500) |
| `GET /api/v1/fixed-assets/assets/:id/revaluations` | `fixed_assets.revaluations.create` (or assets.view) | list per asset (store has no cross-asset reval list — see deviations) |
| `POST /api/v1/fixed-assets/revaluations/:id/post` | `fixed_assets.revaluations.post` (owner) | Idempotency-Key `fa:rev:{revaluationId}` |
| `POST /api/v1/fixed-assets/disposals` | `fixed_assets.disposals.create` | body: assetId, kind SALE/SCRAP, disposalDate, **proceeds (required explicit field — "0" for zero-proceeds SCRAP)**, note? |
| `GET /api/v1/fixed-assets/assets/:id/disposal` | `fixed_assets.assets.view` | the asset's (single) disposal document |
| `POST /api/v1/fixed-assets/disposals/:id/approve` | `fixed_assets.disposals.approve` (owner, SoD) | approver = identity.userId ≠ createdBy |
| `POST /api/v1/fixed-assets/disposals/:id/post` | `fixed_assets.disposals.post` | Idempotency-Key `fa:disp:{disposalId}` |
| `POST /api/v1/fixed-assets/reconciliation/fa-check` | `fixed_assets.reports.view` (or assets.view) | RC-10 on-demand run; the nightly leg rides pg-boss later (GRNI precedent) |

## 7. Deviations + justification (and orchestrator action items)

1. **BLOCKER — `reconciliation_runs.kind` DB CHECK**: migration 0011 (as widened by 0012) allows only AR/AP/CASH/BANK_REC/VAT/INVENTORY/GRNI/WIP — **`FIXED_ASSETS` is missing**, so the RC-10 run INSERT fails at the DB until a one-statement widening lands (mirroring 0012's BANK_REC precedent). I cannot touch migrations. **Action: orchestrator adds the widening to the phase's migration set before the DB gate.**
2. **PC-04 + checklist wiring in accounting** (by constraint, not edited): `assertCoreChecksGreen`'s kind list and `closeChecklist` must gain `FIXED_ASSETS` + the two rows. One-line wiring using my exports: add `"FIXED_ASSETS"` to the kind list; in `closeChecklist` spread `fixedAssetsCheckItem(findRun("FIXED_ASSETS"))` and `await depreciationRunAdvisory(periodId)` into `items`. **Action: orchestrator (mirrors how GRNI/WIP rows landed).**
3. **Frozen-delta revaluation model**: `delta` is frozen at DRAFT from the then-live `store.assetNbv`; the POST journal derives the old side from the frozen delta (`oldAccum = newAccum − (g − delta)`), so row and journal agree by construction and RC-10 reconstructs r from the same frozen values. If a depreciation run lands between DRAFT and POST, the delta remains the draft-time figure (no staleness guard — the store exposes no delta patch, and a guard would strand the one-live-draft rule). Documented in-code; recommended flow is draft-and-post in one sitting. Follow-up (orchestrator, optional): a store `delta` refresh or staleness reject.
4. **Chained revaluations**: the task's algebra restates from the RAW register basis (cost, live accum) each time; a SECOND revaluation's gross leg is `newGross − cost` again, so GL FA = cost + Σ(newGross_i − cost) ≠ last newGross when re-revaluing. RC-10 derives the same sum, so the check stays exact; `currentBasis` (last POSTED reval) is exact for the first/single revaluation. Documented limitation; the accounting-correct chaining (old side = current basis + depreciation since) needs the old-side columns on `asset_revaluations` — a schema follow-up, out of my file ownership.
5. **Disposal derecognizes the RAW basis** (CR FA `cost`, DR ACCUM `accumulatedSnapshot` = history-based freezes, gain/loss vs history NBV) — per the task text and JOURNAL_RULES G-23; reval legs remain on GL (no-recycling, DR-002 out-of-scope). RC-10 encodes exactly this.
6. **`SelfApprovalBlockedError` duplicated** (same code as accounting's) in `lifecycle-errors.ts` — per the task's explicit file list; HTTP maps by code so no drift. Orchestrator may later consolidate onto accounting's class.
7. **No cross-asset disposal/revaluation LIST routes**: the store exposes only by-id/by-asset reads (store is P26-A's; not touched). P26-D's movements report covers the cross-asset surface; a paginated store list is an optional P26-A follow-up.
8. **RC-10 scan**: `listAssets({limit: 1_000_000})` + 2 reads per asset (assetAccumulated + revaluations) in the nightly job — fine at the 10k-asset design scale (indexed, background); paginated fold is the production-scale follow-up (honest marker, mirrors the master-plan's honest-split rule).
9. **Numbering**: disposal numbers via `NumberingService.reserve` docType `asset_disposal`, format `DSP-{YYYY}-{SEQ:6}` (treasury `{PREFIX}-{YYYY}-{SEQ:6}` convention), reserved AFTER the engine post and bound via `numbering.bind` — the treasury expense precedent (replay-safe: the replay path returns before reserving, so a retry never consumes a second number).
10. **Spec failures found & fixed during verification**: three expectation bugs in my own spec (accum-leg directions on the two restatement cases — the task's "restatement DOWN → DEBIT" rule; two sweep fixtures violating NBV = cost − accum). The builders were correct; the suite now pins the exact shapes for the DB golden battery.
