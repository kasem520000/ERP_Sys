import { spawnSync } from "node:child_process";
import { beforeAll, describe, expect, it } from "vitest";

import { MIGRATIONS } from "../infra/db/migrations";
import { ensureTestDb, superuserClient } from "./test-db";
import { runChecks } from "../infra/db/check-rls";

/**
 * Migration-state proofs on real PG16 (PHASE-002 §6):
 * - fresh-apply is done by the suite bootstrap (embedded) or the CI runner;
 * - regression-apply shape: re-running drizzle-kit migrate is a no-op and
 *   `erp.schema_version()` stays consistent with the build manifest (the
 *   previous-released-snapshot regression starts with the first tagged
 *   phase release — recorded in the completion report);
 * - ownership/role/timeout defaults verified (TENANT_ISOLATION §1, §10.4);
 * - the RLS/catalog checker passes on the real schema and flags a probe
 *   table without the policy (negative proof, acceptance 4).
 */

function resolveEntityCatalog(): string {
  // apps/api cwd → monorepo root docs/
  return `${process.cwd()}/../../docs/database/ENTITY_CATALOG.md`;
}

beforeAll(() => {
  ensureTestDb();
});

describe("migration state", () => {
  it("erp.schema_version() equals the build manifest", async () => {
    const su = await superuserClient();
    const version = await su.query<{ v: string }>("SELECT erp.schema_version()::text AS v");
    expect(Number(version.rows[0]?.v)).toBe(MIGRATIONS.length);
    await su.end();
  });

  it("re-apply (regression shape) is a no-op: drizzle-kit migrate skips applied entries", () => {
    const state = ensureTestDb();
    const reapply = spawnSync("pnpm", ["exec", "drizzle-kit", "migrate"], {
      cwd: process.cwd(),
      env: { ...process.env, MIGRATE_DATABASE_URL: state.migrateUrl },
      encoding: "utf8",
      timeout: 120_000,
    });
    expect(reapply.status).toBe(0);
  });

  it("ownership model: erp_migrate owns objects; erp_app is NOT an owner (RLS applies)", async () => {
    const su = await superuserClient();
    const owners = await su.query<{ tablename: string; tableowner: string }>(
      `SELECT tablename, tableowner FROM pg_tables
        WHERE schemaname = 'public' AND tablename IN ('tenants','audit_events')
        ORDER BY tablename`,
    );
    expect(owners.rows.map((row) => [row.tablename, row.tableowner])).toEqual([
      ["audit_events", "erp_migrate"],
      ["tenants", "erp_migrate"],
    ]);
    const bossOwner = await su.query<{ v: string }>(
      `SELECT pg_get_userbyid(nspowner) AS v FROM pg_namespace WHERE nspname = 'boss'`,
    );
    expect(bossOwner.rows[0]?.v).toBe("erp_app");
    await su.end();
  });

  it("role defaults: erp_app row_security=on, statement_timeout=15s; readonly 120s", async () => {
    const su = await superuserClient();
    const appSettings = await su.query(
      `SELECT rolname, rolconfig FROM pg_roles WHERE rolname IN ('erp_app','erp_readonly') ORDER BY rolname`,
    );
    const configByRole = new Map(
      appSettings.rows.map((row) => [row.rolname, row.rolconfig as string[]]),
    );
    expect(configByRole.get("erp_app")).toEqual(
      expect.arrayContaining(["row_security=on", "statement_timeout=15s"]),
    );
    expect(configByRole.get("erp_readonly")).toEqual(
      expect.arrayContaining(["row_security=on", "statement_timeout=120s"]),
    );
    await su.end();
  });

  it("FORCE ROW LEVEL SECURITY is on for both infrastructure tables", async () => {
    const su = await superuserClient();
    const forced = await su.query(
      `SELECT relname FROM pg_class
        WHERE relname IN ('tenants','audit_events') AND relrowsecurity AND relforcerowsecurity
        ORDER BY relname`,
    );
    expect(forced.rows.map((row) => row.relname)).toEqual(["audit_events", "tenants"]);
    await su.end();
  });
});

describe("check-rls (RLS presence + catalog drift)", () => {
  it("passes on the real schema (acceptance 4 positive half)", async () => {
    const state = ensureTestDb();
    const result = await runChecks(state.migrateUrl, resolveEntityCatalog());
    expect(result.violations).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.catalogTables).toEqual(expect.arrayContaining(["tenants", "audit_events"]));
  });

  it("flags a probe table created WITHOUT the policy (negative proof)", async () => {
    const state = ensureTestDb();
    const su = await superuserClient();
    await su.query(`
      CREATE TABLE _rls_probe (
        id uuid PRIMARY KEY,
        tenant_id uuid NOT NULL REFERENCES tenants(id)
      )`);
    const flagged = await runChecks(state.migrateUrl, resolveEntityCatalog());
    expect(flagged.ok).toBe(false);
    expect(
      flagged.violations.some((violation) => violation.startsWith("_rls_probe:")),
    ).toBe(true);

    // The documented macro repairs the RLS half (erp.apply_tenant_policy);
    // the probe's remaining violations are the deliberate catalog gap and
    // (since PHASE-024) the purge-path gap — the macro creates the
    // tenant_isolation policy only, the 0036 DO-block owns the purge
    // policies — both resolve only when the fixture is dropped (strictness
    // by design).
    await su.query(`SELECT erp.apply_tenant_policy('_rls_probe')`);
    const afterMacro = await runChecks(state.migrateUrl, resolveEntityCatalog());
    expect(
      afterMacro.violations.some(
        (violation) =>
          violation.startsWith("_rls_probe:") &&
          !violation.includes("ENTITY_CATALOG") &&
          !violation.includes("purge_path"),
      ),
    ).toBe(false);
    expect(
      afterMacro.violations.some((violation) => violation.includes("ENTITY_CATALOG")),
    ).toBe(true);
    await su.query("DROP TABLE IF EXISTS _rls_probe");
    const clean = await runChecks(state.migrateUrl, resolveEntityCatalog());
    expect(clean.ok).toBe(true);
    await su.end();
  });
});
