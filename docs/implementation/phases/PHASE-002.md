# PHASE-002 — Database & Migration Infrastructure

> **Status:** PLANNED · **Updated:** 2026-10-27

## 1. Phase Overview

- **Phase ID:** PHASE-002
- **Title:** Database & Migration Infrastructure
- **Objective:** Establish the PostgreSQL engineering substrate every business module
  will build on: Drizzle ORM + drizzle-kit migration workflow, the two-role security
  model (`erp_migrate` / `erp_app`), Row-Level-Security helper utilities and the
  tenant-context GUC pattern, the composite tenant-scoped FK macro, the append-only
  audit-event table with its guard triggers, pg-boss job infrastructure, the
  S3-compatible storage adapter with signed URLs, health/readiness endpoints, and
  Testcontainers-based migration tests in CI.
- **Business value:** tenant isolation and migration safety are the platform's two most
  expensive retrofits; doing them once, correctly, makes every later phase cheap and
  safe (RISK-010, RISK-012).

## 2. Scope

In scope:

1. Drizzle setup in `apps/api` with `numeric`→string typing verified; `drizzle.config`
   pointing at `migrations/` (`NNNN_description.sql` convention).
2. Bootstrap migration `0001_core_infra.sql`: roles (`erp_migrate`, `erp_app`,
   `erp_readonly`), `erp` schema helpers — `erp.current_tenant_id()` function
   ([TENANT_ISOLATION.md](../../database/TENANT_ISOLATION.md) §2) — and
   `audit_events` table (append-only + guard trigger + RLS) with its query interface
   (module `audit` skeleton).
3. RLS policy macro/SQL-template `apply_tenant_policy(table)` + CI test that every
   table having `tenant_id` carries the policy.
4. Composite tenant-scoped FK pattern documented in code + a tested example table
   (`_infra_probe` then removed — or kept as test fixture).
5. `tenants` table minimal (id, name, status — full profile in PHASE-003) because
   every RLS policy references it; tenant context unit-of-work (`SET LOCAL` inside
   transaction; context from AsyncLocalStorage) in `packages/domain-core`/api
   infrastructure.
6. pg-boss initialized on a `boss` schema; worker bootstrap (`WORKER_MODE`); test job
   category contract (payload, retry, idempotent handler rules).
7. `files` module skeleton: S3 adapter (MinIO dev) + signed URL issuance + upload
   constraints (size/type) — no attachments UI yet.
8. Health: `/health/ready` (DB round-trip + migration-state check + queue liveness).
9. CI: Testcontainers job — migrations on fresh PG; regression-apply on snapshot;
   RLS/attack tests A1–A5 from [TENANT_ISOLATION.md](../../database/TENANT_ISOLATION.md) §5
   against `audit_events`/`tenants`; docs-schema catalog drift check (fails if a
   migration creates a tenant-owned table without an ENTITY_CATALOG entry — seeded with
   the catalog's current content).
10. Observability wiring: pino logger with tenant/correlation fields + redaction
    serializer; request-id middleware; OpenTelemetry SDK no-op export.

Out of scope (explicit):

- Any business tables (users/roles come in PHASE-003).
- Tenant provisioning logic.
- Redis (ADR-0008 — deferred).
- Backup automation (ops doc exists; drill in later phases).

## 3. Prerequisites

- PHASE-001 COMPLETE (repo, CI, compose, lint gates) — verified via its completion
  report + green CI.
- ADRs: [ADR-0004](../../architecture/ADR/ADR-0004-postgresql-drizzle.md),
  [ADR-0005](../../architecture/ADR/ADR-0005-multi-tenancy.md),
  [ADR-0006](../../architecture/ADR/ADR-0006-identifiers.md) (UUIDv7 ids),
  [ADR-0008](../../architecture/ADR/ADR-0008-jobs-redis.md).
- Docs: [DATABASE_CONVENTIONS](../../database/DATABASE_CONVENTIONS.md),
  [TENANT_ISOLATION](../../database/TENANT_ISOLATION.md),
  [MIGRATION_STRATEGY](../../database/MIGRATION_STRATEGY.md),
  [OBSERVABILITY](../../architecture/OBSERVABILITY.md).

## 4. Design Impact

- **Database changes:** roles/functions, `audit_events`, minimal `tenants`,
  `boss` schema, `_infra` fixtures. Every item enters [ENTITY_CATALOG.md](../../database/ENTITY_CATALOG.md)
  in the same phase (sync rule).
- **API changes:** `/health/ready`; internal module services: `Audit.record()`,
  `Files.issueUploadUrl/getUrl()`, `Jobs.publish()`.
- **UI changes:** none (admin console comes later; no screens).
- **Security & authorization:** roles enforce RLS applicability; `audit_events` guard
  triggers (no UPDATE/DELETE) — attack tests A1–A10 against infrastructure tables.
- **Accounting implications:** none yet; the audit table is the substrate for INV
  auditability and future immutability triggers (journal guards in PHASE-007).
- **Localization implications:** none (logging only; no user strings).
- **Offline implications:** none (audit + files used by sync later).
- **Module dependencies:** `audit`, `files`, and jobs infrastructure used by all later
  modules; `tenancy` context primitive consumed by every repository.

## 5. Implementation Plan

### 5.1 Role bootstrap SQL (migration 0001, excerpt)

```sql
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'erp_migrate') THEN
    CREATE ROLE erp_migrate LOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'erp_app') THEN
    CREATE ROLE erp_app LOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'erp_readonly') THEN
    CREATE ROLE erp_readonly LOGIN;
  END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS erp;
GRANT USAGE ON SCHEMA erp TO erp_app;

CREATE OR REPLACE FUNCTION erp.current_tenant_id() RETURNS uuid
LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('erp.tenant_id', true), '')::uuid $$;

ALTER ROLE erp_app SET row_security = on;
```

### 5.2 Standard RLS policy macro (applied per tenant-owned table)

```sql
-- 0002_rls_macro.sql defines apply_tenant_policy(table_name text) which executes:
--   ALTER TABLE <t> ENABLE ROW LEVEL SECURITY;
--   ALTER TABLE <t> FORCE ROW LEVEL SECURITY;
--   CREATE POLICY tenant_isolation ON <t>
--     USING (tenant_id = erp.current_tenant_id())
--     WITH CHECK (tenant_id = erp.current_tenant_id());
-- CI check (scripts/check-rls.ts) queries pg_policies + information_schema.columns
-- and FAILS the build if any table with a tenant_id column lacks the policy.
```

### 5.3 Audit guard trigger (append-only enforcement, INV substrate)

```sql
CREATE OR REPLACE FUNCTION erp.audit_events_guard() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_events are append-only (INV-003 substrate): % prohibited', TG_OP;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_events_guard
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION erp.audit_events_guard();
```

### 5.4 Unit-of-work contract (TypeScript shape)

```ts
async function withTenant<T>(tenantId: UUID, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('erp.tenant_id', ${tenantId}, true)`);
    return fn(tx);   // every repository inside fn throws without context (ADR-0005)
  });
}
```

### 5.5 Task table

| # | Task | Expected files | Test hook |
|---|------|-----------------|-----------|
| T1 | Drizzle + config + migration conventions + `0001_core_infra.sql` | `apps/api/drizzle.config.ts`, `apps/api/migrations/0001_core_infra.sql` | migration applies clean |
| T2 | Unit-of-work tenant context (SET LOCAL + AsyncLocalStorage) | `apps/api/src/infra/db/*` | unit tests: missing-context throws; GUC transaction-local |
| T3 | `audit` module (record + query, append-only guards, RLS) | `apps/api/src/modules/audit/**` | attack tests A1–A5; update/delete rejected |
| T4 | RLS policy macro + catalog drift CI check | `apps/api/migrations/0002_rls_macro.sql`, `scripts/check-rls.ts` | CI green; probe table without policy fails |
| T5 | pg-boss init + worker mode + test job | `apps/api/src/infra/jobs/*` | job executes, retries, dead-letters per config |
| T6 | `files` skeleton: S3 adapter + signed URLs + constraints | `apps/api/src/modules/files/**` | adapter contract tests (MinIO testcontainer) |
| T7 | `/health/ready` + pino + OTel no-op wiring | `apps/api/src/infra/observability/*` | readiness test with/without DB |
| T8 | Testcontainers CI job (fresh + regression + RLS + drift) | `.github/workflows/ci-db.yml` | green |
| T9 | Docs updates (catalog entries for new tables) | `docs/database/**` | docs validation script green |

## 6. Verification

**Automated tests (required):** tenant-context unit tests; audit append-only attack
tests (A1–A10 applicable); pg-boss retry/idempotency tests; signed URL
expiry/permission tests; migration fresh-apply + regression-apply; RLS presence check;
statement timeout defaults verified.

**Manual verification:** `docker compose up` → health ready green; kill DB → readiness
fails; inspect `\d audit_events` → triggers + RLS + policies present; run one test job
through the worker.

**Acceptance criteria (objective):**

1. Migrations apply on fresh PG16 and on regression snapshot; CI proves both.
2. Connecting as `erp_app` without tenant GUC: SELECT on `audit_events`/`tenants` → 0
   rows; with wrong tenant GUC → 0 rows; insert with mismatched tenant_id → policy
   violation (test output recorded).
3. UPDATE/DELETE on `audit_events` as `erp_app` → rejected (INV guard proof).
4. A table created in a probe migration WITHOUT RLS policy fails the CI RLS check
   (negative proof).
5. Test job executes exactly once for duplicate enqueues (pg-boss dedupe contract).
6. `/health/ready` reflects DB + queue; readiness test covers failure mode.
7. Docs: ENTITY_CATALOG + TABLES + ERD updated; validation script green.

**Performance & security considerations:** pool sizing baseline (20 conns) documented;
statement timeouts set; no dynamic SQL in helpers; secrets via env only (gitleaks
green).

**Migration & rollback:** this phase IS migrations 0001–0002; rollback = revert
commits + drop schema (dev only). Forward-only thereafter per
[MIGRATION_STRATEGY.md](../../database/MIGRATION_STRATEGY.md).

## 7. Risks and Constraints

- RISK-010 materializing here would be catastrophic — hence attack tests are the core
  deliverable, not a garnish.
- RISK-012 (Drizzle friction) first contact: raw-SQL escape hatch permitted if a need
  arises; record usage in report.
- Constraint: `tenants` stays minimal; do not pre-build PHASE-003 fields.

## 8. Completion and Handoff

- **Completion evidence:** report with: attack-test output (each A1–A10 line), migration
  CI logs, readiness probe outputs, job dedupe proof, docs validation output.
- **Documentation updates required:** IMPLEMENTATION_STATUS, CURRENT_STATE, CHANGELOG,
  ENTITY_CATALOG + TABLES + ERD additions, DEVELOPMENT_SETUP (DB section).
- **Exit criteria:** all acceptance criteria green with evidence; next phase can create
  business tables on this substrate without touching infrastructure.
- **Definition of Done:** migrations + roles + RLS + audit + jobs + files + readiness +
  CI all in `main`, tests green, docs synchronized, zero TODOs.
- **Handoff instructions:** read PHASE-001 + PHASE-002 completion reports first; the
  infrastructure is now frozen — changes need decision records. **Next eligible phase:
  PHASE-003 — Identity, Multi-Tenancy & Audit Core** (identify only; do not implement).
