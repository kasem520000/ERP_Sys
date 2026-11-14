import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));

/**
 * The PHASE-043 hard-review probe runner: the auditor's standalone
 * reproduction of the two blocking defects — run OUTSIDE the app's DB
 * suite (audit-evidence/, not src/__db__/) exactly like the owner's
 * independent probe. Boots the SAME embedded PostgreSQL 16 + the real
 * migration chain (apps/api's global-setup), one fork, sequential.
 *
 * Run from apps/api (the migrate step's cwd — drizzle.config.ts lives there):
 *   pnpm --filter @erp/api exec vitest run \
 *     --config ../../audit-evidence/phase043-hard-review/vitest.probe.config.ts
 */
export default defineConfig({
  resolve: {
    alias: {
      "@erp/domain-core": `${here}../../packages/domain-core/src/index.ts`,
      "@erp/contracts": `${here}../../packages/contracts/src/index.ts`,
      "@erp/config": `${here}../../packages/config/src/index.ts`,
    },
  },
  test: {
    environment: "node",
    include: [`${here}probe.spec.ts`],
    globalSetup: [`${here}../../apps/api/src/__db__/global-setup.ts`],
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    isolate: false,
    sequence: { concurrent: false },
    hookTimeout: 180_000,
    testTimeout: 120_000,
    teardownTimeout: 60_000,
  },
});
