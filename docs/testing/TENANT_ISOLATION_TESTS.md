# Tenant Isolation Tests

> **Status:** STABLE · **Owner:** Quality Engineering & Security Architecture · **Updated:** 2026-10-27

Operationalizes the attack matrix **A1–A11** defined in
[../database/TENANT_ISOLATION.md](../database/TENANT_ISOLATION.md) §5 as named, automated,
CI-blocking tests, plus the API-level, worker, file/export, and sync scenarios, and the
production monitoring assertion. Model background:
[../architecture/MULTI_TENANCY.md](../architecture/MULTI_TENANCY.md);
[ADR-0005](../architecture/ADR/ADR-0005-multi-tenancy.md) (3-layer model). This suite is
the release gate for RISK-010 — any failure blocks the build.

## 1. Fixtures and harness

- **Twin tenants**: `ACME` (tenant A) and `GLOBEX` (tenant B) with mirrored entity ids
  where possible (same partner name, sequential ids) plus deliberate cross-references
  (a GLOBEX invoice id known to ACME's test user).
- **Roles**: one active user per tenant (owner role), one platform_admin, one device per
  tenant (from PHASE-020).
- **Connections**: SQL-level tests connect as `erp_app` (RLS enforced, non-owner) exactly
  like production; a separate `superuser`-level setup handle seeds data and must NEVER be
  used by the code under test.
- GUC discipline: the unit-of-work wrapper sets `erp.tenant_id` (transaction-local);
  attack tests deliberately unset/spoof it.

## 2. The A1–A11 matrix as named tests

Each test runs against **every tenant-owned table** via a generated loop (§3), not just a
sample. Expected outcomes are exactly those in
[../database/TENANT_ISOLATION.md](../database/TENANT_ISOLATION.md) §5.

| ID | Test name | Given / When / Then (expected SQL/API outcome) |
|----|-----------|------------------------------------------------|
| A1 | `isolation/A1-no-guc-returns-zero-rows.spec` | Given both tenants have rows in table T; When connecting as `erp_app` and SELECT from T **without** setting `erp.tenant_id`; Then **0 rows** returned (policy compares against NULL → fail closed), no error, no side effects. |
| A2 | `isolation/A2-other-tenant-guc-returns-zero-rows.spec` | Given ACME rows exist; When connecting as `erp_app`, `set_config('erp.tenant_id', GLOBEX, true)`, SELECT from T; Then **0 rows** (ACME data invisible under GLOBEX context). |
| A3 | `isolation/A3-insert-mismatched-tenant-id.spec` | Given GUC = ACME; When INSERT into T with `tenant_id = GLOBEX` in VALUES; Then **policy violation error** (WITH CHECK rejects); zero rows written in either tenant. |
| A4 | `isolation/A4-update-other-tenant-row.spec` | Given a GLOBEX row with known id; When UPDATE that id by primary key with GUC = ACME; Then **0 rows affected** (USING filters it out) — and assert the GLOBEX row is byte-identical after. |
| A5 | `isolation/A5-delete-other-tenant-row.spec` | Given the same; When DELETE by id with GUC = ACME; Then **0 rows affected**; GLOBEX row survives. |
| A6 | `isolation/A6-api-tenant-id-override-ignored.spec` | Given an authenticated ACME session; When POST/PUT with `tenant_id: GLOBEX` (and `tenantId`, and nested variants) in the body on every tenant-scoped route; Then the value is **ignored** for scoping (creates/reads happen in ACME) or **400** when it mismatches the session tenant on echo-validation routes; never scoped to GLOBEX. |
| A7 | `isolation/A7-cross-tenant-enumeration-404.spec` | Given a GLOBEX entity id (invoice, partner, journal, report run, export, device…); When ACME user requests GET/PATCH/DELETE on every route accepting an id; Then **404** (not 403, not 200) — no existence leak; response body identical to a random nonexistent id (timing-insensitive check). |
| A8 | `isolation/A8-join-to-global-table-safe.spec` | Given tenant tables JOIN global reference tables (`currencies`, `tax_codes` global parts); When constructing every documented join with attacker-chosen keys; Then **impossible by construction** — asserts composite FKs `(id, tenant_id)` exist on child tables and no view/foreign key leaks cross-tenant parents; verified via catalog assertions + query tests. |
| A9 | `isolation/A9-worker-missing-context.spec` | Given a queued job payload (ids only); When the handler executes **without** re-establishing tenant GUC (simulated via a fault-injection flag); Then the job **fails hard** (`MissingTenantContextError`), zero partial writes, job lands in dead-letter with typed error; never silently processes 0 rows as "success". |
| A10 | `isolation/A10-direct-sql-without-guc.spec` | Given a developer mistake simulated: raw SQL via app connection pool with no context (repository contract negative test — call a repository method with context cleared); Then **0 rows / fail closed** (throw), never full-table scan of all tenants. |
| A11 | `isolation/A11-signed-url-tenant-scope.spec` | Given tenant A requests a signed URL for its object/export; When tenant B's session (or A's URL against B's object key) attempts fetch; Then **403/404** — keys are tenant-prefix-bound (`tenants/{id}/...`), issuance checks session tenant, expiry enforced; revoked/expired URLs rejected. |

**Additional structural assertions** (run with the suite): every `tenant_id`-bearing table
has RLS **enabled + FORCED**, policy with both `USING` and `WITH CHECK`, and composite
tenant FK from children — via `pg_policies`/`pg_tables` catalog queries
([../database/MIGRATION_STRATEGY.md](../database/MIGRATION_STRATEGY.md) §2 (c)).

## 3. Per-phase expansion rule (enforced, not aspirational)

1. **Checklist**: every new tenant-owned table appears in the phase's completion report
   with a row confirming the A1–A11 generated suite ran against it.
2. **CI catalog query**: a test queries the catalog for all tables with a `tenant_id`
   column and asserts each is in the suite's table registry — adding a tenant-owned table
   without registering it (and therefore without its tests) **fails CI**. The registry is
   code (`isolation/tables.registry.ts`), reviewed like schema changes.
3. **Per-module API spoof scenarios** are added per phase exactly as listed in
   [../security/SECURITY_TEST_PLAN.md](../security/SECURITY_TEST_PLAN.md) §2 (table by
   phase); each new route class inherits A6/A7 automatically through the generated route
   sweep.

## 4. API-level spoofing scenarios (beyond A6/A7)

| # | Scenario | Expected |
|---|----------|----------|
| S-01 | Membership switch: user of both tenants sends the *other* tenant's membership cookie/header | server verifies membership ownership → allowed switch (it is their own membership) with fresh context; switching to a **non-member** tenant reference → 404, no info |
| S-02 | Session of suspended tenant calls any tenant route | 401/403 with `tenant_suspended`; device push rejected ([../architecture/MULTI_TENANCY.md](../architecture/MULTI_TENANCY.md) §3 rule 6) |
| S-03 | Forged `X-Tenant-Id`-style header on every route | ignored entirely (context from session only) — asserted by generated sweep |
| S-04 | Cross-tenant reference in nested payloads (line.partnerId, warehouseId, taxCodeId from tenant B) | validation fails with 404-class error on the nested id; zero partial document creation |
| S-05 | Pagination/filter probes (sort by id ranges scanning other tenants' id space) | only own-tenant rows possible; foreign ids → 404/empty, never data |
| S-06 | Report/export with foreign branch/partner filter ids | empty result or 404 — never foreign rows ([../security/SECURITY_TEST_PLAN.md](../security/SECURITY_TEST_PLAN.md) §9) |
| S-07 | Platform-admin routes: tenant-scoped per operation, `PlatformScope` marked, audited | without `platform.*` permission → 403; with it → audit event with `via_platform_admin`; cross-tenant reads outside `PlatformScope` impossible |

## 5. Worker/job context tests

- **A9 core**: handlers without context fail hard (no partial writes).
- Per-tenant iteration: a batch job processing tenants A and B asserts the GUC changes
  between iterations and a fault injected mid-batch leaves tenant A's completed work
  committed and B's untouched (no global context bleed —
  [../architecture/MULTI_TENANCY.md](../architecture/MULTI_TENANCY.md) rule 4).
- Queue payload discipline: assert payloads contain ids only (no tenant data beyond ids)
  via a payload-shape lint test (ADR-0008 rules).
- Retry path: a retried job re-establishes context from its payload, not from ambient
  state (spawn a retry from a "dirty" ambient context and assert correctness).

## 6. File/export signed-URL scope tests (A11 detail)

| # | Scenario | Expected |
|---|----------|----------|
| F-01 | URL issued for tenant A object, fetched with tenant B session token where applicable | rejected |
| F-02 | URL after expiry (clock advanced in test) | rejected |
| F-03 | Object key tampering (swap tenant prefix in URL) | signature invalid → rejected |
| F-04 | Upload direct to foreign tenant prefix via storage API (if exposed) | impossible — uploads only via issuer endpoint that binds tenant |
| F-05 | Export run of tenant A; download attempt by B user with A's URL | audited denial; no object access |
| F-06 | E-invoicing payload archives (tenant-scoped, PHASE-023) | same prefix rules; adapter jobs fetch only within their tenant context |

## 7. Sync push cross-tenant tests (PHASE-020+)

| # | Scenario | Expected |
|---|----------|----------|
| Y-01 | Device of tenant A pushes commands referencing tenant B entity ids (partner, item, invoice) | per-item `REJECTED` (`VALIDATION_ERROR` class per the sync reason registry, [../offline/SYNC_PROTOCOL.md](../offline/SYNC_PROTOCOL.md) §3.4) with **no existence disclosure** in details; zero effects; no batch abort leakage of B data in error messages |
| Y-02 | Device token of tenant A used against tenant B's sync endpoint scope | token is device+tenant bound → rejected `DEVICE_REVOKED`/`FORBIDDEN` class |
| Y-03 | Revoked device push (same tenant) | rejected, no effects, `sync.push.rejected` event |
| Y-04 | Tenant suspended mid-sync-session | pull returns `tenant_suspended`; push rejected; no partial cursor corruption |

Full chaos matrix: [SYNC_TESTS.md](SYNC_TESTS.md).

## 8. Monitoring assertions (production, not just CI)

- **RLS denial counter must stay 0**: metric `erp_rls_denials_total`
  ([../architecture/OBSERVABILITY.md](../architecture/OBSERVABILITY.md) business SLO set).
  - CI/test: a synthetic canary runs known-bad patterns in every environment; asserts 0
    rows and that the counter increments by the canary's own denials (proving the metric
    works).
  - Production: **alert on > 0** (excluding the canary's labeled traffic) — page per
    [../security/INCIDENT_RESPONSE.md](../security/INCIDENT_RESPONSE.md) §1 auto-SEV-1
    triggers; RISK-010: investigate immediately.
- 404-on-foreign-id rate: dashboards track cross-tenant id probes (A7 patterns) per
  session; spike = enumeration attempt → security review.
- Weekly canary: run the full A1–A11 suite against staging with production-shaped data
  volumes (RLS plans verified — [../database/TENANT_ISOLATION.md](../database/TENANT_ISOLATION.md)
  §6) to catch plan regressions that unit-scale data hides.

## 9. Maintenance protocol

1. New tenant-owned table ⇒ registry row + generated suite run (§3) — CI-enforced.
2. New route class ⇒ A6/A7 sweep inclusion automatic via route registry; new nested-id
   shapes extend S-04.
3. Any production RLS denial ⇒ SEV-1 postmortem adds a regression named after the
   incident ticket ([REGRESSION_STRATEGY.md](REGRESSION_STRATEGY.md) §5).
4. Catalog assertions updated with any RLS policy change (e.g., `platform_scope` GUC
   additions on `tenants` — tested with its own mini-matrix mirroring A1–A5).
