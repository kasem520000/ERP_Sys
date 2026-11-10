# Data Protection

> **Status:** STABLE · **Owner:** Security Architecture · **Updated:** 2026-11-06

Data classification, handling rules per state (transit, rest, logs, exports, backups),
PII inventory, tenant offboarding (export → purge), retention, sub-processors, and device
data. This file operationalizes the data-protection rules stated in
[../architecture/SECURITY_ARCHITECTURE.md](../architecture/SECURITY_ARCHITECTURE.md);
secrets handling is separate: [SECRETS_MANAGEMENT.md](SECRETS_MANAGEMENT.md).

**Legal disclaimer (binding):** this blueprint does NOT assert legal compliance for any
jurisdiction. Retention periods and privacy notices require review by qualified counsel
per market before GA ([../planning/RISK_REGISTER.md](../planning/RISK_REGISTER.md);
decisions under [../decisions/compliance/](../decisions/compliance/README.md)). Where this
file states a number without a legal source, it is a **provisional engineering default**
pending that review.

## 1. Data classification

| Class | Data | Sensitivity | Integrity requirement |
|-------|------|-------------|----------------------|
| **C-FIN** Financial | journal entries/lines, GL, invoices, credit/debit notes, receipts, payments, subledgers, stock valuation, tax summaries | Confidential | **Highest** — immutable once posted (INV-003); tamper = SEV-1 (RISK-009) |
| **C-PII** Personal | partner contacts (name, phone, email, address), tax registration numbers, national IDs (**only** where a jurisdiction pack requires them for e-invoicing), user account data (email, phone, hashed credentials, TOTP seeds) | Confidential, minimization applies | Standard |
| **C-KEY** Credentials & keys | argon2id hashes, session ids, device tokens, recovery codes, signing keys, tax certificates | **Highest confidentiality** | Highest — see [SECRETS_MANAGEMENT.md](SECRETS_MANAGEMENT.md) |
| **C-AUD** Audit trail | `audit_events` (actor, action, before/after JSONB, correlation id) | Confidential | Append-only, integrity-checked; retained beyond tenant purge (hashed identifiers, OQ-009) |
| **C-EXP** Exports & backups | tenant export packages, nightly dumps, report exports, e-invoicing payload archives | Confidential (bulk data) | Immutable (WORM backups); export integrity via audit events |
| **C-CONF** Configuration | tenant settings, entitlements, plans, feature flags, industry manifests | Internal | Standard (audited changes) |
| **C-PUB** Public | marketing site content, plan pricing pages | Public | — |

## 2. Handling rules per class and state

| State | C-FIN | C-PII | C-KEY | C-AUD | C-EXP | C-CONF |
|-------|-------|-------|-------|-------|-------|--------|
| **In transit** | TLS 1.2+ (HSTS on web origins); sync endpoints same | TLS 1.2+ | TLS 1.2+; never in URLs/headers logged | TLS 1.2+ | TLS 1.2+ + signed URLs | TLS 1.2+ |
| **At rest** | DB volume encryption (managed KMS) | DB volume encryption | Secret store + KMS; hashes only in DB; device keys in OS keychain | Same DB encryption; no UPDATE/DELETE grants | Backup bucket KMS + client-side AES-256 for dumps; WORM object-lock | DB encryption |
| **In logs** | **Never** payloads or money amounts — redaction allow-list ([../architecture/OBSERVABILITY.md](../architecture/OBSERVABILITY.md): pino serializer allow-lists fields; unknown objects serialize as keys only) | Never PII (no emails/phones/national IDs); user/tenant ids only | Never — gitleaks + secret-pattern scrubber tests in CI | Log the event id/type, never the before/after payload | Log export id + audit event reference only | Config keys, not values of secret-type settings |
| **In exports** | Included (that is their purpose) — export action audited, signed URL with expiry, rate-limited, DLP-lite size checks | Included; national IDs only when the pack's export format requires | **Never** | Audit trail export is itself audited (`audit.export`) | E-invoicing payload archives tenant-scoped + encrypted | Tenant export includes settings snapshot minus secrets |
| **In backups** | Encrypted dumps (all classes end-to-end in the same dump) | Same | Secrets are NOT in DB dumps (store is external); session/device token hashes are in dumps (acceptable — encrypted) | Included (integrity chain continues across restore) | Monthly archives per compliance window | Included |

**Log redaction allow-list reference** (enforced + tested): the serializer allow-list
permits: `ts, level, module, action, correlation_id, tenant_id, user_id, entity_type,
entity_id, error.code, duration_ms, counts`. Anything else in a structured log is dropped
or redacted; the CI test suite asserts that a deliberately PII-laden object logged by a
buggy module produces redacted output (fail-closed, OBSERVABILITY.md §redaction).

## 3. PII inventory (regional requirements)

| PII field | Where collected | Why | Notes |
|-----------|------------------|-----|-------|
| User email + phone | identity module | login, notifications, recovery | Required at registration; phone optional |
| Password hash (argon2id) | identity | authentication | Never exportable in tenant exports |
| TOTP seed + recovery codes | identity | MFA | Encrypted at rest; recovery codes hashed |
| Partner contact person, phone, email, address | partners module | trading documents, statements | Business necessity standard |
| Partner tax registration number (e.g., VAT number) | partners / tax | tax invoices, e-invoicing payloads | Required for B2B tax invoices per pack rules |
| **National ID / personal identity numbers** | partners (conditional) | **Collected ONLY where a jurisdiction pack's verified e-invoicing requirements demand it** ([../localization/E_INVOICING_ARCHITECTURE.md](../localization/E_INVOICING_ARCHITECTURE.md)) | Pack-controlled field gating; masked in UI except where printing requires; excluded from logs always; legal basis documented in pack compliance matrix |
| Device identifiers | sync/identity | device registration & revocation | Device id + attestation metadata only |
| IP addresses | request logs (transient) | security/abuse detection | Short hot retention (30d), then aggregated |

PII minimization rules: no free-form "notes" fields are indexed or exported unless the
tenant includes them; no PII in job payloads (ids only —
[../database/TENANT_ISOLATION.md](../database/TENANT_ISOLATION.md) §3); no PII in
webhook/query-string parameters (all in bodies/headers that are not logged).

## 4. Tenant offboarding: export → purge flow (FR-PLT-003)

| Step | Actor | Action | Rules |
|------|-------|--------|-------|
| 1 | Tenant owner | Request export via `tenancy.export.request` | Audited; identity-verified; rate-limited (1/week default) |
| 2 | System | Build export package: ZIP containing JSON (documents, ledger, subledgers, partners, items, settings) + attachments + CSV alternates for core lists | Full-fidelity financial data (posted journal entries with all lines) so books can be audited after leaving |
| 3 | System | Deliver via tenant-scoped signed URL | Expiry default 7 days; one regeneration allowed; download audited |
| 4 | Tenant owner | Confirm offboarding (`tenancy.offboarding.execute`) | Two-person: owner request + platform admin execution; subscription must be settled/cancelled first |
| 5 | System | Enter **retention placeholder: 90 days** (OQ-009) then hard purge | **Decision-record note:** the 90-day window is a provisional default; final period requires legal review per jurisdiction and a decision record before GA ([../ASSUMPTIONS_AND_OPEN_QUESTIONS.md](../ASSUMPTIONS_AND_OPEN_QUESTIONS.md) OQ-009). **Record filed:** [DR-024-02](../decisions/DR-024-02-privacy-retention-oq009.md) — BLOCKED-EXTERNAL (legal counsel unreachable from the delivery environment); the 90-day working assumption stays in force, and the constants ship as named placeholders (`OFFBOARDING_RETENTION_DAYS`, `OFFBOARDING_GRACE_DAYS`) in the purge service |
| 6 | System | Purge job: delete tenant rows (batched, per table), delete object-storage objects under the tenant prefix, revoke sessions/devices, cancel jobs | Purge is idempotent + resumable; runs with `erp_migrate`-scoped tooling outside normal app traffic |
| 7 | System | Purge verification: row-count catalog query asserts 0 tenant-owned rows; storage prefix listing asserts 0 objects; verification report stored | Verification is itself an audit event |
| 8 | System | Audit events: retained (append-only) with tenant identifiers **hashed** in the post-purge archive per OQ-009 direction | Keeps platform-forensic ability without retaining tenant business data |

Guardrails: offboarding cannot run while active legal hold is flagged on the tenant
(platform-level flag); purge of a suspended-for-investigation tenant requires security
sign-off ([INCIDENT_RESPONSE.md](INCIDENT_RESPONSE.md)).

## 5. Data retention table (provisional engineering defaults — legal review pending)

| Data class | Hot retention | Cold/archive | End-of-tenancy |
|------------|---------------|--------------|----------------|
| C-FIN (tenant data) | Tenant lifetime | Tenant lifetime | Export + 90-day window (OQ-009) → purge |
| C-AUD audit events | Tenant lifetime | Retained after purge, identifiers hashed (legal window TBD by counsel — placeholder 7 years) | Retained (hashed) |
| Operational logs | 30 days | 1 year cold (no PII by construction) | Not tenant-owned |
| Sessions / device tokens | Until expiry/revocation (12h/30min absolute/idle; device tokens until revocation) | — | Revoked at suspension/purge |
| Exports (signed URLs) | URL expiry 7 days | Package per tenant export retention | Deleted in purge |
| Backups | PITR 7d, nightly 35d, weekly 8w, monthly 12m ([../database/BACKUP_AND_RECOVERY.md](../database/BACKUP_AND_RECOVERY.md)) | Monthly archive per compliance window | Purged tenant's data ages out of all windows; monthly archives re-keyed per legal direction |
| E-invoicing payloads/responses | Per jurisdiction pack policy ([../localization/E_INVOICING_ARCHITECTURE.md](../localization/E_INVOICING_ARCHITECTURE.md) §6) | Same | Per pack policy (regulatory record) |

Retention-decision pointer: the 90-day end-of-tenancy window and the 14-day read-only
grace (Journey H1/H5) are the working-assumption placeholders governed by
[DR-024-02](../decisions/DR-024-02-privacy-retention-oq009.md) (BLOCKED-EXTERNAL —
legal review pending; the record must land or be re-read as BLOCKED at the GA gate);
AR+EN privacy-notice drafts for the same review live at
[../legal/PRIVACY_NOTICES.md](../legal/PRIVACY_NOTICES.md).

## 6. Device data (offline clients)

- Local SQLite store is **encrypted at rest** (SQLCipher / OS-level encryption) with keys
  held in the OS keychain — never in the DB file, never synced (ADR-0012).
- Devices cache only data the synced user is entitled to (permission snapshot refreshed at
  sync; expiry watermark default **7 days offline**, configurable —
  [../offline/SECURITY_AND_DEVICE_MANAGEMENT.md](../offline/SECURITY_AND_DEVICE_MANAGEMENT.md) §5).
- **Revocation** kills pull/push immediately at the server; the device's cached tenant
  data is remote-purged via the required-online watermark on next contact
  (`device.data_expired`), and support/tenant can force the purge.
- Lost-device posture in [THREAT_MODEL.md](THREAT_MODEL.md) S-08; security tests in
  [SECURITY_TEST_PLAN.md](SECURITY_TEST_PLAN.md) §offline.

## 7. Sub-processors

Every sub-processor touches data of the classes noted; each must contractually respect
this classification (DPA / security addendum) and is reviewed at onboarding + annually.

| Sub-processor role | Examples (decision at implementation) | Data classes touched | Constraints |
|--------------------|----------------------------------------|----------------------|-------------|
| Email delivery (SMTP provider) | transactional email service | C-PII (recipient address), notification content (no financial payloads beyond document links) | Notification templates must not include document totals in email bodies (link to authenticated app instead) |
| Object storage | primary cloud provider | C-EXP, C-FIN backups, attachments | Server-side + client-side encryption options per artifact; tenant-prefix isolation; WORM on backups |
| Error tracking | Sentry or equivalent | Request metadata, stack traces, `tenant_id` tag only | Scrubbing enforced (allow-list); no payloads; source maps private |
| Payment provider | per OQ-003 decision record | Subscription billing data (tenant business contacts) — **never tenant-of-tenant financial books** | Card data never touches platform servers (provider-hosted checkout); webhook signatures verified |
| Tax authority systems (ZATCA/ETA) | government gateways | E-invoicing payloads (required by law) | Per jurisdiction pack + [../localization/E_INVOICING_ARCHITECTURE.md](../localization/E_INVOICING_ARCHITECTURE.md) |
| Hosting/DB (primary cloud) | managed PostgreSQL, compute | All classes | KMS encryption; region pinning per A-012 |

Adding a sub-processor requires a decision record + data-class review; the list is
published to tenants (transparency requirement, content pending legal review).

## 8. Privacy notices & user rights (pointer — not legal content)

- The platform MUST present privacy notices (registration, onboarding, portal) and
  handle data-subject requests (access/export/deletion) — **content and per-jurisdiction
  wording are owned by legal counsel**, not this blueprint. Engineering obligations: the
  export flow (§4) exists as the access/export mechanism; deletion requests route through
  support with audit.
- Placeholder task in PHASE-024 (security hardening & compliance review): draft notices
  with counsel per launch market; do not fabricate regulatory claims
  ([../planning/MASTER_ROADMAP.md](../planning/MASTER_ROADMAP.md) PHASE-024).

## 9. Maintenance protocol

1. New data category: classify in §1 before the first migration that stores it (phase
   checklist item).
2. New jurisdiction pack: review §3 PII inventory (national-ID gating) with the pack's
   compliance matrix.
3. Retention changes: decision record only — engineering defaults are not self-serve.
4. Every handling rule above that says "tested" links into
   [SECURITY_TEST_PLAN.md](SECURITY_TEST_PLAN.md); untested rules are tracked as gaps.
