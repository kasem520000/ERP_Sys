# Database Documentation — README

> **Status:** STABLE · **Owner:** Database Architecture · **Updated:** 2026-10-27

PostgreSQL 16+ is the system of record ([ADR-0004](../architecture/ADR/ADR-0004-postgresql-drizzle.md)).
This directory documents conventions, the entity catalog, per-domain table
specifications, ER diagrams, tenant isolation, migration strategy, and backup/recovery.

## Reading order

1. [DATABASE_CONVENTIONS.md](DATABASE_CONVENTIONS.md) — naming, types, keys, constraints, timestamps, soft delete, tenant scoping. **Every migration review starts here.**
2. [ENTITY_CATALOG.md](ENTITY_CATALOG.md) — all entities grouped by module, with phase of introduction, offline-creatability, and ownership.
3. [DATA_DICTIONARY.md](DATA_DICTIONARY.md) — shared semantic dictionary: standard columns, enums registry, money/quantity/status/direction semantics.
4. [TENANT_ISOLATION.md](TENANT_ISOLATION.md) — RLS policy patterns, roles, GUC context.
5. [MIGRATION_STRATEGY.md](MIGRATION_STRATEGY.md) — expand-contract, naming, testing, rollback policy.
6. [TABLES/](TABLES/) — column-level specifications of the core tables (grows per phase; the Drizzle schema files are the machine-readable mirror once implemented).
7. [RELATIONSHIPS.md](RELATIONSHIPS.md) — relationship catalogue rules: tenant-scoped FKs, cascades, reversal/provenance links, read models.
8. [CONSTRAINTS_AND_INDEXES.md](CONSTRAINTS_AND_INDEXES.md) — critical unique/check constraints and hot indexes, with purpose and the index-review checklist.
9. [ERD/](ERD/) — Mermaid ER diagrams per domain cluster.
10. [SEEDS/README.md](SEEDS/README.md) — reference data (currencies, countries, packs, CoA template, permissions).
11. [BACKUP_AND_RECOVERY.md](BACKUP_AND_RECOVERY.md) — storage-level strategy (runbook: operations).

## Synchronization rule (normative)

The **documentation must match the actual schema** at every completed phase: each
completion report includes a "database changes" section, updates ENTITY_CATALOG +
TABLES entries for new/changed tables, and re-generates affected ERD files from the
Drizzle schema. CI (from PHASE-002) runs a docs-schema consistency check that fails when
a tenant-owned table exists in migrations without a catalog entry. A schema doc marked
complete without this check is invalid (directive §8).
