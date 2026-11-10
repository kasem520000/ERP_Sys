# T39 / Task 4 — QC + genealogy: inspections service + controller + qc.spec, genealogy service + controller + genealogy.spec (PHASE-018)

**Agent:** T39 · **Repo:** /home/z/phase017_work
**Status:** COMPLETE — typecheck clean, `pnpm lint` 6/6, depcruise 0 violations (1615
modules, 6463 dependencies), permissions-drift 241 = 241 (no new keys), unit suite
**270/270 (25 files)**, DB suite **FULLY GREEN: 95 files / 1506 tests, 0 failures**
(the prior sole failure — readonly-sweep's `[POST /api/v1/manufacturing/inspections →
404]` — is CLEARED: the controller is mounted and the route sweeps as the typed 403;
notifications-email passed, no rerun needed).

## Files created

- `apps/api/src/modules/manufacturing/application/inspection-service.ts` —
  `InspectionService` (MASTER-PLAN §4, the QC gate): constructor takes
  `@Inject(AuditService) audit`, `@Inject(PostingService) posting`,
  `@Inject(TrackingService) tracking` (every param explicit — the
  vitest/esbuild design:paramtypes hole, the JobCardService/ProductionOrderService
  precedent); `planIssue`/`applyIssue`/`resolveInventoryAccount` imported directly
  from movement-core (the job-card/production-order precedent). `create(input)`:
  1. target validation — production_order ⇒ orderId required + grnId absent, else
     `InspectionTargetInvalidError`; order loaded via the store (undefined →
     `ProductionOrderNotFoundError`), status MUST be COMPLETED (else
     `InspectionTargetInvalidError` — inspections attach to completions);
     goods_receipt ⇒ grnId required + orderId absent, existence via the store's
     read-only `findGrnForInspection` (undefined → `InspectionTargetNotFoundError`).
  2. result/disposition validation — FAIL ⇒ disposition required
     (`InspectionDispositionRequiredError`); PASS ⇒ null/ACCEPT only
     (`InspectionDispositionInvalidError`); RETURN_TO_SUPPLIER ⇒ goods_receipt
     targets only (`InspectionDispositionInvalidError`); sampled ⇒ integer
     sampleSize ≥ 1 / non-sampled ⇒ sampleSize null; inspectedAt must match
     YYYY-MM-DD (both `InspectionInputInvalidError`).
  3. side effects (production_order targets ONLY; GRN targets always record-only):
     PASS(null/ACCEPT) and FAIL+ACCEPT share the release path
     (`tracking.releaseQuarantine`, NO journal; FAIL+ACCEPT is the operator
     override — `operatorOverride: true` in the audit after); batch not held →
     record-only. FAIL+REWORK → record-only (stays held). FAIL+SCRAP → the
     qc_scrap flow (§1 row 4): batch must exist AND be QUARANTINED else
     `QcScrapBatchNotQuarantinedError`; `store.qcBatchOnHand` ≤ 0 →
     `QcScrapEmptyBatchError`; else `planIssue({…, batchId, allowQuarantinedBatch:
     true, reason: "QC_FAILED", movedAt: inspectedAt, sourceType:
     "production_order", sourceId: order.id})` → journal (source
     `production_order/qc_scrap`, entryDate inspectedAt, DR purpose
     PRODUCTION_SCRAP · CR `resolveInventoryAccount(order.fgWarehouseId)`, both
     plan.valueAmount, bilingual memos with QC_FAILED in the text) →
     `applyIssue(plan, posted.journalEntryId)`. The batch STAYS QUARANTINED at
     zero on-hand (comment documents: an emptied hold stays visibly QC-failed).
  4. the inspections row is inserted LAST — a side effect that throws leaves no
     record; fgBatchId = batch?.id ?? null (order targets) / null (GRN targets).
  5. audit `manufacturing.inspection.created` (entityType "inspection"; after:
     targetType/orderId/grnId/result/disposition/sampled/sampleSize/released/
     operatorOverride?); the scrap leg additionally
     `manufacturing.production_order.qc_scrapped` (entityType "production_order";
     after: orderNo/batchId/qty/value/reason "QC_FAILED"/journalEntryId).
  Plus `find(id)` (→ `InspectionNotFoundError`) and `list({targetType?, orderId?,
  limit})`.
- `apps/api/src/modules/manufacturing/application/genealogy-service.ts` —
  `GenealogyService`, READ-ONLY (no constructor deps; never writes, never audits;
  file docblock records the MODULE_BOUNDARIES stance + the T40 ids-only decision):
  - `upstream(batchId)`: iterative BFS by level (level = HOPS; level 1 = the
    queried batch's producing order's batch-bound consumption rows); material
    batches with their own productionOrderId recurse at level+1; expand-once
    visited set on BATCH ids (also breaks pathological cycles) + 16-level depth
    cap (stop, no error); batched store calls per level
    (listConsumptionsByOrderIds → listGenealogyBatches →
    listProductionOrdersByIds); edges carry consumedBy + producedBy order
    id/no (null for purchased); sort (level, consumedByOrderId, batchId).
    Purchased batch (productionOrderId null) → materials [].
  - `downstream(batchId)`: iterative BFS, frontier = batch ids with depth
    (queried 0); per frontier `listConsumptionsByBatchIds` → production edges at
    depth+1 (fromBatch + the consuming order + its fgBatch/item identity via
    listProductionOrdersByIds + listGenealogyBatches) and
    `listBatchSalesEdges` → sale edges at depth+1 (docType from sourceType,
    docDate = the move's calendar date); consuming orders' fg batches join the
    next frontier (visited set + depth cap); sort productions by
    (level, orderId, fromBatchId), sales by (level, docDate, docId).
  - `batchSummary(batchId)`: batch ref + producing order id/no + onHand
    (`store.qcBatchOnHand`) + consumedByOrders (grouped per order, 6dp sums) +
    salesCount + inspectionsCount.
  - every entry point starts `findBatchForGenealogy` → undefined ⇒
    `GenealogyBatchNotFoundError` (A7).
- `apps/api/src/modules/manufacturing/presentation/inspections.controller.ts` —
  §9 rows 22–24 VERBATIM (`@Controller("api/v1/manufacturing/inspections")`):
  GET "" / GET :id / POST "" (201), all
  `@RequirePermissions("manufacturing.qc.manage")` +
  `@RequireFeature("manufacturing.qc")`, requireIdentity on the POST, envelope;
  body zod exactly per the brief (targetType enum, orderId/grnId UUID
  nullable-optional, result enum, sampled bool, sampleSize int 1..2e9
  nullable-optional, disposition enum nullable-optional, inspectedAt DATE,
  note/noteAr NOTE); list query targetType enum + orderId safeParse + LIMIT
  (default 100).
- `apps/api/src/modules/manufacturing/presentation/genealogy.controller.ts` —
  §9 rows 19–21 VERBATIM (`@Controller("api/v1/manufacturing/genealogy")`):
  GET upstream/:batchId, downstream/:batchId, batch/:batchId — every route
  `@RequirePermissions("manufacturing.genealogy.read")` +
  `@RequireFeature("manufacturing.batch_genealogy")`, envelope.
- `apps/api/src/__db__/manufacturing/qc.spec.ts` — 6 tests (the gate-on chain
  below).
- `apps/api/src/__db__/manufacturing/genealogy.spec.ts` — 10 tests (pure reads on
  the §8 golden chain).
- `agent-ctx/T39-4-qc-genealogy.md` (this file).

## Files changed

- `apps/api/src/modules/inventory/application/movement-core.ts` — the minimal
  additive escape hatch: `planIssue` input gains `allowQuarantinedBatch?: boolean`
  (default undefined), threaded into `resolveIssueSlices`'s input type; the guard
  is now `if (batch.status === "QUARANTINED" && input.allowQuarantinedBatch !==
  true) throw new BatchQuarantinedError(...)`. Doc comments on the input field
  and at the guard name the SOLE bypass caller (the QC fail-scrap flow, §1 row
  4). Nothing else changed; the default still throws.
- `apps/api/src/modules/manufacturing/domain/manufacturing-errors.ts` — appended
  the "QC inspections (T39)" section: `InspectionNotFoundError`
  (INSPECTION_NOT_FOUND, 404), `InspectionTargetNotFoundError`
  (INSPECTION_TARGET_NOT_FOUND, 404), `InspectionTargetInvalidError`
  (INSPECTION_TARGET_INVALID, 422), `InspectionInputInvalidError`
  (INSPECTION_INPUT_INVALID, 422), `InspectionDispositionRequiredError`
  (INSPECTION_DISPOSITION_REQUIRED, 422), `InspectionDispositionInvalidError`
  (INSPECTION_DISPOSITION_INVALID, 422), `QcScrapBatchNotQuarantinedError`
  (QC_SCRAP_BATCH_NOT_QUARANTINED, 409, details {orderId, batchId, status}),
  `QcScrapEmptyBatchError` (QC_SCRAP_EMPTY_BATCH, 422, details {batchId,
  onHand}), `GenealogyBatchNotFoundError` (GENEALOGY_BATCH_NOT_FOUND, 404) — all
  DomainError, UPPER_SNAKE codes, English messages, existing doc style.
- `apps/api/src/infra/http/error.filter.ts` — imports + the
  "PHASE-018 manufacturing (T39 — QC + genealogy)" ladder after the T38b block:
  404 = InspectionNotFound / InspectionTargetNotFound / GenealogyBatchNotFound;
  409 = QcScrapBatchNotQuarantined; 422 = InspectionTargetInvalid /
  InspectionInputInvalid / InspectionDispositionRequired /
  InspectionDispositionInvalid / QcScrapEmptyBatch.
- `apps/api/src/modules/manufacturing/infrastructure/manufacturing.store.ts` —
  two new banner sections after the WIP-reconciliation section, file conventions
  followed (`tenantTx()`, `erp.current_tenant_id()`, `generateUuidV7()`,
  snake→camel aliases, `::text` casts, `sql.join` IN lists, empty-input → []):
  - "-- inspections (T39…)": `InspectionRow` (exactly the brief's shape) +
    `INSPECTION_COLUMNS`, `insertInspection` (insert then re-read by id — the
    insertProductionScrap pattern; `inspected_at` inserted `${inspectedAt}::
    timestamptz`, selected back `::text`), `findInspectionById`,
    `listInspections` (ORDER BY created_at, id; `LIMIT least(n,500)`),
    `countInspectionsByBatch` (WHERE fg_batch_id), `findGrnForInspection`
    (read-only existence on goods_receipts — the §6 precedent the 0026 composite
    FK designed), `qcBatchOnHand` (the inventory `batchOnHand` SQL mirrored 1:1).
  - "-- genealogy (T39…)": `GenealogyBatchRow` (+`GENEALOGY_BATCH_COLUMNS` —
    item_batches JOIN items, the BATCH_COLUMNS shape subset PLUS
    productionOrderId, which the upstream walk needs), `findBatchForGenealogy`,
    `listGenealogyBatches`, `listProductionOrdersByIds` (Pick of id/orderNo/
    status/itemId/fgBatchId/fgWarehouseId), `listConsumptionsByOrderIds`
    (batch_id IS NOT NULL applied in SQL), `listConsumptionsByBatchIds`,
    `listBatchSalesEdges` (the brief's SQL verbatim: source_type IN
    ('sales_invoice','delivery_note') AND direction='OUT' ORDER BY moved_at, id).
- `apps/api/src/modules/manufacturing/manufacturing.module.ts` — providers/exports
  += InspectionService, GenealogyService; controllers += InspectionsController,
  GenealogyController; docblock extended with the T39 slice note.
- `apps/api/src/__db__/manufacturing/fixtures.ts` — after `wipReconciliation`
  with a T39 comment: `export const inspections = new InspectionService(audit,
  posting, tracking);` (the module-local `posting` const — same instances the
  other exported services use) and `export const genealogy = new
  GenealogyService();`.

## Decisions

1. **The movement-core escape hatch is opt-in-by-one-caller, not a policy read.**
   The qc_scrap flow must issue a batch the movement core deliberately holds
   (BATCH_QUARANTINED, the §4 gate). Rather than widening the inventory domain
   (a "scrapping" move kind, a status flip on the batch, …), the guard gained a
   single boolean the QC inspection service sets explicitly
   (`allowQuarantinedBatch: true`); the default (`undefined`) still throws, so
   every other explicit-batch issue path — manualIssue, sales, transfers — is
   byte-for-byte unchanged. The comments at the field and the guard name the
   sole caller; FEFO auto-pick remains structurally unable to reach the branch
   (listFefoBatches lists ACTIVE only).
2. **The GRN referential target is seeded via superuser SQL (the documented
   exception).** The record-only goods_receipt inspection needs a goods_receipts
   row the app role cannot create out-of-band (purchasing's posting surface is
   not this spec's subject), so the spec inserts a minimal DRAFT row (fresh
   uuid, tenant M, fixture branch, real supplier M-QC-S1 via the partners store,
   warehouse M-RAW, receipt_date 2026-04-01, status DRAFT) — the wip-recon
   drift-seeding precedent: a referential target the inspection never mutates.
   NOTE the DDL wrinkle: `ck_goods_receipts_po_less_shape` forces
   po_less_reason NOT NULL when po_id is NULL — the seed carries
   'qc spec referential target'. No GL/inventory rows are ever written directly
   (every journal via PostingService, every move via the movement core, every
   batch via TrackingService/stock services).
3. **April 2026 discipline.** All qc.spec activity is dated April (material seed
   04-01 … QC-5 scrap 04-14): January is off-limits (wip-recon pins
   `orders === 0` at asOf 2026-01-31), March is the golden chain + the drift
   windows (the wip drift pair dated 03-20 must stay invisible to the 03-10
   green-path run). The qc_gate setting is set in beforeAll (AFTER
   setupMfgFixture, so the golden chain still completes gate-off) and restored
   in afterAll; April is soft-closed+locked only inside the PERIOD_LOCKED test
   and reopened in its `finally` AND the afterAll safety reopen.
4. **Genealogy is read-only by construction and by proof.** The service has no
   write path and no constructor deps; the spec captures (a) tenant M's journal
   count, (b) the bread stock position in M-FG, (c) the chain batch statuses,
   (d) the audit_events count before the walks and asserts them unchanged after
   every read, plus zero audit rows with action LIKE 'manufacturing.genealogy%'.
5. **Level semantics = hops; expand-once visited set; one edge per consumption
   row.** Level 1 is always the immediate edges (the producing order's inputs
   upstream; the direct consumers downstream). A batch reached twice is still
   EDGE'd each time (one edge per consumption row — a material consumed by two
   orders shows both edges) but its producing order is expanded only once (the
   visited set on batch ids), which also breaks pathological producer cycles.
   The 16-level cap stops walking (no error) — recall breadth over depth,
   matching the BOM explosion's cap without reusing its typed BOM_TOO_DEEP
   (these are different operations: an explosion plans, a walk recalls).
6. **The scrapped batch STAYS QUARANTINED at zero on-hand.** §1 row 4 moves the
   goods out (stock issue + journal) but flips no status: an emptied hold stays
   visibly QC-failed (unlike a WRITTEN_OFF batch), and the empty-batch guard
   makes any later FAIL+SCRAP the typed QC_SCRAP_EMPTY_BATCH. Release remains
   the inspection's explicit decision (a later PASS/ACCEPT on the empty batch is
   record-only — "batch not held" semantics).
7. **The inspection row is inserted AFTER the side effects.** A release or a
   qc_scrap that throws (QC_SCRAP_*, PERIOD_LOCKED from the posting engine, …)
   leaves no inspections row — proven by the PERIOD_LOCKED pack's
   `inspections.list({orderId})` empty + unchanged journal count + onHand
   10.000000 + still-QUARANTINED, and by the record-only GRN pack's unchanged
   whole-tenant journal count.
8. **The qc_scrap source operation is the FIXED `qc_scrap`** (the brief + §1
   row 4 pin it; the production consume/scrap legs use `_<seq>` because they
   repeat by design — an inspection scrap of one order's FG batch is a
   once-per-order event by construction: the first scrap empties the hold, so a
   second call dies at QC_SCRAP_EMPTY_BATCH before ever reaching PostingService.
   The only theoretical replay window is stock re-received INTO the held batch
   between two scraps (planReceipt does not status-check explicit batches);
   accepted per the binding design — the alternative (a `qc_scrap_<seq>`
   operation) would deviate from the pinned source key and the §1 row-4 map that
   POSTING_ENGINE/T40 tie-outs read.
9. **downstream(flour) pins the CHAIN's edges, not the absolute list.** The
   golden flour batch M-F1 is the FEFO pool orders.spec/costing.spec draw from
   (their batch-less flour consumptions land on M-F1), so that walk asserts the
   dough hop at level 1 and the bread hop at level 2 exactly, the invariants
   that hold regardless (every level-1 edge starts at the flour batch; each
   chain order appears exactly once), and the sales list EXACTLY (the single
   invoice at level 3 — only the golden chain sells bread). Every other walk
   (upstream of bread/dough/flour, downstream of dough/bread/packaging, both
   summaries) touches edges only the golden chain created and pins exact sets.
10. **docDate derivation.** The store's listBatchSalesEdges returns
    `moved_at::text` (the brief's SQL, kept verbatim) — a timestamptz rendering
    like "2026-03-06 00:00:00+00"; the service derives the edge's docDate as the
    calendar date (`slice(0, 10)`), which is what the §10 recall surface means
    by the sale's date (asserted "2026-03-06"; the test DB session runs UTC, the
    same assumption the wip-recon `::date` as-of filters already make).
11. **A7 split on targets:** unknown ORDER ids reuse `ProductionOrderNotFoundError`
    (the order's own not-found, 404); unknown GRN ids get the dedicated
    `InspectionTargetNotFoundError` (404, identical unknown-vs-foreign shape);
    genealogy's unknown batch ids are `GenealogyBatchNotFoundError`. All three
    ladders verified typed in the specs.
12. **QC-2's unit-cost pin rides the FG receipt move** (unitCost "1.150000"):
    CompletionResult carries no unitCost field, and a live avgCost read would be
    order-dependent (QC-1's earlier receipt is in the same pool); the move row
    is the spec-owned, order-independent truth.

## Test outputs

- `pnpm --filter @erp/api typecheck` → clean. `pnpm lint` → "Tasks: 6 successful,
  6 total". `pnpm run lint:depcruise` → "✔ no dependency violations found (1615
  modules, 6463 dependencies cruised)" (1609 → 1615: the six new files).
  `pnpm run check:permissions-drift` → "OK — matrix 241 keys, seed 241 keys"
  (rows 19–24 already registered by T36; no new keys).
- `pnpm --filter @erp/api test` → `Test Files 25 passed (25) / Tests 270 passed
  (270)` (the two new specs are DB-suite files; the unit count is unchanged).
- Isolated `TMPDIR=$HOME/tmp-t39 npx vitest run --config vitest.db.config.ts
  src/__db__/manufacturing/qc.spec.ts` → `Test Files 1 passed (1) / Tests 6
  passed (6)`:
  1. "QC-1 PASS path" — completion holds the batch QUARANTINED (expiry
     2026-04-06 = completedAt+3d, provenance set), completion journal EXACTLY
     DR FG-INV 115.0000 · CR WIP 100.0000 · CR LABOR 10.0000 · CR OVERHEAD
     5.0000, fgValue 115.0000; availability onHand/quarantined 100.000000,
     available 0.000000; manualIssue off the held batch rejects
     BATCH_QUARANTINED; PASS (sampled 10) → released true, NO new journal,
     batch ACTIVE, available 100.000000, row fgBatchId/sampled/sampleSize
     pinned; FAIL+SCRAP on the now-ACTIVE batch rejects
     QC_SCRAP_BATCH_NOT_QUARANTINED.
  2. "QC-2 FAIL+SCRAP" — fgValue 57.5000, receipt move unitCost 1.150000,
     batch held at onHand 50.000000; the scrap → scrapJournalEntryId set,
     scrapQty 50.000000, scrapValue 57.5000 (cake WAC in M-FG 1.15), journal
     EXACTLY DR PRODUCTION_SCRAP 57.5000 · CR resolveInventoryAccount(M-FG)
     57.5000 (same helper the service uses), source key production_order/
     qc_scrap, exactly 1 OUT move off the batch (qty 50.000000,
     postedJournalId linked); batch onHand 0.000000 STILL QUARANTINED; order
     WIP 0.0000; second scrap rejects QC_SCRAP_EMPTY_BATCH.
  3. "QC-3 FAIL+REWORK" — stays QUARANTINED, released false, no journal; a
     later PASS releases (ACTIVE).
  4. "QC-4 FAIL+ACCEPT" — released true, batch ACTIVE, and the
     manufacturing.inspection.created audit row carries after.operatorOverride
     true (+ released true).
  5. "QC-5 PERIOD_LOCKED" — April softClose+lock → the scrap (entryDate
     04-14) rejects the engine's PERIOD_LOCKED with ZERO residue (no
     inspection row, journal count unchanged, onHand 10.000000, still held);
     reopen in finally → the SAME scrap succeeds (onHand → 0, still
     QUARANTINED); April restored OPEN.
  6. "GRN targets + validation pack" — supplier M-QC-S1 + DRAFT GRN seeded
     (decision 2); PASS and FAIL+RETURN_TO_SUPPLIER on the GRN are record-only
     (rows pinned, whole-tenant journal count unchanged); the 12 typed
     rejections (PRODUCTION_ORDER_NOT_FOUND, INSPECTION_TARGET_NOT_FOUND,
     INSPECTION_DISPOSITION_REQUIRED, INSPECTION_DISPOSITION_INVALID ×3,
     INSPECTION_TARGET_INVALID ×4, INSPECTION_INPUT_INVALID ×2);
     inspections.find(unknown) → INSPECTION_NOT_FOUND; list
     {targetType: goods_receipt} → exactly the 2 GRN rows.
- Isolated `… src/__db__/manufacturing/genealogy.spec.ts` → `Test Files 1 passed
  (1) / Tests 10 passed (10)`: upstream(bread) 4 exact edges over levels
  [1,1,2,2] (dough 937.500000 producedBy the dough order, packaging 234.375000
  producedBy null; flour 637.500000 + yeast 125.000000 consumedBy the dough
  order); upstream(dough) level-1 flour+yeast only; upstream(flour) [];
  downstream(flour) the chain hops (decision 9) + sales EXACTLY
  [{level 3, sales_invoice, saleInvoiceId, 100.000000, 2026-03-06}];
  downstream(dough) level-1 bread + level-2 sale; downstream(bread) level-1
  sale, productions []; downstream(packaging) level-1 bread order only;
  batchSummary(bread) onHand 650.000000 / salesCount 1 / no consumers /
  inspectionsCount 0, batchSummary(dough) onHand 12.500000 / consumedByOrders
  [bread 937.500000] / salesCount 0; unknown uuid → GENEALOGY_BATCH_NOT_FOUND
  on all three entry points; the read-only guarantee (baseline re-asserted
  after every read + zero manufacturing.genealogy* audit rows).
- Combined `… src/__db__/manufacturing/` → `Test Files 6 passed (6) / Tests 47
  passed (47)` (file order qc → orders → wip-recon → genealogy → bom → costing
  — qc FIRST, so genealogy/costing read the chain after the gate-on substrate
  exists).
- Combined `… src/__db__/manufacturing/ src/__db__/accounting/periods/periods.spec.ts
  src/__db__/billing/readonly-sweep.db.spec.ts` → `Test Files 8 passed (8) /
  Tests 58 passed (58)` (order: readonly-sweep → qc → orders → bom → periods →
  costing → wip-recon → genealogy — genealogy LAST, after every flour consumer;
  the sweep's state-changing route test passed with the inspections route
  mounted).
- **Full DB suite** `TMPDIR=$HOME/tmp-t39 pnpm --filter @erp/api test:db` →
  `Test Files 95 passed (95) / Tests 1506 passed (1506)` (a third distinct
  manufacturing file order; zero failures — the readonly-sweep inspections-404
  violation is gone, wip-recon 4/4 incl. the January NOT_APPLICABLE pin, and
  notifications-email passed on the first run).

## Handoff notes

- **T40 (reports):**
  - The genealogy edges carry IDS ONLY by design (MASTER-PLAN §10): enrich the
    sales edges' doc numbers from `sales_invoices`/`delivery_notes` by docId
    (the reporting module's read direction); the service shapes to wrap are
    `GenealogyUpstreamResult` / `GenealogyDownstreamResult` /
    `GenealogyBatchSummary` (application/genealogy-service.ts) — levels are
    HOPS, sorts are (level, consumedByOrderId, batchId) upstream,
    (level, orderId, fromBatchId) productions and (level, docDate, docId) sales
    downstream.
  - `manufacturing.qc_inspection_log` reads the inspections list shape
    (`InspectionRow`: targetType/orderId/grnId/fgBatchId/result/sampled/
    sampleSize/disposition/inspectedAt/note/noteAr) — the fixture export is
    `inspections` (manufacturing/fixtures.ts), list filter
    {targetType?, orderId?, limit}.
  - The wip-recon `diff.orphanJournals` residue note STILL applies: never assert
    it empty (the net-zero drift pair dated 2026-03-20 lives in tenant M
    forever); a WIP-GL tie-out uses asOf ≥ 2026-03-20 or the wip-check service.
  - qc.spec leaves tenant M with April-dated gate orders + qc_scrap journals on
    the PRODUCTION_SCRAP/INVENTORY accounts (never WIP) — a production_cost GL
    tie over April must include them; the qc_scrap source operation is the
    fixed `qc_scrap` (docType production_order).
- **T41 (web):** the six routes and their envelope shapes —
  `GET/POST /api/v1/manufacturing/inspections` (+ `GET …/:id`) under
  manufacturing.qc.manage / manufacturing.qc: the POST returns
  `{inspection: InspectionRow, released: boolean, scrapJournalEntryId:
  string|null, scrapQty: string|null, scrapValue: string|null}`; the typed
  error codes to map in messages.ts (localizedManufacturingError):
  INSPECTION_NOT_FOUND, INSPECTION_TARGET_NOT_FOUND, INSPECTION_TARGET_INVALID,
  INSPECTION_INPUT_INVALID, INSPECTION_DISPOSITION_REQUIRED,
  INSPECTION_DISPOSITION_INVALID, QC_SCRAP_BATCH_NOT_QUARANTINED (409),
  QC_SCRAP_EMPTY_BATCH, GENEALOGY_BATCH_NOT_FOUND;
  `GET /api/v1/manufacturing/genealogy/{upstream,downstream,batch}/:batchId`
  under manufacturing.genealogy.read / manufacturing.batch_genealogy —
  read-only screens, never a mutation path.
- **Phase owner:** §9 rows 19–24 are now mounted (the 24-route surface is
  complete); §4 (QC gate) and §10 (genealogy semantics) are shipped per the
  master plan; the sole intentional movement-core surface change is decision 1.
