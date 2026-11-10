# Migration Strategy

> **Status:** STABLE · **Owner:** Database Architecture · **Updated:** 2026-10-27

## 1. Framework and file layout

- Drizzle Kit generates SQL migrations; **all migrations are hand-reviewable `.sql`
  files** committed under `apps/api/migrations/`, named `NNNN_description.sql`
  ([DATABASE_CONVENTIONS.md](DATABASE_CONVENTIONS.md) §1).
- A `migrations.lock`-style manifest records order; migrations are strictly sequential.
- Seed/reference data ships as migrations (idempotent by natural keys) or versioned
  seed files applied post-migrate in CI/staging only ([SEEDS/README.md](SEEDS/README.md)).

## 2. Workflow

1. Developer changes Drizzle schema in module code.
2. `drizzle-kit generate` drafts SQL; developer edits for: named constraints, RLS
   policies, composite tenant FKs, partial indexes, triggers (the generator does not
   own these — conventions do).
3. CI migration tests (Testcontainers): (a) apply all on fresh PG from scratch;
   (b) apply on the previous released schema dump (regression); (c) assert every new
   tenant-owned table has RLS policy + tenant FK; (d) run invariant guard tests.
4. Staging rehearsal before every production deploy (release gate).

## 3. Zero-downtime rule: expand → migrate → contract

| Step | Allowed | Forbidden |
|------|---------|-----------|
| Expand | Add nullable columns, new tables, new indexes (`CREATE INDEX CONCURRENTLY`), new check constraints as `NOT VALID` then `VALIDATE` | Lock-heavy changes on hot tables |
| Migrate (code) | Dual-read/write code paths while both shapes exist; backfill jobs in batches | Big-bang rewrites |
| Contract | Drop old columns/indexes **only after** the previous release is fully rolled back-safe (one release of grace) | Dropping data still referenced |

Rules: never rename columns in-place (add + backfill + drop); never change a column
type destructively (new column + backfill + swap); never shrink a numeric precision
(add + backfill + swap). All destructive steps carry a `-- CONTRACT: requires release vX.Y` comment and are gated by a migration config check at deploy time.

## 4. Rollback policy

- Migrations are **forward-only** in production. A bad deploy is rolled back at the
  application level (previous image) because expand-phase changes are backward
  compatible with the previous code.
- Contract steps run only after two successful releases — making app-level rollback
  safe.
- True data rollback (PITR restore) is an incident-level decision with documented
  trade-offs ([../operations/DISASTER_RECOVERY.md](../operations/DISASTER_RECOVERY.md)).

## 5. Approval and review

Every migration PR includes: purpose, scope (tables/columns), locking risk assessment
(which locks on which tables at what size), backfill plan + batch size, contract steps
with timing, docs updates (entity catalog/TABLES). The
[code review template](../implementation/templates/CODE_REVIEW_TEMPLATE.md) §database
enforces this checklist.

## 6. Schema-docs synchronization (normative)

Same phase as the migration: update [ENTITY_CATALOG.md](ENTITY_CATALOG.md) +
[TABLES/](TABLES/) specs + affected [ERD/](ERD/) files, or the phase cannot be marked
COMPLETE (README sync rule; directive §8 "never mark schema documentation complete
without checking against the implemented structures").

## 7. Environments

| Env | Migration execution |
|-----|--------------------|
| CI | Fresh container per run + regression schema |
| Staging | Auto pre-deploy; rehearsal evidence stored |
| Production | Pre-deploy job (`erp_migrate`), gated; deploy aborts on failure; metrics + slow-migration log collected |
