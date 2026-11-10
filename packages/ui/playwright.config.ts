import { defineConfig } from "@playwright/test";

/**
 * Visual-regression harness (VISUAL_TESTING): deterministic fonts
 * (self-hosted woff2 + document.fonts.ready + data-visual-ready), frozen
 * clock (preview decorator), seeded fixtures, threshold 0, AR+EN both
 * mandatory (coverage check), viewports 390/1024/1280 on archetype pages.
 * CI budget: ≤5 min per suite with sharding (workers).
 */
export default defineConfig({
  testDir: "./tests",
  testMatch: /.*\.spec\.ts$/,
  // the perf gate runs ALONE (playwright.perf.config.ts) — frame-time
  // measurement is meaningless under parallel rendering contention.
  testIgnore: /perf\//,
  outputDir: "./.playwright-artifacts",
  snapshotDir: "./__image_snapshots__",
  fullyParallel: true,
  // Screenshot determinism: software rasterizers on shared runners produce
  // subpixel AA variance under CPU contention — cap the workers (VISUAL_TESTING
  // §3 anti-flake; the ≤5min budget holds at this level).
  workers: 2,
  timeout: 60_000,
  expect: {
    toHaveScreenshot: { threshold: 0, maxDiffPixelRatio: 0, animations: "disabled", caret: "hide" },
  },
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
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
  ],
});
