# T-P20-2c — Device registry services (Wave 2 / PHASE-020)

> Task ID 2-c · device registry + credential plane + reconciliation.
> Delivered by subagent; orchestrator wires `sync.module.ts` afterwards.

## Files delivered (all NEW, owned files only)

1. `apps/api/src/modules/sync/application/device-registry-service.ts`
2. `apps/api/src/modules/sync/application/device-tokens.ts`
3. `apps/api/src/modules/sync/application/reconciliation-service.ts`
4. `apps/api/src/modules/sync/presentation/devices.controller.ts`
5. `apps/api/src/__db__/sync/devices.spec.ts`

Forbidden files untouched (verified: `git status` shows only the 5 new files +
this evidence file). No shared infra touched (error filter, guards, module
wiring all left for the orchestrator).

## Exported signatures (for wiring)

### DeviceRegistryService (class; DI: `constructor(@Inject(AuditService) audit)`)
```ts
register(input: {
  actorId: string; tenantId: string; deviceName: string;
  deviceClass: "pos-terminal" | "tauri-desktop" | "android-field" | "android-personal";
  platform?; platformVersion?; appVersion?; contractVersion?;
  deviceKeyPublic?; capabilities?: string[]; platformAttestation?;
}): Promise<{ device: RegisteredDevice; attestationNonce: string | null; enrollmentSecret: string }>
attest(input: { deviceId: string; signature: string }): Promise<{ attestedAt: Date; trustFlags: Record<string, unknown> }>
revoke(input: { deviceId: string; actorId: string; reason?: string; admin: boolean }): Promise<{ revokedAt: Date }>
flagTrust(input: { deviceId: string; actorId: string; flags: Record<string, unknown> }): Promise<Record<string, unknown>>
expireData(input: { deviceId: string; actorId: string; expiresAt: string | null }): Promise<{ dataExpiresAt: Date | null }>
list(_input: { tenantId: string }): Promise<DeviceListRow[]>   // ambient scope authoritative
get(input: { deviceId: string }): Promise<{ device: DeviceDetailRow; cursors: { entityType; lastSeq; acknowledgedAt }[] }>
touchPull(deviceId: string): Promise<void>
touchPush(deviceId: string): Promise<void>
```
Typed errors exported from the same file: `DeviceNotFoundError`
(DEVICE_NOT_FOUND), `DeviceAttestationUnavailableError`
(DEVICE_ATTESTATION_UNAVAILABLE), `DeviceAttestationFailedError`
(ATTESTATION_FAILED — retryable, nonce NOT rotated).

### device-tokens.ts (module functions)
```ts
issueAccessToken(input: { userId; deviceId; capabilities? }): { token; expiresAt }        // 15-min HS256 JWT
verifyAccessToken(token: string): DeviceAccessTokenClaims | undefined                    // stateless verify
issueRefreshToken(tx: TenantDb, deviceId: string, predecessorId?): Promise<{ token; expiresAt }> // 30d
rotateRefreshToken(input: { deviceId; token }): Promise<RefreshRotation>
reapplyRefreshReuseRevocation(input: { deviceId: string }): Promise<void>                // idempotent kill switch
```
`RefreshRotation = { accessToken, refreshToken, expiresAt /* = access 15-min
expiry */, refreshTokenExpiresAt }`. Typed errors: `DeviceRefreshInvalidError`
(DEVICE_REFRESH_INVALID), `DeviceRevokedError` (DEVICE_REVOKED). Constants:
`ACCESS_TOKEN_TTL_SECONDS = 900`, `REFRESH_TOKEN_TTL_MS = 30d`.

### ReconciliationService (class; DI: `constructor(@Inject(AuditService) audit)`)
```ts
pendingOperations(): Promise<{ deviceId; name; revokedAt; pendingCommands; ownedDrafts; oldestPendingAt }[]>
reassignDrafts(input: { actorId; fromDeviceId; toDeviceId }): Promise<{ count: number }>
dismissDevice(input: { actorId; deviceId }): Promise<void>
```

### DevicesController (class; DI: `constructor(registry: DeviceRegistryService)`)
Routes (paths EXACT, match route-permissions rows 1–7):
`POST /api/v1/devices` (sync.devices.register, 201) · `GET /api/v1/devices`
(identity.devices.manage) · `GET /api/v1/devices/:id` (identity.devices.manage) ·
`PATCH /api/v1/devices/:id` (identity.devices.manage; body {trustFlags?, dataExpiresAt?}) ·
`POST /api/v1/devices/:id/attest` (sync.devices.register; body {signature}) ·
`POST /api/v1/devices/:id/revoke` (sync.devices.revoke + `self: true`; body {reason?}) ·
`POST /api/v1/devices/:id/refresh` (PUBLIC — no RequirePermissions; body {refreshToken}).

## Spec result (gate)

```
$ cd apps/api && TMPDIR=$HOME/tmp-p20c npx vitest run --config vitest.db.config.ts src/__db__/sync/devices.spec.ts
 ✓ register: the devices row (class→platform, trust flags, nonce) + sha256-at-rest enrollment secret + audit
 ✓ attestation-lite: ed25519 round-trip (DER + raw import), retryable failure, no-substrate typed error
 ✓ refresh rotation: happy chain → predecessor_id; REUSE of the rotated token → revocation + alarm (M-05)
 ✓ rotation with an expired token: typed invalid, device NOT revoked (no theft alarm)
 ✓ revoke: kill switch + chain death; idempotent second revoke (no second audit)
 ✓ flagTrust/expireData: jsonb merge + the remote data-expiry watermark, audited
 ✓ list/get: per-device cursor state (RLS world) + the touch watermarks
 ✓ reconciliation: queue → reassign drafts → dismiss (close the queue to zero)
 ✓ the public refresh route: tenant derivation + the kill switch surviving the failure response
 Test Files  1 passed (1)
      Tests  9 passed (9)   (Duration ~4.8s incl. embedded-PG boot)
```

Gates: `npx tsc --noEmit -p tsconfig.json` (apps/api) — clean for all 5 files;
`npx eslint <the 5 files>` — clean. Repo-root `pnpm typecheck` currently fails
ONLY in other agents' in-flight files (`packages/sync-core/src/outbox/engine.ts`
missing `../retry` — 2-d's WIP; `sync/application/push-service.ts` +
`handlers/partner-merge.ts` unused-symbol errors — 2-b's WIP). None of those
are owned by 2-c; re-run the root gate after their waves land.

## Decisions (the JWT approach, deviations — for the completion report)

1. **There is NO pre-existing JWT machinery to copy.** The task said "copy the
   exact sign call from identity" — grep proves identity signs no JWTs
   anywhere: sessions are OPAQUE server-side rows (0003 `sessions.token_hash`,
   ADR-0015 §2 "opaque server-side session records"; ARCHITECTURE_BASELINE
   "JWT never in browser"). The closest existing primitives are the
   `keyMaterialForTokens()` HMAC envelope (reset links, sync cursor tokens).
   **Decision:** device access tokens are standard three-segment HS256 JWTs
   (node:crypto only, no new dependency) signed with the identity
   `keyMaterialForTokens()` secret — same key, three derivations (reset links,
   sync cursors, device access). Claims {sub, deviceId, capabilities?, iat,
   exp}, 15-min exp. `verifyAccessToken` exported stateless; the existing
   X-Session-Token verify path is untouched (nothing breaks). No env changes
   needed (IDENTITY_SECRET_KEY envelope reused as-is).
2. **Register does NOT issue credentials** (per task spec — envelope is
   {deviceId, attestationNonce, enrollmentSecret, contractVersion}). The
   enrollment secret is the one-time registration proof (sha256 →
   devices.device_key_hash, the 003/016 shape) — NOT the refresh token.
   The first refresh token bootstrap is left to wiring:
   `issueRefreshToken(tx, deviceId)` is exported and ready (MASTER-PLAN §9
   wanted credentials at register — deviation recorded, task text wins).
3. **The reuse kill switch vs withTenant rollback.** `rotateRefreshToken`
   throws DeviceRevokedError AFTER revoking — a caller whose UoW rolls back on
   the throw loses the revocation. The controller catches DeviceRevokedError
   and re-applies via exported idempotent
   `reapplyRefreshReuseRevocation({deviceId})` in a fresh committed withTenant
   (no double alarm: it only audits when the UPDATE actually flips the row).
   Spec test 9 proves the kill switch survives the failure response.
4. **Concurrent double-spend closed**: consumption is a conditional UPDATE
   (`SET used_at WHERE id AND used_at IS NULL RETURNING`); zero rows → reuse
   path (revoke + alarm). Two in-flight requests with the same token → one
   wins, the loser triggers the kill switch.
5. **Rotation order** (task text, exactly): not-found/expired →
   DeviceRefreshInvalidError; used → REUSE (revoke+chain+alarm+throw
   DeviceRevokedError); chain revoked → invalid; device row revoked (belt &
   braces, admin-revoked device, no alarm) → DeviceRevokedError; else consume
   → successor (predecessor_id) + fresh access token + audit
   `device.token_rotated` (no secret material, SECURITY §8).
6. **`expiresAt` in the rotation result = the access token's 15-min expiry**
   (client schedules its next exchange against it); the successor's 30-day
   window rides `refreshTokenExpiresAt` as an extra field.
7. **Typed errors live inside my owned files** (registry + tokens), not
   `domain/sync-errors.ts` (not in my ownership). They follow the pos-errors
   pattern; unmapped DomainErrors surface through the global filter as 422
   (the existing DEVICE_NOT_FOUND precedent — the pos module's device errors
   map the same way today). I deliberately did NOT touch the shared error
   filter (concurrent-agent conflict risk); if the completion report wants
   400/404 mappings, they land with the W3/W4 error-registry consolidation.
8. **`list`/`pendingOperations` tenant boundary**: devices is global
   (service-mediated, no tenant_id), so the tenant filter is the membership
   join (`JOIN memberships m ON m.user_id = d.user_id`, RLS filters it to the
   ambient tenant). `get` stays by-id (016 precedent, no existence oracle
   concern on the identity plane); the RLS'd sync-state queries return empty
   for foreign devices.
9. **`oldestPendingAt` = min(inbox_commands.processed_at)** for the device —
   the queue's age column (approximation documented in the service header).
10. **Dismissal**: `trust_flags.reconciliation_dismissed = true` +
    `sync.reconciliation_dismissed` audit; the queue filters it. Un-acked
    inbox records keep a revoked device on the queue until a human dismisses
    (SECURITY §4.4 — never silently dropped).
11. **Spec fixture**: role cloned from the system `owner` template (0005
    cross-join already carries all 4 sync-plane keys) — no manual permission
    grants needed, matching the foundation task's note. Users
    23232323-…4001/4002, tenant 23232323 (SAR, verified unused).
12. **Math.floor is lint-forbidden** (ADR-0009 rule) — unix seconds use the
    login-service bitwise pattern `(Date.now() / 1000) | 0`.
13. **ck_device_refresh_tokens_window** forced the expiry fixture to move
    `issued_at` back with `expires_at` (expires_at > issued_at on every write).
14. platformVersion/appVersion are accepted on the wire and carried in the
    `device.registered` audit payload only — devices has no such columns
    (0029 widened everything else).

## Orchestrator action items (wiring)

1. `sync.module.ts`: provide `DeviceRegistryService`, `ReconciliationService`,
   `DevicesController`; device-tokens are plain module functions (no provider
   needed — they carry a module-level AuditService singleton; refactor into
   injected deps during wiring if desired).
2. `permissions.guard.ts` `SELF_SCOPE_KEYS` does not yet include
   `sync.devices.revoke` — the route registry row carries `self: true` and
   the controller enforces ownership (device.user_id === session user OR the
   admin key), but the guard only admits key holders today. Add the key to
   SELF_SCOPE_KEYS for the self-revoke journey (SECURITY §4.1).
3. Data-plane consumers (2-a/2-b pull/push, W3 wiring): use
   `verifyAccessToken` for the native-client bearer (claims.sub +
   claims.deviceId + claims.capabilities) alongside the existing
   X-Session-Token + X-Device-Id path; call `registry.touchPull/touchPush`
   from the ack routes (watermarks).
4. First-refresh bootstrap for native clients (issue at register, or a
    dedicated enrollment exchange) — `issueRefreshToken(tx, deviceId)` is
    ready; MASTER-PLAN §9 wanted it at register (see decision 2).
5. Error-status mappings for the new codes (if wanted beyond the 422
    default) belong with the W3/W4 error-registry consolidation — I left the
   shared filter untouched.
