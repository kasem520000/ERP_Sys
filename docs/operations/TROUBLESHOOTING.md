# Troubleshooting

> **Status:** STABLE · **Owner:** Platform Operations · **Updated:** 2026-11-05

Symptom → diagnosis → remediation tables for production and staging. Every entry links
the authoritative runbook or spec section; alerts that route here are defined in
[MONITORING.md](MONITORING.md) §3. **Golden rule:** before mutating anything, capture
evidence (correlation ids, `audit_events`, `boss.job` state) — most remediations are safe
only on a correct diagnosis.

## 1. How to use this runbook

1. Identify the alert/symptom group below and open the linked section.
2. Run the **diagnosis** commands (all read-only) before any remediation.
3. Prefer app-level remediations (restart, re-enqueue, flag-off) over data-level ones.
4. Anything that touches posted financial data is an incident
   ([../security/INCIDENT_RESPONSE.md](../security/INCIDENT_RESPONSE.md)) — corrections go
   through reversals/new documents, never edits (INV-003).

## 2. API

Symptoms: 5xx spikes, slow p95, restart loops. Alerts: `Api5xxSpike`, `ApiP95Breach`,
`PoolSaturation`, `SLOBurn` ([MONITORING.md](MONITORING.md) §3).

| Symptom | Diagnosis | Remediation | Runbook |
|---------|-----------|-------------|---------|
| 5xx spike after a deploy | Correlate start time with deploy log; check error codes in logs (`error.code`) grouped by route | If release-correlated → app rollback: [DEPLOYMENT.md](DEPLOYMENT.md) §4 + [CI_CD.md](CI_CD.md) §7 | [DEPLOYMENT.md](DEPLOYMENT.md) §3–4 |
| Slow p95 across routes | `SELECT calls, mean_exec_time, rows, query FROM pg_stat_statements ORDER BY mean_exec_time DESC LIMIT 20;` — look for new plans after migration | Add/fix index per [../database/CONSTRAINTS_AND_INDEXES.md](../database/CONSTRAINTS_AND_INDEXES.md) §6; check stats freshness (`ANALYZE`) | [../database/DATABASE_CONVENTIONS.md](../database/DATABASE_CONVENTIONS.md) §8 |
| DB pool exhaustion | Pool metrics (waiters, queue); `SELECT count(*), state FROM pg_stat_activity GROUP BY state;` — look for long `idle in transaction` | Kill offending pids via the pool admin route; find the leaked transaction in logs by `correlation_id`; fix code path (missing unit-of-work dispose) | [../database/DATABASE_CONVENTIONS.md](../database/DATABASE_CONVENTIONS.md) §10 |
| Readiness flapping | `GET /health/ready` detail: which `checks[]` fails (DB round-trip? queue?) | DB issue → §database; queue issue → §jobs; transient LB blips during deploys are expected only inside deploy windows | [MONITORING.md](MONITORING.md) §2 |
| Error budget burning (no single symptom) | SLO dashboard burn rate by route/tenant | Treat as capacity/correctness investigation: open a ticket with the top contributing route + tenant distribution | [MONITORING.md](MONITORING.md) §5 |

## 3. Database

Alerts: `SlowQueryRate`, `StorageGrowth`, `ReplicationLag`.

| Symptom | Diagnosis | Remediation | Runbook |
|---------|-----------|-------------|---------|
| Lock contention (requests piling up, `wait_event_type='Lock'`) | `SELECT pid, wait_event_type, wait_event, now()-query_start AS age, left(query,80) FROM pg_stat_activity WHERE wait_event_type IS NOT NULL AND state<>'idle';` then `SELECT pg_blocking_pids(pid), pid FROM pg_stat_activity WHERE cardinality(pg_blocking_pids(pid))>0;` | Identify the blocker (usually a report query or forgotten transaction); terminate the session only if it is not a posting transaction (`pg_terminate_backend` as last resort — posting transactions are atomic and retry-safe via INV-013) | [../database/DATABASE_CONVENTIONS.md](../database/DATABASE_CONVENTIONS.md) §10 |
| Table/index bloat (counts fine, scans slow) | Bloat estimate via `pgstattuple` on suspects; autovacuum stats | Tune autovacuum per table; `REINDEX CONCURRENTLY` bloated indexes in a maintenance window | [../database/CONSTRAINTS_AND_INDEXES.md](../database/CONSTRAINTS_AND_INDEXES.md) §6 |
| Replication lag (once replica exists) | Provider lag metrics + `pg_stat_replication` | Throttle heavy reports off the primary; check network/wal volume; never let reporting queries hit primary during spikes | [../architecture/DEPLOYMENT_ARCHITECTURE.md](../architecture/DEPLOYMENT_ARCHITECTURE.md) §Scaling path |
| Storage growth | Disk usage by relation: `SELECT relname, pg_size_pretty(pg_total_relation_size(oid)) FROM pg_class WHERE relkind='r' ORDER BY pg_total_relation_size(oid) DESC LIMIT 15;` | Growth in `boss.job`/`audit_events`/`change_log` → maintenance job review ([../database/DATABASE_CONVENTIONS.md](../database/DATABASE_CONVENTIONS.md) §9); capacity action otherwise | [DEPLOYMENT.md](DEPLOYMENT.md) §7 |
| Migration job failed at deploy | Migration job log (statement + lock info) | Abort per [DEPLOYMENT.md](DEPLOYMENT.md) §3; fix forward — never write a down-migration | [../database/MIGRATION_STRATEGY.md](../database/MIGRATION_STRATEGY.md) §4 |

## 4. Jobs & workers

Alerts: `WorkerHeartbeatStale`, `DeadLetterGrowth`.

| Symptom | Diagnosis | Remediation | Runbook |
|---------|-----------|-------------|---------|
| Worker heartbeat stale | Worker logs (is the process up? OOM? stuck render?); `SELECT state, count(*) FROM boss.job GROUP BY state;` | Restart worker (`docker compose -f deploy/compose.prod.yml up -d --no-deps worker`) — pg-boss re-claims expired jobs; if crash-looping, check Chromium memory (§printing) | [DEPLOYMENT.md](DEPLOYMENT.md) §2 step 5 |
| Dead-letter triage (generic steps) | 1. `SELECT * FROM boss.job WHERE state IN ('failed','expired') ORDER BY created_on DESC LIMIT 50;` 2. Read `response`/error payload; 3. Classify by category below; 4. Check whether a payload bug (fix code) or data state (fix data via flows) | Re-enqueue only after the cause is fixed; bulk re-enqueue of unfixable payloads creates noise, not progress | ADR-0008 ([../architecture/ADR/ADR-0008-jobs-redis.md](../architecture/ADR/ADR-0008-jobs-redis.md)) |
| Dead letters: `reports.*` | Render errors, template failures, timeouts (render budget) | Fix template/params; stuck renders → §printing; re-enqueue the specific `report_runs` rows | [../accounting/DOCUMENT_LIFECYCLE.md](../accounting/DOCUMENT_LIFECYCLE.md) §5 + §printing below |
| Dead letters: `accounting.recurring` | Recurring journal generation failures (period locked, missing purpose mapping) | Fix period/config; re-run — idempotency key (INV-013) prevents duplicates | [../accounting/POSTING_ENGINE.md](../accounting/POSTING_ENGINE.md) |
| Dead letters: `reconciliation.*` | Subledger/stock reconciliation drift detected | Never silence: read the drift report, identify the invariant (INV-009/010/012/019) and the offending module; Sev-1 if real drift | [../accounting/ACCOUNTING_INVARIANTS.md](../accounting/ACCOUNTING_INVARIANTS.md) |
| Dead letters: `sync.*` (PHASE-020+) | Rejected pushes (period locked, price tolerance, credit limit) | These are **tenant-actionable errors**: verify the device got the rejection; no server-side merge — see §sync | [../offline/SYNC_PROTOCOL.md](../offline/SYNC_PROTOCOL.md) |
| Stuck report render queue | Queue depth for `reports.render` rising; worker CPU/memory | See §printing (Chromium pool exhaustion) | §printing below |

## 5. Authentication & sessions

| Symptom | Diagnosis | Remediation | Runbook |
|---------|-----------|-------------|---------|
| User lockout storm | `SELECT email, failed_login_count, locked_until FROM users WHERE locked_until > now();` — brute-force pattern? distributed or single IP? | Rate-limit/response per [../architecture/SECURITY_ARCHITECTURE.md](../architecture/SECURITY_ARCHITECTURE.md); unlock individual legitimate users via admin flow (audited); credential-stuffing pattern → tighten rate limits + notify affected users | [../architecture/ADR/ADR-0015-authentication.md](../architecture/ADR/ADR-0015-authentication.md) |
| Session storm (login churn, session table spike) | Sessions created per minute by user/IP; check for clients looping on 401 (rotated secret? expired announcement?) | If `SESSION_SECRET` was rotated without a grace strategy → redeploy with previous secret briefly + fix rotation procedure; loop clients → min-version enforcement (PHASE-022) | [ENVIRONMENT_CONFIGURATION.md](ENVIRONMENT_CONFIGURATION.md) §3 |
| MFA lockout (lost device) | `mfa_factors` state for the user | Admin-assisted MFA reset flow (audited, requires identity verification); recovery codes where enrolled | [../security/SECRETS_MANAGEMENT.md](../security/SECRETS_MANAGEMENT.md) |
| Invitation emails not arriving | Mailpit/provider logs; `SMTP_HOST` correctness; bounce records | Provider issue → switch to fallback provider config; individual tenant → resend invitation (new token, old expires) | [DEVELOPMENT_SETUP.md](DEVELOPMENT_SETUP.md) §6.4 |

## 6. Tenants, entitlements & isolation

Alert: `RLSDenial` (Sev-1 — [MONITORING.md](MONITORING.md) §3).

| Symptom | Diagnosis | Remediation | Runbook |
|---------|-----------|-------------|---------|
| **RLS denial counter > 0** | Pull the request logs for the denial (tenant, route, correlation id); reproduce the request shape in staging | This means code attempted a cross-tenant access: treat as a security incident (RISK-010) — hotfix path with attack-test coverage ([../database/TENANT_ISOLATION.md](../database/TENANT_ISOLATION.md) §5) before anything else | [../security/INCIDENT_RESPONSE.md](../security/INCIDENT_RESPONSE.md) |
| Tenant suspended; users see stale behavior | `tenants.status`, `subscriptions.status`, entitlement materialization state | Suspension is designed to: block login into tenant, stop jobs, flip entitlements at next materialization. Verify the entitlements refresh job ran; old sessions must be rejected at the boundary | [../architecture/MULTI_TENANCY.md](../architecture/MULTI_TENANCY.md) |
| Entitlement changes not taking effect | `entitlements` table row age vs change time (materialization lag); client-side caching TTL | Re-run materialization job; confirm plan change was audited; clients re-check entitlements per contract — never cache longer than the stated TTL | [ENVIRONMENT_CONFIGURATION.md](ENVIRONMENT_CONFIGURATION.md) §4 |
| Tenant reports "data missing" | User session tenant vs requested tenant; RLS is doing its job if ids mismatch | Verify membership + branch scope; a correct 404 on cross-tenant ids is by design (no existence leak — A7 attack) | [../database/TENANT_ISOLATION.md](../database/TENANT_ISOLATION.md) §5 |

## 7. Offline sync (PHASE-020+ — **LIVE 2026-11-04**)

Alerts: `SyncPushFailSpike` (Sev-2), `SyncCursorStall` (Sev-3) — both live via the
`GET /api/v1/sync/admin/health` aggregate (60 s cache) + the
`/[locale]/platform/sync-health` screen; gauges `outbox.lag` (bucket histogram) and
`device.revoked.pending_ops`.

| Symptom | Diagnosis | Remediation | Runbook |
|---------|-----------|-------------|---------|
| **`SyncPushFailSpike`** — push failure spike (successRate < 90% w/ ≥ 20 commands over the 7-day window in-product; > 5% in 15 min on the metrics pipeline) | Health aggregate `rejectionsByReason` (or `SELECT result->>'reason', count(*) FROM inbox_commands WHERE tenant_id=$1 AND processed_at > now()-interval '7 days' GROUP BY 1 ORDER BY 2 DESC;`); correlate with a deploy, a period lock, or a master-data batch (ITEM_INACTIVE/PARTNER_INACTIVE waves) | Reason-coded waves are business-expected (typed, resubmittable-aware) — notify the tenant, never force-merge; a code spike after a deploy (e.g. VALIDATION_ERROR) is a regression → roll back per §4 and treat as a sync-protocol incident | [../offline/SYNC_PROTOCOL.md](../offline/SYNC_PROTOCOL.md) §3.4 |
| **`SyncCursorStall`** — entity cursor lag > 7 days (in-product) / > threshold of change_log ahead (pipeline) | `SELECT entity_type, last_seq, acknowledged_at, now()-acknowledged_at AS lag FROM sync_cursors WHERE device_id=$1;` vs `SELECT entity_type, max(seq) FROM change_log WHERE tenant_id=$1 GROUP BY 1;`; check `devices.last_pull_at` + the daily `sync.cursor.compact` audit (`sync.cursor_compact_run`) | If the feed head is advancing but the cursor stalls: device connectivity/credential issue (revoked? token reuse? check `devices.revoked_at`); if the feed head itself is stale: producer issue → §jobs and the `sync.feed.health` 5-min probe; a device stuck past its permission watermark is read-only by design (D-04) | [../offline/SYNC_PROTOCOL.md](../offline/SYNC_PROTOCOL.md) §2 |
| Stuck pull cursor (clients not getting changes) | `SELECT entity_type, last_seq FROM sync_cursors WHERE device_id=$1;` vs `SELECT max(seq) FROM change_log WHERE tenant_id=$1;` — per-entity lag | If change feed is healthy but cursor stalls: device connectivity/heartbeat issue; if change_log lags globally: producer job issue → §jobs | [../offline/SYNC_PROTOCOL.md](../offline/SYNC_PROTOCOL.md) |
| Rejected pushes triage | Rejection reason codes on `inbox_commands`/document state: period locked, price beyond tolerance, credit limit exceeded, version conflict, FORBIDDEN (online-only entity or non-owner draft — never resubmittable) | These are **by-design actionable errors returned to the device** — verify the device shows them; do not force-merge on the server; tenant resolves the business condition then re-submits (FORBIDDEN/ONLINE_ONLY items must be cancelled, not retried) | [../accounting/DOCUMENT_LIFECYCLE.md](../accounting/DOCUMENT_LIFECYCLE.md) §4 |
| Revoked-device pending ops (`device.revoked.pending_ops` > 0 — the reconciliation queue) | `GET /api/v1/sync/admin/reconciliation` (or the `/[locale]/platform/sync-reconciliation` screen): devices with un-acked inbox commands or owned drafts after revocation | Work the queue to zero: reassign owned DRAFTs to a live device (`POST /api/v1/sync/admin/drafts/reassign`) or let the tenant finish them online; un-acked ops keep the device on the queue until a human closes it — never silently dropped | [../offline/SECURITY_AND_DEVICE_MANAGEMENT.md](../offline/SECURITY_AND_DEVICE_MANAGEMENT.md) §4 |
| Refresh-token reuse — device suddenly revoked | `audit_events` `device.refresh_token_reuse_detected` + the rotation chain (`SELECT id, predecessor_id, used_at, revoked_at FROM device_refresh_tokens WHERE device_id=$1 ORDER BY issued_at;`) | Reuse = possible token theft: the kill switch (revoke + alarm) already fired — treat as a security incident (RISK-010 ladder); re-enroll the device only after the owner confirms possession | [../offline/SECURITY_AND_DEVICE_MANAGEMENT.md](../offline/SECURITY_AND_DEVICE_MANAGEMENT.md) §3 |
| Duplicate effects suspected after sync | Check posting idempotency: `SELECT tenant_id, source_type, source_id, operation, count(*) FROM journal_entries GROUP BY 1,2,3,4 HAVING count(*)>1;` (must return 0) | If 0 → dedupe worked (client-side duplicates are display-only); if > 0 → **Sev-1** (RISK-011) — incident, freeze sync for that tenant | [../accounting/ACCOUNTING_INVARIANTS.md](../accounting/ACCOUNTING_INVARIANTS.md) INV-013 |
| Offline POS receipts not reconciling | `offline_receipt_no` present on posted invoices for the terminal/shift window | Re-run the terminal reconciliation view; gaps mean unsynced local sales → device must sync before close of shift | [../accounting/DOCUMENT_LIFECYCLE.md](../accounting/DOCUMENT_LIFECYCLE.md) §4 |

## 8. Desktop application (PHASE-021 — **LIVE 2026-11-04**)

The Windows desktop client (Tauri shell, [ADR-0013](../architecture/ADR/ADR-0013-tauri-desktop.md)):
signed auto-update channel, WebView2 runtime probe, local SQLite store, and the bridge
sync driver. Dev loop: [DESKTOP_QUICKSTART.md](DESKTOP_QUICKSTART.md); installed-client
requirements: [DESKTOP_SYSTEM_REQUIREMENTS.md](DESKTOP_SYSTEM_REQUIREMENTS.md).

| Symptom | Diagnosis | Remediation | Runbook |
|---------|-----------|-------------|---------|
| Update refused: "manifest signature rejected" / "bundle signature verification failed" / "downgrade rejected" | The updater client's state machine reports `rejected` with the reason in the client log; compare the channel `latest.json` signature against the trusted pubkeys (S-15 — rotation mid-window? manifest signed by the retired key?) | These are **D-06 fail-closed by design — never bypass, never re-serve different bytes under a live version** (immutability rule). Republish a correctly signed manifest: `pnpm tsx scripts/updater-manifest.ts sign\|publish` (+ `--self-test`); during a rotation use the dual-trust window (both pubkeys in the client build) before retiring the old key | [DEPLOYMENT.md](DEPLOYMENT.md) §7 + [`deploy/updater/README.md`](../../deploy/updater/README.md) |
| Devices stuck on the blocked-min-version (force-update) screen | `latest.json` carries `minVersion` above the installed version — either an intentional halt remedy (DR-P21-05) or a stale force-update left behind | Intentional: publish the fixed build ≥ `minVersion` at `stagePercent` 100 — the blocked screen drives the install through the same verified path, no bypass exists | [DEPLOYMENT.md](DEPLOYMENT.md) §7 |
| Staged rollout not promoting (stuck at 10% or 50%) | Client-stability panels: trailing-24 h crash-free-session rate + session count vs the gates — ≥ 99.5% over ≥ 200 sessions to promote 10→50, ≥ 99.7% over ≥ 500 to promote 50→100; below 50 sessions the tiny-sample guard HOLDS | A crash spike below **98.5%** auto-halts: the rollout service publishes the `minVersion` force-update remedy — do not manually widen `stagePercent` while the rate is under a gate; fix the build instead | [MONITORING.md](MONITORING.md) §1 + [../planning/RELEASE_STRATEGY.md](../planning/RELEASE_STRATEGY.md) §Rollout |
| App shows the system-requirements screen instead of the UI (WebView2 below minimum) | The startup probe banded the installed Evergreen runtime `< 109.0.1518.78` (DR-P21-04); versions in `(minimum, recommended 120.0.2210.61)` run with degraded-capability notices only | Install/upgrade the WebView2 Evergreen runtime ≥ minimum via the installer guidance in the screen — no crash, no broken UI is the expected behavior (PHASE-021 criterion 10); do not try to "skip" the probe | [DESKTOP_SYSTEM_REQUIREMENTS.md](DESKTOP_SYSTEM_REQUIREMENTS.md) §2 |
| Local store corruption reported (`LocalStoreCorruptError` / integrity check ≠ ok) | The app runs the LOCAL_DATABASE §6.4 path: stage outbox/inbox survivors to a staging file → delete the DB → re-run migrations → re-import → cursors reset → **full pull**; the staging manifest is kept on disk | Verify the next full pull completes and the outbox drains; net acceptable loss = cached read models only. If staging was unwritable the app refuses LOUD and keeps the file — never a delete without staging; support then re-enrolls the device | [../offline/LOCAL_DATABASE.md](../offline/LOCAL_DATABASE.md) §6.4 |
| Manual "Sync now" disabled with the unavailable reason (`SYNC_DRIVER_NOT_REGISTERED`) | The bridge `sync` member is absent — an older shell build without the sync-driver commands (DR-P21-09); the webview never runs the sync engine itself | Fail-closed by design: update the shell to a build carrying the sync driver — the controls stay disabled (honest unavailable state), never a simulated sync | [DESKTOP_QUICKSTART.md](DESKTOP_QUICKSTART.md) §2–3 |
| Shell boot fails closed with `SqlCipherUnavailableError` (`SQLCIPHER_UNAVAILABLE`) | A store encryption key is configured but the running build is not the SQLCipher profile (DR-P21-02 dual-profile store: cipher = the Windows CI `--features sqlcipher` build; standard = the plain-SQLite fallback) | Install the cipher-profile release build (the production posture — at-rest encryption), or accept the explicit standard-profile fallback dialog: every other key-management invariant still holds (key only in the OS keychain, secret-scan green), but the standard-profile file is plaintext at rest — the D-02 binary-inspection caveat, run for real only on the Windows CI cipher profile | [../offline/LOCAL_DATABASE.md](../offline/LOCAL_DATABASE.md) §4 |

## 9. Android application (PHASE-022 — **LIVE 2026-11-05**)

The Expo/React Native client ([ADR-0014](../architecture/ADR/ADR-0014-android-expo.md)):
ONE app, TWO capability experiences (`android-field` / `android-personal`), local SQLite
store, background sync, biometric unlock, Play Store staged rollout. Dev loop:
[MOBILE_QUICKSTART.md](MOBILE_QUICKSTART.md); the release channel + the S-15 signing
family: [DEPLOYMENT.md](DEPLOYMENT.md) §7.

| Symptom | Diagnosis | Remediation | Runbook |
|---------|-----------|-------------|---------|
| Background sync barely runs / data stale until the app is opened (Doze, OEM task killers) | This is **Android background-execution reality, not a defect**: the OS-scheduled background fetch is best-effort at ≥ 15-min intervals and Doze/OEM killers may defer it indefinitely (common on regional OEMs — the PHASE-022 risk note); check `devices.last_pull_at` in the registry — if it advances whenever the app is foregrounded, the scheduler is behaving | The **foreground cycle is the reliability path by design** (2-min while dirty + connectivity-regained 5 s debounce + after-write fast push); the user-facing "Sync now" always exists; user help documents the Doze reality honestly. Never promise real-time background sync on Android | [../offline/SYNC_PROTOCOL.md](../offline/SYNC_PROTOCOL.md) §8 + [MOBILE_QUICKSTART.md](MOBILE_QUICKSTART.md) §6 |
| Data arrives in chunks / a pull "stops partway" (budget behavior) | The byte-budget guards are doing their job: pull ≤ 8 MB / push ≤ 2 MB per cycle (cellular defaults), personal-account background pull ≤ 256 KB — an over-budget cycle splits across cycles; a server-side `DEFERRED` with `retryAfterMs` is the per-device rate limit backing off (never executed, never inbox-recorded) | No action: the next cycle resumes from the cursor; verify convergence via `devices.last_pull_at` + the sync-health dashboard. If a cursor truly stalls (> 7 days), it is the §sync `SyncCursorStall` path | [../offline/SYNC_PROTOCOL.md](../offline/SYNC_PROTOCOL.md) §2–3 |
| App blocked on the force-update screen (below `minVersion`) | The release manifest's `minVersion` is above the installed version — either an intentional halt remedy (crash-free rate < 98.5% at any sample size published `minVersion` = last-known-good) or a routine minimum bump | Intentional by design: publish the fixed build ≥ `minVersion` — the blocked screen drives the Play Store update; **no bypass exists**. Do not lower `minVersion` to "unblock" devices while the crash cause is unfixed | [DEPLOYMENT.md](DEPLOYMENT.md) §7 |
| Device suddenly signed out with local data purged (revocation UX) | The admin console revoked the device (or a refresh-token reuse tripwire fired — possible theft, §sync): pushes were answered `DEVICE_REVOKED`, and the next contact purged the business tables + outbox + cursors (personal read models included) and required re-login — this is the D-01 lost-device playbook working | Expected behavior: re-enroll the device only after the owner confirms possession (a reuse tripwire = the security-incident ladder); the device's un-acked ops/owned DRAFTs sit on the reconciliation queue — work it to zero (reassign or finish online), never silently dropped | [../offline/SECURITY_AND_DEVICE_MANAGEMENT.md](../offline/SECURITY_AND_DEVICE_MANAGEMENT.md) §4 + §sync above |
| Writes disabled with the "requires connectivity" banner (trust-flagged device) | `devices.trust_flags` recorded a best-effort root/tamper signal (D-07): the app degrades to online-only for writes — reads keep working; the banner is the honest state, never a brick | An admin acks the flag after review (the `adminAckedAt` PATCH — the ack covers one episode); offline writes return when the device is acked AND the permission snapshot is inside the 7-day watermark. Rooted-device detection is explicitly NOT a security boundary — server-final enforcement; a false positive only degrades UX | [../offline/SECURITY_AND_DEVICE_MANAGEMENT.md](../offline/SECURITY_AND_DEVICE_MANAGEMENT.md) §5 |

## 10. E-invoicing (PHASE-023 — pipeline **LIVE 2026-11-05**; adapter = `UNVERIFIED` stub)

The submission registry (`e_invoicing_submissions` — one row per document × adapter, retry
chains via `retry_of_submission_id`, sealed payload/response artifacts) and its job
pipeline are **operational and adapter-neutral**: `PENDING → GENERATED → SIGNED →
SUBMITTED → ACCEPTED/REJECTED → REPORTED` (`FAILED` = dead-letter; `SUPPRESSED` for
opted-out documents), exponential-capped retries with dead-letter alerting. pg-boss
queues: `einvoicing.submission.pipeline` (2-min pass driving rows sign → submit → poll →
reconcile), `einvoicing.cert.expiry` (daily sweep), `einvoicing.reject.spike` (5-min
evaluation). **The ZATCA adapter itself is the `UNVERIFIED` refuse-to-submit stub until
the verification gate passes (DR-001 OPEN — RISK-005): `UNVERIFIED_REGIME` refusals are
the honest expected state, never an incident.** The fake-authority harnesses
(`tests/authorities/fake-zatca`, `fake-eta`) drive the REAL registry + jobs — the triage
flows below are exercised there. Alerts: `EInvoiceRejectSpike`, `CertExpiry`
([MONITORING.md](MONITORING.md) §3 — notifications inbox, category `einvoicing`); funnel
screens: `/[locale]/platform/einvoicing-funnel` (platform ops) and
`/[locale]/settings/tax/einvoicing` (tenant). Full design:
[../localization/E_INVOICING_ARCHITECTURE.md](../localization/E_INVOICING_ARCHITECTURE.md);
phase spec: [../implementation/phases/PHASE-023.md](../implementation/phases/PHASE-023.md).

| Symptom | Diagnosis | Remediation | Runbook |
|---------|-----------|-------------|---------|
| Submission REJECTED by the authority | The registry row: `GET /api/v1/tax/einvoicing/registry/submissions?status=REJECTED` (or `SELECT status, attempts, last_error_code, error_detail, authority_refs FROM e_invoicing_submissions WHERE id=$1;`) — reason code, `error_detail` JSONB, authority refs, plus the sealed response artifact in the files store | Fix the **document data** the authority rejected (e.g., buyer fields), then `POST /api/v1/tax/einvoicing/submissions/:id/resubmit` — it requires a REJECTED/FAILED row and creates a **NEW row chained via `retry_of_submission_id`** (the old row keeps its terminal status forever). **Never edit history** — the registry is append-only. A rejection that indicates a spec misunderstanding → compliance incident (RISK-005) | [../localization/E_INVOICING_ARCHITECTURE.md](../localization/E_INVOICING_ARCHITECTURE.md) §2, §7 |
| **`EInvoiceRejectSpike`** — rejection rate > 5% of submissions in 15 min (Sev-2) | The 15-minute rejection window + top `last_error_code` reasons on `/[locale]/platform/einvoicing-funnel` (or `GET /api/v1/tax/einvoicing/funnel`); evaluated every 5 min per tenant, deduped per 15-min window (inbox, category `einvoicing`) | Triage the reason-code wave: tenant-data rejections (buyer fields, numbering) → the tenant fixes and resubmits per the row above; a same-code spike right after a pack/adapter change is a spec misunderstanding → compliance incident (RISK-005): freeze the adapter flag (`POST /api/v1/tax/einvoicing/settings/:adapterId` with `"enabled": false` — disabling is always allowed) and fix forward | [MONITORING.md](MONITORING.md) §3 + [../localization/E_INVOICING_ARCHITECTURE.md](../localization/E_INVOICING_ARCHITECTURE.md) §7 |
| **`CertExpiry`** — certificate inside the 30/14/7-day ladder (Sev-3; Sev-2 under 7 days) | `GET /api/v1/tax/einvoicing/certificates` — metadata + countdowns + signing volume ONLY (**no API surface returns key material — by design, asserted by the S-10 handling tests**); the daily sweep flips `EXPIRING_SOON` under 30 days and fires each threshold exactly once (`e_invoicing_certificates.expires_alerted_at` per-threshold dedupe) | Rotate **before** expiry via the authority's re-enrollment process: `POST /api/v1/tax/einvoicing/certificates/enroll` with `rotatedFromId` (audited, approval-separated admin trigger; the PEM ships out-of-band and is sealed at rest under `einvoicing/{jurisdiction}/{tenant}/…`; the previous cert goes REVOKED — never deleted). Tenant offboarding purges the certificate paths + usage rows — key material never survives offboarding | [../security/SECRETS_MANAGEMENT.md](../security/SECRETS_MANAGEMENT.md) §6 |
| Authority spec change / jurisdiction pack upgrade (sandbox passes, production fails ⇒ version drift) | Pack versions: `GET /api/v1/tax/packs/:country/versions`; the tenant's pin lives in `tax_pack_bindings` (staged preview → apply: `GET /api/v1/tax/packs/:country/preview` → `POST /api/v1/tax/packs/:country/apply`, audited); compare the sealed payload snapshots of the two environments before anything else | Apply the new pack version, bump the adapter version + staged rollout (submission modes are versioned per ADR-0010; spec versions pinned per adapter declaration). **A pack updating mid-flight is safe by design:** `STAMP_AT_POSTING` snapshots freeze each posted line's (treatment, rate, jurisdiction, version) — loading a pack update never alters posted documents and warns on drafts spanning a rate change; in-flight submissions keep their sealed payload + digest | [../localization/TAX_ENGINE.md](../localization/TAX_ENGINE.md) §3 + [../localization/E_INVOICING_ARCHITECTURE.md](../localization/E_INVOICING_ARCHITECTURE.md) §7 |
| Submission dead-lettered (`FAILED`) or retries stuck | The retry sweep's worklist — `SELECT id, status, attempts, next_attempt_at FROM e_invoicing_submissions WHERE status IN ('PENDING','GENERATED','SIGNED','SUBMITTED') AND (next_attempt_at IS NULL OR next_attempt_at <= now()) ORDER BY COALESCE(next_attempt_at, created_at);` (partial index on `(status, next_attempt_at)`); backoff doubles from 30 s capped at 30 min; a row dead-letters at 8 attempts (FAILED is terminal) and the dead-letter watch alerts hourly while FAILED > 0 (inbox, category `einvoicing`) | **Classify before acting: `UNVERIFIED_REGIME` = the stub refusing every regulated action while the verification gate is unpassed (DR-001 OPEN) — expected, NOT an incident.** Real pipeline failures (e.g., `PENDING_DOCUMENT_DATA`, authority timeouts after capped retries): fix the cause, then resubmit per the rejection row above — a FAILED row never silently resurrects; the resubmit endpoint (new row) is the retry unit | [../localization/E_INVOICING_ARCHITECTURE.md](../localization/E_INVOICING_ARCHITECTURE.md) §2 |
| Submission queue backing up / authority slow | `boss.job` for the `einvoicing.*` queues + funnel latency p50/p95 (`GET /api/v1/tax/einvoicing/funnel`); the pipeline pass runs every 2 min per ACTIVE tenant | Backoff storms after provider incidents are capped (30-min max delay); if the authority is down, the registry honestly shows PENDING/SUBMITTED — **never mark ACCEPTED without authority confirmation (directive §12: registry status is the sole authority truth)** | [../localization/E_INVOICING_ARCHITECTURE.md](../localization/E_INVOICING_ARCHITECTURE.md) §2 |
| Bank-statement import parked rows (unparseable lines) | `GET /api/v1/treasury/bank-statements/parked-lines?status=PARKED` — raw cells stored **verbatim** in `bank_statement_parked_lines` (`raw_cells`/`raw_line` + `parked_reason`); a parked row is never a guessed amount into `bank_statement_lines` | Map it: `POST /api/v1/treasury/bank-statements/parked-lines/:id/resolve` (writes the confirmed `bank_statement_lines` row + links `resolved_line_id`; the parked row stays as history) — or discard with a reason: `POST /api/v1/treasury/bank-statements/parked-lines/:id/discard` (note required). Balance-drift warnings on import are advisory — **never a silent correction** | [../accounting/RECONCILIATION.md](../accounting/RECONCILIATION.md) §4 |
| Payout batch `DRIFT` (provider-reported ≠ platform-computed) | `GET /api/v1/platform/billing/payouts?tenantId=…` — `drift_detail` carries the reported (count, gross) vs the computed (settled `provider_webhook` payments in the window); reconciliation flips `RECONCILED` on match, `DRIFT` on mismatch (`POST /api/v1/platform/billing/payouts/sync` runs both) | Investigate with the detail (missed webhook, fee-schedule difference, window boundary) — **drift is never auto-corrected**; corrections go through the auditable billing flows (refunds record a `payment.refunded` billing event). DR-002 stays OPEN: sandbox depth, **no production payment cutover claim** | [../decisions/product/DR-002-payment-provider-selection.md](../decisions/product/DR-002-payment-provider-selection.md) + [../implementation/phases/PHASE-023.md](../implementation/phases/PHASE-023.md) §2 |

## 11. Printing & report rendering (Chromium in worker)

| Symptom | Diagnosis | Remediation | Runbook |
|---------|-----------|-------------|---------|
| Report renders stuck / queue depth rising | Worker memory + CPU graphs; render-duration metrics; `boss.job` in `active` state with old `started_on` | Restart worker (expired jobs re-claimed); reduce render concurrency if pattern repeats | [DEPLOYMENT.md](DEPLOYMENT.md) §2 step 5 |
| Chromium pool exhaustion (OOM, crash loops) | Worker logs: render timeouts then OOM-kill loop; RISK-013 | Cap concurrent renders below memory budget; ensure render-timeout kills the page, not the pool; burst capacity = dedicated worker pool (scaling path), not a bigger shared worker | [../architecture/DEPLOYMENT_ARCHITECTURE.md](../architecture/DEPLOYMENT_ARCHITECTURE.md) §Scaling path |
| Garbled Arabic in PDFs (missing glyphs) | Test render of the same template in staging | Template/font issue, not ops: route to the phase template fix; fonts ship with the image (never fetch at runtime) | [../architecture/ADR/ADR-0011-reporting-printing.md](../architecture/ADR/ADR-0011-reporting-printing.md) |

## 12. Escalation matrix

| Severity | Examples | First responder | Escalate after | Escalation target |
|----------|----------|-----------------|----------------|-------------------|
| Sev-1 | RLS denial, posting invariant failure, migration failure, region loss, WORM drift | On-call primary (paged) | 15 min without containment | Engineering lead + product owner; incident command per [../security/INCIDENT_RESPONSE.md](../security/INCIDENT_RESPONSE.md) |
| Sev-2 | Backup job failure (repeated), DLQ growth, e-invoicing reject spike, sync push spike, pool saturation | On-call primary (ticket/page per §3) | 4 h without resolution | Engineering lead; product owner if tenant-visible |
| Sev-3 | Slow queries, cursor lag, storage growth, Sev-3 cert window | Assigned engineer (ticket) | Sprint boundary | Capacity/tech-debt review |

Any incident involving **ledger data integrity** (posting, reconciliation, sync
duplicates) is **Sev-1 by definition** (RISK-009/RISK-011) — do not downgrade it because
only one tenant is affected. Post-incident reviews: [DISASTER_RECOVERY.md](DISASTER_RECOVERY.md) §6.
