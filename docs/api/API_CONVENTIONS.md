# API Conventions

> **Status:** STABLE · **Owner:** Offline & API Architecture · **Updated:** 2026-10-27

Style rules for the public REST API of the Platform (NestJS,
[ADR-0003](../architecture/ADR/ADR-0003-nextjs-nestjs.md)). One API serves the web BFF, the
Tauri desktop, and the Android clients — client-agnostic by construction. Machine-readable
contracts are generated per [OPENAPI_STRATEGY.md](OPENAPI_STRATEGY.md); errors follow
[ERROR_MODEL.md](ERROR_MODEL.md); versioning policy is [API_VERSIONING.md](API_VERSIONING.md);
idempotency policy is [IDEMPOTENCY.md](IDEMPOTENCY.md).

## 1. URL structure

```
/api/v1/<module>/<resource>[/<id>][/<subresource>]
```

- `v1` is the **major** URL version (see [API_VERSIONING.md](API_VERSIONING.md)); minor and
  patch changes never appear in the URL.
- `<module>` = owning bounded context (`accounting`, `sales`, `purchasing`, `inventory`,
  `treasury`, `partners`, `tax`, `sync`, `identity`, `platform`…), matching module
  boundaries ([../architecture/MODULE_BOUNDARIES.md](../architecture/MODULE_BOUNDARIES.md)).
- `<resource>` = **plural kebab-case** noun: `sales-invoices`, `credit-notes`,
  `price-lists`, `cash-accounts`, `journal-entries`, `devices`.
- Sub-resources for aggregates: `/api/v1/sales/sales-invoices/{id}/lines` (read),
  `/api/v1/partners/partners/{id}/contacts`. Actions that are not CRUD use a **verb
  sub-resource** with POST: `/post`, `/approve`, `/submit`, `/reverse`, `/allocate`,
  `/cancel` — e.g. `POST /api/v1/sales/sales-invoices/{id}/post`. Action endpoints are
  part of the contract and appear in OpenAPI; hidden verbs are forbidden.

## 2. Methods (semantics)

| Method | Semantics | Body | Idempotency-Key |
|--------|-----------|------|-----------------|
| `GET` | Read (never side-effecting; report runs may create run records — those use POST /report-runs) | none | not used |
| `POST` | Create resource / execute action | required | **REQUIRED** ([IDEMPOTENCY.md](IDEMPOTENCY.md) §1) |
| `PATCH` | Partial update of a mutable resource (drafts, settings) | required (JSON Patch object, not array) | optional but honored |
| `PUT` | Not used (no full-replace semantics in the domain) | — | — |
| `DELETE` | Soft delete where the resource allows it (tombstoned for sync) | none | optional but honored |

Rules: no custom HTTP methods; no verbs in resource names; PATCH carries the optimistic
`version` (§8); state transitions (post/approve) are always POST actions with their own
idempotency semantics — never a PATCH of `status`.

## 3. Request/response envelopes

Success envelope (`data` + `meta`); errors ALWAYS use the
[ERROR_MODEL.md](ERROR_MODEL.md) envelope — never a bare string, never data inside error
paths:

```jsonc
// single resource
{ "data": { "id": "0192…", "invoiceNo": "INV-RYD-2026-000123", … },
  "meta": { "requestId": "req-…", "version": 7 } }

// collection (paginated — §4)
{ "data": [ … ],
  "meta": { "requestId": "req-…", "cursor": "b64…", "hasMore": true, "count": 200,
            "nextCursor": "b64…" } }

// action result
{ "data": { "id": "0192…", "status": "POSTED", "journalEntryIds": ["…"],
            "officialNumber": "INV-RYD-2026-000123" },
  "meta": { "requestId": "req-…" } }
```

`meta.requestId` echoes the correlation id (§10). Unknown fields in requests are rejected
(`VALIDATION_ERROR`, zod strict) — no silent ignoring — except where documented for
forward compatibility during major N→N+1 overlap.

## 4. Cursor pagination

- Parameters: `cursor` (opaque), `limit` (default 50, max 200 for general lists; sync pull
  has its own limits, [../offline/SYNC_PROTOCOL.md](../offline/SYNC_PROTOCOL.md) §2.4).
- Response: `meta.hasMore: boolean` + `meta.nextCursor` (present iff `hasMore`). The
  client stops when `hasMore === false`. `meta.cursor` echoes the consumed cursor.
- The cursor is **base64-encoded opaque bytes** — clients never parse, construct, or
  extrapolate it. Cursors encode `{sort, filters-hash, position, issuedAt}` and are signed;
  a cursor whose embedded query no longer matches the request's filters is rejected with
  `VALIDATION_ERROR` (prevents filter drift mid-pagination).
- Cursors expire after 24 h (`CURSOR_EXPIRED` → restart pagination). Offset pagination is
  NOT offered anywhere in v1 (deterministic ordering + stable totals matter more than
  random access).

## 5. Filtering and sorting

Syntax `field[op]=value` (URL query, repeated params = OR within same field, comma = IN):

| Example | Meaning |
|---------|---------|
| `?status=POSTED` | equality (`field=value` shorthand for `field[eq]`) |
| `?invoiceDate[gte]=2026-10-01&invoiceDate[lte]=2026-10-31` | range (dates ISO 8601) |
| `?totalAmount[gt]=1000.00` | numeric comparison (decimal strings, [ADR-0009](../architecture/ADR/ADR-0009-money-precision.md)) |
| `?customerId[in]=id1,id2` | set membership |
| `?customerName[like]=شركة` | server-side LIKE (anchoring documented per field) |
| `?branchId[null]=true` | null / not-null (`[null]=false`) |

Sorting: `?sort=invoiceDate,-totalAmount` (prefix `-` = descending). Default sort is
stable and documented per collection (usually `-createdAt`). Filters are whitelisted per
endpoint in `packages/contracts` (zod query schema) — arbitrary-field filtering is
rejected. All filters are tenant-scoped by construction
([../architecture/MULTI_TENANCY.md](../architecture/MULTI_TENANCY.md) §3).

## 6. Sparse fieldsets

`?fields=invoiceNo,status,totals` returns only those fields (+ always `id`). Available on
list endpoints consumed by mobile/cache layers where payload size matters. `fields` is
validated against the contract; unknown fields → `VALIDATION_ERROR`. Sparse responses are
a rendering option, not a different resource type — same schema, nullable-present fields.

## 7. Money, decimal, and date transport

| Type | Wire format | Rule |
|------|-------------|------|
| Money | JSON **string**, `"1234.5000"` | decimal regex `^-?\d{1,15}(\.\d{1,4})?$` — max 4 dp, matching `numeric(19,4)` storage (ADR-0009); JSON numbers for money are contract violations |
| Quantities | string, `"12.500000"` | regex `^-?\d{1,15}(\.\d{1,6})?$` — max 6 dp, matching `numeric(19,6)` storage |
| FX rates / percentages | string, 8 / 4 dp | rate regex `^-?\d{1,15}(\.\d{1,8})?$` (max 8 dp, matching `numeric(19,8)`); percentage max 4 dp (`numeric(7,4)`) |
| Dates (business) | ISO 8601 `YYYY-MM-DD` | calendar dates in tenant timezone semantics per field doc |
| Timestamps | ISO 8601 UTC with offset/Z (`2026-10-27T08:15:00Z`) | always timestamptz, always UTC on the wire |
| Enums | UPPER_SNAKE strings | never numbers; registry in contracts package |

> **Consolidation note (DEF-001, 2026-10-28):** this table is the single authoritative
> registry of wire-format precision patterns. ADR-0009 previously quoted a single blanket
> regex `^-?\d{1,15}(\.\d{1,8})?$` "for money inputs"; that line has been corrected in
> ADR-0009 to defer to the per-type patterns above (amounts ≤ 4 dp, quantities ≤ 6 dp,
> rates ≤ 8 dp). Applying the old blanket regex to money would have accepted 8-decimal
> amounts that `numeric(19,4)` storage cannot hold without silent rounding.

## 8. Concurrency (optimistic locking)

1. Every mutable server resource carries an integer `version` in responses.
2. Mutations (PATCH, and state actions on already-server-known rows) must send the base
   version: REST path uses `If-Match: <version>` header; sync path carries `baseVersion`
   in the command ([../offline/SYNC_PROTOCOL.md](../offline/SYNC_PROTOCOL.md) §3).
3. Mismatch → **409 CONFLICT** (REST) with error code `STALE_VERSION`, `details.currentVersion`
   and the current row snapshot; the client merges or overwrites per user choice. (The
   412 status is reserved for the sync endpoint's contract-version precondition —
   [ERROR_MODEL.md](ERROR_MODEL.md) §2.) Posted/immutable resources never accept
   mutations at all (`409 IMMUTABLE_DOCUMENT`).
4. No ETag/Last-Modified caching of tenant business data (cache correctness is delegated
   to `version` + explicit refresh); `Cache-Control: no-store` on authenticated responses.

## 9. Idempotency (headers)

- `Idempotency-Key: <uuid>` **required on all POST /v1/\* writes** (create + actions) and
  on `POST /sync/push`. Full policy: [IDEMPOTENCY.md](IDEMPOTENCY.md) — first execution
  stores the response keyed by `key + route + body-hash`; replays return the stored
  response with `Idempotency-Replayed: true`; same key + different body → `422
  IDEMPOTENCY_KEY_CONFLICT`; **24 h retention** for the HTTP API replay store (the sync
  inbox retains ≥ 30 days, [../offline/IDEMPOTENCY_AND_RETRIES.md](../offline/IDEMPOTENCY_AND_RETRIES.md) §1).
- Missing key on a write = `VALIDATION_ERROR` (not 400-generic) — clients are generated,
  so this is a programming error surfaced loudly in CI, not a runtime negotiation.

## 10. Correlation & rate limiting

- **Correlation**: clients MAY send `X-Request-Id: <uuid>`; the API validates or
  generates one, propagates it to jobs/logs/audit, and echoes it in every response header
  AND `meta.requestId` + error `traceId` ([../architecture/OBSERVABILITY.md](../architecture/OBSERVABILITY.md) §"Structured logging").
- **Rate limiting**: per-tenant and per-device token buckets. On breach: `429` with
  `Retry-After: <seconds>` (and `X-RateLimit-Limit` / `X-RateLimit-Remaining` /
  `X-RateLimit-Reset` on all responses). Rate-limit errors carry code `RATE_LIMITED`,
  never `INTERNAL_ERROR`. Sync `DEFERRED` is the protocol-level analogue for push batches
  ([../offline/SYNC_PROTOCOL.md](../offline/SYNC_PROTOCOL.md) §3.5).

## 11. Tenant context (never in the body for scoping)

1. Tenant context derives from the authenticated principal's active membership
   ([../architecture/MULTI_TENANCY.md](../architecture/MULTI_TENANCY.md) §2) — never from
   a body field, header, or query parameter.
2. A `tenantId` appearing in a payload is **ignored for scoping**; if present and
   mismatched with the session-derived context, the request is rejected with `FORBIDDEN`
   (`details: 'tenant context mismatch'`) — mismatched echoes are treated as spoof
   attempts, not typos ([../architecture/DATA_FLOW.md](../architecture/DATA_FLOW.md) §7).
3. Membership switching is an explicit authenticated endpoint
   (`POST /identity/sessions/switch-tenant`) — the server verifies the target membership
   and reissues the session reference.

## 12. Locale & localized messages

- `Accept-Language: ar` (default), `en`, or `ar,en` per RFC. Server-localized
  `error.message` uses it; `error.code` is locale-independent
  ([ERROR_MODEL.md](ERROR_MODEL.md) §1). Business display names carry both
  `name`/`nameAr` where the resource is bilingual.
- Responses state `Content-Language`. Arabic strings are proper Unicode (no numerals
  conversion server-side — rendering is client concern,
  [../localization/RTL_AND_LTR.md](../localization/RTL_AND_LTR.md)).
- Dates/timestamps remain ISO 8601 regardless of locale (§7); localized calendars
  (Hijri display) are client-side rendering only.

## 13. File uploads

1. **Direct upload pattern (default)**: client requests an upload slot —
   `POST /platform/file-objects { name, contentType, size, purpose }` — receives
   `{ fileObjectId, uploadUrl, method: PUT, headers, expiresAt }` with a **signed URL
   bound to the issuer's tenant**; uploads directly to object storage; then
   `POST /platform/file-objects/{id}/complete` verifies checksum + attaches the file to
   the owner entity. Rationale: API pods never proxy file bytes.
2. **Multipart (small files only)**: ≤ 5 MB attachments (e.g., expense receipt photos)
   may use `multipart/form-data` with: one `file` part, one `metadata` JSON part;
   enforced content-type whitelist; size checked from headers BEFORE buffering; AV scan
   queued via pg-boss ([ADR-0008](../architecture/ADR/ADR-0008-jobs-redis.md)).
3. Uploads are idempotent by `Idempotency-Key` at slot-creation level; the signed URL is
   single-use, short-lived (≤ 15 min), and scoped (`purpose` bound). Downloads use
   short-lived signed URLs as well ([../security/DATA_PROTECTION.md](../security/DATA_PROTECTION.md)).

## 14. Webhooks — **DEFERRED (post-MVP)**

Outbound webhooks (tenant-configurable HTTP callbacks on events like
`invoice.posted`, `subscription.renewed`) are **not part of MVP (PHASE-014)**. When
implemented, the contract will be: HMAC-SHA256 signing (`X-ERP-Signature` + timestamp to
defeat replay), at-least-once delivery with exponential retry + dead-letter per endpoint,
event catalog in `packages/contracts/events`, and per-endpoint secret rotation via
[../security/SECRETS_MANAGEMENT.md](../security/SECRETS_MANAGEMENT.md). This section is a
**placeholder by policy** — no webhook endpoints ship before their decision record and
OpenAPI entries exist.

## 15. OpenAPI generation

The OpenAPI 3.1 document is **generated** from the zod contracts in `packages/contracts`
via route registration — hand-written spec fragments are forbidden (drift risk). Per CI
build the pipeline publishes `openapi.json` / `openapi.yaml` artifacts and runs
breaking-change diff gates against the baseline. Consumer codegen policy and the
documentation-portal plan (post-MVP): [OPENAPI_STRATEGY.md](OPENAPI_STRATEGY.md).
