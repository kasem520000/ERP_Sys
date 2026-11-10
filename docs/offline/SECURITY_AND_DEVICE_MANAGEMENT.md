# Security and Device Management

> **Status:** STABLE · **Owner:** Offline & API Architecture · **Updated:** 2026-10-27

Device trust, credential handling, revocation, offline authorization, and local data
protection for offline-capable clients. Authentication foundations:
[ADR-0015](../architecture/ADR/ADR-0015-authentication.md) (argon2id, sessions, device
tokens), [ADR-0012](../architecture/ADR/ADR-0012-offline-sync.md) §6. Endpoint mechanics:
[../api/AUTHENTICATION.md](../api/AUTHENTICATION.md). Threat catalog:
[../security/THREAT_MODEL.md](../security/THREAT_MODEL.md).

## 1. Device trust model

A **device** is a registered offline-capable client with its own identity, credentials,
and revocation state (`devices` table, [../database/ENTITY_CATALOG.md](../database/ENTITY_CATALOG.md)).
Trust is layered:

1. **User authentication** — a device belongs to an authenticated user with a membership
   and role; it can never act outside that user's permissions.
2. **Device identity** — per-device keypair (public key registered, possession proven at
   enrollment, re-challenged on suspicious activity).
3. **Capability scope** — the negotiated subset at registration (POS, van sales,
   personal account) bounds pull feeds and push intents server-side.
4. **Tenant context** — always derived from membership, never from the device
   ([../architecture/MULTI_TENANCY.md](../architecture/MULTI_TENANCY.md) §3).

## 2. Registration flow

1. Authenticated user with `devices.register` permission calls `POST /api/v1/devices`
   with `{ deviceName, platform, platformVersion, appVersion, contractVersion,
   deviceKeyPublic, capabilities }` ([SYNC_PROTOCOL.md](SYNC_PROTOCOL.md) §1).
2. **Attestation-lite**: server issues a nonce challenge; the device signs it with the
   registered private key. Best-effort platform attestation (Android Play Integrity /
   hardware key attestation where available; absent on most shop PCs) raises a trust
   score and is recorded — absence does not block registration but marks the device
   `attestation: 'none'` (visible to admins; relevant to §7 posture).
3. Server records the device (`devices` row: user, platform, key hash, capabilities,
   last_seen_at, revoked_at) and issues scoped credentials (§3).
4. Re-registration (reinstall, OS reset) creates a NEW device; admins see and manage the
   full list per user. Nothing migrates device identity — a restored outbox is handled by
   idempotency, not by identity reuse ([IDEMPOTENCY_AND_RETRIES.md](IDEMPOTENCY_AND_RETRIES.md) §3).

## 3. Credential storage and rotation

| Credential | Storage | Lifetime / rotation |
|------------|---------|---------------------|
| Access token (device) | Memory only; never written to SQLite or logs | 15 min; refreshed silently via the refresh token |
| Refresh token (device-bound) | **OS keychain / keystore** — Windows Credential Manager (Tauri plugin), Android Keystore (Expo SecureStore) | One-time-use, rotating on every exchange; bound to `device_id`; reuse of a rotated token = theft signal → revoke device + audit alarm ([ADR-0015](../architecture/ADR/ADR-0015-authentication.md) §3) |
| Device private key | OS keychain / keystore (hardware-backed where available) | Lifetime of the registration; never leaves the device |
| SQLite encryption key | OS keychain / keystore | Rotated only with DB re-encryption at update time ([LOCAL_DATABASE.md](LOCAL_DATABASE.md) §4) |

Rules: **no secrets in SQLite** — the local DB contains business data and cursors only;
tokens/passwords/keys live exclusively in OS-protected storage. Screenshots/screen
recording are disabled in the Android app for financial screens; POS/desktop screens
avoid echoing credentials in logs (pino redaction,
[../architecture/OBSERVABILITY.md](../architecture/OBSERVABILITY.md)).

## 4. Revocation and kill switch

1. **Who can revoke**: the owning user (self-service device list), a tenant admin, or a
   platform operator (support incident) — each path is permission-gated and audited.
2. **Effect (kill switch)**: revoked device's pulls return `DEVICE_REVOKED`; pushes are
   rejected per-item with `DEVICE_REVOKED` BEFORE any command executes
   ([SYNC_PROTOCOL.md](SYNC_PROTOCOL.md) §1.5); refresh-token exchange fails immediately.
3. **Grace for in-flight**: a request that already passed authentication completes (≤ 15
   min token lifetime); no new tokens are minted after revocation. In-flight accepted
   commands remain valid (they were authorized when executed).
4. **Revoked device with pending outbox**: its pending operations are rejected at push
   with `DEVICE_REVOKED`; the tenant's reconciliation view lists them as
   unresolved-device-operations for explicit review ([FAILURE_RECOVERY.md](FAILURE_RECOVERY.md)
   §1) — they are never silently dropped or silently executed.
5. Re-enabling is not possible; a re-trusted physical device registers fresh (§2.4).

## 5. Offline permission snapshot

1. At every successful sync, the device pulls its **permission snapshot**: the user's
   effective role permissions + capability grants, as of that pull. The snapshot gates
   the LOCAL UI only (buttons, screens, capability classes).
2. **Enforcement is server-final**: every pushed command is permission-checked at
   execution, exactly like online requests. A tampered client with a forged snapshot
   achieves nothing server-side; at worst it renders UI it cannot use.
3. The snapshot carries an expiry watermark (default: 7 days offline). Beyond the
   watermark the app degrades to **read-only + online-required** mode: cached reads are
   viewable; every write requires connectivity so authorization is live. This bounds how
   long a stale-grant UI can mislead (role revoked while device is offline).
4. Snapshot changes are part of the pull feed (entity `permission_snapshot`), so
   downgrades propagate on next sync without app update.

## 6. Lost-device playbook (operational)

1. User/admin revokes the device (§4) — kills pull/push and token minting.
2. **Remote data-expiry via required-online watermark**: the revocation response and the
   next blocked sync carry an instruction the app honors on its next contact: purge local
   tenant data (outbox included — its commands are already server-rejected by policy) and
   require online re-login. A device that never contacts the server again is bounded by
   the offline watermark (§5.3) — it goes read-only and then inert within days; combined
   with encryption-at-rest (§3) the residual risk is documented and accepted.
3. Ownership transfer: admin reassigns device-owned drafts
   ([CONFLICT_RESOLUTION.md](CONFLICT_RESOLUTION.md) §6.3), terminals are re-enrolled
   (`pos_terminals.device_id`), and the incident is audited end-to-end.
4. Financial safety net: no ledger effect ever depended on the lost device's local state;
   pending-but-unsynced operations simply never happened server-side.

## 7. Jailbreak / root posture

1. **Best-effort detection only**: rooted Android / suspicious desktop environments are
   detected via standard signals and recorded on the device profile
   (`devices.trustFlags`); detection is explicitly NOT a security boundary.
2. **Policy response**: a flagged device is forced into **online-only mode** (writes
   require live server authorization every time; local write caching disabled) until an
   admin acknowledges the risk. Rationale: with encryption keys in hardware-backed
   stores, a rooted device compromises the local cache but not server authorization.
3. Never lock a user out solely on a false-positive root signal — degrade, don't brick;
   the admin console shows the flags with timestamps for human decision.

## 8. Device lifecycle audit events

Every lifecycle transition writes an audit event
([../database/ENTITY_CATALOG.md](../database/ENTITY_CATALOG.md) `audit_events`), actor +
device + before/after + correlation id:

| Event | Recorded |
|-------|----------|
| `device.registered` | user, platform, capabilities, attestation result, key fingerprint |
| `device.attested` / `device.attestation_failed` | challenge outcomes |
| `device.token_rotated` | device, timestamp (no secret material) |
| `device.refresh_token_reuse_detected` | device, source ip, immediate revocation trigger |
| `device.revoked` | actor (self/admin/operator), reason |
| `device.last_seen` (metric, not audit) | feeds sync-lag monitoring ([../architecture/OBSERVABILITY.md](../architecture/OBSERVABILITY.md)) |
| `device.data_expired` (remote purge) | device, watermark applied |
| `device.trust_flagged` / `device.trust_acknowledged` | flag, admin actor |

Support/monitoring hooks: sync-lag alert (> 7 days stale device), refresh-reuse alarm,
revocation spike per tenant — each wired to runbooks
([../operations/TROUBLESHOOTING.md](../operations/TROUBLESHOOTING.md)).
