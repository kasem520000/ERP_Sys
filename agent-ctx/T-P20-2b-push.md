# T-P20-2b — PHASE-020 push side (Wave 2): handler framework + inbox + policies + legacy compat

> Task ID: 2-b · PHASE-020 · SYNC_PROTOCOL §3/§6 + MASTER-PLAN §1/§6/§7.
> Delivered by subagent (its session was cut before the evidence file was
> written — the orchestrator verified the delivered surface, ran the gates,
> and completed the controller wiring); this file is the retroactive record.

## Files

| File | Status |
|---|---|
| `apps/api/src/modules/sync/application/push-service.ts` | REWRITTEN to v2 (763 lines; 016 `requireActivePosDevice` kept byte-identical) |
| `apps/api/src/modules/sync/application/handlers/index.ts` | NEW — NormalizedCommand + SyncHandlerContext + registry |
| `apps/api/src/modules/sync/application/handlers/pos-sale.ts` | NEW — legacy `pos_sale` + v2 `pos_sale:create` (SERVER_DECISION, 016 path) |
| `apps/api/src/modules/sync/application/handlers/shift.ts` | NEW — legacy `cashier_shift` open/close (SERVER_DECISION, 016 path) |
| `apps/api/src/modules/sync/application/handlers/partner-merge.ts` | NEW — `partner:contact_merge` FIELD_LEVEL_MERGE |
| `apps/api/src/modules/sync/application/handlers/draft-invoice.ts` | NEW — `sales_invoice:create_draft`/`update_draft` OWNER_DEVICE_WINS + STALE_VERSION |
| `apps/api/src/modules/sync/application/handlers/online-only.ts` | NEW — ONLINE_ONLY guard → FORBIDDEN resubmittable:false |
| `apps/api/src/modules/sync/application/inbox-service.ts` | NEW — findInboxResult/recordInboxResult |
| `apps/api/src/modules/sync/domain/sync-errors.ts` | NEW — 6 request-level typed errors |
| `apps/api/src/__db__/sync/push.spec.ts` | NEW (9 tests) |
| `apps/api/src/__db__/sync/policies.spec.ts` | NEW (8 tests) |
| `apps/api/migrations/0031_sync_draft_line_replace.sql` | NEW — `GRANT DELETE ON sales_invoice_lines` (the update_draft aggregate-replace gap) + registrations |

## Delivered mechanics (verified in code + specs)

- Unified normalize (v2 `SyncCommand` / 016 legacy) → ONE handler registry
  keyed `"entityType:intent" | "legacy:type"`; handlers call owning-module
  services ONLY (PosSaleService, PosShiftFlowService, SalesInvoiceService,
  PartnerService) — no second business-logic path.
- Batch flow per MASTER-PLAN §6: device row → tenant suspended (C-14
  per-item, never in inbox) → revoked (C-06 per-item) → contract gate
  (C-08 per-item `CONTRACT_VERSION_UNSUPPORTED`, resubmittable false) →
  rate limit (token bucket per device; gated pushes never consume a
  token; overflow → `DEFERRED {reason: 'RATE_LIMITED', retryAfterMs:
  5000}` — not executed, not in inbox).
- Inbox: lookup `(tenant_id, device_id, command_id)` (v2) /
  `(tenant_id, device_id, idempotency_key)` (both) → replay stored result
  + `duplicate: true` (C-01); within-batch second occurrence of the same
  idempotencyKey replays the FIRST result + duplicate (v2 refinement over
  the 016 `{deduped}` echo — recorded below).
- Handlers validate BEFORE any write and declare feed entries; the push
  service records the inbox row + `publishFeedEntries` in the SAME tx as
  the command (SYNC_PROTOCOL §9 note 4).
- ONLINE_ONLY_ENTITIES (8 types) → FORBIDDEN resubmittable:false before
  any handler runs.
- `partner:contact_merge`: whitelist phone/phone2/email/addressLine1/
  addressLine2/city/contactPerson; constrained fields present
  (creditLimit/paymentTerms/taxNumber/priceListId/status) →
  VALIDATION_ERROR `details.constrainedFields`, zero merge; per-field LWW
  merge + `partner.contact_field_merged` audit with field-level
  before/after.
- `sales_invoice:create_draft` → DRAFT via sales service, stamps
  `owner_device_id`; `update_draft` → non-owner FORBIDDEN
  details.ownerDeviceId; baseVersion mismatch → STALE_VERSION
  details.currentVersion; aggregate snapshot semantics (lines replaced
  wholesale — migration 0031's DELETE grant).

## Test evidence (re-run by orchestrator 2026-11-04)

```
$ cd apps/api && npx vitest run --config vitest.db.config.ts src/__db__/sync/
 ✓ src/__db__/sync/push.spec.ts (9 tests)
 ✓ src/__db__/sync/devices.spec.ts (9 tests)
 ✓ src/__db__/sync/policies.spec.ts (8 tests)
 ✓ src/__db__/sync/pull.spec.ts (9 tests)
 Test Files  4 passed (4)   Tests  35 passed (35)
```

(includes 2-a/2-c suites — the shared suite state after the wave landed;
2-b's own 17 tests: push.spec 9 + policies.spec 8.)

## Decisions (for the completion report)

1. Within-batch duplicate idempotencyKey → replay-first-result +
   `duplicate: true` (the 016 path echoed `{deduped: true}` with no
   result; the v2 refinement returns the stored result so a flapped
   client converges without a re-push).
2. Migration 0031: 0018 never granted DELETE on sales_invoice_lines
   (online drafts are append-only); the sync update_draft handler is a
   legitimate line-replacing writer (DRAFT-only, OWNER_DEVICE_WINS single
   writer — posted lines unreachable by construction).
3. DEFERRED items never consume rate tokens and never enter the inbox
   (C-03 discipline: no partial records for unexecuted commands).
4. Legacy `{type: "pos_sale"|"cashier_shift"}` rides the same handlers
   with `intent: "create"|"open"|"close"`; results byte-identical to 016
   (`result.replay` preserved).

## Orchestrator wiring completed after the cut

- `sync.controller.ts`: v2 pull/push/pull-ack/push-ack/status through the
  generalized services (`pull()` routes the permissions entity itself —
  the controller's duplicated branch removed; status v2 shape +
  `contractSupported` C-08 signal; `trustFlags` added to
  `SyncDeviceRow`/`loadDevice`).
- `error.filter.ts`: SYNC_ENTITY_NOT_PULLED/DEVICE_NOT_FOUND → 404;
  DEVICE_REVOKED (both spellings)/SyncTenantSuspended → 403;
  DeviceRefreshInvalid → 401; SyncContractUnsupported → 422;
  SyncRateLimited → 429; SyncCommandInvalid/Attestation* → 400.
- `sync.module.ts`: PushService + DeviceRegistryService +
  ReconciliationService + DevicesController wired.
- `permissions.guard.ts` SELF_SCOPE_KEYS += `sync.devices.revoke`
  (controller already enforces device ownership — self-revoke journey).
