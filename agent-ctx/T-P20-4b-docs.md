# T-P20-4b — PHASE-020 docs (Wave 4 / task 4-b)

> Task ID: 4-b · PHASE-020 · MASTER-PLAN §16 (the docs checklist — binding).
> Docs-only task: ZERO code changes (verified — `git status` deltas on
> `apps/**`/`packages/**` all belong to waves 1–3 + the orchestrator wiring;
> this task touched `docs/**` + this evidence file only).

## Files touched (docs only)

| # | File | Change |
|---|------|--------|
| 1 | `docs/database/ENTITY_CATALOG.md` | the 4 sync tables → "020 generalized — LIVE" (change_log/sync_cursors re-annotated; tombstones/inbox_commands → "020 — LIVE" with the job semantics); `devices` row widened (device_class/contract_version/attestation/trust_flags/watermarks/data_expires_at); `device_refresh_tokens` row verified present (W1 touch); `sales_invoices` + owner_device_id; section heading notes the sync substrate 016/020 |
| 2 | `docs/database/TABLES/sync.md` | NEW — the sync cluster column-level specs (change_log incl. the 0030 sequence grant, sync_cursors, tombstones, inbox_commands, device_refresh_tokens, the devices widening + 0031, grants & seeds) |
| 3 | `docs/database/ERD/sync.md` | NEW — the sync cluster ERD (mermaid: devices/refresh-chain/feed/cursors/tombstones/inbox + owner_device_id; the no-FK-on-tenant_id rule) |
| 4 | `docs/database/ERD/tenancy-identity.md` | devices block widened + `device_refresh_tokens` entity + the rotation-chain edge + pointer to the sync cluster specs |
| 5 | `docs/database/TABLES/trade-sales.md` | the 016 narrow-slice note trued up (was "is §11's boundary" → now "was … until PHASE-020 generalized it" + pointer to TABLES/sync.md) |
| 6 | `docs/planning/IMPLEMENTATION_STATUS.md` | PHASE-020 → COMPLETE + report link + the dense 019-style notes cell; header date; current-state heading → 001..020 |
| 7 | `docs/handoff/CURRENT_STATE.md` | implemented list + PHASE-020; repo-contents line → PHASE-020; the PHASE-020 prose block (the 015–018 per-phase block style); Tested line + the sync suites |
| 8 | `docs/handoff/CHANGELOG.md` | the PHASE-020 entry (019 bullet-list style) |
| 9 | `docs/product/FEATURE_CATALOG.md` | `offline.sync_protocol` + `offline.device_management` → "020 (shipped 2026-11-04)" + permission keys reconciled to the real seeds |
| 10 | `docs/api/ERROR_MODEL.md` | §4 sync/business registry: the `FORBIDDEN` row (DR-P20-02) + the ITEM_INACTIVE/PARTNER_INACTIVE resubmittable clarification |
| 11 | `docs/operations/MONITORING.md` | Sync health dashboard → LIVE with the concrete panels; `SyncPushFailSpike`/`SyncCursorStall` → live with the implemented in-product conditions; the `erp_sync_outbox_lag_devices` + `erp_sync_device_revoked_pending_ops` gauges note |
| 12 | `docs/operations/DEPLOYMENT.md` | §7 PHASE-020 row expanded: the change_log growth pre-flight (feed-head freshness, `ix_change_log_tenant_entity_seq`, size trend vs StorageGrowth, sibling-job bounds) + the partitioning decision trigger |
| 13 | `docs/operations/TROUBLESHOOTING.md` | §7 → LIVE; one runbook entry per alert (SyncPushFailSpike, SyncCursorStall) + the revoked-pending-ops/reconciliation-queue row + the refresh-token-reuse row (the correct audit action `device.refresh_token_reuse_detected`) |
| 14 | `docs/planning/PHASE_ACCEPTANCE_CRITERIA.md` | the 020 row rewritten to carry ALL 13 §6 criteria (compressed table style) |
| 15 | `docs/testing/SYNC_TESTS.md` | header status → FULL matrix LIVE; the §7 status note (9 files/74 tests, per-suite breakdown, seeds, the in-memory-adapter caveat) |
| 16 | `docs/offline/SYNC_PROTOCOL.md` | header status; §11 "SHIPPED 2026-11-04" note with the DR-P20-05/06/07 deviation pointers |
| 17 | `docs/offline/LOCAL_DATABASE.md` | header status; §1 status note (LOCAL_MIGRATIONS v2 + the in-memory-adapter caveat); §5 the row-count approximation note (DR-P20-10) |
| 18 | `docs/product/SUBSCRIPTION_AND_ENTITLEMENTS.md` | the PHASE-020 add-on-wiring note (offline.* live at CURRENT_SHIPPED_PHASE 20; 021/022 client keys stay phase-gated) |
| 19 | `docs/handoff/NEXT_ACTION.md` | rewritten: single next action = PHASE-021 (Tauri desktop per ADR-0013), why-now (020 complete), how (handoff protocol + binding constraints), next-eligible section, Do NOT updated |
| 20 | `docs/implementation/phases/reports/PHASE-020-COMPLETION.md` | NEW — the completion report (PHASE-019 style exactly): per-wave files, the gate table, the 13 acceptance criteria green, the capabilities cross-check table, **DR-P20-01…20** consolidated from every T-P20-*.md Decisions section, the honest deferrals, docs-updates checklist, exit criteria/DoD/handoff, the task evidence index |
| 21 | `agent-ctx/T-P20-4b-docs.md` | this file |

## Gate output (verbatim tail)

```
$ pnpm docs:validate
…
PASS  4d. EXPANSION_REGISTER present with ED-01..ED-19
…
PASS  4i. v2.0 cross-references registered (G-21..32, INV-023..26, BR-041..056, reports, perms, nav)

29/29 checks passed.
```

Baseline before my edits was also 29/29 — the gate stayed green through every
edit (new files TABLES/sync.md + ERD/sync.md + the completion report all pass
the link/phase-ref checks).

Re-verified while writing the report (the evidence core):

```
$ cd apps/api && npx vitest run --config vitest.db.config.ts src/__db__/sync/
      Tests  74 passed (74)
      Duration  11.63s
```

(no `it.todo` left in the dir — the three chaos-found-bug slots are real green
tests; matches the orchestrator's key facts).

## Decisions taken (docs-side)

1. **TABLES/ERD as new cluster files** (`sync.md` in both dirs) following the
   PHASE-019 crm-projects pattern (a whole new cluster authored in-phase)
   rather than scattering rows into tenancy-identity/trade-sales — with the
   tenancy-identity ERD + trade-sales TABLES trued up as pointers.
2. **Alert conditions documented honestly**: MONITORING's pipeline thresholds
   (5%/15 min; cursor-lag threshold) are kept, annotated with the implemented
   in-product conditions from SyncHealthService (successRate < 90% w/ ≥ 20
   commands over the 7d window; > 7-day lag) — the completion report records
   that the in-product aggregate is what shipped 2026-11-04.
3. **DR numbering**: DR-P20-01 is the ITEM_INACTIVE/PARTNER_INACTIVE
   resubmittable:false flip (matching the in-code comment in
   `packages/contracts/src/sync/index.ts:362` and chaos-matrix.spec.ts:1195);
   the remaining decisions consolidated as DR-P20-02…20; SYNC_PROTOCOL's
   status note references DR-P20-05/06/07 consistently.
4. **Error-filter mappings** quoted from the actual wiring
   (`error.filter.ts`: 404/403/401/422/429/400 rows) rather than the wave-2
   suggestions — the orchestrator wiring is the shipped truth.
5. PHASE_ACCEPTANCE_CRITERIA kept in its established one-row highlights
   format but rewritten to cover all 13 phase-doc §6 criteria (the file's own
   header says the authoritative expanded version lives in the phase doc —
   the row now points at every criterion incl. the k6 staged posture).

## Leftovers / handoff notes

1. **`CURRENT_SHIPPED_PHASE` code constant** —
   `apps/api/src/modules/configuration/application/apply/prerequisites.ts:55`
   still reads `"PHASE-019"`. Flipping it to `"PHASE-020"` is a CODE change
   (out of this docs-only task's mandate) and needs the spec re-pin with it
   (`__tests__/template-prerequisites.spec.ts` + the templates-*.spec pins
   assert the constant). MASTER-PLAN §16 wants it at 20 so the `offline.*`
   feature keys resolve live in `resolveEffectiveConfig` — **the
   orchestrator/W4 close-out must flip it before commit** (the docs side is
   done: SUBSCRIPTION_AND_ENTITLEMENTS + IMPLEMENTATION_STATUS + NEXT_ACTION
   now speak of CURRENT_SHIPPED_PHASE 20). Doc-only historical mentions of
   15/16/17/18/19 (CHANGELOG entries, per-phase prose in CURRENT_STATE) are
   records, deliberately not rewritten.
2. **k6 sync-fleet + capabilities tooling** = W4-a's scope (task 4-a);
   `apps/api/k6/` still holds only mvp-candidate + posting-smoke. The
   completion report records k6 T-05 as staged-not-executed (the waived
   hosted-k6 posture) and quotes the capabilities cross-check honestly.
3. The completion report's Definition of Done says "commit pending the W4
   close-out" — the W4 commit + `phase/020` tag land with the orchestrator's
   final gate run (full `test:db` at W4 per MASTER-PLAN §17).
4. IMPLEMENTATION_STATUS's stale "Cross-cutting status" table (a PHASE-002
   snapshot no phase has refreshed) was left untouched — a pre-existing gap,
   not this phase's; noted here so a future pass can decide.
