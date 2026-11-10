# T38b-i / Task 3-b — Production order core + golden chain (PHASE-018)

**Agent:** T38b-i · **Repo:** /home/z/phase017_work
**Status:** COMPLETE — typecheck 6/6, lint 6/6, depcruise 0, DB suite 1485/1486
(sole fail: readonly-sweep with exactly the 2 expected 404s — wip-check (T38b-ii) +
inspections POST (T39); notifications-email is the PHASE-017-documented flaky order
sensitivity — passes in reruns, 5/5 observed).
Note: the dispatching agent completed the DI fix + evidence after the subagent hit
its deadline: the vitest/esbuild pipeline emits NO design:paramtypes, so
non-@Inject constructor params resolve to undefined (the JobCardService
silent-undefined precedent) — ProductionOrderService now @Injects ALL 7 params.

## Files created

- `apps/api/src/modules/manufacturing/application/production-order-service.ts` (1016+)
  — full lifecycle: create/update (DRAFT), release (PRD number via NumberingService
  reserve+bind, BOM version bind + level-1 explosion snapshot as order lines,
  idempotent on RELEASED), start, consume (planIssue/applyIssue, stagePendingOverlay,
  one journal per call with operation `consume:<seq>` — sequence-unique source keys,
  per-slice production_consumptions rows, line actual_qty updates, >threshold%
  variance → over_plan flag + ONE inbox notification dedupe-keyed, never blocks),
  scrap (reason per policy, value ≤ WIP balance — typed SCRAP_EXCEEDS_WIP, journal
  `scrap:<seq>`, NO stock move), complete (WIP-balance materials + labor/overhead
  rates as extra completion-journal credits, FG receipt via planReceipt with
  batchNo=orderNo + expiry=completedAt+shelfLifeDays, linkBatchProduction +
  quarantineBatch when qc_gate=required, idempotent replay returns the stored
  result), cancel (zero-consumption rule, reason required).
- `apps/api/src/modules/manufacturing/presentation/production-orders.controller.ts`
  — routes §9 #8–17, verbatim vs route-permissions (view/create/approve/post split,
  scrap under feature manufacturing.scrap).
- `apps/api/src/__db__/manufacturing/orders.spec.ts` (8) + `costing.spec.ts` (9) +
  fixtures chain (§8 numbers exact — J1 8875.0000 / J2 443.7500 / J3 8431.2500 /
  J4 8554.6875 / J5 9117.1875 multi-credit; dough @ 8.875000, bread @ 12.156250,
  expiry +2d/+5d, sale COGS 1215.6250, WIP zero per order, on-hands: dough 12.5 /
  packaging 765.625 / flour 1362.5 / yeast 875 / bread 650).

## Files changed

- `manufacturing.store.ts` (order/line/consumption/scrap sections below the BOM
  banner), `manufacturing-errors.ts` (+state/input/cancel/rounding/shelf-life errors)
  + `error.filter.ts` ladder, `manufacturing.module.ts` (+ProductionOrderService
  provider/export + ProductionOrdersController), `fixtures.ts` (chain export).

## Handoff notes

- **T38b-ii**: order stamps to read — `wip_credit_value`, `fg_value`, `labor_value`,
  `overhead_value`, `fg_journal_id`, `fg_batch_id`, `actual_qty`, `completed_at`;
  `sumOrderWip`/consumption/scrap lists exist on the store; the wip-check route is
  `POST /api/v1/manufacturing/reconciliation/wip-check` (route-permissions row
  exists; permission manufacturing.costing.read, feature manufacturing.wip);
  add "WIP" to the PC-04 lists (assertCoreChecksGreen + PeriodService.lock) and
  activate the `reconciliation.wip` checklist row; the golden chain leaves WIP GL
  balance 0 (tie-out substrate ready).
- **T39**: chain export `fixture.chain` (dough/bread order rows + produced batch ids
  + the journal ids); genealogy edges = production_consumptions.batch_id (upstream)
  + item_batches.production_order_id + stock_moves(source_type sales_invoice/
  delivery_note, batch_id) for downstream sales; qc gate OFF in the chain (qc.spec
  flips `manufacturing.qc_gate` via setMfgSetting + runs its own gate-required order).
- **T40**: the report tie-outs read the same chain data (dedicated R18 tenant
  recommended — mirror industry-017's pattern).

## Test outputs

- DB suite: `Test Files 1 failed | 91 passed (92)` / `Tests 1 failed | 1485 passed
  (1486)` — readonly-sweep violations exactly `[wip-check 404, inspections 404]`.
- orders.spec 8/8 · costing.spec 9/9 · bom.spec 11/11 (isolated tails recorded in
  /tmp/run2.log section; typecheck/lint/depcruise green.
