import { defineConfig } from "vitest/config";

// Unit + property suite (fast, no infrastructure): every spec file under
// src/ EXCEPT the database suite in src/__db__/, which runs against a real
// PostgreSQL 16 through `pnpm test:db` (vitest.db.config.ts), mirroring the
// CI split (ci.yml `unit` job vs ci-db.yml).
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.spec.ts"],
    exclude: ["src/__db__/**"],
  },
});
