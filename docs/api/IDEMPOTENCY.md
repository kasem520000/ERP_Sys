# Idempotency (API Policy)

> **Status:** STABLE · **Owner:** Offline & API Architecture · **Updated:** 2026-10-27

The full idempotency policy for the REST API surface. Companion documents: the offline
end-to-end model ([../offline/IDEMPOTENCY_AND_RETRIES.md](../offline/IDEMPOTENCY_AND_RETRIES.md))
and the sync inbox (≥ 30-day retention); envelope/header conventions
([API_CONVENTIONS.md](API_CONVENTIONS.md) §9); error codes ([ERROR_MODEL.md](ERROR_MODEL.md) §4).

## 1. Where idempotency keys are required

1. **All `POST /api/v1/*` writes** — resource creation AND action endpoints
   (`/post`, `/approve`, `/allocate`, `/reverse`…). Missing `Idempotency-Key` header →
   `422 VALIDATION_ERROR` (generated clients always send one; this is a loud programming
   error, not a negotiation).
2. **`POST /api/v1/sync/push`** — the batch carries the key (batch UUIDv7) AND each
   command carries its own command-level key
   ([../offline/SYNC_PROTOCOL.md](../offline/SYNC_PROTOCOL.md) §3.1).
3. PATCH/DELETE may send a key and get identical replay semantics, but are not required
   to (they are naturally guarded by optimistic `version`, [API_CONVENTIONS.md](API_CONVENTIONS.md) §8).
4. GETs are idempotent by definition — no key, no storage.
5. **Explicitly NOT idempotent (adopted from Folder 2, consolidation 2026-10-28):**
   session-creating endpoints — `POST /api/v1/auth/login`, `POST /api/v1/auth/refresh`
   and device registration — are **excluded** from rule 1: each successful execution
   legitimately creates new state (a new session/refresh-token pair), so an idempotency
   key would replay a stale session response. They are protected instead by rate
   limiting, lockout policy, and refresh-token rotation
   ([AUTHENTICATION.md](AUTHENTICATION.md)). Rule 1's blanket "all POST writes" must be
   read with this exclusion.

## 2. Key format

- **UUID (v4 or v7) recommended** — any non-empty string ≤ 128 chars is accepted, but
  generated clients use one UUIDv7 per logical user operation, **regenerated only when
  the user intent changes** (an automatic retry reuses the SAME key; an edit-and-resend
  after a rejection uses a NEW key for the changed payload).
- The key is scoped per client intent, never per attempt. Retrying a timed-out POST with
  a fresh key breaks the guarantee and is a client bug.

## 3. Server behavior (first execution vs replay)

1. On first execution the server stores the response keyed by
   `(tenantId, route, method, key)` + `body-hash`, **in the same transaction as the
   effects** (§6). Response storage is the serialized success OR error envelope.
2. A replay (same key + same route + same body-hash) returns the **stored response
   verbatim**, status code included, with the added response header
   `Idempotency-Replayed: true`. The client treats it as the original outcome.
3. Same key + **different body-hash** → `422 IDEMPOTENCY_KEY_CONFLICT`
   ([ERROR_MODEL.md](ERROR_MODEL.md) §4) with `details.storedHash` vs `receivedHash`
   omitted (never echo stored payload material) — the client must use a new key.
4. Which responses are replayable: ALL — including business rejections (`422 PERIOD_LOCKED`
   replays as the same rejection). This is deliberate: a duplicate delivery of a rejected
   action must not flip to acceptance because state changed in between.
5. Replay applies per route: the same key on two different routes are independent
   operations (no cross-route coupling).

## 4. Retention and eviction

- **24 h retention** for the HTTP replay store (`idempotency_keys` rows: tenant, route,
  key, body-hash, response, created_at). Eviction is a pg-boss job; eviction never
  re-enables duplicate execution for financial effects — the durable financial guard is
  the posting-operation key (INV-013, permanent by row uniqueness,
  [../accounting/POSTING_ENGINE.md](../accounting/POSTING_ENGINE.md) §2.1).
- **The sync inbox retains ≥ 30 days** ([../offline/IDEMPOTENCY_AND_RETRIES.md](../offline/IDEMPOTENCY_AND_RETRIES.md) §1)
  because offline devices can be disconnected for days — transport-level 24 h is
  insufficient there; sync is the surface where replay windows must exceed offline
  horizons.
- Replaying a key after retention expiry executes the request fresh (documented,
  acceptable for non-financial routes; financial routes remain protected by
  posting-operation keys and natural id upserts — every financial POST has a
  second-layer guard by design).

## 5. Concurrency

- Two concurrent requests with the **same key** are **serialized**: the second waits on
  the first's transaction (row lock on the key row inserted by the first); after commit it
  receives the stored response (`Idempotency-Replayed: true`).
- Concurrent same-key requests never execute effects twice; the loser never sees a
  half-applied state (it sees either the full stored result or a 5xx that resolves on
  retry after the winner's commit).
- The batch push endpoint serializes per command id, not per batch: two overlapping
  batches with different keys but a shared command dedupe at the command layer
  ([../offline/SYNC_PROTOCOL.md](../offline/SYNC_PROTOCOL.md) §4).

## 6. Interaction with transactions

1. The key row + stored response are written **inside the same database transaction** as
   the business effects: either (effects + replay record) commit together, or neither.
   A crash mid-execution can never leave "effects without replay record" (unsafe) or
   "replay record without effects" (false replay).
2. For multi-step flows orchestrated by pg-boss (e.g., report generation), the API-level
   key guards the *enqueue* operation; the job's own at-most-once semantics come from job
   idempotency rules ([ADR-0008](../architecture/ADR/ADR-0008-jobs-redis.md) §3) — the
   contract distinguishes "request accepted" replays from "job already ran" dedupe.
3. Posting operations additionally record the engine idempotency key in the same
   transaction as the journal insert ([ADR-0007](../architecture/ADR/ADR-0007-centralized-posting-engine.md) §2.4)
   — the API key and the engine key compose without conflict.

## 7. Test requirements

1. **Replay determinism**: same key+body → identical response bytes (modulo
   `Idempotency-Replayed` header), same status, zero new effects (row-count assertions).
2. **Conflict**: same key + mutated body → `422 IDEMPOTENCY_KEY_CONFLICT`, zero effects.
3. **Concurrency**: N parallel same-key requests → exactly one execution, N−1 replays.
4. **Crash windows**: kill between effect-commit and response-return → client retry gets
   the stored response; no double effect (financial fixtures assert single journal entry,
   INV-013).
5. **Retention boundary**: replay at 23 h59 m vs 24 h01 m — documented behavior observed;
   financial route replayed post-retention still exactly-once via engine key.
6. **Sync surface**: batch replay, partial-batch replay, and command-level replay
   cross-checks live in the chaos suite
   ([../offline/IDEMPOTENCY_AND_RETRIES.md](../offline/IDEMPOTENCY_AND_RETRIES.md) §5,
   [../testing/SYNC_TESTS.md](../testing/SYNC_TESTS.md)).

These tests run in CI against every release (contract-test tier) — idempotency is a
release gate, not a best-effort property.
