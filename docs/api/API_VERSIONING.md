# API Versioning

> **Status:** STABLE · **Owner:** Offline & API Architecture · **Updated:** 2026-10-27

Versioning policy for the public REST API. Mechanics live in
[API_CONVENTIONS.md](API_CONVENTIONS.md) (URL structure) and
[OPENAPI_STRATEGY.md](OPENAPI_STRATEGY.md) (diff gates and artifacts); release cadence
follows [../planning/RELEASE_STRATEGY.md](../planning/RELEASE_STRATEGY.md).

## 1. Major version in the URL

- The URL carries the **major** version only: `/api/v1/…`. A future `/api/v2` is a new,
  parallel surface — v1 is not rewritten in place.
- **Minor and patch changes never touch the URL.** They ship continuously, are announced
  via the API changelog, and are enforced by OpenAPI diff gates: additive-only changes
  pass; anything from the breaking table (§3) fails CI until the change is moved behind a
  new major or reverted.
- Error-code and enum registries ([ERROR_MODEL.md](ERROR_MODEL.md)) evolve additively
  within a major: new codes may appear in minor releases; clients must implement the
  unknown-code fallback.

## 2. Compatibility contract per release

| Release unit | What changes | URL | Gate |
|--------------|--------------|-----|------|
| Patch | Bug fixes, message wording, no wire change | `/v1` | full CI + contract tests |
| Minor | New endpoints, new optional fields, new enum/error codes, new query params (optional) | `/v1` | OpenAPI diff: additive-only, no breaks |
| Major | Anything in §3 | `/v2` (new surface) | new baseline; v1 enters deprecation (§4) |

## 3. Breaking-change definition (any one ⇒ major)

| Change | Example |
|--------|---------|
| Removing a field (request or response) | dropping `meta.hasMore` |
| Renaming a field | `invoiceNo` → `invoiceNumber` |
| Changing a field's type/shape | money string → number (also banned outright, [ADR-0009](../architecture/ADR/ADR-0009-money-precision.md)); object → array |
| Changing required-ness toward required | optional field becomes mandatory |
| Removing an enum value the client may send, or narrowing accepted values | dropping `CASH` from invoice kinds |
| Error-code semantics change | `NOT_FOUND` start meaning "hidden" (§[ERROR_MODEL.md](ERROR_MODEL.md) §3 stays fixed) |
| Status-code mapping change for an existing route | 422 → 400 for the same condition |
| Auth/permission model change on an existing route | route newly requires a different permission |
| Behavioral semantic change | pagination stops being cursor-based, idempotency window change |

Additive changes (new optional fields, new routes, new codes) are **never** breaking.

## 4. Deprecation policy

1. A major version is deprecated by announcement + `Deprecation` and `Sunset` HTTP
   headers on all its routes (Sunset = removal date ≥ **90 days** out, and at least
   **2 minor releases** of the new major have shipped).
2. During overlap the deprecated major is fully functional (no artificial throttling);
   its OpenAPI document is frozen — no new endpoints, only security fixes.
3. Removal happens on the announced Sunset date; clients were given: headers, changelog
   entries, generated-client upgrade guides, and migration notes per breaking table row.

## 5. Client compatibility matrix (native apps lag)

- Web and desktop ship synchronously with the API, but **Android (Play Store) and POS
  terminals (on-premise) lag** — devices can be offline or un-updated for weeks.
- Therefore the server supports **major N and N−1 concurrently** (full traffic on N,
   overlap window for N−1 per §4). It never supports three majors.
- Contract-version negotiation for the *sync* surface (finer-grained than URL majors) is
  handled by `CONTRACT_VERSION_UNSUPPORTED` and the forced-update flow
  ([../offline/LOCAL_DATABASE.md](../offline/LOCAL_DATABASE.md) §2.3,
  [../offline/SYNC_PROTOCOL.md](../offline/SYNC_PROTOCOL.md) §1.2).
- Rollout rule: a new major ships no earlier than PHASE+2 of any native client release
  depending on it, per the phase dependency graph
  ([../planning/PHASE_DEPENDENCY_GRAPH.md](../planning/PHASE_DEPENDENCY_GRAPH.md)).

## 6. Contract tests enforced in CI

1. Every PR regenerates `openapi.json` and runs **`openapi-diff` breaking-change check**
   against the committed baseline of the current major (fail on any §3 row).
2. Contract tests execute generated clients against the running API (web + desktop share
   the TypeScript client; Android's generated client runs in its own job) — drift between
   spec and implementation is a build failure, not a discovery.
3. The baseline may only advance via a reviewed "baseline bump" PR that includes the
   changelog entry; CI rejects baseline changes riding on feature PRs.
4. Version-relevant artifacts (spec per major, changelog, deprecation table) are published
   per build ([OPENAPI_STRATEGY.md](OPENAPI_STRATEGY.md) §3).
