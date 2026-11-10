# Tenant Isolation (Database Level)

> **Status:** STABLE · **Owner:** Database & Security Architecture · **Updated:** 2026-10-27

Storage-level enforcement of multi-tenancy. Application-level model:
[../architecture/MULTI_TENANCY.md](../architecture/MULTI_TENANCY.md); attack tests:
[../testing/TENANT_ISOLATION_TESTS.md](../testing/TENANT_ISOLATION_TESTS.md).

## 1. Roles

| Role | Purpose | Privileges |
|------|---------|-----------|
| `erp_migrate` | Migration execution only | Owns objects; DDL; NOT used by the app at runtime |
| `erp_app` | API runtime | DML on app tables; **NOT** owner → RLS applies; NO superuser bypass |
| `erp_readonly` | Ops/diagnostics | SELECT with RLS enforced (empty without tenant GUC — intentionally) |
| `boss` schema | pg-boss queue | Owned by app role; queue tables excluded from RLS (no tenant data) |

`ALTER ROLE erp_app SET row_security = on;` and table-level `FORCE ROW LEVEL SECURITY`
so even the object owner (after restore drills etc.) stays behind policies.

## 2. Tenant context GUC

```sql
-- executed by the unit-of-work right after BEGIN:
SELECT set_config('erp.tenant_id', $1, true);  -- true = transaction-local
```

- Transaction-local (`set_config(..., true)`) — cannot leak across pooled connections.
- Missing GUC + tenant-owned table access ⇒ policy compares against NULL ⇒ **zero rows**
  (fail closed). A `NULLIF`-free strict cast helper is used to avoid casting errors
  masking logic:

```sql
CREATE OR REPLACE FUNCTION erp.current_tenant_id() RETURNS uuid
LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('erp.tenant_id', true), '')::uuid $$;

-- Standard policy applied to EVERY tenant-owned table:
ALTER TABLE sales_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_invoices FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sales_invoices
  USING (tenant_id = erp.current_tenant_id())
  WITH CHECK (tenant_id = erp.current_tenant_id());
```

- `USING` guards reads; `WITH CHECK` blocks cross-tenant writes/updates. Both required.
- A helper migration macro (PHASE-002) applies the standard policy to a table list, so
  adding tables is mechanical; CI test asserts every `tenant_id`-bearing table has the
  policy (catalog query `pg_policies`).

## 3. Scope discipline

1. Global reference tables (`currencies`, `jurisdictions`, `permissions`, …) have NO
   tenant_id and NO RLS — they are read-only for `erp_app` (GRANT SELECT only).
2. Platform-level tables (`tenants`, `plans`, `subscriptions`) are readable by the API
   only through the tenancy module's explicit services; RLS on `tenants` itself uses a
   separate `erp.platform_scope` GUC with its own grant path + audit.
3. Job/queue tables: no tenant data in payloads beyond ids; handlers re-establish tenant
   GUC per item (ADR-0008 rules).

## 4. Composite tenant-scoped foreign keys

Child tables validate parent scope by FK on `(id, tenant_id)`:

```sql
-- parent has: UNIQUE (id, tenant_id)
ALTER TABLE sales_invoice_lines
  ADD CONSTRAINT fk_invoice_tenant
  FOREIGN KEY (invoice_id, tenant_id) REFERENCES sales_invoices (id, tenant_id) ON DELETE CASCADE;
```

This makes cross-tenant dangling references structurally impossible, even with RLS off.

## 5. Attack test matrix (CI, mandatory per new table)

| # | Attack | Expected |
|---|--------|----------|
| A1 | SELECT with no GUC | 0 rows |
| A2 | SELECT with another tenant's GUC | 0 rows |
| A3 | INSERT with mismatched tenant_id in VALUES | policy violation error |
| A4 | UPDATE other tenant's row id with own GUC | 0 rows affected |
| A5 | DELETE other tenant's row | 0 rows affected |
| A6 | API request attempting tenant_id override in body | ignored / 400 on mismatch with session |
| A7 | API cross-tenant id enumeration (list/get/mutations) | 404 (not 403 — no existence leak) |
| A8 | JOIN from tenant table to global table leaking other tenants | impossible by construction; verified |
| A9 | Worker job executing with missing context | hard error, job fails, no partial writes |
| A10 | Direct SQL as `erp_app` without GUC (simulated developer mistake) | 0 rows / fail closed |

A11 (per new file/export path): signed URL of tenant A cannot fetch object of tenant B
(key prefix includes tenant id; issuance checks session tenant).

## 6. Performance notes

- RLS predicate adds a filter on `tenant_id = <const>` — matches the leading column of
  every hot index, so plans stay index-driven (verified in EXPLAIN tests in CI for the
  top-10 hot queries).
- `current_tenant_id()` is STABLE — fine for planner; per-statement evaluation only.
