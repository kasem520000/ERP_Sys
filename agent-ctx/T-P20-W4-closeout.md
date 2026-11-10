# T-P20 — W4 orchestrator close-out (PHASE-020 final)

> The orchestrator's own wave-4 record: wiring completions, production-bug
> fixes, the phase-bump flip, and the final full-suite gates. Complements
> the per-task evidence files (index in the completion report).

## 1. Wave-2 wiring completions (after the 2-b/2-d agent cuts)

- `sync.controller.ts` v2: pull routes everything through `pull()` (the
  service itself gates the device + routes the `permissions` entity — the
  controller's duplicated branch removed), status v2 shape with
  `contractSupported` (C-08 signal), `trustFlags` added to
  `SyncDeviceRow`/`loadDevice`, push/ack pair with the 50-command + 1 MB
  budgets, `ackPositions` upserting `sync_cursors` via the tamper-evident
  cursor decode.
- `sync.module.ts`: PushService + DeviceRegistryService +
  ReconciliationService + DevicesController + SyncAdminController wired.
- `permissions.guard.ts` SELF_SCOPE_KEYS += `sync.devices.revoke` (the
  controller enforces device ownership — the self-revoke journey).
- `error.filter.ts`: the sync-plane status map (404/403/401/422/429/400 —
  the 2-c agent's rows landed intact).
- Evidence files written retroactively for the cut agents:
  `T-P20-2b-push.md`, `T-P20-2d-sync-core.md` (their work verified green
  first: sync dir 35/35 → later 74/74, sync-core 36/36).

## 2. Production bugs found by the chaos matrix (3-b) + fixed in-phase

1. **C-09b — PRICE_CHANGED never fired on the offline POS path.** The
   BR-003 gate lived only in `SalesInvoiceService.approve`; the POS
   autopost bypassed it. Fix: the same policy-gated check on
   `PosSaleService.submit` (overrides disallowed → deterministic
   resolution enforced; default lane pricing unchanged) +
   `PriceChangedError` now carries `{itemId, resolved, provided}` details.
2. **C-11b — ITEM_INACTIVE vocabulary.** `requireSellableItem` +
   `resolveSalesPrice` treated soft-deleted items as "does not exist"
   (generic VALIDATION_ERROR); the registry map said ITEM_INACTIVE was
   resubmittable:true. Fixes: soft-deleted master data → ITEM_INACTIVE
   (the tenant's own row — the no-disclosure principle targets cross-tenant
   probes, C-13's concern); `RESUBMITTABLE_BY_REASON.ITEM_INACTIVE/
   PARTNER_INACTIVE` → false (CONFLICT_RESOLUTION §3 binding —
   cancel/substitute-and-resend, never a plain resubmit; DR-P20-01).
3. **D-03b — no push byte budget.** `push-service` enforced only the
   50-command cap; the controller's zod cap disagreed (200). Fixes: the
   1 MB serialized-batch budget on BOTH (service = the single enforcement
   point; controller = defense in depth), the controller's count cap
   aligned to 50.
   The three `it.todo` slots converted to real green tests (C-09b, C-11b,
   D-03b) + the C-11 original's assertions updated to the corrected
   vocabulary (tombstoned → ITEM_INACTIVE resubmittable:false; unknown id
   stays the generic VALIDATION_ERROR).

## 3. NAV_ITEMS + phase bump (the W4-a/4-b leftovers)

- `packages/contracts/src/navigation.ts`: +3 platform rows
  (platform.devices / sync-health / sync-reconciliation — feature keys
  offline.device_management / offline.sync_protocol).
- `CURRENT_SHIPPED_PHASE` → `"PHASE-020"` + the coordinated pin moves
  (DR-P20-24): spec pin, the two beyond-phase synthetic proofs → 021,
  layer-fixtures BUSINESS_KEYS += the 0029 offline keys, 8 business golden
  hashes re-pinned. Configuration suite 97/97.

## 4. W4 stabilization

- **Handlers contract split** (DR-P20-21): `handlers/contract.ts` leaf —
  depcruise 0 violations (was 4 no-circular).
- **createQueue deadlock tolerance** (DR-P20-22): `createQueueTolerant`
  with 40P01 retry ×2 — the import-export boot flake closed.
- **Isolation A-series fixtures** (DR-P20-23): OWN_ROW/seed/attack rows
  for tombstones + inbox_commands (A4/A7 column fallbacks gc_after/result;
  inbox_commands on the NO_UPDATE_GRANT denial path) +
  `sales_invoice_lines` deleteGranted (0031). Isolation suite 888/888.

## 5. Final gate table (all green, 2026-11-04)

| Gate | Result |
|---|---|
| FULL DB suite | **115 files / 1773 tests ALL PASSED** |
| Sync dir | 9 files / 74 tests (wall ~12 s) |
| sync-core | 36/36 |
| API unit | 274/274 |
| Sales+POS regression | 57/57 |
| typecheck / lint | 6/6 · 6/6 |
| depcruise | 0 violations (1018 modules) |
| permissions-drift | 243 = 243 |
| i18n-parity | ar=en=3044 |
| capabilities-matrix | fixture ↔ matrix agree (PASS 13 rows) |
| docs:validate | 29/29 |
| check-rls | green in-suite (migrations.db.spec runChecks) |

## 6. Deliverable state

Uncommitted tree ≈ 99 changed/new paths spanning migrations 0029–0031,
the sync module (application/domain/presentation), sync-core v1, contracts
v2 (+ capabilities fixture + navigation), 3 web screens + components +
i18n, k6 + tooling scripts, 21 docs updates, and this evidence trail. The
phase commit + tag land with this close-out.
