# DATABASE_ARCHITECTURE — Authoritative Database Principles

> **Status:** STABLE · **Owner:** Database Architecture · **Updated:** 2026-10-28 (consolidation pass)
> **Authority:** Consolidates the normative database rules; detailed references remain
> [database/DATABASE_CONVENTIONS.md](DATABASE_CONVENTIONS.md),
> [database/CONSTRAINTS_AND_INDEXES.md](CONSTRAINTS_AND_INDEXES.md),
> [database/RELATIONSHIPS.md](RELATIONSHIPS.md),
> [database/DATA_DICTIONARY.md](DATA_DICTIONARY.md),
> [database/MIGRATION_STRATEGY.md](MIGRATION_STRATEGY.md). On conflict, those detailed
> documents govern for their scope except where a consolidation correction (DEF-xxx) is recorded.

## 1. Platform rules (normative)

1. **PostgreSQL 16+ is the system of record** for money, documents, stock, jobs, audit —
   no financial data lives anywhere else authoritatively (ADR-0004).
2. **Keys:** UUIDv7 application-generated primary keys; every tenant-owned table carries
   `tenant_id` (not null) with `UNIQUE (id, tenant_id)` supporting **composite
   tenant-scoped foreign keys** on children — cross-tenant dangling references are
   structurally impossible even with RLS off ([RELATIONSHIPS.md](RELATIONSHIPS.md) §1).
3. **Tenant isolation:** `FORCE ROW LEVEL SECURITY` on all tenant tables; policies
   `USING`/`WITH CHECK` against a transaction-local GUC set via
   `set_config('erp.tenant_id', $1, true)` — fail-closed (missing/empty GUC → zero rows);
   role separation `erp_migrate` (never serves requests) / `erp_app` / `erp_readonly`
   ([TENANT_ISOLATION.md](TENANT_ISOLATION.md) §1–2; tests: A1–A11).
4. **Financial precision:** amounts `numeric(19,4)`, quantities `numeric(19,6)`, FX rates
   `numeric(19,8)`, percentages `numeric(7,4)`; floats forbidden for money; wire format
   is decimal strings with **per-type patterns** ([../api/API_CONVENTIONS.md](../api/API_CONVENTIONS.md) §7,
   DEF-001 correction).
5. **Business rules made structural:** the posting idempotency unique key
   `uq_journal_entries_tenant_source_op`, per-tenant code uniqueness, official document
   number uniqueness `(tenant_id, branch_id[, doc_type], number)`, fiscal-period
   non-overlap `EXCLUDE`, one-active-account-per-purpose partial index
   ([CONSTRAINTS_AND_INDEXES.md](CONSTRAINTS_AND_INDEXES.md) §1).
6. **Ledger immutability:** guard triggers reject UPDATE/DELETE on
   `journal_entries`, `journal_lines`, `stock_moves`, `audit_events` for the app role
   (INV-003); corrections are new linked reversal documents, never edits.
7. **Ledger balance as a DB-level property:** a **deferrable constraint trigger** asserts
   Σdebit = Σcredit per entry at transaction commit (DEF-010 — an immediate row trigger
   would abort valid multi-line postings; adopted from Folder 4). PHASE-007 ships it with
   a test that bypasses the posting engine and expects commit failure.
8. **Enums:** text + CHECK, registry in [DATA_DICTIONARY.md](DATA_DICTIONARY.md) §9 —
   the registry is the single source; any value added in a TABLES spec must be added to
   the registry in the same change (DEF-004 corrections applied:
   `VAT_PLANNED_EINVOICING`, submission status `FAILED`).
9. **Timestamps** `timestamptz` (UTC) for events, `date` for business dates; `jsonb` only
   for genuinely schemaless payloads (tax snapshots, manifests) — never for queryable
   business facts.
10. **Soft delete:** only on non-ledger operational rows, via status columns + partial
    unique indexes; ledger rows are never deleted.

## 2. Migration and change management

- **Expand → migrate → contract**; financial tables expand-only in practice (contract
  requires coordinated release, rarely worth it); every migration ships with its RLS
  policies; `NOT VALID` → `VALIDATE` and `CREATE INDEX CONCURRENTLY` procedures defined.
- Failed migration = abort and fix forward; rollbacks are the exception and require a
  decision record ([MIGRATION_STRATEGY.md](MIGRATION_STRATEGY.md)).
- Docs ↔ schema drift is release-blocking: the entity catalog, data dictionary, and TABLES
  specs must match the Drizzle schema; validation is scripted
  ([../scripts/validate_docs.py](../../scripts/validate_docs.py) checks doc-level integrity;
  schema-level checks land with PHASE-002 CI).
- Phase discipline: TABLES/ specs grow with their phase — implementing agents must
  extend the dictionary in the same PR that adds a table (anti-speculation rule stays,
  but the registry-completeness rule above is binding).

## 3. Backup, recovery, retention

Nightly encrypted (client-side AES-256) logical dumps with WORM object-lock + WAL PITR
(7 days) + **nightly automated restore-and-invariant-smoke** + quarterly cold DR drill;
per-tenant PITR is out of scope until a paying-customer requirement justifies it
([BACKUP_AND_RECOVERY.md](BACKUP_AND_RECOVERY.md), risk R-DR-1 in
[../planning/RISK_REGISTER.md](../planning/RISK_REGISTER.md)).
`journal_lines`/`stock_moves` partitioning/archival: post-GA, revisit when any tenant
exceeds ~10M lines ([DATABASE_CONVENTIONS.md](DATABASE_CONVENTIONS.md) §9; consolidated risk R-DB-2).

## 4. Performance budgets (documented, to be proven)

Posting p95 < 300 ms end-to-end on MVP sizing; TB < 2 s at 1M lines; report contract
freshness assertions. Targets are **acceptance criteria, not claims** —
[../testing/PERFORMANCE_TEST_PLAN.md](../testing/PERFORMANCE_TEST_PLAN.md) T-02 must pass
before GA (PHASE-025).

## 5. Consolidated defect corrections in database scope

| ID | Severity | Correction | Where |
|----|----------|------------|-------|
| DEF-001 | HIGH | Money wire-regex conflict resolved (per-type patterns; ADR-0009 corrected) | [../api/API_CONVENTIONS.md](../api/API_CONVENTIONS.md) §7, ADR-0009 |
| DEF-004 | MEDIUM | Enum registry gaps closed (`VAT_PLANNED_EINVOICING`, `FAILED`) | [DATA_DICTIONARY.md](DATA_DICTIONARY.md) §9 |
| DEF-010 | HIGH | Ledger balance trigger made **deferrable** (immediate firing breaks valid postings) | [CONSTRAINTS_AND_INDEXES.md](CONSTRAINTS_AND_INDEXES.md) §2 |
| DEF-005 | — | `journal_entries.entry_no` nullability **verified correct** (NULL while DRAFT; assigned at posting) — no change | [TABLES/core-accounting.md](TABLES/core-accounting.md) |
