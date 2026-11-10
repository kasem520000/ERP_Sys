import { defineConfig } from "@playwright/test";

/**
 * PHASE-021 W3 task 3-b — the E2E desktop-offline config (MASTER-PLAN §10).
 *
 * NO `webServer`: the spec manages its own static server over the
 * `apps/web/out-desktop` export because the journeys must inject the
 * `window.__erpDesktop` bridge double (page.exposeFunction +
 * context.addInitScript) into EVERY context BEFORE the web bundle boots —
 * a managed webServer serves pages the harness cannot pre-inject into.
 * The export itself is built once in the spec's beforeAll
 * (`pnpm --filter @erp/web build:desktop`, ~40 s; `E2E_SKIP_BUILD=1`
 * reuses a pre-built export for CI contexts where the in-spec build is
 * flaky — the gate command then builds it explicitly first).
 *
 * Serial (one worker): the journeys are stateful end-to-end scripts over a
 * real SQLite store each; parallelism buys nothing at two journeys.
 * Timeouts are generous: the beforeAll export build dominates (~40 s), the
 * whole file's budget is ≤ 5 min.
 */
export default defineConfig({
  testDir: ".",
  outputDir: "./.artifacts",
  timeout: 150_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  use: {
    headless: true,
    timezoneId: "UTC",
  },
});
