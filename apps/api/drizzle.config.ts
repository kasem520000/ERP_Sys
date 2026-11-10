import { defineConfig } from "drizzle-kit";

/**
 * PHASE-002 drizzle-kit configuration (ADR-0004).
 *
 * - `schema`: typed table definitions consumed by `drizzle-kit generate` and the
 *   Drizzle query layer. RLS policies, roles, triggers, and helper functions are
 *   hand-written SQL in `migrations/*.sql` — the generator never owns those.
 * - `out`: sequential, hand-reviewable migration files `NNNN_description.sql`
 *   (DATABASE_CONVENTIONS §1) plus the order manifest `meta/_journal.json`
 *   (MIGRATION_STRATEGY §1 "migrations.lock-style manifest").
 * - Connection: the migration bootstrap role (superuser on a fresh stack, or
 *   `erp_migrate` in a provisioned environment). The app never uses this URL.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./migrations",
  url: process.env.MIGRATE_DATABASE_URL,
});
