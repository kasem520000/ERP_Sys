# T-P20-3b — Chaos matrix + companion suites (Wave 3 / PHASE-020)

> Task ID 3-b · chaos-matrix.spec.ts (C-01..C-16) → duplicates.spec.ts →
> device-security.spec.ts → push-isolation.spec.ts + the shared `_oracle.ts`
> ledger oracle. Tests ONLY (no production code touched).

## Files delivered (all NEW, owned files only)

| # | File | Session | Purpose |
|---|------|---------|---------|
| 1 | `apps/api/src/__db__/sync/_oracle.ts` | 1st (cut off) | shared substrate: `seedPosWorld` per-suite fixtures, service graph, `enrollDevice`, `HarnessTransport`, command builders, ledger oracles (INV-013/001/002/018, AR tie, honest-state) |
| 2 | `apps/api/src/__db__/sync/chaos-matrix.spec.ts` | 1st (cut off) | FULL matrix C-01..C-16 + a D-04 watermark probe (17 passed, 2 todo) |
| 3 | `apps/api/src/__db__/sync/duplicates.spec.ts` | 1st + 2nd (formatting fix only, line 7 import split) | 2×/10×/concurrent/cross-batch/35-day restored outbox (5 passed) |
| 4 | `apps/api/src/__db__/sync/device-security.spec.ts` | 2nd (this session) | D-01 revoke pre-exec, D-03 malformed/oversized, D-04 snapshot expiry, tenant-A→B spoof (4 passed, 1 todo) |
| 5 | `apps/api/src/__db__/sync/push-isolation.spec.ts` | 2nd (this session) | Y-01..Y-04 (4 passed) |

Forbidden files untouched — verified: the 4 harness references
(pull/push/policies/devices.spec.ts) and the sibling's jobs.spec.ts carry
pre-session mtimes (01:56/01:58/02:05/02:14/03:05) and zero edits from this
task; no `modules/**`, `infra/**`, `packages/**`, migrations, or web files
were modified.

## Tenants (all verified unused before seeding; no cross-file state)

| Suite | Tenant(s) | Actors |
|---|---|---|
| chaos-matrix | 24242424 (+foreign 34343434 for C-13) | 2401/2402 |
| duplicates | 25252525 | 2501/2502 |
| device-security | 26262626 (+spoof B 28282828) | 2601/2602 |
| push-isolation | 30303030 (A) + 31313131 (B) | 3001/3002/3003, B 3102 |

## Per-scenario one-liners (assertions bind to SYNC_TESTS §2 / MASTER-PLAN §14)

- **C-01** pos_sale ×4 deliveries → 1 invoice + 1 journal pair (INV-013
  2-per-source), byte-equal replays with `duplicate:true` (no property on
  the original).
- **C-02** premature dependent (update_draft before its create) →
  VALIDATION_ERROR referencing the missing id, zero orphans; resubmit after
  the predecessor lands → ACCEPTED version+1.
- **C-03** 5-command batch, #3 PERIOD_LOCKED (December locked+reopened
  around the push) → 1,2,4,5 committed; exact journal-line count 20
  (4×[3 settlement + 2 COGS]) — zero residue.
- **C-04** commit-then-drop-response (server executes, device "crashes"
  IN_FLIGHT) → boot recovery (recover=1) → re-push replays the ORIGINAL
  result `duplicate:true`; outbox ACKED, pos_sales row SYNCED with the
  original official number.
- **C-05** flap mid-pull: page fetched then discarded → cursor never
  advanced; re-pull serves the identical page (entityType/hasMore/changes
  equal); full drain == DISTINCT feed ids; local rows == feed count.
- **C-06** revoke mid-queue → pull throws SyncDeviceRevokedError; push
  per-item DEVICE_REVOKED (zero execution, inbox 1 = the pre-revoke
  command only); client cycle surfaces revoked, pushes nothing, queue
  pending=2 (no silent loss); reconciliation lists the device.
- **C-07** ±48h client clock skew (the +6h/−2h class rides the same
  advisory-only mechanism) → entry_date = business date, posted_at ≤ server
  now and < the skewed future time; same-second redelivery replays by id;
  a different command with the same clientCreatedAt executes.
- **C-08** stale contract "1999-01-01.1" → per-item
  CONTRACT_VERSION_UNSUPPORTED (nothing executed/inbox); client leg: meta
  contractVersion preset → typed rejections recorded; status-advertised
  gate → store `contractGate:"read-only"`, zero pulls/pushes, captures
  throw SyncReadOnlyError.
- **C-09** 20 queued sales with 2 rng-picked engineered rejects (stock 500
  vs 50; INACTIVE item) → 18 official POS- numbers; 2 typed rejects with
  user actions; INSUFFICIENT_STOCK details {itemId}; PENDING_SYNC before
  the drain, SYNCED+official after, rejects never SYNCED/numbered.
- **C-10** two devices, one draft → non-owner FORBIDDEN
  details.ownerDeviceId; owner stale baseVersion STALE_VERSION
  details.currentVersion; owner-current ACCEPTED — exactly one resolution
  path (single-writer).
- **C-11** tombstone: soft-deleted item → op:DELETE + payload:null +
  tombstones row; local row removed by the applier; stale push = unknown-id
  shape (byte-equal modulo id echo); INACTIVE-item vocabulary; unknown-row
  tombstone = no-op with cursor advancing.
- **C-12** cursor seq beyond head → resync:true + fresh 0-cursor + zero
  changes; ledger untouched; the client honors the directive (runCycle
  emits `resync`, restart lands, feed re-served from 0).
- **C-13** A-device referencing foreign-B REAL ids (item/partner/invoice
  probe) → VALIDATION_ERROR identical to unknown-id, zero effects in A and
  B.
- **C-14** suspend mid-session → push per-item TENANT_SUSPENDED (not in
  inbox); status surface suspended:true; restore → resume from the parked
  cursor (same seq), the accepted command replays duplicate:true, the
  gated one EXECUTES — no duplicates.
- **C-15** tampered payloads (negative qty; price 80 with tender 115;
  zero-price) → typed VALIDATION_ERROR, zero residue (invoices/journals/
  lines/moves all unchanged), oracles hold.
- **C-16** storage-full at capture (quota-armed adapter refusing write
  transactions) → capture throws loudly; queue persists (2 pending); after
  recovery the drain accepts both, SYNCED + official numbers.
- **duplicates** 2×/10× same key (byte-equal replays, 1 journal pair);
  concurrent twins (sequential in-process, noted); cross-batch replay in
  batch 5 of 5 (5 invoices/10 journals); 35-day restored outbox (age
  processed_at 35d + DELETE → inbox miss → the pos_sale service's own
  posting-key dedupe replays `replay:true`, no 2nd journal/stock move).
- **D-01** revoke pre-exec (queue full, nothing executed yet): pull typed
  DEVICE_REVOKED; push per-item DEVICE_REVOKED (zero ledger, inbox =
  the pre-revocation create_draft only); client cycle marks
  queueUnresolvable, pending=3; reconciliation lists the device via its
  owned draft.
- **D-03** malformed/oversized: non-object, 121-char key, 41-char
  entityType, 81-char localRef, unknown type, 61-char offlineReceiptNo →
  per-item VALIDATION_ERROR (never executed, never in inbox, the exact
  contract vocabulary messages); 51-command batch → typed
  SYNC_COMMAND_INVALID.
- **D-04** >7d watermark → SyncReadOnlyError on captures (outbox never
  gains the row), state readOnly; the server still re-validates pushes
  while the store is read-only (authority never relaxed); fresh REAL
  permissions pull restores writability and the queue drains (SYNCED +
  POS- number).
- **spoof (device-security)** A's device inside B's context: items feed =
  B's only; permissions projection for A's user = EMPTY key set (home
  contrast: partners.view + sync.devices.register present); both ledgers
  untouched (B: 0 journals/0 invoices).
- **Y-01** cross-tenant push: A's device referencing B's REAL item/partner/
  draft-invoice ids → per-item VALIDATION_ERROR, zero effects in both
  tenants, messages free of B data (no /Isolation B/, no /31313131/).
- **Y-02** pull RLS scope: A-context pull contains A's item, never B's;
  the same device id in B's context serves B's items only (A's never ride
  along); permissions snapshot in B = [] for A's user.
- **Y-03** foreign-id refs = unknown-id shape: byte-equality (modulo the
  caller-provided id echo) for item, partner, and invoice references —
  including A's REAL draft id pushed THROUGH B's context (mirror spoof).
- **Y-04** device↔tenant binding: the PUBLIC refresh route (no ambient
  context) derives device → user → ACTIVE membership → withTenant; the
  rotation's `device.token_rotated` audit lands in A only (B: 0 audit
  rows, 0 inbox rows, 0 owned invoices); access-token claims
  {sub: A's cashier, deviceId, capabilities}.

## Verbatim gate output (final run)

```
$ cd apps/api && TMPDIR=$HOME/tmp-p20ball npx vitest run --config vitest.db.config.ts src/__db__/sync/
 ✓ src/__db__/sync/chaos-matrix.spec.ts (19 tests | 2 skipped) 2318ms
 ✓ src/__db__/sync/push.spec.ts (9 tests) 1273ms
 ✓ src/__db__/sync/duplicates.spec.ts (5 tests) 544ms
 ✓ src/__db__/sync/device-security.spec.ts (5 tests | 1 skipped) 344ms
 ✓ src/__db__/sync/jobs.spec.ts (6 tests) 349ms
 ✓ src/__db__/sync/push-isolation.spec.ts (4 tests) 319ms
 ✓ src/__db__/sync/devices.spec.ts (9 tests) 264ms
 ✓ src/__db__/sync/policies.spec.ts (8 tests) 183ms
 ✓ src/__db__/sync/pull.spec.ts (9 tests) 113ms
 Test Files  9 passed (9)
      Tests  71 passed | 3 todo (74)
   Start at  03:31:31
   Duration  11.49s (transform 1.03s, setup 0ms, collect 2.07s, tests 5.71s, environment 0ms, prepare 60ms)
WALL_SECONDS=12   (whole-dir wall incl. embedded-PG boot; ≤15 min budget beaten by ~75×)
```

Per-suite single-file runs (each its own PG boot ~5-8s wall): chaos 7.75s
(17 passed | 2 todo), duplicates 5.96s (5), device-security 6.55s (4),
push-isolation 5.60s (4).

`npx tsc --noEmit -p tsconfig.json` → zero errors (whole apps/api project).
`npx eslint <the 5 files>` → clean.

## Seeded-RNG approach (SYNC_TESTS §1/§9 — replayable scenarios)

1. Every randomized scenario takes a fixed per-scenario seed (C-01 `0xc01`
   … C-16 `0xc10`, D-01 `0xd01`, D-03 `0xd03`, D-04 `0xd04`, spoof `0x5f5`)
   and logs `[<id>] seed=<decimal>` to stdout — the run transcript above
   shows the seeds (e.g. `[C-09] seed=3081`, `[D-01] seed=3329`).
2. `seededRandom` (packages/sync-core test-harness) drives
   `ReferenceDevice.rng`; draws decide e.g. WHICH 2 of C-09's 20 sales are
   the engineered rejects (`[C-09] engineered rejects: #16 (stock) #12
   (inactive item)` is in the transcript), the C-11 victim sku, and the
   C-01 key suffix.
3. Deterministic scenarios (C-03/C-12/D-03) log their seed without drawing
   (shapes are fully specified — no ambient randomness, per SYNC_TESTS §3).
4. No `Math.floor` anywhere in the 5 files (ADR-0009); int draws use
   `(rng() * N) | 0`.

## Decisions (numbered, for the completion report)

1. **Prior-session continuation.** This task started with a cut-off first
   session that had already delivered `_oracle.ts`, chaos-matrix (17 green,
   2 todo) and duplicates (5 green). Verified both green first, then wrote
   the two missing suites. Only edit to prior files: duplicates.spec.ts
   line 7 (one line carried two imports — split for style; eslint was
   green either way).
2. **Oracle helper is NEW, by design.** Checked `__db__/pos/golden.spec.ts`
   and `__db__/sales/*` first per the task: they assert per-case journals
   inline (no reusable INV-013/001/002/018/AR/honest-state helpers exist) —
   so `_oracle.ts` implements them as SQL group-by violation scans
   (expect-empty lists) + a dependency-free internal expect wrapper
   (throwing loud Errors; vitest surfaces them as failures). The composite
   `ledgerOraclesHold(tenant)` runs after EVERY scenario.
3. **C-07 skew class:** master-plan §14 binds "±48h (+6h/−2h cases)" — the
   spec exercises the ±48h extremes (the strictest instances of the same
   advisory-only mechanism); the +6h/−2h sub-cases need no separate code
   path (clientCreatedAt is never read for dating; server entry_date is
   the business date, posted_at the server clock — asserted explicitly).
4. **C-02 vehicle:** policies.spec's draft-invoice fixtures adapted — the
   "receipt-allocates-invoice" pair maps to update_draft-before-create
   (the 020 intent set has no offline receipt:allocates intent; recorded
   as the honest mapping of the SYNC_TESTS row onto shipped intents).
5. **duplicates 35-day leg:** the retention job runs as the privileged
   maintenance role, so the aging UPDATE + DELETE ride the superuser
   handle (mirrors MASTER-PLAN §11: erp_app holds no UPDATE/DELETE on
   inbox_commands); the job's keying column (processed_at) is what gets
   aged, then the row is purged — the inbox replay MUST miss, and the
   service-level posting-key dedupe is the asserted second layer
   (`replay:true`, `duplicate` ABSENT — the inbox never saw it).
6. **Y-02 semantics:** the tenant binding of a pull/push is the REQUEST's
   tenant context (feed-groups.ts:113-114, devices is service-mediated
   with no tenant_id by PHASE-003 §4 design). The suite asserts the honest
   consequences: a B-scoped session serves/writes B only (A's rows can
   neither be pulled into it nor pushed through it), and the credential
   plane (Y-04) derives its tenant from the device user's ACTIVE
   membership via the PUBLIC refresh route — never from ambient context.
   A tenant-A session cannot be handed B rows by any device-id choice.
7. **D-01 queue listing:** a pre-exec revocation has no un-acked inbox
   rows, so the reconciliation entry is asserted through the owned DRAFT
   (ownedDrafts=1 — the devices.spec queue shape); the "queued local data
   wiped on next contact" clause of SECURITY_TEST_PLAN D-01 is a 021
   consumer behavior — the 020 client asserts its honest stand-in: the
   queue goes unresolvable (DEVICE_REVOKED) and nothing is silently lost.
8. **D-04 server-authority leg:** while the local store is read-only, a
   direct push of a tampered payload still rejects server-side — proving
   the client gate never relaxes server enforcement (the WATERMARK header
   contract: "the server stays the final authority … re-checks are never
   skipped").
9. **memoryAdapter no-rollback caveat (harness, not production):** the
   in-memory adapter's `transaction` is a documented pass-through
   (adapter.ts:411-416), so a capture refused by assertWritable AFTER the
   business-row INSERT leaves that row PENDING_SYNC with no outbox row.
   D-04 asserts the honest invariant that holds in both worlds: the
   OUTBOX never lists the refused capture, the refused row never carries
   an official number, and the drained capture is SYNCED. Real SQLite
   (LOCAL_DATABASE §6.2) rolls the whole capture back.
10. **`bUserId`/unused-import hygiene:** tsc noUnusedLocals forced the
    Y-04 register actor to be the device USER (CASHIER_A) — the registry's
    actorId is the device's user_id, so the token `sub` is the cashier;
    first run failed on `sub` mismatch, fixed by registering as CASHIER_A
    (documented in the spec comment).
11. **Suite isolation:** every suite owns its tenants end to end (the
    chaos C-13 foreign tenant and the device-security spoof tenant are
    dedicated real tenants seeded in-suite — chaos 34343434, security
    28282828; both verified unused) — no cross-file state anywhere.

## Production bugs / gaps found (NOT fixed — tests-only task; loud todo tests in-suite)

1. **PRICE_CHANGED never fires on the offline POS path** —
   `it.todo("C-09b…")` in chaos-matrix.spec.ts:842. CONFLICT_RESOLUTION
   §2/§7 + MASTER-PLAN §7 promise pos_sale:create validates current
   prices (0% POS tolerance); the BR-003 gate exists only in
   `SalesInvoiceService.approve` (apps/api/src/modules/sales/application/
   invoices.ts:567-583), which the POS autopost path bypasses — a stale
   unit price with consistent tenders POSTS at the stale price. Owner:
   sales/pos module owner.
2. **Soft-deleted (tombstoned) item references reject VALIDATION_ERROR
   instead of ITEM_INACTIVE** — `it.todo("C-11b…")` in
   chaos-matrix.spec.ts:1104. `requireSellableItem`
   (apps/api/src/modules/sales/application/quotations.ts:281-292) treats
   deleted as unknown (honest no-disclosure, but the ITEM_INACTIVE UX
   contract [cancel/substitute-and-resend] is lost); and a LIVE-but-
   INACTIVE item rejects ITEM_INACTIVE with resubmittable TRUE
   (packages/contracts/src/sync/index.ts:358) where MASTER-PLAN §14 C-11
   says resubmittable:false. Owner: sales module + contracts.
3. **No push byte-size cap (≤1 MB promise unenforced) + disagreeing count
   caps** — `it.todo("D-03b…")` in device-security.spec.ts:322. Only the
   count budget is enforced: push-service.ts:459 (MAX_PUSH_BATCH=50 →
   typed SYNC_COMMAND_INVALID) vs the controller's `z.array.max(200)`
   (sync.controller.ts:150); no code path measures payload bytes. Owner:
   sync push/controller (Wave 4 consolidation).

## Leftovers / handoff notes

1. `pnpm test:db`-scale budget: whole sync dir measured 11.49s vitest /
   12s wall (single embedded-PG boot for the dir run) — quote in the
   completion report against the ≤15 min claim.
2. The chaos-matrix "D-04 probe" (last test) intentionally overlaps
   device-security D-04 — the probe covers the watermark mechanics; the
   device-security leg carries the full journey (real pull, server
   authority, recovery drain). Both stay green by design.
3. The duplicates "concurrent twin" leg is sequential in-process (noted
   in-suite): a true race needs interleaved withTenant transactions; the
   server-side race guard (inbox UQ + INV-013 op keys) is what a real race
   would exercise — candidate for the 024/025 hardening pass.
4. If the completion report wants a REAL `receipt:allocates` intent
   (C-02's original vehicle), it lands with the 022/023 intent columns —
   the C-02 mapping decision (update_draft-before-create) is recorded
   above (decision 4).
