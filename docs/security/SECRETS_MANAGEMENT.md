# Secrets Management

> **Status:** STABLE · **Owner:** Security Architecture · **Updated:** 2026-10-27

Inventory, storage, rotation, and leak response for every secret the platform handles.
Tax-authority certificates are the highest-sensitivity class and get their own section (§6).
Leak response is revoke-first (§7). Related:
[../architecture/SECURITY_ARCHITECTURE.md](../architecture/SECURITY_ARCHITECTURE.md),
[DATA_PROTECTION.md](DATA_PROTECTION.md), [THREAT_MODEL.md](THREAT_MODEL.md) (supply-chain
and certificate-theft scenarios).

## 1. Secret inventory

| # | Secret | Used by | Sensitivity | Notes |
|---|--------|---------|-------------|-------|
| S-01 | DB credentials (`erp_app`, `erp_readonly`) | API runtime, ops diagnostics | High | Non-owner role; never `erp_migrate` at runtime ([../database/TENANT_ISOLATION.md](../database/TENANT_ISOLATION.md) §1) |
| S-02 | DB migration credential (`erp_migrate`) | Deploy job only | **Highest (DB)** | Owner of objects; exists only in the deploy pipeline's secret scope |
| S-03 | Session signing key / session store credentials | identity module | High | Sessions are opaque server-side records (ADR-0015) |
| S-04 | Password hashing parameters + pepper (if used) | identity | High | argon2id parameters stored per-hash |
| S-05 | TOTP seeds + recovery codes (hashed) | identity module | High | C-KEY class ([DATA_PROTECTION.md](DATA_PROTECTION.md) §1) |
| S-06 | Device token signing/verification keys | sync + identity | High | Per-device rotating refresh tokens (ADR-0015/0012) |
| S-07 | SMTP credentials | notifications module | Medium | Email content contains no financial payloads (§7 sub-processors) |
| S-08 | Object storage keys (app bucket vs backup bucket) | files module, backup jobs | High | Separate principals per bucket; backup principal cannot delete WORM objects |
| S-09 | Payment provider API keys + webhook signing secrets | billing adapters (PHASE-014) | High | Provider decision per OQ-003; webhook secrets separate from API keys |
| S-10 | **Tax authority certificates & private keys (ZATCA/ETA)** | e-invoicing signing job (PHASE-023) | **HIGHEST** | §6; [../localization/E_INVOICING_ARCHITECTURE.md](../localization/E_INVOICING_ARCHITECTURE.md) §3 |
| S-11 | Webhook signers (inbound verification keys) | adapter ports | Medium–High | Rotation coordinated with provider |
| S-12 | KMS keys (DB volume, backups, secret-store envelope) | platform | **Highest** | Managed KMS; separate keys per environment |
| S-13 | TLS certificates (public origins) | edge/load balancer | Medium | Provider-managed renewal preferred |
| S-14 | CI/CD credentials (registry push, deploy targets) | pipelines | High | OIDC federation where supported; no long-lived PATs |
| S-15 | Client update-signing keys (Tauri updater, Android signing) | release pipeline | High | Compromise = malicious client updates ([THREAT_MODEL.md](THREAT_MODEL.md) S-13) |

## 2. Storage per environment

| Environment | Mechanism | Rules |
|-------------|-----------|-------|
| Development | `.env` files (gitignored) + docker-compose secrets | `.env.example` lists keys with empty values; compose injects into containers; **never** real secrets in the repo; local e-invoicing stubs use throwaway self-signed material |
| CI | OIDC-based cloud credentials or scoped, short-lived tokens | No secrets as long-lived GitHub secrets where OIDC works; registry push token scoped to repo; DB for integration tests is ephemeral (Testcontainers) with random credentials generated per run |
| Staging | Same managed secret store as production, separate namespace + separate KMS key | Staging NEVER uses production secrets (especially S-10) |
| Production | Managed secret store (cloud KMS-backed) | Injected as environment at deploy; runtime processes read env only; no secret ever written to DB rows, logs, or object storage; access to the store is role-scoped (deploy pipeline, API runtime role, signing-job role) |

## 3. Rotation policy

| Secret | Routine rotation | Procedure | Emergency (leak) procedure |
|--------|------------------|-----------|----------------------------|
| S-01 DB app creds | 90 days | Create new role member/password → deploy with new value → drop old | Rotate immediately; force reconnect; audit `pg_stat_activity` for unexpected sessions |
| S-02 migration credential | Per deploy window (ephemeral preferred) | Pipeline provisions short-lived credential | Revoke; re-run migrations only after review |
| S-03 session signing | 180 days | Dual-accept window (verify old+new) then retire old | Rotate + invalidate all sessions (users re-login; audited) |
| S-05 TOTP seeds | On user reset only | User-driven re-enrollment | Admin reset (`identity.mfa.admin_reset`) + notification |
| S-06 device token keys | 180 days | New key verified at next token refresh | Global device re-registration ( disruptive — SEV-2 comms) |
| S-07 SMTP | 180 days or provider policy | Provider console + store update | Rotate; block sender if account compromised |
| S-08 storage keys | 90 days | New key → deploy → remove old key from store | Rotate + audit object access logs for exfiltration |
| S-09 payment keys | Provider portal policy (test keys never in prod) | Add new key id → switch adapter config → revoke old | Rotate via provider immediately; verify webhook endpoints; reconcile recent webhook events |
| S-10 tax certificates | Per authority process + **expiry monitoring** | See §6 | See §6 + [INCIDENT_RESPONSE.md](INCIDENT_RESPONSE.md) P-04 |
| S-11 webhook signers | Provider-coordinated | Zero-downtime dual-secret window | Rotate with provider; replay-verify recent callbacks |
| S-12 KMS keys | Annual review; rotation per provider KMS flow (no downtime) | KMS key-version rotation | Provider incident process; consider data-rekey scope |
| S-15 client signing keys | Only on compromise or platform decision (rotation is a client-update event) | New key ships with app update that trusts both, then old retired | Minimum-version force-update push ([../planning/RELEASE_STRATEGY.md](../planning/RELEASE_STRATEGY.md)) |

## 4. Access rules

1. **Least privilege**: every runtime component receives only the secrets it uses
   (API role ≠ signing-job role ≠ deploy pipeline). The signing job's credential can read
   only S-10 paths — nothing else.
2. **No secrets in code**: gitleaks runs in CI from PHASE-001 on every push + full history
   scan weekly; pre-commit hook recommended for developers.
3. **No secrets in logs**: pino allow-list redaction (never log headers wholesale, never
   log environment dumps); CI test asserts secret-shaped values are redacted.
4. **No secrets in images**: container images built without build args carrying secrets;
   images scanned in CI (OS packages + embedded manifest); final images assume public
   registries are semi-trusted (history scan of base images weekly).
5. **No secrets in job payloads**: pg-boss payloads carry ids only (ADR-0008); jobs
   re-read config from the store at execution time where a secret is needed.
6. Secret store access is audited: who read which secret path, when; weekly review of
   S-10/S-12 access logs (org control).

## 5. Environment separation & residency

- Dev/CI/staging/prod have **disjoint** secret namespaces and KMS keys; a leaked staging
  secret grants nothing in production.
- Region pinning per A-012: production secrets stay in the deployment region; cross-region
  backup replication uses storage-level mechanisms, not copied credentials.

## 6. Tax-certificate special handling (S-10 — HIGHEST)

Per [../localization/E_INVOICING_ARCHITECTURE.md](../localization/E_INVOICING_ARCHITECTURE.md) §3:

1. **Encrypted at rest**: certificates/private keys stored in the secret store (or an
   encrypted object with KMS envelope), tenant-scoped paths
   `einvoicing/{jurisdiction}/{tenant}/...`.
2. **Signing-job-only access**: only the e-invoicing signing job's runtime credential can
   decrypt; the API role cannot; platform admins cannot read key material (they can only
   trigger enrollment/rotation workflows).
3. **Usage audit**: every decrypt + sign operation writes an audit event (tenant, doc,
   submission id, key version); signing volume dashboards make anomalous bursts visible.
4. **Expiry monitoring**: certificate expiry countdowns alert at 30/14/7 days
   (alert wiring in [../architecture/OBSERVABILITY.md](../architecture/OBSERVABILITY.md));
   renewal follows the authority's re-enrollment process — never improvised.
5. **Never in exports/backups**: key material is excluded from tenant export packages and
   from database dumps (store is external to the DB); a restored environment re-links to
   the store, not to key copies.
6. Tenant offboarding purges the tenant's certificate paths from the store as part of the
   purge job ([DATA_PROTECTION.md](DATA_PROTECTION.md) §4 step 6).

## 7. Leak response (revoke-first checklist)

Order of operations — **revoke before investigating** (an attacker with a live secret
erases traces while you read logs):

1. **Revoke/rotate the exposed secret** (per §3 emergency column) — even if it breaks a
   non-critical flow; availability < containment.
2. **Scope the exposure**: what could the secret reach (which tenant data, which
   environment)? Treat as SEV-1 if S-10/S-12 or any production tenant-data-reaching
   secret ([INCIDENT_RESPONSE.md](INCIDENT_RESPONSE.md)).
3. **Audit trail pull**: secret-store access logs, app logs, provider-side logs for the
   secret's lifetime; identify unauthorized use windows.
4. **Notify affected parties** per severity ladder (tenant-facing template AR+EN in
   [INCIDENT_RESPONSE.md](INCIDENT_RESPONSE.md) §communication).
5. **Eradicate the source**: repo history rewrite (if pushed), CI log redaction, rotated
   credentials everywhere the secret could have been cached.
6. **Verify**: re-run gitleaks + scanner; confirm old secret fails authentication
   attempts in a canary.
7. **Postmortem** within 5 business days; add a regression check (e.g., new gitleaks rule
   for the leaked pattern) — evidence tracked per
   [SECURITY_TEST_PLAN.md](SECURITY_TEST_PLAN.md) §evidence.

## 8. Maintenance protocol

1. New external integration ⇒ new inventory row + storage/rotation/access entries before
   the first production credential exists (phase checklist).
2. Quarterly: review inventory vs. actual store contents (no orphans); review access
   grants.
3. Any rotation procedure executed in anger becomes a runbook entry
   ([../operations/](../operations/TROUBLESHOOTING.md) index) with what-was-hard notes.
