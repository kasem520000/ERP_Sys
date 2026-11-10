# T-P20-2d — sync-core v1 (Wave 2): cycle engine, retry, recovery, pruning, watermark

> Task ID: 2-d · PHASE-020 · MASTER-PLAN §13; SYNC_PROTOCOL §9 + LOCAL_DATABASE.
> Delivered by subagent (session cut before the evidence file — orchestrator
> verified the surface and re-ran the gates; retroactive record).

## Files

| File | Status |
|---|---|
| `packages/sync-core/src/cycle.ts` | NEW — `runCycle()` full engine |
| `packages/sync-core/src/retry.ts` | NEW — full-jitter scheduler (base 5s / cap 15min) + `RetryScheduler` |
| `packages/sync-core/src/recovery.ts` | NEW — `recoveryPass()` IN_FLIGHT→QUEUED + integrity check |
| `packages/sync-core/src/pruning.ts` | NEW — row-budget LRU pruning per device class |
| `packages/sync-core/src/errors.ts` | NEW — `SyncReadOnlyError` + `LocalStoreCorruptError` |
| `packages/sync-core/src/watermark.ts` | NEW — permission snapshot watermark (D-04) + `assertWritable` |
| `packages/sync-core/src/outbox/engine.ts` | EXTENDED (markQueueUnresolvable + v2 hooks) |
| `packages/sync-core/src/commands/builders.ts` | EXTENDED (v2 command builders) |
| `packages/sync-core/src/store/adapter.ts` | EXTENDED (meta/inbox helpers, quarantine) |
| `packages/sync-core/src/store/pull.ts` | EXTENDED (permission watermark + meta) |
| `packages/sync-core/src/client.ts`, `src/index.ts` | EXTENDED (cycle surface exported) |
| `packages/sync-core/__tests__/cycle.test.ts` | NEW (6) |
| `packages/sync-core/__tests__/retry.test.ts` | NEW (7) |
| `packages/sync-core/__tests__/recovery-pruning.test.ts` | NEW (9) |
| `packages/sync-core/__tests__/watermark-tombstone.test.ts` | NEW (6) |

## Delivered mechanics (verified in code + tests)

- `runCycle()` order: recovery pass → status (contract gate →
  `meta: contractGate = "read-only"`, STOP, no fabrications — C-08;
  revocation → queue unresolvable, no push — C-06) → pull permissions
  FIRST (watermark) → pull each feed entity until drained (hasMore loop,
  resync honored — C-12) → push FIFO batches ≤ 50 (v2 transport when
  available, else 016 legacy) → best-effort acks.
- Retry: `delay = min(cap, base×2^attempts)×rand(0.5..1)`, honors
  `retryAfterMs`; DEFERRED results reschedule without consuming attempts.
- Recovery: IN_FLIGHT→QUEUED; integrity check (cursor/inbox counts vs
  meta checksum) → mismatch = `LocalStoreCorruptError` (loud, never a
  silent drop) → quarantine + cursor-reset re-bootstrap (C-12 path).
- Pruning: per-class row budgets (approximation BYTES_PER_ROW_APPROX —
  documented; byte-exact is 021 with real SQLite), oldest-synced rows
  first; outbox/inbox/cursors never pruned.
- Watermark: `now − snapshotAt > 7d` → `SyncReadOnlyError` on writes
  (D-04 client-side; server re-checks on push regardless).

## Test evidence (re-run by orchestrator 2026-11-04)

```
$ cd packages/sync-core && npx vitest run
 ✓ __tests__/recovery-pruning.test.ts (9 tests)
 ✓ __tests__/chaos-slice.test.ts (8 tests)      // 016 slice intact
 ✓ __tests__/cycle.test.ts (6 tests)
 ✓ __tests__/retry.test.ts (7 tests)
 ✓ __tests__/watermark-tombstone.test.ts (6 tests)
 Test Files  5 passed (5)   Tests  36 passed (36)
```

## Decisions (for the completion report)

1. Row-count budget approximation (documented in pruning.ts) — byte-exact
   LRU budgets deferred to 021 (real SQLite), per MASTER-PLAN §13.
2. Contract gate stores `meta: contractGate = "read-only"` (sticky until
   a status call reports a supported version) — the local store stays
   READABLE but never pushes under an unsupported contract.
3. Revoked-device discovery mid-cycle marks the whole queue
   `unresolvable` (no per-item retry storm); reconciliation is the
   server-side owner of the aftermath (2-c's queue).
4. `markQueueUnresolvable` added to the outbox engine (the 016
   chaos-slice test untouched and green).

## Wave-2 integration state (orchestrator-verified)

- `pnpm typecheck` 6/6, `pnpm lint` 6/6 (whole monorepo, after the
  controller/module/guard wiring landed).
- `apps/api` sync DB suite 35/35 (pull 9, push 9, policies 8, devices 9).
- `sync-core` 36/36.
