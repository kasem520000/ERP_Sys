# T38b-ii / Task 3-c — WIP reconciliation (INV-010 extension) + wip-check route + PC-04 wiring (PHASE-018)

**Agent:** T38b-ii · **Repo:** /home/z/phase017_work
**Status:** COMPLETE — typecheck clean, `pnpm lint` 6/6, depcruise 0 violations (1609
modules), unit 270/270 (25 files), permissions-drift 241=241, DB suite **1489/1490**
(sole fail: readonly-sweep with EXACTLY `[POST /api/v1/manufacturing/inspections → 404
NOT_FOUND]` — T39's route; wip-check is mounted and sweeps as the typed 403
read-only). notifications-email passed this run (the PHASE-017-documented flake did
not fire).

## Files created

- `apps/api/src/modules/manufacturing/application/wip-reconciliation-service.ts` —
  `ManufacturingReconciliationService.runWipCheck({asOf, runMode, checkedBy})`, kind
  `"WIP"` (mirrors `inventory/application/reconciliation-service.ts` + the
  treasury/tax run-check pattern):
  - controlSide = Σ GL base balance (as-of) of the ACTIVE WIP purpose account(s)
    (`journalStore.accountsForPurposes(["WIP"])` — the accounting-owned read, same
    import as `insertReconciliationRun`).
  - subledgerSide = Σ per-order WIP balances over ALL orders with in-window activity:
    Σ consumptions.value − Σ scraps.value − (completed in window ?
    orders.wip_credit_value : 0), each side as-of filtered (`consumed_at::date`,
    `scrapped_at::date`, `completed_at::date` ≤ asOf — inventory's as-of discipline,
    so a mid-chain asOf never false-breaks).
  - Orphan detail in `diff.orphanJournals`: journal entries touching the WIP
    account(s) with source ≠ `production_order` — entry id + entryNo + sourceType +
    sourceId + `wipNet` (the entry's signed WIP effect) — the inventory
    movesWithoutJournal mirror (informational detail; status is the balance compare).
  - status OK iff control === subledger EXACTLY (Decimal, tolerance 0; both sides
    normalized to canonical 4dp strings); BROKEN diff also carries
    `ordersWithWip` (nonzero-balance orders, capped 25) for T40 tie-outs.
  - Unmapped WIP purpose → early-return OK run 0.0000/0.0000 with
    `diff {accounts: 0, orders: 0, note: "WIP not mapped — nothing to reconcile"}`
    (the AR/AP unmapped precedent + inventory's zero-accounts semantics — the
    checklist derives NOT_APPLICABLE from the zero counts).
  - BROKEN ⇒ audit `manufacturing.reconciliation_broken` (entityType
    `"production_order_reconciliation"`, entityId = run id) + InboxService
    notification: category `reconciliation`, severity `critical`, bilingual
    title/body (GL vs orders balances + asOf), actionUrl `/manufacturing/orders`,
    dedupeKey `mfg-wip-reconciliation-broken:<runId>` (tenant broadcast — the §5
    variance-notification pattern; first user of the `reconciliation` category).
  - NO journal writes; run writes are reconciliation_runs + audit + notification
    only. No new domain errors (the check never throws typed errors; input
    validation is the controller's zod) → manufacturing-errors.ts + error.filter
    ladder untouched.
- `apps/api/src/modules/manufacturing/presentation/reconciliation.controller.ts` —
  §9 row 18 VERBATIM: `POST /api/v1/manufacturing/reconciliation/wip-check`,
  `@RequirePermissions("manufacturing.costing.read")` +
  `@RequireFeature("manufacturing.wip")`, requireIdentity, envelope; body
  `{asOf?, runMode?, checkedBy?}` (zod ISO date / NIGHTLY|ON_DEMAND / uuid|null),
  defaults asOf=today, runMode=ON_DEMAND, checkedBy=session user.
- `apps/api/src/__db__/manufacturing/wip-recon.spec.ts` — 4 tests (below).
- `agent-ctx/T38bii-3c-wip-recon.md` (this file).

## Files changed

- `manufacturing/infrastructure/manufacturing.store.ts` — new banner section
  "-- WIP reconciliation (T38b-ii…)": `wipGlBalanceAsOf(accountId, asOf)` (the
  inventory `glBalanceAsOf` SQL mirrored 1:1 — journal_lines truth), 
  `listOrderWipBalances(asOf)` (the as-of variant of T38b-i's `sumOrderWip`,
  per-order rows `{orderId, orderNo, status, balance}`), `listWipOrphanJournals(
  accountIds, asOf, limit)` (+ row types). Read-only SELECTs; no new writes.
- `manufacturing/manufacturing.module.ts` — +ManufacturingReconciliationService
  provider/export, +ReconciliationController (docblock notes the §11 slice).
- `accounting/application/reconciliation-service.ts` — PC-04 list
  `assertCoreChecksGreen` += `"WIP"`; the `reconciliation.wip` checklist row is LIVE:
  `wipCheckState(run)` / `wipCheckDetail(run)` (NOT_RUN when no run; NOT_APPLICABLE
  when the run is OK and (accounts === 0 — purpose unmapped — OR orders === 0 — no
  production activity); OK/BROKEN otherwise; mirrors `inventoryCheckState`'s
  zero-accounts branch over the manufacturing counts, per MASTER-PLAN §11 "NOT
  APPLICABLE when no WIP account mapped / zero accounts").
- `accounting/application/period-service.ts` — PC-04 `lock` gate list += `"WIP"`.
- `__db__/manufacturing/fixtures.ts` — exports `wipReconciliation`
  (ManufacturingReconciliationService on the fixture audit + InboxService).
- `__db__/accounting/periods/periods.spec.ts` — extended the live-checklist test
  (the per-phase pattern: PHASE-008 cash, -009 vat, -010 inventory blocks) with the
  PHASE-018 WIP block: NOT_RUN before any run → run the mfg check on tenant A
  (2026-08-31, no production activity) → OK run → checklist NOT_APPLICABLE with
  detail containing "nothing to reconcile".

## Decisions

1. **Drift-seeding technique (the INV-010 mirror):** the inventory spec seeds an
   orphan MOVE via superuser SQL (the app role cannot bypass the posting engine);
   the WIP mirror seeds an orphan JOURNAL through the REAL manual-journal surface —
   `JournalService` draft → submit (default policy `none` → auto-APPROVED) → post
   (`source {docType: "journal_entry", docId: draft.id, operation: "post"}`): a
   balanced manual journal `DR WIP(1160) 500.0000 · CR rent(5210) 500.0000` dated
   2026-03-20. This is a perfectly legitimate GL entry with NO producing order —
   exactly the drift the check exists to catch, and it exercises the real surface
   (no superuser guard-trigger surgery needed). Asserted: control − subledger =
   EXACTLY 500.0000 (difference-based — robust to any other order state), the diff's
   `orphanJournals` names the entry (sourceType `journal_entry`, sourceId = draft id,
   wipNet 500.0000).
2. **Repair = compensating correction (production discipline):** the drift is
   repaired by the SAME-DAY reversal through `mJournals.reverse` (posting engine,
   entryDate 2026-03-20) — posted documents are never mutated (the inventory spec's
   "production repairs are compensating corrections" note). RESIDUE for later specs:
   tenant M keeps the manual-journal/reversal pair on WIP dated 2026-03-20 — NET
   ZERO on the WIP GL from that date on (a wip-check at ANY asOf stays OK), but the
   pair remains in later runs' `diff.orphanJournals` detail (informational, like
   inventory's orphanMoves). Nothing asserts "orphanJournals is empty" after this
   spec; T39/T40 should not assert it either (see handoff).
3. **PERIOD_LOCKED interplay verified as "the run still records":** reconciliation
   runs are diagnostics (reconciliation_runs + audit + notification writes only) —
   same semantics as the inventory stock-check (no period gate in `runStockCheck`).
   The spec locks March (lock succeeds — prior WIP runs OK), records a run while
   LOCKED, then reopens in `finally` (order-independence discipline).
4. **PC-04 proof ordering:** the BROKEN run must be the LATEST WIP run ≤ the
   period's endDate for the lock gate to trip (`latestReconciliationRuns` picks
   DISTINCT ON kind by as_of DESC, created_at DESC) — the drift run uses asOf
   2026-03-31 (≥ every earlier WIP run's asOf in the spec) so `periods.lock(March)`
   throws `RECONCILIATION_BROKEN` (kind WIP), then reopen.
5. **Checklist NOT_APPLICABLE semantics:** `wipCheckState` = NOT_APPLICABLE when the
   run is OK && (accounts === 0 || orders === 0). This satisfies BOTH the
   MASTER-PLAN ("no WIP account mapped / zero accounts") and the brief's D4 ("with
   no WIP activity the checklist shows NOT_APPLICABLE"): the zero-activity case is
   proven on tenant M itself with an asOf BEFORE the chain (2026-01-31: WIP mapped,
   orders 0 → the January period's checklist shows NOT_APPLICABLE), avoiding a
   cross-suite fixture import or superseding tenant M's WIP mapping.
6. **Stale spec expectations (brief C4):** greps for `reconciliation.wip` /
   `WIP reconciled` / `manufacturing module ships` across `src/__db__` + unit tests
   found NONE (the stub row was never pinned anywhere — periods.spec,
   golden.spec, reporting/* all clean; dashboard.db.spec.ts has no checklist
   references). The periods.spec extension above is the additive live-row proof,
   not a fix.
7. **File-order independence:** the DB suite does NOT sort files (orders.spec's
   header note), so every pack is difference-based (the drift delta) or
   window-scoped (January; the golden-chain zero holds in both orders: every
   in-window March order completes in window — verified against costing.spec's
   03-07→03-08/03-09 orders and orders.spec's April packs). Proven by running
   wip-recon.spec ISOLATED (4/4, runs first) and after orders.spec (4/4 in the
   combined run). March is always restored OPEN in `finally`/`ensurePeriodOpen`.
8. **Route placement:** a tiny dedicated `reconciliation.controller.ts`
  (`@Controller("api/v1/manufacturing")`) — production-orders.controller is scoped
  to the `/production-orders` prefix and inventory keeps stock-check inside its big
  controller; a separate controller file is the cleanest VERBATIM row-18 mount.

## Test outputs

- `pnpm --filter @erp/api typecheck` → clean. `pnpm lint` → 6/6 successful.
  `pnpm run lint:depcruise` → "✔ no dependency violations found (1609 modules,
  6408 dependencies cruised)". `pnpm run check:permissions-drift` → "OK — matrix
  241 keys, seed 241 keys" (no new permission keys — row 18 uses the existing
  `manufacturing.costing.read`).
- `pnpm --filter @erp/api test` → `Test Files 25 passed (25) / Tests 270 passed (270)`.
- Full DB suite `TMPDIR=$HOME/tmp-t38bii pnpm --filter @erp/api test:db`:
  `Test Files 1 failed | 92 passed (93)` / `Tests 1 failed | 1489 passed (1490)`;
  the sole failure is readonly-sweep with violations EXACTLY
  `["POST /api/v1/manufacturing/inspections → 404 NOT_FOUND"]` — wip-check left the
  404 list (mounted; sweeps as 403 tenancy/subscription-read-only — business plan
  carries `manufacturing.wip`, no manual entitlement needed), inspections POST is
  T39's mount.
- Isolated `TMPDIR=$HOME/tmp-t38bii npx vitest run --config vitest.db.config.ts
  src/__db__/manufacturing/wip-recon.spec.ts` → 4/4 (runs-first order):
  1. "WIP-GL green path — the golden chain nets the WIP GL balance to zero":
     run OK, kind WIP, controlBalance "0.0000" = subledgerBalance "0.0000",
     diffCount 0, accounts ≥ 1, orders ≥ 2, orphanJournals []; checklist
     `reconciliation.wip` = OK with "per-order WIP balances…" detail.
  2. "zero-activity window": asOf 2026-01-31 → OK 0.0000/0.0000, accounts ≥ 1
     (mapped but idle), orders 0; the JANUARY period's checklist item =
     NOT_APPLICABLE ("no production activity…").
  3. "PERIOD_LOCKED interplay": softClose + lock March (succeeds — WIP runs OK)
     → runWipCheck asOf 2026-03-31 RECORDS while LOCKED (OK) → reopen in finally.
  4. "seeded drift": manual journal on WIP → BROKEN (delta exactly 500.0000,
     orphan named with source journal_entry/draft id/wipNet 500.0000); audit
     event `manufacturing.reconciliation_broken` on entityType
     `production_order_reconciliation`; inbox row (category reconciliation,
     severity critical, actionUrl /manufacturing/orders) via superuser SELECT;
     checklist item BROKEN; softClose + lock(March) → RECONCILIATION_BROKEN;
     reopen; same-day reversal → repaired run asOf 2026-03-31 OK with
     controlBalance === subledgerBalance.
- Combined `manufacturing/ + accounting/periods/periods.spec.ts +
  billing/readonly-sweep.db.spec.ts` run: 41/42 — the same single inspections-404
  failure; periods.spec 5/5 (the extended checklist test included), orders 7/7,
  costing 9/9, bom 11/11.

## Handoff notes

- **T39 (QC + genealogy):** the sweep's remaining violation is EXACTLY
  `POST /api/v1/manufacturing/inspections` — mount the inspections controller and
  the sweep goes fully green. Do NOT assert `diff.orphanJournals` is empty in any
  tenant-M wip-check run: the drift fixture leaves a net-zero manual-journal +
  same-day-reversal pair on WIP (dated 2026-03-20) that stays in the orphan DETAIL
  forever (status stays OK at every asOf ≥ 2026-03-20; asOf < 2026-03-20 sees
  neither). If qc.spec/genealogy.spec create January-2026-dated orders, the
  wip-recon January NOT_APPLICABLE assertion (`orders === 0` at asOf 2026-01-31)
  becomes stale — keep order activity in March/April or update that fact.
- **T40 (reports):** the wip-check run shape to reuse in tie-outs:
  `ManufacturingReconciliationService.runWipCheck({asOf, runMode: "ON_DEMAND",
  checkedBy})` → `{kind: "WIP", status, controlBalance, subledgerBalance, diff:
  {accounts, orders, orphanJournals, [ordersWithWip when BROKEN]}}`; the fixture
  export is `wipReconciliation` (manufacturing/fixtures.ts). The golden chain ties
  at asOf 2026-03-10: 0.0000 = 0.0000. The production_cost GL tie (consumed
  materials ↔ consumption journals) is untouched by the drift pair (it hits neither
  side). A WIP-GL-balance tie-out should use asOf ≥ 2026-03-20 (net zero) or the
  wip-check service itself.
- **T41 (web):** the run row is envelope-wrapped at
  `POST /api/v1/manufacturing/reconciliation/wip-check` (permission
  manufacturing.costing.read, feature manufacturing.wip); diff fields are plain
  JSON (numbers/strings/arrays) — api-types rows can mirror ReconciliationRunRow.
- **Phase owner:** the PC-04 gate + the close checklist now include WIP; the
  RECONCILIATION.md row for WIP (§1) can be marked shipped in the docs pass.
