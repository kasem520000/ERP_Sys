# P26-E (WEB) — T13 fixed-assets screens + nav + i18n — work record

Task ID: P26-E · agent: WEB (subagent) · status: COMPLETE (tsc + parity green)

## What other agents need to know (contracts I coded against)

The backend (P26-A/B/C) is parallel; the web compiles against route strings
and typed row mirrors of `fixed-assets.store.ts`. **Contract asks** (the
shapes my screens require — all one-line enrichments of the store rows):

1. **`GET /fixed-assets/assets` list rows must carry the NBV read model** —
   `FixedAssetListRow = AssetRow & { accumulatedToDate; nbv }` (the register
   table shows accumulated + NBV columns). The store already exposes
   `assetAccumulated`/`assetNbv`; the list controller needs to join them.
2. **`GET /fixed-assets/assets/:id`** → `FixedAssetDetailRow` = the list row
   + `history: FixedAssetHistoryLine[]` (runStatus + reversedAt joined — the
   `listDepreciationLinesByAsset` shape).
3. **`GET /fixed-assets/depreciation-runs/:id`** → `DepreciationRunDetailRow`
   `{ run, lines }` where each line is `DepreciationRunLineView` = the line
   row JOINED with the asset fields the workspace grid needs:
   `assetCode, assetName, assetNameAr, method, cost, salvageValue,
   openingAccumulated, totalEstimatedUnits, nbvAfter`.
4. **`POST /fixed-assets/depreciation-runs/assemble {fiscalPeriodId,
   unitsByAssetId?}`** → returns the run row (`DepreciationRunListRow`); the
   web then re-GETs `/:id`. Re-assembly (same period) reuses/replaces the
   DRAFT — the web calls it for both initial assemble and apply-usage.
5. **`POST /fixed-assets/assets/:id/capitalize`** body `{ funding:
   "CREDIT"|"CASH"|"OPENING", partnerId? }` → `CapitalizeResultRow`
   (journalEntryId + journalEntryNo for the toast).
6. **`POST /fixed-assets/revaluations`** `{assetId, revaluationDate,
   newGrossValue, newAccumulated, reason}` → DRAFT row;
   **`POST /fixed-assets/revaluations/:id/post`** → POSTED row.
7. **`POST /fixed-assets/disposals`** `{assetId, kind, disposalDate,
   proceeds}` → DRAFT row; **`/:id/approve`** (second user, SoD) sets
   approvedBy; **`/:id/post`** → POSTED row with disposalNo + journalEntryId
   — the web then renders the a4-document voucher client-side.
8. Error codes I localize (`lib/messages.ts` localizedFixedAssetsError):
   ASSET_CATEGORY_NOT_FOUND/ASSET_NOT_FOUND/DEPRECIATION_RUN_NOT_FOUND/
   ASSET_DISPOSAL_NOT_FOUND/ASSET_REVALUATION_NOT_FOUND → 404 family;
   ASSET_CATEGORY_CODE_TAKEN, ASSET_CODE_TAKEN, ASSET_IMMUTABLE_FIELDS,
   PURPOSE_NOT_MAPPED, INVALID_AMOUNT/SALVAGE_EXCEEDS_COST, UOP_UNITS_REQUIRED,
   IMMUTABLE_DOCUMENT, RUN_ALREADY_POSTED, RUN_PERIOD_DUPLICATE, PERIOD_LOCKED,
   NBV_FLOOR_VIOLATION, DISPOSAL_STATE_INVALID, DISPOSAL_SOD_VIOLATION,
   DISPOSAL_PROCEEDS_INVALID, REVALUATION_STATE_INVALID,
   CAPITALIZATION_STATE_INVALID, ASSET_DISPOSED_REUSE. If the final
   controller taxonomy differs, extend that switch — one line per code.

## Deliverables

- Routes (apps/web/app/[locale]/fixed-assets/): page (§2 list), new (§3),
  [id] (§5 detail), [id]/edit (§3), categories (§8), depreciation (§4),
  disposals (§9), reports (§7).
- Components: fixed-assets-tabs, fixed-assets-table, fixed-asset-form,
  fixed-asset-detail, fixed-asset-categories, depreciation-runs,
  asset-disposals (+ report-workspace gains an optional `reportKeyPrefix`
  prop — backward compatible, /reports unchanged).
- Nav: `accounting.fixed-assets` added to NAV_ITEMS (packages/contracts,
  group accounting, order 70, icon "building", featureKey
  `fixed_assets.register`, permission `fixed_assets.assets.view`); web
  FALLBACK_CRUMBS + dynamic-prefix rule for fixed-assets/:id(/edit).
- i18n: `fa*` + nav/common keys — 200 new dictionary keys per locale
  (197 fa* + navAccounting + navFixedAssets + commonEdit) in BOTH locales;
  AR/EN parity green at 3599 keys per locale.
- Types/messages: FixedAsset* row types in lib/api-types.ts;
  localizedFixedAssetsError + localizedAssetStatus/DepreciationMethod/
  DisposalKind in lib/messages.ts.

## Pattern deviations (all deliberate, sibling-precedented)

1. Task said `app/(app)/fixed-assets` — the repo's real module pattern is
   `app/[locale]/<module>`; mirrored siblings exactly.
2. "fixedAssets namespace" — the repo dictionary is FLAT keyed; added a
   clearly-delimited `fa*` block (the mfg* precedent).
3. One nav item (NAVIGATION_MODEL §1.1 row) + in-page module tab strip
   (FixedAssetsTabs) for the sibling surfaces — the one-item-many-screens
   manufacturing shape.
4. Categories live at `/fixed-assets/categories` (module folder, the
   manufacturing-config precedent), not under /settings — task allowed
   either; module folder keeps the feature cohesive.
5. Disposal wizard abandon guard is a plain reset (the import-wizard
   precedent); the §9 Dialog abandon guard is only exercised by the asset
   form's dirty-guard.
6. The a4-document voucher is built client-side via `@erp/ui/print`
   `renderA4Document` (the sanctioned print layer — the offline/reprint
   precedent) into the report-workspace iframe-srcDoc preview shape.
7. UoP live preview is exact BigInt math (never floats); the server
   re-assembly stays the authority (the POS Z-preview discipline) — the
   note is on screen (faDepPreviewNote).

## Verification (run by me)

- `apps/web`: `pnpm exec tsc --noEmit -p tsconfig.json` → green (no output).
- root: `pnpm run check:i18n-parity` → "ar=3599 keys, en=3599 keys … 100%
  key parity; no empty values."
- eslint on all new files → clean.
- packages/contracts tsc → green.
