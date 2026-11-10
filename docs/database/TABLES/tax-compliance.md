# Table Specifications — Tax & Compliance

> **Status:** STABLE · **Owner:** Database & Tax Architecture · **Updated:** 2026-11-05 · **Delivered:** PHASE-009 (migration `0013_tax.sql`) · operational registry + certificates + rollout PHASE-023 (migration `0035_external_integrations.sql`)

Column-level specifications for the tax/compliance tables **as delivered by
PHASE-009** (the jurisdiction-pack engine, the tenant codes/registrations,
the staged pack bindings, the INV-012 document-summary substrate, the VAT
returns, and the e-invoicing submission registry schema — real integrations
PHASE-023). Conventions:
[../DATABASE_CONVENTIONS.md](../DATABASE_CONVENTIONS.md); catalog entries:
[../ENTITY_CATALOG.md](../ENTITY_CATALOG.md) §tax & compliance; ERD:
[../ERD/treasury-tax.md](../ERD/treasury-tax.md).

**Doc-reality reconciliation (recorded in the PHASE-009 completion report):**
the pre-implementation plan below sketched `jurisdictions` keyed by
`country_code` text-PK with spread columns (`invoice_requirements`,
`e_invoicing_regime`, `effective_dates`, `source_refs`) and an
`e_invoicing_submissions` shape from the E_INVOICING pre-design. The
delivered schema: `jurisdictions` carries a uuid PK + `country_code`
UNIQUE with the full COUNTRY_PACKS §2 descriptor as one `descriptor` jsonb
(the authoring/interchange form verbatim); the treatments catalog ships as
its own `tax_treatments` seed table (return-box semantics live there, not
on rate rows); rate rows cover only the pack-rate treatments
(`STANDARD_RATED`/`ZERO_RATED`/`REVERSE_CHARGE`) — `EXEMPT`,
`OUT_OF_SCOPE` and `NOT_SUBJECT` compute no pack rate by engine semantics
(TAX_ENGINE §1) so they carry no rate rows; the submission registry ships
the lifecycle states of the PHASE-009 port (`PENDING → GENERATED →
SUBMITTED → ACCEPTED/REJECTED/FAILED`); and the phase additionally
delivered `tax_pack_bindings`, `tax_document_summaries` (INV-012's
document side — append-only) and `vat_returns` which the plan had not
sketched. The tables below document the DELIVERED shapes.

## `tax_treatments` (seed/reference — PHASE-009)

The six treatments, never conflated (TAX_ENGINE §1), with their distinct
return-box semantics.

| Column | Type | Null | Constraints | Description |
|--------|------|------|-------------|-------------|
| key | text | NO | PK; ck: `STANDARD_RATED \| ZERO_RATED \| EXEMPT \| OUT_OF_SCOPE \| REVERSE_CHARGE \| NOT_SUBJECT` | Treatment key |
| name / name_ar | text | NO | — | Bilingual labels |
| taxable | boolean | NO | — | Whether the treatment participates in VAT computation |
| output_tax_box | text | YES | ck: both boxes NULL or both NOT NULL | Return box (output side) |
| input_tax_box | text | YES | — | Return box (input side) |
| sort_order | integer | NO | — | Canonical ordering (deterministic summaries) |

## `jurisdictions` (seed/reference — PHASE-009)

Global reference data (ADR-0005 / TENANT_ISOLATION §3): **no tenant_id, no
RLS, read-only to `erp_app`** — pack updates ship as `erp_migrate` seed
migrations with changelog + verification records (SEEDS rule 2).

| Column | Type | Null | Constraints | Description |
|--------|------|------|-------------|-------------|
| id | uuid | NO | PK | |
| country_code | char(2) | NO | UNIQUE (ISO-3166 alpha-2) | Jurisdiction identity |
| country_name / country_name_ar | text | NO | — | Display names |
| currency_code | char(3) | NO | fk → `currencies` | Default currency |
| minor_units | integer | NO | ck: 0–4 | Currency decimals (ISO-4217) |
| vat_status | text | NO | ck: `VAT_IN_FORCE \| VAT_PLANNED \| NO_VAT` | Scheme applicability (the e-invoicing regime + statuses ride the descriptor) |
| pack_version | text | NO | — | e.g. `1.0.0-baseline` |
| descriptor | jsonb | NO | — | The COUNTRY_PACKS §2 pack JSON (formats, identifiers with null-until-verified formats, e_invoicing regime, regulatory notes) |
| verification_status | text | NO | default `REQUIRES_VERIFICATION`; ck with `verified_at` shape | Flips to VERIFIED only via the compliance-matrix per-fact protocol |
| source_ref | text | NO | — | Official source to verify against |
| verified_at | timestamptz | YES | — | NULL until the human protocol completes |
| is_active | boolean | NO | default true | Pack deactivation (never delete — history) |
| created_at | timestamptz | NO | default now() | |

## `jurisdiction_tax_rates` (seed/reference — PHASE-009)

Versioned, effective-dated rate rows (TAX_ENGINE §3): **a rate change = a
NEW row with `effective_from`, never an edit**; prior windows keep
`effective_to` so boundary fixtures pin (BH: 5% 2019→2021-12-31, 10% from
2022-01-01). Only the compliance-file-asserted standard rates are seeded;
`verified_at` ships NULL (REQUIRES_VERIFICATION provenance — directive
§1.12–1.13).

| Column | Type | Null | Constraints | Description |
|--------|------|------|-------------|-------------|
| id | uuid | NO | PK | |
| jurisdiction_id | uuid | NO | fk → `jurisdictions` (RESTRICT) | |
| treatment | text | NO | fk → `tax_treatments(key)`; ck: `STANDARD_RATED \| ZERO_RATED \| REVERSE_CHARGE` | Pack-rate treatments only (EXEMPT/OUT_OF_SCOPE/NOT_SUBJECT compute no pack rate) |
| rate | numeric(8,4) | NO | ck `rate ≥ 0` | Percentage (15.0000 = 15%) |
| effective_from | date | NO | uq(jurisdiction_id, treatment, effective_from) | Window start |
| effective_to | date | YES | ck `effective_to ≥ effective_from` | NULL = open-ended |
| source_ref | text | NO | — | Official source + fact citation |
| verified_at | timestamptz | YES | — | NULL until verified |
| created_at | timestamptz | NO | default now() | |

Index: `ix_jurisdiction_rates_lookup (jurisdiction_id, treatment, effective_from)` — the
resolver's rate-at-date lookup.

## `tax_codes` (tenant — PHASE-009)

| Column | Type | Null | Default | Constraints | Description |
|--------|------|------|---------|-------------|-------------|
| `id`, `tenant_id` **+standard** | — | — | — | `UNIQUE (id, tenant_id)` | RLS-scoped |
| code | text | NO | — | `uq_tax_codes_tenant_code (tenant_id, code)`; shape `^[A-Za-z0-9_-]{1,20}$` | User-facing code (tenant-unique) |
| name / name_ar | text | NO / YES | — | — | Bilingual label |
| country_code | char(2) | NO | — | fk → `jurisdictions` (RESTRICT); `uq_tax_codes_tenant_country_code` | Jurisdiction binding (resolution never crosses packs) |
| default_treatment | text | NO | — | ck: all six treatments | The resolver's input |
| snapshot_policy | text | NO | `STAMP_AT_POSTING` | ck: `STAMP_AT_POSTING \| STAMP_AT_DRAFT` | V1: posting stamps (data-carried for consumers) |
| status | text | NO | `ACTIVE` | ck: `ACTIVE \| ARCHIVED` | Archive is reference-guarded (service) |

Index: `ix_tax_codes_tenant_country_status (tenant_id, country_code, status)`.

## `tax_registrations` (tenant — PHASE-009)

Migrates the provisional PHASE-004 `tax.registration.*` settings
(expand-migrate-contract; the registration service owns the dual-read
window).

| Column | Type | Null | Constraints | Description |
|--------|------|------|-------------|-------------|
| `id`, `tenant_id` **+standard** | — | — | `UNIQUE (id, tenant_id)`; `uq (tenant_id, country_code)` | One row per jurisdiction per tenant |
| country_code | char(2) | NO | fk → `jurisdictions` (RESTRICT) | |
| status | text | NO | ck: `REGISTERED \| NOT_REGISTERED \| DEREGISTERED` | Drives resolution (not registered → NOT_SUBJECT) |
| registration_number | text | YES | ck shape: required (3–50 chars) while REGISTERED, NULL otherwise | As printed on invoices (format unasserted until verification) |
| effective_from / effective_to | date | NO / YES | ck window | Registration validity |
| deregistered_at | date | YES | ck: `(status = 'DEREGISTERED') = (deregistered_at IS NOT NULL)` | |
| note | text | YES | — | Transition notes (audited) |

## `tax_pack_bindings` (tenant — PHASE-009)

Staged pack-version pin per tenant (COUNTRY_PACKS §6.4: preview → apply,
audited; never retroactive — BR-033).

| Column | Type | Null | Constraints | Description |
|--------|------|------|-------------|-------------|
| `id`, `tenant_id` **+standard** | — | — | `UNIQUE (id, tenant_id)`; `uq (tenant_id, country_code)` | |
| country_code | char(2) | NO | fk → `jurisdictions` | |
| pack_version | text | NO | — | The pinned version (must be a seeded version) |
| applied_at / applied_by | timestamptz / uuid | NO / YES | default now() | The rollout audit trail (+ the `tax.pack_applied` audit event) |

## `tax_document_summaries` (tenant — PHASE-009, append-only 🔒)

INV-012's document side: per-document (direction, treatment, rate, tax
code) groups accumulated at posting inside the posting transaction. The
VAT return aggregates these; the RC-06/RC-07 checks reconcile them against
GL tax-account movements. **Append-only by grants (no UPDATE/DELETE for
`erp_app`) + the `erp.tax_summaries_guard()` trigger** — RC-07's seeded
drift is superuser tooling by construction.

| Column | Type | Null | Constraints | Description |
|--------|------|------|-------------|-------------|
| id | uuid | NO | PK | |
| tenant_id | uuid | NO | fk → tenants; RLS | |
| created_at | timestamptz | NO | default now() | |
| source_type | text | NO | shape `^[a-z][a-z0-9_]{2,39}$` | `expense` today; sales/purchase docs from their phases |
| source_id | uuid | NO | uq group key with (tenant_id, source_type, source_id, direction, treatment, rate, tax_code_id) | The posting document |
| document_date | date | NO | — | The resolution date (period aggregation) |
| fiscal_period_id | uuid | YES | — | Optional period convenience (date ranges drive queries) |
| country_code | char(2) | NO | fk → `jurisdictions` | |
| direction | text | NO | ck: `OUTPUT \| INPUT` | |
| treatment | text | NO | ck: all six | |
| rate | numeric(8,4) | NO | — | The snapshot's rate |
| tax_code_id | uuid | YES | composite fk → `tax_codes` (RESTRICT) | NULL for synthetic groups |
| taxable_base / tax_amount | numeric(19,4) | NO | — | Canonical 4-dp exact strings |
| snapshot | jsonb | NO | — | The frozen `tax.snapshot.v1` contract |

Indexes: `ix_tax_summaries_period (tenant_id, country_code, document_date, direction)`;
`ix_tax_summaries_source (tenant_id, source_type, source_id)`.

## `vat_returns` (tenant — PHASE-009)

| Column | Type | Null | Constraints | Description |
|--------|------|------|-------------|-------------|
| `id`, `tenant_id` **+standard** | — | — | `UNIQUE (id, tenant_id)`; `uq (tenant_id, country_code, period_start, period_end)` | One return per window |
| country_code | char(2) | NO | fk → `jurisdictions` | |
| period_start / period_end | date | NO / NO | ck `end ≥ start` | |
| status | text | NO | `DRAFT` | ck: `DRAFT \| READY \| FILED`; a failed re-prepare revokes READY → DRAFT (RC-07) |
| summary | jsonb | NO | — | The deterministic aggregation (byte-identical re-runs) |
| cross_check | jsonb | NO | — | The INV-012 side-by-side (documentSide vs glSide + ok) |
| cross_check_ok | boolean | NO | false | Gates READY and mark-filed |
| prepared_at / prepared_by | timestamptz / uuid | YES | ck: non-DRAFT ⇒ prepared_at NOT NULL | |
| filed_at / filed_by | filing… | YES | ck: `(status = 'FILED') = (filed_at IS NOT NULL AND filed_by IS NOT NULL)` | The human filing (audited; the platform reports) |
| filing_reference / filing_note | text | YES | ref length 1–80 | Filing metadata for audit |

## `e_invoicing_submissions` (tenant — schema PHASE-009, OPERATIONAL PHASE-023)

The PHASE-009 schema-only registry became OPERATIONAL with migration
`0035_external_integrations.sql` (E_INVOICING §2/§6): **one LIVE row per document ×
adapter** (registry idempotency — the no-double-clearance guarantee), the full
lifecycle ladder with `SIGNED`/`REPORTED` joining the enum, exponential-capped
retries with dead-letter alerting, and sealed payload/response artifacts. **Registry
status is the SOLE source of authority truth (directive §12)** — a document's
official validity never depends on local state. `REJECTED`/`FAILED` rows are
immutable history: resubmission appends a NEW row chained via
`retry_of_submission_id` (never an edit — TROUBLESHOOTING §10).

| Column | Type | Null | Constraints | Description |
|--------|------|------|-------------|-------------|
| `id`, `tenant_id` **+standard** | — | — | `UNIQUE (id, tenant_id)`; partial unique `uq_einvoicing_submissions_live (tenant_id, source_type, source_id, adapter_id) WHERE status IN ('PENDING','GENERATED','SIGNED','SUBMITTED','ACCEPTED','REPORTED')` | One LIVE registry row per document × adapter (0035 expand-contract: replaces 009's `uq_e_invoicing_submissions_source` — no legacy rows existed to backfill, the schema was test-only) |
| country_code | char(2) | NO | fk → `jurisdictions` | |
| adapter_id | text | NO | — | e.g. `zatca`, `fake-zatca`/`fake-eta` (test-only harnesses) |
| source_type / source_id | text / uuid | NO | shape as summaries | The submitting document |
| status | text | NO | `PENDING` | ck: `PENDING \| GENERATED \| SIGNED \| SUBMITTED \| ACCEPTED \| REJECTED \| REPORTED \| FAILED` (E_INVOICING §2 lifecycle — SIGNED only where the regime signs; unsigned regimes hop GENERATED → SUBMITTED; REJECTED is terminal for the row — reason codes surface for user action) |
| attempts | integer | NO | `0` | Retry counter (exponential backoff capped at 30 min; dead-letter at `RETRY_MAX_ATTEMPTS`) |
| next_attempt_at | timestamptz | YES | — | The retry sweep's due-time (live-retry states only) |
| authority_refs | jsonb | NO | `[]` | Authority-issued references (ICV/UUID-class ids stored as compliance payload fields — ADR-0006: never replacing platform identity) |
| payload_file_id / response_file_id | uuid | YES | → `file_objects` (`EINVOICE_PAYLOAD`/`EINVOICE_RESPONSE` owner types) | The SEALED artifacts (AES-256-GCM envelope via `EINVOICING_SECRET_KEY`/`EINVOICING_SECRET_KEY_ID`, tenant-scoped signed URLs on read; production fails closed without the key) |
| payload_digest | text | YES | — | Stable digest for idempotent rebuilds |
| authority_reference | text | YES | — | Primary authority id when accepted |
| submitted_at / reported_at / responded_at | timestamptz | YES | — | Lifecycle timestamps (`reported_at` = the reporting-mode acknowledgement) |
| last_error_code | text | YES | — | Typed last failure (feeds the DLQ alert) |
| error_detail | jsonb | YES | — | Typed rejection payload |
| retry_of_submission_id | uuid | YES | indexed (`ix_einvoicing_submissions_retry_of`); soft chain link — no FK | The row this resubmission supersedes (append-only history) |

Indexes: `ix_e_invoicing_tenant_status (tenant_id, country_code, status)` (009);
`uq_einvoicing_submissions_live` (0035, partial unique — above);
`ix_einvoicing_submissions_retry (status, next_attempt_at) WHERE status IN
('PENDING','GENERATED','SIGNED','SUBMITTED')` (0035 — the pg-boss retry sweep's
due-row scan); `ix_einvoicing_submissions_retry_of (tenant_id,
retry_of_submission_id)` (0035 — the chain walk).

Grants keep the 009 shape (SELECT/INSERT/UPDATE for `erp_app` — the registry owns
its rows; DELETE never: history is append-only).

## `e_invoicing_certificates` (tenant — PHASE-023, S-10 HIGHEST)

The e-invoicing certificate registry (SECRETS_MANAGEMENT §6): metadata +
lifecycle ONLY — the encrypted blob lives in the files store under
`einvoicing/{jurisdiction}/{tenant}/…` paths, and **no column here carries key
material by design**; the API surface never returns key bytes (signing-job-only
access — the §6 handling tests assert the read refusal). Enrollment/rotation are
approval-separated audited admin workflows; the expiry sweep alerts at 30/14/7
days with each fired threshold recorded on `expires_alerted_at` (fires exactly
once); offboarding purges the secret paths (DATA_PROTECTION §4 step 6 — the only
DELETE caller; revocation is a status).

| Column | Type | Null | Constraints | Description |
|--------|------|------|-------------|-------------|
| `id`, `tenant_id` **+standard** | — | — | `UNIQUE (id, tenant_id)` | composite-FK anchor for usage rows |
| country_code | char(2) | NO | fk → `jurisdictions` (RESTRICT) | |
| adapter_id | text | NO | — | The adapter the certificate serves |
| label | text | NO | ck length 1–120 | Human label |
| key_version | text | NO | — | Key-material version tag |
| secret_path | text | NO | `uq_e_invoicing_certificates_path`; ck shape `LIKE 'einvoicing/%'` | The secret-store PATH (the blob is external — S-10) |
| fingerprint | text | NO | — | Public-key fingerprint |
| not_before / not_after | timestamptz | NO / NO | ck `not_after > not_before` | Validity window (drives the expiry ladder) |
| status | text | NO | `ACTIVE` | ck: `ACTIVE \| EXPIRING_SOON \| EXPIRED \| REVOKED` | Lifecycle (expiry sweep flips it; REVOKED keeps history) |
| enrolled_by / enrolled_at | uuid / timestamptz | YES / NO | — | Approval-separated enrollment audit (`now()` default) |
| rotated_from_id | uuid | YES | composite self-FK → `e_invoicing_certificates` (SET NULL) | The rotation chain |
| sign_count | bigint | NO | `0` | Signing-volume counter (usage rows are the detail) |
| last_used_at | timestamptz | YES | — | |
| expires_alerted_at | jsonb | NO | `{}` | Which 30/14/7 thresholds already fired (once each) |

Index: `ix_einvoicing_certs_tenant (tenant_id, adapter_id, status)` — the expiry
sweep + tenant status queries. Grants: SELECT/INSERT/UPDATE/DELETE for `erp_app`
(DELETE exists solely for the offboarding purge — usage rows go first, the FK).

## `e_invoicing_certificate_usage` (tenant — PHASE-023, append-only 🔒)

One audited row per SIGN/DECRYPT operation (tenant, certificate, submission, key
version) — the signing-volume dashboard substrate. **INSERT + SELECT only** (no
UPDATE/DELETE grants — the audit trail cannot be rewritten); retention sweeps
bound growth. No `updated_at`/`version` — rows are immutable by shape.

| Column | Type | Null | Constraints | Description |
|--------|------|------|-------------|-------------|
| `id`, `tenant_id`, `created_at` | — | — | `UNIQUE (id, tenant_id)` | no `updated_at`/`version` — append-only |
| certificate_id | uuid | NO | composite FK → `e_invoicing_certificates` (RESTRICT) | The certificate used |
| submission_id | uuid | YES | soft link — no FK | The registry row the operation served (when applicable) |
| operation | text | NO | ck: `SIGN \| DECRYPT` | What the key material did |
| key_version | text | NO | — | The key version tag at use time |
| used_at | timestamptz | NO | `now()` | |

Index: `ix_einvoicing_cert_usage_cert (tenant_id, certificate_id, used_at)`.

## `e_invoicing_adapter_settings` (tenant — PHASE-023)

The per-tenant adapter rollout flag (T13, DEPLOYMENT §7): **default OFF for every
adapter in every jurisdiction**; enabling is a gated, audited action that requires
a provisioned ACTIVE certificate for the tenant's jurisdiction
(service-enforced — the gate test asserts the refusal); disabling is always
allowed (rollback = flag off). **Never the global `feature_flags` table** —
platform L8 vs tenant configuration; RLS-scoped.

| Column | Type | Null | Constraints | Description |
|--------|------|------|-------------|-------------|
| `id`, `tenant_id` **+standard** | — | — | `UNIQUE (id, tenant_id)`; `uq_einvoicing_adapter_settings (tenant_id, adapter_id)` | One rollout flag per adapter per tenant |
| country_code | char(2) | NO | fk → `jurisdictions` (RESTRICT) | The jurisdiction the enablement targets |
| enabled | boolean | NO | `false` | ck: `enabled = false OR (enabled_by IS NOT NULL AND enabled_at IS NOT NULL)` — an enabled adapter always carries its audited enabler |
| config | jsonb | NO | `{}` | Adapter-specific tenant configuration (policy blob, not a data channel) |
| enabled_by / enabled_at | uuid / timestamptz | YES / YES | — | The audited enablement |

Grants: SELECT/INSERT/UPDATE for `erp_app` (the toggle surface).

## Widening of existing tables (migration 0035)

- `file_objects.owner_type` — widened additively with `EINVOICE_PAYLOAD`,
  `EINVOICE_RESPONSE`, `EINVOICING_CERT` (the sealed submission artifacts + the
  certificate blob; the 0006/0012 widening pattern).
- `notifications.category` + `notification_prefs.category` — widened with
  `einvoicing` (the `einvoice.submission.failed` dead-letter inbox alert + the
  CertExpiry 30/14/7 escalation ladder; the 0023/0027 widening shape).
- `billing_events.type` — widened with `payment.refunded` (the refund flow's
  auditable trail — see [tenancy-identity.md](tenancy-identity.md) §billing_payouts).

## Widening of existing tables (this migration)

- `items.tax_code_id` — the PHASE-006 reserved NULLABLE column **gains its composite
  FK** → `tax_codes` (expand step, MIGRATION_STRATEGY §3).
- `item_categories.default_tax_code_id` — NEW nullable column + composite FK (the
  category-default resolution input, T5).
- `expenses.tax_code_id` — the PHASE-008 reserved column gains its composite FK
  (the G-11 VAT leg).
