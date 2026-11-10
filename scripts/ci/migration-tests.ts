import { spawnSync } from "node:child_process";

import { Client } from "pg";
import { PostgresContainer } from "@testcontainers/postgresql";

/**
 * PHASE-002 Testcontainers CI runner (PHASE-002 §2.9, MIGRATION_STRATEGY §7):
 * boots a FRESH postgres:16 container per run, applies the full migration
 * chain, provisions dev credentials, executes the DB suite against it, and
 * runs the RLS/catalog checker. Fresh-apply is the primary proof; the
 * idempotent re-apply (regression-apply shape at this phase — no prior
 * released snapshot exists yet; snapshots begin with the first tagged phase
 * release) is asserted inside the suite.
 *
 * CI infra (docker available): `.github/workflows/ci-db.yml` runs this file.
 * Sandbox (no docker daemon): `pnpm test:db` exercises the identical suite
 * against an embedded PostgreSQL 16 instead — recorded in the phase report.
 */
async function main(): Promise<void> {
  console.log("[migration-tests] starting postgres:16 container…");
  const container = await new PostgresContainer("postgres:16")
    .withDatabase("erp")
    .withUsername("postgres")
    .withPassword("postgres")
    .start();
  const migrateUrl = container.getConnectionUri();
  const appUrl = `postgres://erp_app:erp_app@${container.getHost()}:${container.getMappedPort(5432)}/erp`;
  try {
    console.log("[migration-tests] fresh-apply: drizzle-kit migrate");
    const migrate = spawnSync("pnpm", ["--filter", "@erp/api", "exec", "drizzle-kit", "migrate"], {
      cwd: process.cwd(),
      env: { ...process.env, MIGRATE_DATABASE_URL: migrateUrl },
      encoding: "utf8",
      stdio: "inherit",
      timeout: 180_000,
    });
    if (migrate.status !== 0) {
      throw new Error(`drizzle-kit migrate failed (exit ${migrate.status})`);
    }

    // Dev credentials (compose parity; migrations stay secret-free).
    const bootstrap = new Client({ connectionString: migrateUrl });
    await bootstrap.connect();
    await bootstrap.query("ALTER ROLE erp_app PASSWORD 'erp_app'");
    await bootstrap.query("ALTER ROLE erp_readonly PASSWORD 'erp_readonly'");
    await bootstrap.end();

    console.log("[migration-tests] db suite (RLS attacks, jobs, files, readiness)");
    const suite = spawnSync("pnpm", ["--filter", "@erp/api", "test:db"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        TEST_DATABASE_URL: appUrl,
        TEST_MIGRATE_DATABASE_URL: migrateUrl,
      },
      encoding: "utf8",
      stdio: "inherit",
      timeout: 600_000,
    });
    if (suite.status !== 0) {
      throw new Error(`db suite failed (exit ${suite.status})`);
    }

    console.log("[migration-tests] RLS + catalog drift check");
    const check = spawnSync("pnpm", ["exec", "tsx", "scripts/check-rls.ts"], {
      cwd: process.cwd(),
      env: { ...process.env, MIGRATE_DATABASE_URL: migrateUrl },
      encoding: "utf8",
      stdio: "inherit",
      timeout: 60_000,
    });
    if (check.status !== 0) {
      throw new Error(`check-rls failed (exit ${check.status})`);
    }

    console.log("[migration-tests] ALL GREEN");
  } finally {
    await container.stop();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
