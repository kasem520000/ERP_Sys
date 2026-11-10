import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/__db__/**/*.spec.ts"],
    globalSetup: ["src/__db__/stub-setup.ts"],
  },
});
