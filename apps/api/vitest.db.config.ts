import { defineConfig } from "vitest/config";

/**
 * Database suite (PHASE-002 §6): real PostgreSQL 16 + real migrations + RLS
 * attack tests + pg-boss + s3rver-backed files tests. Boots once per run in
 * `src/__db__/global-setup.ts`:
 * - `TEST_DATABASE_URL` set → use that server (Testcontainers CI job); the
 *   migration-tests runner has already applied migrations.
 * - unset (sandbox/local) → boot an embedded PostgreSQL 16 (same major as the
 *   compose stack) and apply `drizzle-kit migrate` against it.
 *
 * singleFork + no isolation: one worker process, one PG boot, sequential
 * specs — attack tests stay deterministic.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/__db__/**/*.spec.ts"],
    globalSetup: ["src/__db__/global-setup.ts"],
    pool: "forks",
    poolOptions: {
      forks: { singleFork: true },
    },
    isolate: false,
    sequence: { concurrent: false },
    hookTimeout: 180_000,
    testTimeout: 60_000,
    teardownTimeout: 60_000,
  },
});
