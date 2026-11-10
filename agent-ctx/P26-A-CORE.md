# P26-A (CORE) — Work Record — Fixed Assets Core (T2/T3/T4/T5)

> Phase: PHASE-026 · Task ID: `P26-A` · Status: **COMPLETE** (typecheck ✅ eslint ✅ depcruise ✅)
> Read this before touching fixed_assets core files. Other agents: P26-B owns
> depreciation/run services, P26-C revaluation/disposal/RC-10, P26-D reports,
> P26-E web, P26-F suites+docs. Do NOT rewrite my files — append your own.

## Files created (mine — 1,831 LOC total)

| File | LOC | Content |
|---|---|---|
| `apps/api/src/modules/fixed_assets/domain/fixed-assets-errors.ts` | 125 | 12 error classes, stable codes, A7-shaped, bilingual BR-041 detail |
| `apps/api/src/modules/fixed_assets/application/category-service.ts` | 319 | T2: CRUD + `assertCategoryUsable` (BR-041) + `categoryMissingPurposes` |
| `apps/api/src/modules/fixed_assets/application/asset-service.ts` | 381 | T3: register create/edit (immutability contract), list/detail, status machine `canTransitionTo`/`assertCanTransitionTo` |
| `apps/api/src/modules/fixed_assets/application/capitalization-service.ts` | 263 | T4: G-21 direct capitalization — CREDIT / CASH / OPENING variants |
| `apps/api/src/modules/fixed_assets/application/purchase-capitalization.ts` | 398 | T5: `CapitalExpenseLineEffect` port + `buildCapitalExpenseJournalLine` + `PurchaseCapitalizationService.createFromPurchase` |
| `apps/api/src/modules/fixed_assets/presentation/fixed-assets.controller.ts` | 310 | routes §3.11 + zod schemas + P26-B/C/D append markers |
| `apps/api/src/modules/fixed_assets/fixed_assets.module.ts` | 35 | Nest module (imports AccountingModule + AuditModule) |
| `apps/api/src/app.module.ts` | +2 lines | FixedAssetsModule registered after PurchasingModule |

Only existing file touched: `app.module.ts` (+import, +array entry). Store,
migration, schema.ts, purchasing files, docs, web: UNTOUCHED.

## What P26-B/C/D/E can consume (contracts)

- **`assertCategoryUsable(category)`** — exported from
  `application/category-service.ts`. Call before every posting (run post,
  revaluation post, disposal post). Throws `CategoryNotUsableError`
  (CATEGORY_NOT_USABLE, bilingual, names ALL missing keys).
  `categoryMissingPurposes()` = non-throwing variant.
- **`canTransitionTo(from, to)` / `assertCanTransitionTo(from, to)`** — exported
  from `application/asset-service.ts`. Legal set: ACTIVE→FULLY_DEPRECIATED |
  DISPOSED | WRITTEN_OFF; FULLY_DEPRECIATED→DISPOSED; DISPOSED/WRITTEN_OFF
  terminal. Use for the run floor flip + disposal lock (INV-023).
- **`ASSET_STATUSES`** const + `AssetStatus` type exported.
- **`DEPRECIATION_METHODS`**, `PURPOSE_KEY_RE`, `MIN/MAX_LIFE_MONTHS` exported
  from category-service.
- **Store** (pre-existing, 33 fns): `assetAccumulated`/`assetNbv` are the NBV
  read model — accumulated = opening_accumulated + Σ lines of POSTED
  non-reversed runs. Use for run assembly + disposal snapshots.
- **Controller append points**: section markers at the bottom of
  `presentation/fixed-assets.controller.ts` — `// -- depreciation runs (P26-B…`,
  `// -- revaluations (P26-C…`, `// -- disposals (P26-C…`, `// -- reports (P26-D…`.
  Inject your services into the constructor; permission keys are seeded
  (migration 0037 §480-492).
- **Idempotency key convention** (master plan): source keys are
  `(FIXED_ASSET_CAPITALIZATION|DEPRECIATION_RUN|ASSET_DISPOSAL|ASSET_REVALUATION,
  docId, operation)` — INV-013 via the engine; use operation `post` (+ engine
  `reverse` per INV-014).
- **Errors available** in `domain/fixed-assets-errors.ts`: ASSET_CATEGORY_NOT_FOUND,
  ASSET_CATEGORY_CODE_CONFLICT, ASSET_NOT_FOUND, ASSET_CODE_CONFLICT,
  CATEGORY_NOT_USABLE, INVALID_AMOUNT, ASSET_STATUS_INVALID, BRANCH_NOT_FOUND,
  USER_NOT_FOUND, PARTNER_NOT_FOUND, CAPITALIZATION_INVALID, ALREADY_CAPITALIZED.

## G-21 journal shapes implemented (line lists, purpose-keyed)

- **CREDIT** (2 lines): `DR {category.assetPurposeKey} cost` ·
  `CR AP_CONTROL cost` with `partnerId` (INV-009 — engine partner-subledger
  port writes the AP row in-tx). Partner must be kind SUPPLIER|BOTH + ACTIVE
  (else CAPITALIZATION_INVALID / PARTNER_NOT_FOUND).
- **CASH** (2 lines): `DR {category.assetPurposeKey} cost` · `CR CASH cost`
  (fail-closed PURPOSE_NOT_MAPPED when the tenant has no CASH mapping).
- **OPENING** (4 lines when opening_accumulated > 0, else 2):
  `DR {category.assetPurposeKey} cost` · `DR {equityPurpose} accum` ·
  `CR {category.accumDepreciationPurposeKey} accum` · `CR {equityPurpose} cost`.
  equityPurpose = `OPENING_EQUITY` by default, overridable per call
  (`openingEquityPurposeKey`). Net: FIXED_ASSET +cost, ACCUM +accum,
  OPENING_EQUITY net cost−accum. Balanced one journal.
- Source: `{docType: 'FIXED_ASSET_CAPITALIZATION', docId: assetId, operation:
  'post'}` — one capitalization per asset; retry replays (INV-013); after
  success asset.source_type='FIXED_ASSET_CAPITALIZATION', source_id=journalEntryId.
- **Purchase path** (`createFromPurchase`): `DR {category.assetPurposeKey} cost` ·
  `CR AP_CONTROL cost` (partnerId = the POSTED supplier invoice's supplierId).
  Asset born with source_type='supplier_invoice', source_id=invoiceId,
  status ACTIVE. Call-level idempotency: same (code, invoice) → replay via
  journal source-key lookup; same code other source → ASSET_CODE_CONFLICT.

## BR-041 enforcement points (all fail-closed)

1. Asset create (asset-service): category exists + ACTIVE + `assertCategoryUsable`.
2. Direct capitalization (capitalization-service): re-checked before spec build.
3. Purchase capitalization (purchase-capitalization): at `createFromPurchase`
   AND inside `buildCapitalExpenseJournalLine` (the future GRN hook).
4. Category update: purpose-key changes on an IN-USE category (assets > 0)
   must fully resolve; unused categories may stage unmapped keys.
5. Engine re-check at account resolution (PURPOSE_NOT_MAPPED) covers races.

## Deviations & honest notes

1. **T5 = documented port, not a purchasing wire-up** (per the task's STOP
   clause): `goods_receipt_lines` has no `capital_expense`/`asset_category_id`
   columns (schema change would be purchasing-owned). Exports
   `CapitalExpenseLineEffect` + `buildCapitalExpenseJournalLine` +
   `purchaseCapitalizationPort`; zero purchasing files modified. Chain-fixture
   proof (GRN→SIN→asset ACTIVE) is orchestrator-owned DB suite.
2. **Custodian validation is membership-scoped** (`findMembershipForUserInTenant`)
   not bare user-existence: a foreign-tenant user id must 404 like an unknown
   one (A7); identity api re-exports the store fn.
3. **Branch/partner reads are cross-module read refs** (tenancy.store /
   partners.store) mirroring the sales→tenancy.store precedent; depcruise
   clean (1,346 modules, no violations).
4. **Zero-cost assets can register** (cost ≥ 0 per spec) but cannot
   capitalize (journal lines must be > 0 → CAPITALIZATION_INVALID).
5. **Foreign-currency invoices**: the purchase G-21 posts in tenant BASE
   currency (register is base-denominated per DR-002 — no FX dimension);
   documented in the file header.
6. **Category code is immutable** (store takes no code patch — natural key).

## Verification evidence

- `pnpm exec tsc --noEmit -p tsconfig.json` (apps/api): exit 0, no output.
- `pnpm exec eslint src/modules/fixed_assets/ src/app.module.ts`: clean.
- `pnpm run lint:depcruise`: ✔ no violations (1346 modules, 9149 deps).
- No test files written; no DB booted; no purchasing/web/docs files touched
  (git status verified).
