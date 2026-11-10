import { defineConfig } from "@playwright/test";

/**
 * Perf gate (isolated): frame-time measurement needs the machine to itself —
 * visual/a11y suites run separately (pnpm test:visual, then pnpm test:perf).
 */
export default defineConfig({
  testDir: "./tests/perf",
  outputDir: "./.playwright-artifacts-perf",
  snapshotDir: "./__image_snapshots__",
  workers: 1,
  timeout: 120_000,
  webServer: {
    command: "node tests/visual/serve.mjs dist-storybook",
    url: "http://127.0.0.1:6060",
    reuseExistingServer: true,
    timeout: 120_000,
  },
  use: {
    baseURL: "http://127.0.0.1:6060",
    deviceScaleFactor: 1,
  },
});
