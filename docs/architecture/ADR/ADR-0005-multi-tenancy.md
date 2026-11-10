# ADR-0005 — Shared-Schema Multi-Tenancy with Row-Level Security Defense-in-Depth

> **Status:** ACCEPTED · **Date:** 2026-10-27 · **Supersedes:** none

## Context

The Platform serves many small-to-large tenants from one deployment. Tenant isolation is a
security invariant (directive §7): a single leak of cross-tenant data is a product-ending
event. Options: database-per-tenant, schema-per-tenant, or shared schema with `tenant_id`
scoping. The platform must also support offline sync, analytics, and per-tenant
entitlements.

## Decision

**Shared schema, shared database** with `tenant_id` on every tenant-owned table, plus
**PostgreSQL Row-Level Security (RLS) as defense-in-depth**, plus mandatory authorization
tests. This is a three-layer model:

1. **Application layer (primary):** every query is executed through repositories that
   require a tenant context; tenant context is derived **from the authenticated session
   server-side, never from client input**; queries without a tenant context throw.
2. **Database layer (safety net):** RLS policies on every tenant-owned table filter by
   `current_setting('erp.tenant_id')::uuid`. The app connects as non-owner role `erp_app`
   with `FORCE ROW LEVEL SECURITY` semantics; the migration role cannot be used at
   runtime. `SET LOCAL erp.tenant_id = '<uuid>'` is executed **inside the transaction**
   so a pooled connection cannot leak context across requests.
3. **Test layer (proof):** CI runs a cross-tenant attack suite — attempts to read/update
   other tenants' rows via API, via direct repository misuse, and via raw SQL with a
   missing/spoofed context — and asserts zero leakage
   ([../../testing/TENANT_ISOLATION_TESTS.md](../../testing/TENANT_ISOLATION_TESTS.md)).

### Alternatives considered

| Alternative | Why not |
|-------------|---------|
| Database-per-tenant | Thousands of tenants × migrations/backup/monitoring per DB = operational explosion; cross-tenant platform features (admin console, billing) become hard. |
| Schema-per-tenant | Middle ground: connection-pool cache explosion, catalog bloat, migration time grows linearly; still not a security boundary against app bugs (same role sees all schemas). |
| Shared schema, no RLS | Single layer of defense; one forgotten `WHERE tenant_id` = breach. Rejected. |

### Consequences and required mitigations

- Noisy-neighbor risk: mitigated by per-tenant rate limits, statement timeouts, and
  (later) per-tenant connection/query quotas.
- Large-tenant performance: indexes are tenant-scoped `(tenant_id, ...)`; a tenant
  exceeding shared capacity becomes a candidate for a future dedicated deployment —
  the model permits extraction without code change.
- Backup/restore is platform-wide; per-tenant **data export** is a product feature
  (offboarding), not a substitute for tenant-level restores. Per-tenant point-in-time
  restore is out of scope until justified (revisit trigger below).
- Batch/platform jobs that must span tenants (billing, sync fan-out) run with explicit
  per-tenant transactions — never with RLS disabled.

### Revisit triggers

- A compliance/procurement requirement for physical isolation or data residency for a
  specific market segment → introduce dedicated deployments (same code, separate DB) for
  those tenants, not schema-per-tenant.
- Per-tenant PITR demands from enterprise plans → evaluate before GA.
