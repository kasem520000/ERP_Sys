import { defineConfig } from "@playwright/test";

/** CSP probe config — drives a REAL built web app (see scripts/test:web-security). */
export default defineConfig({
  testDir: "./tests/security",
  outputDir: "./.playwright-artifacts",
  timeout: 60_000,
  use: { baseURL: `http://127.0.0.1:${Number(process.env.WEB_PROBE_PORT ?? 3100)}` },
  webServer: {
    command: "pnpm exec next start -p 3100",
    port: 3100,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
