# T41 — PHASE-018 Task 6 (web UI) — manufacturing screens

**Task ID:** T41 · **Agent:** T41 (manufacturing web: BOMs + production orders + QC + genealogy)
**Scope:** 4 screens (`/manufacturing/{boms,orders,qc,genealogy}`) for the finished PHASE-018
manufacturing backend (T38/T39), plus dictionary keys, wire types, localized error/status mappers,
and the §14 registrations (aliases, report targets, fallback crumbs). Work confined to
`/home/z/phase017_work/apps/web` (+ the shared `scripts` gate runs). **No backend, contracts, or
docs changes** (`pnpm --filter @erp/api typecheck` re-run clean — nothing leaked).

## Files

### Created (pages — server component, the distribution/settlements pattern verbatim)
| File | Notes |
| --- | --- |
| `apps/web/app/[locale]/manufacturing/boms/page.tsx` | primary `manufacturing/boms?limit=200`; supporting `items/items?limit=100` (STOCK) + `items/uoms` (decision 4 — the output-unit display); 401→login, 403→forbidden state; supporting reads degrade to empty. |
| `apps/web/app/[locale]/manufacturing/orders/page.tsx` | primary `manufacturing/production-orders?limit=200`; supporting `items/items?limit=100` (STOCK), `inventory/warehouses` (active), `tenancy/branches` (active), `manufacturing/boms?limit=200` (the explicit-version select pool, client-filtered per FG item). |
| `apps/web/app/[locale]/manufacturing/qc/page.tsx` | primary `manufacturing/inspections?limit=200`; supporting `manufacturing/production-orders?limit=200` (client-filtered to COMPLETED — the only legal order targets) + `items/items?limit=100` (order sku labels). |
| `apps/web/app/[locale]/manufacturing/genealogy/page.tsx` | NO primary resource (a search surface): supporting `items/items?limit=100` (STOCK + trackBatch) + `inventory/batches?limit=500` (the batch pool, degrades to []); 401 on ANY supporting fetch → login redirect (decision 6); 403 on the pools degrades to empty (the paste-a-UUID path still works — the searches render their own localized FORBIDDEN). |

### Created (client components — the distribution-settlements/routes pattern)
| File | Screen surface |
| --- | --- |
| `components/manufacturing-boms.tsx` | version registry table (item, v`versionNo`, status badge via `localizedBomStatus`, yield, effective-from, note) + item/status filters (server refetch) · create dialog (STOCK output item whose base uom becomes outputUomId — the uom CODE displayed via the uoms pool; yield `0 < y ≤ 100` ≤4dp; note; multi-add component-lines editor: component select + qtyPerOutput > 0 ≤6dp + scrapPct ≥ 0 ≤4dp, remove row) · selected-version workspace: lines table (component, qty, scrap %, uom), DRAFT-only edit (PUT full-replace: yield + note + lines) + activate (optional effective-from DatePicker), ACTIVE-only archive · explosion preview: item select (defaults to the selected version's item + its bomId) + requested qty + optional explicit version → `GET manufacturing/boms/explosion` → levels table (level, sku, qty 6dp, scrap %, via-semi-finished sku or —) + per-item totals table. |
| `components/manufacturing-orders.tsx` | order list (order no / —, sku, status badge via `localizedProductionOrderStatus`, planned/actual qty, fgValue money, completed-at) + status filter (DRAFT…CANCELLED) · create dialog (branch, FG STOCK item, optional explicit BOM version — client-filtered `bomId` pool, planned qty > 0 ≤6dp, planned date, materials + FG warehouses, optional labor/overhead rates ≥ 0 ≤6dp with the absorption hint) · selected-order workspace (GET `:id` → order/lines/consumptions/scraps/completion): header card (order no, status, item, branch, warehouses, planned/actual, fgValue/wipCredit/labor/overhead money fields, the produced batch + expiry when completed, cancel reason when cancelled), plan-lines table (component, planned qty, scrap %, actual qty, the `over_plan` warning chip — decision 5), lifecycle bar per status (DRAFT: release + cancel; RELEASED: start + cancel; IN_PROGRESS: consume + scrap + complete + cancel; COMPLETED/CANCELLED read-only; NO edit UI — decision 2), consume dialog (lines editor seeded one row per planned component, component select limited to the planned set, add/remove rows, qty > 0 ≤6dp, optional explicit batch — `inventory/batches?itemId=` pool per component, empty = FEFO auto; empty rows are simply not sent), scrap dialog (qty, reason 1–40 required, value positive ≤4dp MoneyInput, scrapped-at), complete dialog (actual qty, optional batchNo, completed-at → the completion summary toast), consumptions table (item, batchNo, qty, unit cost, value, date, journal id short) + scraps table (reason, qty, value, date, journal short). |
| `components/manufacturing-qc.tsx` | inspections table (inspected-at, target-type badge, the target reference — order no from the COMPLETED pool or GRN id short (decision 3), FG batch id short (decision 3), PASS green / FAIL red chip, sampled + sample size, disposition via `localizedInspectionDisposition`, note) + target-type filter (server refetch) · create dialog: targetType select (production_order → COMPLETED-order select w/ orderNo+sku; goods_receipt → pasted GRN UUID text input + the no-GRN-list hint — decision 3), result PASS/FAIL, sampled toggle + sampleSize int ≥ 1 (shown/enabled only when sampled), disposition select RESTRICTED client-side (PASS → none/ACCEPT; FAIL → required; RETURN_TO_SUPPLIER only for goods_receipt — mirrors the service's `InspectionDispositionInvalidError` matrix), inspected-at DatePicker, note. POST → the success notice composes: the recorded toast + the `released` batch message + (when `scrapJournalEntryId` non-null) the qc_scrap line (qty + value + journal short). |
| `components/manufacturing-genealogy.tsx` | read-only recall search: item select → batch select (`inventory/batches?itemId=`, label = batchNo + expiry + status) OR pasted batch UUID (client UUID regex) · Upstream / Downstream / Summary buttons (three GETs `manufacturing/genealogy/{upstream,downstream,batch}/:batchId`) · every result renders the batch card first (batchNo, sku, status badge via `localizedBatchStatus`, expiry); upstream adds the materials levels table (level, batchNo, sku, qty, consumedBy orderNo, producedBy orderNo or — for purchased); downstream adds the productions table (level, from-batch, order, status, FG batch, sku, qty) + the sales table (level, batch, doc type via `localizedSaleDocType`, doc id short, doc date, qty) with the ids-only hint on the sales card; summary adds the producing order / on-hand / consumed-by-orders / sales + inspections counts. Unknown/foreign batch → the typed `GENEALOGY_BATCH_NOT_FOUND` message (never a crash); a failed pool refetch degrades to the paste path. |

### Modified
| File | Change |
| --- | --- |
| `apps/web/lib/effective-config.ts` | `TARGET_ROUTE_ALIASES` += `manufacturing.bom → /manufacturing/boms`, `manufacturing.orders → /manufacturing/orders`, `manufacturing.qc → /manufacturing/qc`, `manufacturing.genealogy → /manufacturing/genealogy` (PHASE-018 comment); `INDUSTRY_REPORT_TARGETS` += `manufacturing.production_cost`, `manufacturing.batch_genealogy`, `manufacturing.qc_inspection_log` (report deep-links). |
| `apps/web/components/app-shell.tsx` | `FALLBACK_CRUMBS` += the 4 manufacturing rows (one shared `manufacturingNavSection` — decision 8), mirroring the distribution rows' placement + comment style. |
| `apps/web/lib/api-types.ts` | `WarehouseRow` += `role: string \| null` (the 0026 widening the API has shipped since T36 — the web type was stale). Appended the manufacturing wire rows (mirrors the store/service types exactly, ADR-0009 decimal strings): `BomRow`, `BomLineRow`, `BomWithLines`, `ExplosionLevelItem`, `ExplosionResult`, `ProductionOrderRow`, `ProductionOrderLineRow`, `ProductionConsumptionRow`, `ProductionScrapRow`, `OrderCompletionSummary`, `ProductionOrderDetail`, `ConsumeResult`, `ScrapResult`, `CompletionResult`, `InspectionRow`, `CreateInspectionResult`, `GenealogyBatchRef`, `UpstreamMaterialEdge`, `GenealogyUpstreamResult`, `DownstreamProductionEdge`, `DownstreamSaleEdge`, `GenealogyDownstreamResult`, `GenealogyBatchSummary`. |
| `apps/web/lib/messages.ts` | `localizedManufacturingError` (all 33 typed codes → `mfgErr*`; posting-engine codes fall back to the API message; unknown codes → the generic ladder — the `localizedDistributionError` pattern, called directly by the four screens, NOT wired into `localizedApiError`, matching how distribution/commissions dispatch) + label helpers: `localizedBomStatus` (DRAFT/ACTIVE/ARCHIVED), `localizedProductionOrderStatus` (the 5 states), `localizedInspectionResult` (PASS/FAIL), `localizedInspectionDisposition` (4 + null), `localizedInspectionTargetType` (production_order/goods_receipt), `localizedBatchStatus` (ACTIVE/QUARANTINED/WRITTEN_OFF), `localizedGenealogyKind` (MATERIAL/PRODUCED/SOLD), `localizedSaleDocType` (sales_invoice/delivery_note). |
| `apps/web/i18n/dictionaries.ts` | one `// -- PHASE-018 (T41): manufacturing navigation & screens` block appended at the end of ALL THREE blocks (interface + ar + en) — **208 keys each** (see the count below). AR authored first; existing blocks untouched. |

## Key count
**208 keys × 3 blocks (interface/ar/en)** — navigation/crumbs 5, BOM screen 45, orders screen 65,
QC screen 31, genealogy screen 32, error keys 33 (`mfgErr*` — one per manufacturing typed code:
the 12 BOM codes + BOM_REQUIRED, the 11 production-order codes, the 8 inspection/QC codes,
GENEALOGY_BATCH_NOT_FOUND). AR authored first, then EN. Reused existing keys where they fit:
`commonSave/commonCreate/commonCancel/commonOpen/commonClear`, `accountingColStatus`,
`errorsValidation/errorsNotFound`, `itemsColSku`, `itemUomLabel`, `stockColQty`,
`mfgBomNote` (shared note label), `mfgConsumptionBatch` (shared batch label).
(The first authoring pass shipped 207 keys and missed the orders status-filter blank option
`mfgOrdersAllStatuses` — caught by the typecheck gate; it was added to all three blocks, which
is the +1. Every `mfg*` key referenced by the four screens, `messages.ts` and `app-shell.tsx`
was machine-diffed against the interface block afterwards: exact match, no gaps.)

## Verification output (exact tails)
```
$ pnpm --filter @erp/web typecheck
> @erp/web@0.1.0 typecheck /home/z/phase017_work/apps/web
> tsc --noEmit -p tsconfig.json
(clean — exit 0)

$ pnpm --filter @erp/web run lint
> @erp/web@0.1.0 lint /home/z/phase017_work/apps/web
> eslint .
(clean — exit 0)

$ pnpm run check:i18n-parity
== i18n key parity: ar=2556 keys, en=2556 keys ==
ar/en catalogs at 100% key parity; no empty values.

$ pnpm lint
 Tasks:    6 successful, 6 total
Cached:    5 cached, 6 total

$ pnpm --filter @erp/api typecheck
> @erp/api@0.1.0 typecheck /home/z/phase017_work/apps/api
> tsc --noEmit -p tsconfig.json
(clean — confirms no backend edits leaked)
```
No page smoke run: the typecheck + the byte-followed distribution archetypes are the gate (the
brief explicitly skips a web dev server). Money displays at 4dp (`formatMoneyDisplay(value, 4)`,
the accounting-GL precedent — no truncation of the canonical 19,4 strings); quantities/percentages
render the exact server strings with `dir="ltr"`.

## Decisions & deviations (all additive, none blocking)
1. **Items route is `items/items`, not `inventory/items`.** The brief's supporting-read shorthand
   said `inventory/items?limit=100`; the actual registered route (route-permissions row
   `/api/v1/items/items`) and every existing web page fetch `items/items?limit=100`. Followed the
   working path; `inventory/warehouses`, `inventory/batches`, `tenancy/branches` are real as
   written.
2. **No production-order edit UI** (per the brief's "keep edits minimal: NO edit UI"). The DRAFT
   workspace surfaces the hint `mfgOrderNoEditHint` ("create a replacement order or correct via
   adjusted consumptions") instead of a PUT dialog; the create dialog covers creation.
3. **Ids-only columns on QC + genealogy.** `InspectionRow` carries orderId/grnId/fgBatchId (no
   numbers) and there is no GRN list API, so: the QC target column resolves orderNo through the
   COMPLETED-orders pool (fallback: the id short) and renders the GRN id short with the
   `mfgQcGrnHint` paste note; the FG-batch column renders the id short. The genealogy sales table
   renders doc ids short with the `mfgGenealogyIdsHint` note pointing at the
   `manufacturing.batch_genealogy` report for the numbers (the §10 ids-only design).
4. **`items/uoms` added as a supporting read on the BOM page** (beyond the brief's two fetches):
   the create dialog must DISPLAY the output uom (the item's base uom is sent as outputUomId);
   showing a raw UUID would be dishonest, and `items/uoms` is the registered route the
   price-lists/items pages already use. Degrades to the id short on failure.
5. **The `over_plan` warning chip is a local 12-line span**, not a `@erp/ui` Badge: the frozen
   package's Badge ships neutral/primary only; the chip composes the semantic `warning-*` token
   classes the read-only banner / templates StatusChip precedent already use.
6. **Genealogy 401/403 handling without a primary resource:** a 401 on ANY supporting fetch
   redirects to login (a dead session can run no search); a 403 on the pools degrades them to
   empty — the paste-a-UUID path still works and each walk renders its own localized FORBIDDEN
   when the user lacks `manufacturing.genealogy.read` (honest: the pools only need the inventory
   view permission, which is not the genealogy permission).
7. **Consume editor seeding:** the dialog seeds one row per planned component (the legal issue
   set); rows left empty are simply not sent, added rows are limited to the planned components,
   and the explicit batch select lists `inventory/batches?itemId=` in the server's returned order
   (batch_no — the FEFO pick is the server default when the line leaves the batch empty).
8. **One shared fallback crumb section** (`manufacturingNavSection`) for all four routes: the
   manifest's own L9 groups are two (Production/الإنتاج for boms/orders/qc and
   Traceability/التتبع for genealogy) and render registry-driven when the food_manufacturing
   template is applied; the FALLBACK_CRUMBS map is crumb-labels-only (the sidebar keeps its
   derived groups), so one shared section is the minimal honest fallback — documented in the
   app-shell comment.
9. **QC disposition restrictions are client-side mirrors of the service matrix** (PASS →
   none/ACCEPT; FAIL → required; RETURN_TO_SUPPLIER → goods_receipt only) — the options list
   itself narrows, and the server's `INSPECTION_DISPOSITION_*` typed errors still render
   localized as the backstop.
10. **Explosion preview defaults to the selected version** (item + bomId) so a workspace click
    reproduces exactly that version; changing the item resets the explicit version to "the
    item's active".
11. **Resumed-session completion:** the first authoring pass landed everything but one
    dictionary key (`mfgOrdersAllStatuses`, the orders status-filter blank option) in all
    three blocks — `pnpm --filter @erp/web typecheck` failed with TS2551 on
    `manufacturing-orders.tsx:522`. The key was added to the interface + ar + en blocks
    (AR "كل الحالات" / EN "All statuses", mirroring `mfgBomsAllStatuses`), after which all
    four gates pass; a machine diff of every `mfg*` key referenced anywhere in `apps/web`
    against the T41 interface block confirms no other gaps.

## Handoff notes (phase owner)
- **Docs pass:** if NAVIGATION_MODEL/PAGE_ARCHETYPES are maintained, the four routes are
  `/{locale}/manufacturing/{boms,orders,qc,genealogy}` — server page + client component (the
  "generic-detail"-style workspace archetype the distribution screens established); nav aliases
  `manufacturing.{bom,orders,qc,genealogy}` + the three report deep-links live in
  `lib/effective-config.ts`.
- **The completion report can cite:** the 24-route API surface is now fully surfaced on the web
  (22 of 24 routes reachable from these four screens — the two exceptions are `PUT
  production-orders/:id` (decision 2) and `POST reconciliation/wip-check` (the reconciliation
  framework's own surface, not a screen per §14's five-surface list)); i18n parity moved
  2348 → 2556 keys (+208, exact AR/EN parity, no empty values).
- **Known minor seams (documented, not blocking):** the QC/genealogy id-short columns (decision
  3) and the genealogy batch-pool fetch degrade paths (decision 6). A future enrichment could
  join batch numbers via a batch-list API per order, but the report already owns the doc-number
  enrichment per MASTER-PLAN §10.
- **The screens follow the proven distribution archetypes byte-for-byte** (requireSessionToken →
  Promise.all fetchApi → 401/403 branches → AppShell + client component; bffFetch mutations with
  per-button busy keys; SuccessNotice/ErrorNotice; `dir="ltr"` numerals; AR-first dictionaries),
  so the phase-gate web security probe (the T35/T34 follow-up item) applies to them unchanged.
