# ADR-0004 — PostgreSQL 16+ with Drizzle ORM

> **Status:** ACCEPTED · **Date:** 2026-10-27 · **Supersedes:** none

## Context

The data model is relational-first (directive §8): explicit tables for financial and
operational entities; strong constraints; Row-Level Security for tenant isolation;
NUMERIC money; complex reporting SQL. The ORM must give SQL-level control, safe
migrations, and first-class TypeScript types. PostgreSQL is mandated by the directive as
the primary database.

## Decision

**PostgreSQL 16+** is the system of record. **Drizzle ORM + drizzle-kit** manage schema,
types, and migrations.

Rationale for Drizzle over alternatives:

| Option | Assessment |
|--------|-----------|
| **Drizzle** (chosen) | Schema-as-TypeScript with exact column types (NUMERIC→string, safe); SQL-like query API; migrations are plain SQL files (reviewable, tweakable for RLS/constraints/triggers); no runtime query engine; excellent Postgres feature coverage (RLS via `sql` templates, partial indexes, check constraints). |
| Prisma | Polished DX, but schema language abstracts away some Postgres specifics; migration SQL is generated opaquely; historical friction with advanced SQL (window functions, RLS policies, `SET LOCAL`) pushes logic into raw escapes anyway; extra engine binary. |
| Kysely | Great typed query builder, but no schema definition/migration story — would need to be paired with another tool. |
| TypeORM | Decorator complexity, maintenance-mode reputation, subtle footguns in relations/persistence — too risky for financial data. |
| Raw `pg` + hand SQL | Maximum control but loses type safety and drifts from code; Drizzle keeps an escape hatch to raw SQL where needed. |

Normative usage rules:

1. Money columns: `numeric(19,4)`; quantities `numeric(19,6)`; FX rates `numeric(19,8)`
   ([ADR-0009](ADR-0009-money-precision.md)). Drizzle returns NUMERIC as strings — the
   decimal layer in `domain-core` is mandatory.
2. Every tenant-owned table carries `tenant_id uuid not null` and RLS policies
   ([ADR-0005](ADR-0005-multi-tenancy.md)). RLS SQL lives in migrations (plain SQL files).
3. Migrations are sequential, forward-only in normal operation; each is wrapped in a
   transaction; constraints are named; expand-contract pattern for zero-downtime changes
   ([../../database/MIGRATION_STRATEGY.md](../../database/MIGRATION_STRATEGY.md)).
4. The app connects as a **non-owner role** (`erp_app`) so RLS applies; the migration role
   (`erp_migrate`) owns objects and is used only by migrations.
5. `jsonb` is allowed for genuinely schema-flexible payloads (e.g., report parameters,
   integration payloads) but NEVER for core financial fields (amounts, accounts, statuses).
6. Database extensions allowed: `pgcrypto` (gen_random_uuid pre-16 need / crypto),
   `pg_trgm` (search); anything else requires an ADR note. UUIDv7 generated in
   application code ([ADR-0006](ADR-0006-identifiers.md)).

## Consequences

- Full SQL power for reporting (window functions, CTEs) with compile-time types.
- Team must read SQL migrations; no ORM magic migrations — a feature for financial audits.
- Drizzle is younger than Prisma: pin versions; CI runs migration tests on real Postgres
  via Testcontainers.

## Revisit triggers

- If Drizzle blocks a needed Postgres capability, fall back to hand-written SQL in
  repositories (allowed today) — ORM replacement is not anticipated.
- Read-replicas for reporting load: supported by Postgres natively; revisit when report
  traffic justifies it.
