# Database Conventions

> **Status:** STABLE · **Owner:** Database Architecture · **Updated:** 2026-10-27

Mandatory conventions for every table, migration, and query. Reviews reject violations
(see [../implementation/templates/CODE_REVIEW_TEMPLATE.md](../implementation/templates/CODE_REVIEW_TEMPLATE.md)).

## 1. Naming

| Object | Convention | Example |
|--------|-----------|---------|
| Tables | `snake_case`, plural | `sales_invoices` |
| Columns | `snake_case` | `entry_date` |
| PK | `id` | `id uuid` |
| FK columns | `<referenced>_id` | `tenant_id`, `partner_id` |
| Boolean | `is_`/`has_` prefix | `is_postable` |
| Timestamps | `_at` suffix (timestamptz) | `posted_at` |
| Dates (calendar) | `_date` suffix (date) | `due_date` |
| Amounts | `_amount` / `_amt` avoided; semantic names with `numeric` | `net_amount` |
| Indexes | `ix_<table>_<cols>` | `ix_journal_lines_tenant_entry` |
| Unique constraints | `uq_<table>_<cols>` | `uq_accounts_tenant_code` |
| Checks | `ck_<table>_<rule>` | `ck_journal_lines_amount_positive` |
| FKs | `fk_<table>_<ref>` | `fk_invoices_tenant` |
| Migrations | `NNNN_short_name.sql` sequential | `0007_create_journal_entries.sql` |

## 2. Identity & keys

- PK: `id uuid NOT NULL` (UUIDv7 generated in app; ADR-0006). No bigserial anywhere in
  tenant-owned data.
- Official document numbers: separate `number`/`document_no` column + unique per scope
  (`uq_<doc>_tenant_branch_number`), assigned server-side at approval/posting.
- Natural/codes columns (e.g., account `code`, item `sku`) get tenant-scoped unique
  constraints, never PK status.

## 3. Tenant scoping (see [TENANT_ISOLATION.md](TENANT_ISOLATION.md))

- Every tenant-owned table: `tenant_id uuid NOT NULL REFERENCES tenants(id)`.
- First element of every hot index: `tenant_id` (composite indexes).
- RLS policy applied to every tenant-owned table (no exceptions, including "small"
  lookup tables).
- Global reference data (currencies, countries, pack rate tables, permissions catalog):
  NOT tenant-owned, no RLS, read-only to the app role.

## 4. Types & precision

| Data | Type |
|------|------|
| Money amounts | `numeric(19,4)` |
| Quantities | `numeric(19,6)` |
| FX rates | `numeric(19,8)` |
| Percentages | `numeric(7,4)` |
| Prices/unit costs | `numeric(19,6)` |
| Enum-ish statuses | `text` + `ck` check constraint + typed TS union (NOT Postgres enums — additive migrations only; see §7) |
| Bilingual names | `name text` (primary, EN or AR) + `name_ar text` — both nullable-safe, display picks per locale |
| JSONB payloads | `jsonb` for snapshot/config data only; never amounts/statuses/partners (queryable integrity stays relational) |
| Timestamps | `timestamptz` (UTC stored; display per tenant/user TZ) |
| Dates | `date` (tenant fiscal calendar semantics) |
| Soft-delete | `deleted_at timestamptz NULL` only where product needs recycle behavior; financial documents are NEVER soft-deleted (lifecycle states instead) |

## 5. Standard columns

```
id uuid pk
tenant_id uuid not null        -- tenant-owned tables only
created_at timestamptz not null default now()
updated_at timestamptz not null
created_by uuid                -- references users(id) via memberships; platform actions null
version int not null default 1 -- optimistic concurrency (If-Match)
```

- `updated_at` maintained by app (or trigger); `version` incremented on update — API
  enforces If-Match on mutating routes ([../api/API_CONVENTIONS.md](../api/API_CONVENTIONS.md)).

## 6. Foreign keys & integrity

- FKs ALWAYS declared with `ON DELETE RESTRICT` default (financial integrity); specific
  `ON DELETE CASCADE` only for owned child rows (journal lines, invoice lines) — and
  posted parents are never deleted anyway (lifecycle).
- Referenced rows must be tenant-scoped: composite FK where possible, plus a validation
  trigger for cross-scope safety (`fk_includes_tenant` pattern: child FK references
  parent `(id, tenant_id)` via unique index on parent).
- Check constraints for: positive amounts, non-negative quantities, valid status values,
  date order (start ≤ end), direction fields.

## 7. Enumerations policy

Status/treatment/type columns: `text` + CHECK + TypeScript union type in
`packages/contracts`. Adding a value = migration (check constraint swap) + code PR.
Rationale: Postgres native enums are painful to extend/remove in migrations; check
constraints are additive and self-documenting in `\d`.

## 8. Indexing rules

1. Every FK gets an index (Postgres does not auto-index FK columns).
2. Composite order: `(tenant_id, <most selective>, <sort order>)` matching real query
   patterns (e.g., `ix_sales_invoices_tenant_partner_date (tenant_id, partner_id,
   invoice_date desc)`).
3. Partial indexes for hot subsets: `WHERE status = 'POSTED'`, `WHERE deleted_at IS NULL`.
4. Unique constraints double as indexes — do not duplicate.
5. Trigram (`pg_trgm`) indexes for user-facing search fields (partner names, item names).
6. No index without a documented purpose in the TABLES/ spec or migration comment.

## 9. Data lifecycle

- Immutable financial rows: no UPDATE/DELETE grants for the app role on
  `journal_entries`, `journal_lines`, `stock_moves`, `audit_events` (trigger-enforced
  as belt-and-braces, INV-003).
- Tombstone tables for sync-visible deletions of offline-relevant entities
  (ADR-0012); soft-deleted reference rows (items, partners) sync as tombstones.
- Retention & archival: audit events retained (see
  [../security/DATA_PROTECTION.md](../security/DATA_PROTECTION.md)); job/queue tables
  pruned by maintenance jobs; per-tenant archival is post-GA.

## 10. Query rules

1. All queries through Drizzle repositories (raw `sql` allowed but reviewed); no
   string-concatenated SQL, ever.
2. Repository MUST run inside tenant context (throws without it — ADR-0005).
3. Reporting queries use module-owned read models / views; never ad-hoc cross-module
   joins in one feature's migration-land.
4. Statement timeout defaults set per role (app: 15s; report role: 120s).

## 11. Seeds

Reference data (currencies, countries, jurisdiction packs, CoA template, permission
catalog, plans) is versioned SQL/YAML under `seeds/` and applied by migrations
(deterministic, idempotent via natural keys). See [SEEDS/README.md](SEEDS/README.md).
