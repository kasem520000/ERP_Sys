/**
 * PHASE-002 CI checkers (PHASE-002 §2.3/§2.9), fail-closed:
 *
 * 1. RLS presence: every table in `public` bearing a `tenant_id` column must
 *    have FORCE RLS + the `tenant_isolation` policy (USING and WITH CHECK)
 *    applicable to `erp_app` (TENANT_ISOLATION §2); the platform table
 *    `tenants` additionally allows its documented id-based variant.
 * 2. Catalog drift: every table in `public` must be documented in
 *    docs/database/ENTITY_CATALOG.md (README sync rule; MIGRATION_STRATEGY
 *    §6) — a migration creating an undocumented tenant-owned table fails
 *    the build.
 *
 * Consumers: the CI checker CLI (`scripts/check-rls.ts`), the local gate,
 * ci-db.yml, and the DB suite (negative proof: a probe table without the
 * policy is flagged, then passes after `erp.apply_tenant_policy()`).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { Client } from "pg";

/**
 * PHASE-002 CI checkers (PHASE-002 §2.3/§2.9), both fail-closed:
 *
 * 1. RLS presence: every table in `public` bearing a `tenant_id` column must
 *    have FORCE ROW LEVEL SECURITY + the `tenant_isolation` policy (USING and
 *    WITH CHECK) applicable to `erp_app` (TENANT_ISOLATION §2). The platform
 *    table `tenants` additionally allows its documented id-based variant.
 * 2. Catalog drift: every table in `public` must be documented in
 *    docs/database/ENTITY_CATALOG.md (README sync rule; MIGRATION_STRATEGY
 *    §6) — a migration creating an undocumented tenant-owned table fails
 *    the build.
 *
 * Runs after migrations in the ci-db workflow and from the local gate; the DB
 * suite additionally proves the checker itself: a probe table without the
 * policy is flagged (negative proof), then passes after
 * `erp.apply_tenant_policy()`.
 */

interface TableCheckRow {
  table_name: string;
  has_tenant_id: boolean;
  rls_enabled: boolean;
  rls_forced: boolean;
  /** concatenated USING expressions of the tenant_isolation policy (null: none) */
  policy_usings: string | null;
  /** concatenated WITH CHECK expressions (null: none) */
  policy_with_checks: string | null;
  /** true when the policy applies to erp_app */
  policy_applies_to_app: boolean | null;
  /** PHASE-024: true when the purge_path_delete policy applies to erp_migrate. */
  purge_delete_applies_to_migrate: boolean | null;
  /** PHASE-024: true when the purge_path_update policy applies to erp_migrate. */
  purge_update_applies_to_migrate: boolean | null;
}

export interface CheckResult {
  ok: boolean;
  violations: string[];
  catalogTables: string[];
}

const PLATFORM_TABLE = "tenants";

export async function runChecks(
  migrateUrl: string,
  entityCatalogPath: string,
): Promise<CheckResult> {
  const client = new Client({ connectionString: migrateUrl });
  await client.connect();

  const tables = await client.query<TableCheckRow>(`
    SELECT
      c.relname AS table_name,
      EXISTS (
        SELECT 1 FROM information_schema.columns col
        WHERE col.table_schema = 'public' AND col.table_name = c.relname
          AND col.column_name = 'tenant_id'
      ) AS has_tenant_id,
      c.relrowsecurity AS rls_enabled,
      c.relforcerowsecurity AS rls_forced,
      (
        SELECT string_agg(pol.qual, ' OR ') FROM pg_policies pol
        WHERE pol.schemaname = 'public' AND pol.tablename = c.relname
          AND pol.policyname = 'tenant_isolation'
      ) AS policy_usings,
      (
        SELECT string_agg(pol.with_check, ' OR ') FROM pg_policies pol
        WHERE pol.schemaname = 'public' AND pol.tablename = c.relname
          AND pol.policyname = 'tenant_isolation'
      ) AS policy_with_checks,
      (
        SELECT bool_or('erp_app' = ANY(pol.roles)) FROM pg_policies pol
        WHERE pol.schemaname = 'public' AND pol.tablename = c.relname
          AND pol.policyname = 'tenant_isolation'
      ) AS policy_applies_to_app,
      (
        SELECT bool_or('erp_migrate' = ANY(pol.roles)) FROM pg_policies pol
        WHERE pol.schemaname = 'public' AND pol.tablename = c.relname
          AND pol.policyname = 'purge_path_delete'
      ) AS purge_delete_applies_to_migrate,
      (
        SELECT bool_or('erp_migrate' = ANY(pol.roles)) FROM pg_policies pol
        WHERE pol.schemaname = 'public' AND pol.tablename = c.relname
          AND pol.policyname = 'purge_path_update'
      ) AS purge_update_applies_to_migrate
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
    ORDER BY c.relname
  `);

  const violations: string[] = [];
  for (const row of tables.rows) {
    if (row.has_tenant_id) {
      if (!row.rls_enabled || !row.rls_forced) {
        violations.push(
          `${row.table_name}: tenant_id present but RLS not ENABLE+FORCE (TENANT_ISOLATION §2)`,
        );
      }
      if (row.policy_usings === null || row.policy_with_checks === null) {
        violations.push(
          `${row.table_name}: missing tenant_isolation policy (USING and WITH CHECK both required)`,
        );
      } else {
        const usings = row.policy_usings ?? "";
        const checks = row.policy_with_checks ?? "";
        if (row.policy_applies_to_app !== true) {
          violations.push(`${row.table_name}: policy does not apply to erp_app`);
        }
        const expected =
          row.table_name === PLATFORM_TABLE
            ? /current_tenant_id\(\)|platform_scope_active\(\)/
            : /tenant_id = erp\.current_tenant_id\(\)/;
        if (!expected.test(usings) || !expected.test(checks)) {
          violations.push(
            `${row.table_name}: policy predicate must match the documented macro (${row.table_name === PLATFORM_TABLE ? "id/platform variant" : "tenant_id = erp.current_tenant_id()"}), got USING=${usings}`,
          );
        }
      }
      // PHASE-024 (migration 0036): the explicit purge path — every
      // tenant-owned table carries `purge_path_delete` + `purge_path_update`
      // for erp_migrate (command-scoped; NO insert policy by design) so the
      // offboarding purge can reach exactly the GUC-named tenant's rows on
      // the migration-scope connection (DATA_PROTECTION §4 step 6).
      // Drift-checking the policies here keeps a future table from silently
      // shipping without them.
      if (row.table_name === "tenants") {
        // The id-keyed platform table: update-only (the OFFBOARDED marking).
        if (row.purge_update_applies_to_migrate !== true) {
          violations.push(
            `${row.table_name}: missing purge_path_update policy for erp_migrate (PHASE-024 purge path — the id-scoped tenants variant)`,
          );
        }
      } else if (
        row.purge_delete_applies_to_migrate !== true ||
        row.purge_update_applies_to_migrate !== true
      ) {
        violations.push(
          `${row.table_name}: missing purge_path_delete/purge_path_update policies for erp_migrate (PHASE-024 purge path — DATA_PROTECTION §4 step 6)`,
        );
      }
    }
  }

  // Catalog drift (README sync rule): public tables must be documented.
  const catalog = readFileSync(entityCatalogPath, "utf8");
  const catalogTables = [...catalog.matchAll(/^\s*\|\s*`([a-z0-9_]+)`/gm)].map(
    (match) => match[1] as string,
  );
  const documented = new Set(catalogTables);
  for (const row of tables.rows) {
    if (!documented.has(row.table_name)) {
      violations.push(
        `${row.table_name}: present in the database but missing from ENTITY_CATALOG.md (schema-docs sync rule, MIGRATION_STRATEGY §6)`,
      );
    }
  }

  await client.end();
  return { ok: violations.length === 0, violations, catalogTables };
}


/** Resolve ENTITY_CATALOG.md from the package or the monorepo root. */
function resolveEntityCatalog(): string {
  const candidates = [
    join(process.cwd(), "docs", "database", "ENTITY_CATALOG.md"),
    join(process.cwd(), "..", "..", "docs", "database", "ENTITY_CATALOG.md"),
  ];
  for (const candidate of candidates) {
    try {
      readFileSync(candidate);
      return candidate;
    } catch {
      // try the next candidate
    }
  }
  throw new Error(`ENTITY_CATALOG.md not found from ${process.cwd()}`);
}

/** CLI entry (scripts/check-rls.ts): exit code 1 on any violation. */
export async function main(): Promise<void> {
  const url = process.env.MIGRATE_DATABASE_URL;
  if (url === undefined || url === "") {
    throw new Error(
      "MIGRATE_DATABASE_URL is required (migrate/bootstrap role connection)",
    );
  }
  const result = await runChecks(url, resolveEntityCatalog());
  for (const violation of result.violations) {
    console.error(`[check-rls] VIOLATION ${violation}`);
  }
  console.log(
    `[check-rls] ${result.ok ? "OK" : "FAILED"} — ${result.catalogTables.length} catalog tables`,
  );
  if (!result.ok) {
    process.exitCode = 1;
  }
}
