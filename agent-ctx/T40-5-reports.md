# T40 / Task 5 — Manufacturing reports: ManufacturingQueriesService + phase018 contracts + registry wiring + industry-018.spec (PHASE-018)

**Agent:** T40 · **Repo:** /home/z/phase017_work
**Status:** COMPLETE — `pnpm --filter @erp/api typecheck` clean · `pnpm lint` "Tasks: 6
successful, 6 total" · `pnpm run lint:depcruise` "✔ no dependency violations found
(1618 modules, 6506 dependencies cruised)" (1615 → 1618: the three new files) ·
`pnpm run check:permissions-drift` "OK — matrix 241 keys, seed 241 keys" (no new keys
— the three contracts reuse the 0026 seed) · unit suite **270/270 (25 files)**
(the reporting-unit.spec counts now pin **66**) · isolated
`src/__db__/reporting/industry-018.spec.ts` **11/11 green** · reporting db dir
**9 files / 55 tests green** · **FULL DB suite: 96 files / 1517 tests, 0 failures**
(was 95/1506 → +1 file, +11 tests). NOTE: `render.spec.ts` PASSED in this sandbox's
runs (both the reporting-dir run and the full suite) — the Playwright chromium
binary documented as missing in T33's evidence is present here; nothing was done
about it either way.

## The 3 report keys (registered in `registry/index.ts` §9 PHASE-018 block, 63 → 66)

| Report key | AR title | Permission (0026 seed — NO new keys) | Assertions |
|---|---|---|---|
| `manufacturing.production_cost` | تكلفة الإنتاج | `manufacturing.costing.read` | `production-materials-gl-tie` (GL, tolerance 0) |
| `manufacturing.batch_genealogy` | شجرة الدفعات | `manufacturing.genealogy.read` | — (operational, README rule-2 note) |
| `manufacturing.qc_inspection_log` | سجل فحوص الجودة | `manufacturing.qc.manage` | — (operational, README rule-2 note) |

All three: category `industry`, bilingual AR-first, `executionClass inline` /
`printTemplate a4-report` (the kit defaults, the phase017 precedent), money as
canonical 4dp strings (qty 6dp), `currencyPresentation "base"`, freshness
`current` 60 s TTL + per-nature invalidation events, `onFailure: "block-export"`
assertions, exact-decimal tie via `assertExact`.

## Files created

- `apps/api/src/modules/reporting/registry/industry/manufacturing-queries.ts` —
  `ManufacturingQueriesService` (`@Injectable()`, read-only raw SQL inside the
  ambient tenant tx — the distribution-queries pattern verbatim: local
  `tenantTx()` throwing without an ambient scope, `sql` template, camelCase
  aliases, `::text` casts, `journal.accountsForPurposes` for the tie, the local
  `idsScopeSql` helper):
  - `productionCost({fromDate, toDate, status?, branchIds?})` — per-order rows
    for every order with ANY activity in the window (a consumption OR a scrap in
    window, OR completed_at in window — the listOrderWipBalances activity
    definition), optional status filter (`…::text IS NULL OR o.status = …`, the
    listInspections pattern) and branch scope. One SQL query with LATERALs:
    planned/actual qty (6dp), yieldPct = actual÷planned×100 (4dp),
    plannedComponentsQty (Σ production_order_lines.planned_qty), consumedQty
    (Σ actual_qty), overPlanLines (count of over_plan lines), consumedValue /
    scrapValue / scrapCount (in-window, 4dp), plannedLaborValue /
    plannedOverheadValue (planned_qty × rate, 4dp), laborValue / overheadValue /
    fgValue (the order row's absorbed quanta), wipBalance =
    Σ consumptions − Σ scraps − wip_credit_value ALL-TIME (the sumOrderWip
    formula — exactly 0 for every completed order). ORDER BY o.order_no.
  - `productionCostGlTie({fromDate, toDate, branchIds?})` — register side
    (Σ production_consumptions.value in window, branch-scoped) vs GL side
    (Σ journal_lines DEBIT amount on the `accountsForPurposes(["WIP"])` accounts
    of entries with source_type 'production_order' AND operation
    `LIKE 'consume\_%'` AND status POSTED AND entry_date in window — the
    commissionsTotalTie pattern; no WIP account mapped → glSide "0.0000").
    Note the escaped LIKE: the source is `'consume\\_%'` so the SQL sees
    `consume\_%` (JS template literals swallow a lone `\_`).
  - `batchGenealogy({batchId})` — the RECALL WALK WITH DOC NUMBERS: this service
    does its OWN raw-SQL walk (it does NOT import the manufacturing module or
    its GenealogyService — reporting→published-tables read-only direction).
    Semantics mirror T39 exactly: iterative BFS, level = HOPS (1 = the immediate
    edge), expand-once visited set on batch ids, one edge per consumption row,
    16-level cap that stops without error. Three flat row kinds: MATERIAL
    (upstream: material batch, qty, the consuming order no, producedByOrderNo —
    null for purchased), PRODUCED (downstream: the consuming order's FG batch +
    sku, qty consumed from the source batch, the producing order no), SOLD
    (downstream: batch, move qty, docNo = sales_invoices.invoice_no /
    delivery_notes.delivery_no via LEFT JOINs on stock_moves.source_id, docDate =
    moved_at::date). Sort: kind asc (MATERIAL < PRODUCED < SOLD), then level,
    then batchNo. Unknown batch → `{ batch: null, rows: [] }` (decision 2).
  - `qcInspectionLog({fromDate, toDate})` — one row per inspection with
    `inspected_at::date BETWEEN`, LEFT JOINed with production_orders (orderNo),
    goods_receipts (grnNo = receipt_no) and item_batches (fgBatchNo), ORDER BY
    inspected_at, created_at.
- `apps/api/src/modules/reporting/registry/industry/phase018.ts` — the three
  `defineReport` contracts (phase017.ts patterns verbatim: WINDOW_PARAMS,
  assertDecl + assertExact, source(), col/moneyCol/qtyCol, run() with
  rows/totals/assertionResults/notes). production_cost carries the
  PRODUCTION_MATERIALS_GL_TIE assertion (INV-010), 5 sum totals
  (consumedValueTotal/scrapValueTotal/fgValueTotal/laborValueTotal/
  overheadValueTotal via addExact) and the planned-material-QTY note;
  batch_genealogy has NO GL assertion (OPERATIONAL_NOTE + the read-only/level
  semantics note + the not-found note on a miss); qc_inspection_log counts
  resultCount as its measure. `sampled` renders as the canonical "true"/"false"
  string (ReportRow.values is string|number|null — booleans are not a legal
  value).
- `apps/api/src/__db__/reporting/industry-018.spec.ts` — dedicated tenant R18
  book + 11 tests (the R17 spec structure).
- `agent-ctx/T40-5-reports.md` (this file).

## Files changed

- `apps/api/src/modules/reporting/registry/services.ts` —
  `ManufacturingQueriesService` import + the `manufacturing:` interface entry
  (PHASE-018 doc comment) + the lazy-bundle `new ManufacturingQueriesService()`.
- `apps/api/src/modules/reporting/registry/index.ts` — the new "§9 industry
  (industries/reports/README PHASE-018 rows — the manufacturing set)" block: 3
  imports from `./industry/phase018` appended to REPORT_CONTRACTS (63 → 66).
- `apps/api/src/modules/reporting/reporting.module.ts` — `KNOWN_PERMISSION_KEYS`
  += the three manufacturing keys (see decision 7 — NOT in the brief's file
  list but boot-critical).
- `apps/api/src/modules/reporting/application/contract.ts` — `ReportParams`
  gains the typed `batchId?: string` key (the vehicleId PHASE-017 precedent;
  without it `params.batchId` is the index-signature `unknown` and the
  genealogy contract does not typecheck).
- `apps/api/src/modules/reporting/__tests__/reporting-unit.spec.ts` — local
  `KNOWN_PERMISSIONS` += the three manufacturing keys; both count assertions
  63 → 66 ("the 66 frozen contracts…" test name, `result.count`,
  `snapshot` length).
- `apps/api/src/__db__/reporting/golden.spec.ts` — the registry-snapshot pin
  63 → 66, the describe label "(50 core + 13 industry)" → "(50 core + 16
  industry)", AND the stale header comment that still said "snapshot stays at
  53 (50 core + 3 industry)" (a PHASE-015 leftover) → 66 / 16 industry.
- `apps/api/src/__db__/reporting/fixtures.ts` — `ALL_KNOWN_PERMISSIONS` += the
  same three keys (additive; the set mirrors the known catalog).

Untouched (as instructed): migrations, `src/db/schema.ts`, route-permissions,
the manufacturing module internals (the queries service reads the published
tables read-only — the reporting precedent), `runtime.ts`/`contract.ts`
DataSourceModule wiring (T36 already did it), all docs (the phase owner's).

## Decisions

1. **The ids-only→docNo enrichment split per MASTER-PLAN §10.** The
   manufacturing GenealogyService returns doc IDS ONLY by design (keeps the
   core walk free of sales/billing table reads); the REPORT owns the
   enrichment: `manufacturing-queries.ts` re-walks the same graph with its own
   raw SQL and LEFT JOINs sales_invoices (invoice_no) / delivery_notes
   (delivery_no — the schema's number column is `delivery_no`) onto the
   stock_moves sales edges. The reporting service therefore imports nothing
   from the manufacturing module — the reporting→published-tables read-only
   direction holds, and the walk semantics (BFS, hops, expand-once, one edge
   per consumption row, 16-cap) are duplicated by deliberate design and
   asserted equal by the three genealogy tests (they pin exactly the edges
   genealogy.spec pins for tenant M's chain shape).
2. **A recall search miss is an empty result, not a 500.**
   `GenealogyBatchNotFoundError` is manufacturing-owned and the report must not
   import it: `batchGenealogy` returns `{ batch: null, rows: [] }` for an
   unknown batch and the CONTRACT's run() returns SUCCEEDED with 0 rows, a
   "rows: 0" total and the bilingual note "Batch not found in this tenant —
   the recall result is empty (a recall search miss, not an error)". Pinned by
   test 7 (unknown uuid → SUCCEEDED + the note).
3. **The planned-material-QTY note.** Planned component VALUE has no cost basis
   until something is consumed (the plan is a qty explosion; value only exists
   at issue cost), so the report exposes plannedComponentsQty vs consumedQty as
   THE material comparison, keeps plannedLaborValue/plannedOverheadValue as
   planned_qty × rate (those DO have a basis), and says exactly that in a
   bilingual note on production_cost.
4. **The R18 book design — gate ON, single-actor-plus-approver.** Tenant
   R18 = `58585858-5858-5858-5858-585858585858` (repo-grep verified unused).
   The QC gate is superuser-seeded ON (`manufacturing.qc_gate` = "required")
   BEFORE the book and LEFT IN PLACE (dedicated single-use tenant). The chain
   needs the two in-process semi-finished releases: order A's dough batch is
   QUARANTINED at completion, PASS releases it (no journal), and only then can
   B1's explicit-batch consume run (BATCH_QUARANTINED otherwise); the same for
   cake batch #1 before the sale. The invoice SoD guard (BR-034
   SelfApprovalBlockedError) REJECTS a same-actor approval, so the book adds a
   second user row R18_APPROVER (`5a5a5a5a-0000-4000-8000-0000000005a1`,
   grep-verified unused): R_ACTOR raises + posts, R18_APPROVER approves. All
   dates ride TODAY inside FY${currentYear} (2026); every journal flows through
   PostingService, every move through the movement core, every batch through
   TrackingService — the one superuser write is the tenant/user/tenant_settings
   referential seeding the R17/mfg-fixture patterns already use.
5. **The avgCost 1.041250 derivation (pinned green).** R18-FG cake position:
   B1 completes 50 @ 1.110000 (55.500000) → the sale issues 20 @ WAC 1.11
   (22.2000, leaving 30 @ 1.11 = 33.300000) → B2 completes 50 @ 1.000000 →
   position 80 / 83.300000 → avgCost 83.3 ÷ 80 = **1.041250**. The B2
   FAIL+SCRAP then issues the whole batch #2 on-hand 50 at that WAC →
   **52.0625** (DR PRODUCTION_SCRAP · CR FG-INV) — the fixture itself asserts
   `scrapValue === "52.0625"` at build time, and the batch stays QUARANTINED
   at zero on-hand. The qc_scrap journal never touches WIP, so the
   production-materials-gl-tie stays exact: register 100 + 50 + 50 = 200.0000 ==
   Σ WIP debits of the three consume_<seq> journals.
6. **production_cost's tie is window-shaped, not status-shaped.** The status
   filter scopes the ROWS only; the tie (like every PHASE-017 tie) reconciles
   the window's consumption register against the window's consume journals —
   test 3 runs the status filter both ways and the tie stays PASS either way
   (all three orders are COMPLETED in the book, so both sides stay 200.0000).
7. **`reporting.module.ts` KNOWN_PERMISSION_KEYS needed the three keys too
   (a minimal honest fix beyond the brief's file list).** The brief listed the
   unit spec's local KNOWN_PERMISSIONS, golden.spec and fixtures.ts, but the
   NestJS boot path (`ReportingModule.onModuleInit` → validateRegistry against
   the module's own set) validates every contract's requiredPermission —
   without the three manufacturing keys there, AppModule fails to boot and the
   nine full-app DB specs (identity-http, readonly-sweep, webhook-http,
   usage-limits, master-data-http, tenancy-http, inbox, mvp-candidate,
   import-export) would all fail. The unit spec's set is documented as
   "re-declared from ReportingModule", so the module set is kept in sync — the
   same discipline, one file the brief missed. Full suite green proves it.
8. **`ReportParams.batchId` typed key (contract.ts).** The genealogy contract's
   `params.batchId!` does not typecheck through the index signature
   (`unknown`); the PHASE-017 `vehicleId` precedent (an explicitly typed param
   key with a phase comment) is the established fix. `DataSourceModule`/
   SOURCE_MODULES/MODULE_DATA_PHASE/REGISTERED_PHASE_WINDOW were already wired
   by T36 and were NOT touched.
9. **PRODUCED rows carry nullable batchNo/sku.** A downstream consuming order
   that has not completed yet has no FG batch; the row shape mirrors T39's
   DownstreamProductionEdge (fgBatchNo/fgSku nullable) rather than inventing a
   non-null contract the data cannot honor. In the R18 book every consuming
   order is COMPLETED, so the tests pin non-null batch numbers.
10. **No drillTargets** on the three contracts — the PHASE-016/017
    aggregate-first precedent (drill hops would need document-view permission
    keys; nothing new was invented).

## Test outputs (exact tails)

- `pnpm --filter @erp/api typecheck` → clean (no output). `pnpm lint` →
  "Tasks: 6 successful, 6 total". `pnpm run lint:depcruise` → "✔ no dependency
  violations found (1618 modules, 6506 dependencies cruised)". `pnpm run
  check:permissions-drift` → "[permissions-drift] OK — matrix 241 keys, seed
  241 keys".
- `pnpm --filter @erp/api test` → `Test Files 25 passed (25) / Tests 270 passed
  (270)` (the reporting-unit.spec "the 66 frozen contracts validate against the
  known-permission catalog" now pins count 66 + snapshot 66).
- Isolated `TMPDIR=$HOME/tmp-t40 npx vitest run --config vitest.db.config.ts
  src/__db__/reporting/industry-018.spec.ts` → `Test Files 1 passed (1) /
  Tests 11 passed (11)`:
  1. production_cost TODAY..TODAY — 3 rows (A < B1 < B2 by PRD sequence): row A
     plannedQty/actualQty "100.000000", yieldPct "100.0000",
     plannedComponentsQty/consumedQty "30.000000", consumedValue "100.0000",
     scrapValue "0.0000", fgValue "100.0000", wipBalance "0.0000"; row B1
     plannedComponentsQty "50.000000", consumedValue "50.0000", scrapValue
     "2.0000", scrapCount 1, plannedLaborValue/laborValue "5.0000",
     plannedOverheadValue/overheadValue "2.5000", fgValue "55.5000", wipBalance
     "0.0000"; row B2 consumedValue "50.0000", fgValue "50.0000", wipBalance
     "0.0000"; totals consumedValueTotal "200.0000", scrapValueTotal "2.0000",
     fgValueTotal "205.5000", laborValueTotal "5.0000", overheadValueTotal
     "2.5000"; **production-materials-gl-tie PASS {left "200.0000", right
     "200.0000"}**.
  2. Empty window (2025-01-01..2025-01-31) — 0 rows, tie PASS {0.0000, 0.0000}.
  3. Status filter — COMPLETED → 3 rows; DRAFT → 0 rows.
  4. batch_genealogy (cake #1) — exactly 4 rows, kind order MATERIAL×3 then
     SOLD: dough MATERIAL L1 (qty "50.000000", orderNo = B1, producedByOrderNo
     = A), box MATERIAL L2 "10.000000" + cocoa MATERIAL L2 "20.000000"
     (orderNo = A, producedByOrderNo null; batchNo tiebreak puts R18-B1 before
     R18-C1), SOLD L1 {batchNo = cake #1, docNo = the captured invoiceNo, qty
     "20.000000", docDate TODAY}; NO PRODUCED rows.
  5. batch_genealogy (dough) — 5 rows: MATERIAL L1 box + cocoa (consumedBy A),
     PRODUCED L1 cake#1 (B1, 50) + cake#2 (B2, 50), SOLD L2 the invoice (via
     cake #1).
  6. batch_genealogy (cocoa R18-C1) — 4 rows: PRODUCED L1 dough (A, 20),
     PRODUCED L2 cake#1 + cake#2, SOLD L3 the invoice — the multi-level
     forward recall.
  7. batch_genealogy unknown uuid — SUCCEEDED, 0 rows, rows total "0", the
     not-found note present.
  8. qc_inspection_log TODAY..TODAY — 3 rows pinned in creation order: PASS/A
     (fgBatchNo = dough batchNo, sampled "false", sampleSize null), PASS/B1
     (sampled "true", sampleSize 10, fgBatchNo = cake #1), FAIL/B2 (sampled
     "true", sampleSize 2, disposition "SCRAP", fgBatchNo = cake #2);
     resultCount "3"; narrow window 2026-06-01..06-30 → 0 rows.
  9. Registry meta — the 3 keys category "industry", the three permissions,
     executionClass "inline", `ALL_KNOWN_PERMISSIONS.has(permission)` true,
     snapshot length 66.
  10. CSV render over production_cost — contains "PRD-", "200.0000",
      "production-materials-gl-tie,PASS".
- Combined reporting dir `… src/__db__/reporting/` → `Test Files 9 passed (9) /
  Tests 55 passed (55)` (asof 2, render 2, industry-018 11, industry-017 10,
  industry 8, exports 4, runs 5, dashboard 7, golden 6).
- **Full DB suite** `TMPDIR=$HOME/tmp-t40 pnpm --filter @erp/api test:db` →
  `Test Files 96 passed (96) / Tests 1517 passed (1517)` (95/1506 → 96/1517;
  zero failures — the app-boot specs confirm decision 7, and the manufacturing
  suites are untouched by the R18 book).

## Handoff notes

- **T41 (web):** the three report keys for `/reports?report=…` deep-links +
  INDUSTRY_REPORT_TARGETS: `manufacturing.production_cost`,
  `manufacturing.batch_genealogy`, `manufacturing.qc_inspection_log`. Row/
  column shapes (values keyed by column id):
  - production_cost — orderNo, status, sku, itemName, plannedQty/actualQty/
    plannedComponentsQty/consumedQty (qty 6dp), yieldPct (4dp text),
    overPlanLines, consumedValue/scrapValue/plannedLaborValue/
    plannedOverheadValue/laborValue/overheadValue/fgValue/wipBalance (money
    4dp), scrapCount; totals consumedValueTotal/scrapValueTotal/fgValueTotal/
    laborValueTotal/overheadValueTotal; params {dateFrom, dateTo, locale,
    status? (DRAFT|RELEASED|IN_PROGRESS|COMPLETED|CANCELLED), branchIds?}.
  - batch_genealogy — kind ("MATERIAL"|"PRODUCED"|"SOLD"), level, batchNo
    (nullable on PRODUCED), sku, qty, orderNo, producedByOrderNo, docNo,
    docDate; params {batchId (uuid), locale}; an unknown batch returns 0 rows +
    a note (render the note, not an error state).
  - qc_inspection_log — inspectedAt (date), targetType, orderNo, grnNo,
    fgBatchNo, result, sampled ("true"/"false" strings), sampleSize,
    disposition, note; params {dateFrom, dateTo, locale}.
- **Phase owner (docs):** the REPORT_CATALOG/industries README rows are yours —
  the registry count is now 66 (50 core + 16 industry); the
  industries/reports/README line "63 contracts total … the PHASE-018/019 rows
  remain catalogued only" is now stale in exactly that one respect. The three
  README PHASE-018 rows the code implements verbatim: production_cost (planned
  vs actual material/labor/overhead per order with yield and scrap),
  batch_genealogy (upstream material batches and downstream sales for a
  finished batch, recall support), qc_inspection_log (inspections with
  results, dispositions, and quarantined batches).
- **Nothing else pending from T39's handoff:** the genealogy enrichment is
  shipped per §10; the InspectionRow list shape is consumed as designed; the
  wip-recon orphanJournals residue warning is respected (nothing in T40 asserts
  it empty — the R18 book has no drift pairs at all).
