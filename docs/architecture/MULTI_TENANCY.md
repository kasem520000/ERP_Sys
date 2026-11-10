# Multi-Tenancy Architecture

> **Status:** STABLE · **Owner:** Platform Architecture · **Updated:** 2026-10-27

How tenant context is established, validated, propagated — and how isolation is proven.
Storage-level detail: [../database/TENANT_ISOLATION.md](../database/TENANT_ISOLATION.md);
attack-test detail: [../testing/TENANT_ISOLATION_TESTS.md](../testing/TENANT_ISOLATION_TESTS.md).

## 1. Concepts

| Concept | Definition |
|---------|-----------|
| Tenant | One customer organization (row in `tenants`) |
| Membership | A user's role-bearing link to a tenant (`memberships`) |
| Tenant context | `{ tenantId, branchScope?, permissions }` derived from the authenticated principal |
| Platform context | Operators acting on tenants via the admin console — still tenant-scoped per operation, flagged `via_platform_admin` in audit events |

## 2. Context lifecycle (per request — normative)

1. **Establish**: authentication middleware resolves session/device token → principal
   (user id). For tenant routes, the active **membership** (user's selected tenant) is
   resolved from a signed cookie/header reference that the server issued — a client
   cannot name an arbitrary tenant; it can only switch between its own memberships
   (verified server-side).
2. **Validate**: membership must be ACTIVE; tenant must be ACTIVE (not suspended);
   entitlement checks occur at module load (feature key) and per action (permission).
3. **Propagate**: context stored in `AsyncLocalStorage`; repositories read it implicitly;
   the unit-of-work wrapper executes `SET LOCAL erp.tenant_id = $1` immediately after
   `BEGIN` on every pooled connection used by the transaction.
4. **Enforce**: RLS policies compare `tenant_id` with `current_setting('erp.tenant_id')`;
   any mismatch or missing setting yields zero rows (SELECT) or rejection (mutation).
5. **Clear**: context object is never cached across requests; transaction-scoped GUCs
   expire with the transaction (`SET LOCAL`).

## 3. Rules (normative)

1. Tenant id in a request body is **ignored** for scoping purposes (may be echoed for
   idempotency/validation mismatches).
2. No repository method may execute without a context (throws `MissingTenantContextError`).
3. Cross-tenant queries exist ONLY inside platform-admin services with explicit
   `PlatformScope` marking + separate permission + audit event per use.
4. Background jobs re-establish context per tenant iteration; a job never holds a
   "global" context.
5. Files, exports, reports, caches, and webhooks are tenant-scoped at creation time
   (paths/keys include tenant id; signed URLs are bound to the issuer's tenant).
6. A suspended tenant: sessions invalidated, device pushes rejected, sync pulls return
   `tenant_suspended`, admin console access only.

## 4. Defense in depth summary

| Layer | Guarantee | Test |
|-------|-----------|------|
| Authorization (permissions) | User may only perform permitted actions | Permission matrix tests per route |
| Scoped queries (repositories) | Query filtered by tenant by construction | Repository contract tests |
| RLS (Postgres) | Even buggy/escaped SQL cannot cross tenants | SQL-level attack tests (connect as app role with wrong/missing GUC) |
| Context middleware | Tenant context cannot be client-supplied | API-level spoof tests |
| Egress review | Exports/files/logs cannot leak tenant data | Redaction tests, log scrubber tests |

## 5. Noisy neighbors & fairness (MVP measures)

Per-tenant rate limits on API; per-tenant statement timeouts; report job concurrency
quotas; (post-MVP option) per-tenant connection pool partitions. Documented in
[OBSERVABILITY.md](OBSERVABILITY.md) and [DEPLOYMENT_ARCHITECTURE.md](DEPLOYMENT_ARCHITECTURE.md).

## 6. Future options (not commitments)

Dedicated deployments for regulated/large tenants (same code, separate database) —
supported by the architecture without code change; per-tenant PITR; tenant migration
tooling between environments. Each requires its own decision record before GA.
