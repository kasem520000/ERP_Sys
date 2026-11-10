import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["__tests__/**/*.test.ts"],
    // PHASE-021: real file-backed SQLite suites can be slow on cold CI disks —
    // generous per-test timeout, still far under the §9 wall budget (≤ 10 min
    // for the whole desktop dir).
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
