# Error Model

> **Status:** STABLE · **Owner:** Offline & API Architecture · **Updated:** 2026-11-04

The single error envelope, HTTP status mapping, and stable error-code registry for the
whole API. Codes are **contracts**: clients branch on them, so renaming or re-semanticking
one is a breaking change ([API_VERSIONING.md](API_VERSIONING.md) §3). Message localization
follows [API_CONVENTIONS.md](API_CONVENTIONS.md) §12; correlation per §10.

## 1. Error envelope (JSON schema)

```jsonc
{
  "error": {
    "code": "PERIOD_LOCKED",              // stable enum — the contract; never localized
    "message": "الفترة المالية مقفلة لهذا التاريخ", // localized via Accept-Language
    "details": {                           // machine-readable, code-specific payload
      "fiscalPeriod": { "id": "…", "status": "LOCKED", "endDate": "2026-09-30" },
      "fieldErrors": [                     // zod issues for VALIDATION_ERROR
        { "path": "lines[0].unitPrice", "message": "…", "code": "invalid_format" }
      ]
    },
    "traceId": "req-0192…",                // correlation id — quote to support
    "retryable": false                     // may the SAME request succeed if retried as-is?
  }
}
```

Rules: `code` is from the registry (§4) or a module-scoped code added by the same process
as schema changes (OpenAPI-documented); `message` is human display only — never parsed;
`details` is a typed, code-documented object (field errors, current values, limits);
`retryable: true` only for transport/transient classes (§5). HTTP body and status ALWAYS
agree — no 200-with-error-body anywhere.

## 2. HTTP status mapping

| Status | Meaning in this API | Typical codes |
|--------|---------------------|---------------|
| `400` | Malformed request (unparseable body, bad cursor) | `BAD_REQUEST`, `CURSOR_EXPIRED`, `CURSOR_MISMATCH` |
| `401` | Not authenticated / bad credentials | `UNAUTHENTICATED` |
| `403` | Authenticated, not permitted (same tenant scope) | `FORBIDDEN`, `MFA_REQUIRED` is `423` (see below), `RATE_LIMITED` is `429` |
| `404` | Not found — **also used for cross-tenant resources** (§3) | `NOT_FOUND` |
| `409` | State conflict: stale version, already-transitioned state | `STALE_VERSION`, `IMMUTABLE_DOCUMENT`, `ALREADY_POSTED`, `ALREADY_REVERSED` |
| `412` | Precondition failed — sync contract version gate | `CONTRACT_VERSION_UNSUPPORTED` |
| `422` | Semantically invalid (validation, idempotency conflicts) | `VALIDATION_ERROR`, `IDEMPOTENCY_KEY_CONFLICT`, plus business rejections surfaced on the REST surface (`PERIOD_LOCKED`, `INSUFFICIENT_STOCK`, `CREDIT_LIMIT_EXCEEDED`, `PRICE_CHANGED`) |
| `423` | Locked (MFA required to proceed) | `MFA_REQUIRED` |
| `429` | Rate limited | `RATE_LIMITED` (+ `Retry-After`) |
| `500` | Unhandled server fault (never carries domain semantics) | `INTERNAL_ERROR` |
| `503` | Maintenance / dependency down | `SERVICE_UNAVAILABLE`, `TENANT_SUSPENDED` (tenant-level stop, [../architecture/MULTI_TENANCY.md](../architecture/MULTI_TENANCY.md) §3.6) |

Sync push uses **per-item results**, not statuses, for business rejections
([../offline/SYNC_PROTOCOL.md](../offline/SYNC_PROTOCOL.md) §3.4) — the same codes appear
there as `REJECTED.reason`. The batch-level HTTP status reflects only transport/authorization
(401/403/412/429/5xx).

## 3. 404 vs 403 — cross-tenant resources

Accessing a resource that exists in another tenant (or a personal-account row not
authorized to the caller) returns **`404 NOT_FOUND` — never `403`**. Rationale: `403`
confirms existence to a probe (enumeration oracle); `404` does not. RLS makes this natural
(zero rows → not found). `403` is reserved for permissions inside the caller's own tenant
scope ("you may not approve invoices" is a real, explorable answer there). This rule is
attack-tested in [../testing/TENANT_ISOLATION_TESTS.md](../testing/TENANT_ISOLATION_TESTS.md).

## 4. Error code registry (initial)

**General**

| Code | Status | Meaning |
|------|--------|---------|
| `BAD_REQUEST` | 400 | unparseable/malformed request |
| `VALIDATION_ERROR` | 422 | schema/semantic validation failure (`details.fieldErrors` from zod) |
| `UNAUTHENTICATED` | 401 | missing/expired credential, bad password, locked-out login |
| `MFA_REQUIRED` | 423 | TOTP/recovery code needed |
| `FORBIDDEN` | 403 | permission missing (in-scope), CSRF failure, tenant-context mismatch/spoof |
| `NOT_FOUND` | 404 | absent or out-of-scope resource (§3) |
| `STALE_VERSION` | 409 | optimistic-concurrency mismatch (`details.currentVersion`) |
| `IMMUTABLE_DOCUMENT` | 409 | mutation of a POSTED/REVERSED/CANCELLED document |
| `IDEMPOTENCY_KEY_CONFLICT` | 422 | same key, different body-hash ([IDEMPOTENCY.md](IDEMPOTENCY.md) §3) |
| `CURSOR_EXPIRED` | 400 | pagination cursor older than 24 h |
| `CURSOR_MISMATCH` | 400 | cursor/query mismatch ([API_CONVENTIONS.md](API_CONVENTIONS.md) §4) |
| `RATE_LIMITED` | 429 | token bucket exhausted |
| `INTERNAL_ERROR` | 500 | unhandled fault (traceId is the debugging handle) |
| `SERVICE_UNAVAILABLE` | 503 | maintenance / dependency down |
| `TENANT_SUSPENDED` | 503 | tenant-level stop |
| `CONTRACT_VERSION_UNSUPPORTED` | 412 | client contract too old/new ([../offline/LOCAL_DATABASE.md](../offline/LOCAL_DATABASE.md) §2.3) |
| `DEVICE_REVOKED` | 403 | revoked device attempted sync ([../offline/SECURITY_AND_DEVICE_MANAGEMENT.md](../offline/SECURITY_AND_DEVICE_MANAGEMENT.md) §4) |
| `FILE_TOO_LARGE` | 422 | upload beyond limit ([API_CONVENTIONS.md](API_CONVENTIONS.md) §13) |
| `UNSUPPORTED_MEDIA_TYPE` | 400 | upload content type not whitelisted |

**Posting engine** ([../accounting/POSTING_ENGINE.md](../accounting/POSTING_ENGINE.md) §3 —
registry copy; engine document is authoritative)

| Code | Status (REST surface) | Meaning |
|------|----------------------|---------|
| `ENTRY_NOT_BALANCED` | 422 | INV-001/002 failure |
| `PERIOD_LOCKED` | 422 | INV-011 — entry date in locked/closed period |
| `PERIOD_NOT_FOUND` | 422 | no fiscal period covers the date |
| `ACCOUNT_NOT_POSTABLE` | 422 | target is a group node / non-postable |
| `ACCOUNT_ARCHIVED` | 422 | target account archived |
| `CURRENCY_MISMATCH` | 422 | INV-005 failure |
| `PURPOSE_NOT_MAPPED` | 422 | account purpose unmapped — fail closed |
| `MISSING_PARTNER_ON_CONTROL` | 422 | INV-009 — AR/AP line without partner |
| `MISSING_FX_RATE` | 422 | foreign currency without rate |
| `ALREADY_POSTED` | 409 | INV-013 duplicate (returns stored result on sync path) |
| `ALREADY_REVERSED` | 409 | INV-014 — reversal of a reversed entry |
| `INVALID_AMOUNT` | 422 | ≤ 0 or non-decimal |

**Sync / business rejections** ([../offline/SYNC_PROTOCOL.md](../offline/SYNC_PROTOCOL.md) §3.4)

| Code | Surface | Meaning |
|------|---------|---------|
| `PRICE_CHANGED` | sync item / 422 REST | line price differs from server price beyond tolerance |
| `INSUFFICIENT_STOCK` | sync item / 422 REST | availability check failed (`details.availableQty`) |
| `CREDIT_LIMIT_EXCEEDED` | sync item / 422 REST | partner credit limit exceeded |
| `ITEM_INACTIVE` / `PARTNER_INACTIVE` | sync item | referenced master data deactivated (resubmittable: false — soft-deleted/inactive master data must be substituted, not retried) |
| `FORBIDDEN` | sync item | ONLINE_ONLY entity push or non-owner draft edit (`details.ownerDeviceId`; resubmittable: false) — added PHASE-020 |
| `DUPLICATE_COMMAND` | sync item meta | duplicate delivery replayed from inbox (`duplicate: true`) |

Adding a code = registry PR + OpenAPI regeneration + client-handling row (§5) — the
registry is the enumerated union mirrored in `packages/contracts`.

## 5. Client handling contract

1. **Branch on `code`, display `message`**: UI behavior is driven by the code registry
   (e.g., `PRICE_CHANGED` → offer accept/edit/cancel actions,
   [../offline/CONFLICT_RESOLUTION.md](../offline/CONFLICT_RESOLUTION.md) §3); `message`
   is display text only.
2. **Retry only when `retryable: true`** (or sync `DEFERRED`); otherwise surface actions.
   Retry storms on non-retryable errors are a client bug — generated clients make it
   structurally impossible.
3. **Log `traceId`, quote it to support**: every error toast/log line includes the
   traceId; support looks up the exact request chain
   ([../architecture/OBSERVABILITY.md](../architecture/OBSERVABILITY.md) §"Structured logging").
4. **Unknown code fallback**: display `message` + traceId + "contact support" — never a
   generic crash, never silent swallowing; forward-compat for new codes is part of this
   contract (server may add codes in minor versions, [API_VERSIONING.md](API_VERSIONING.md) §3).
5. **No error text parsing**: string matching on messages is forbidden in all clients
   (localization would break it); `details` is the machine-readable channel.
