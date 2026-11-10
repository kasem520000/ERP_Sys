import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import appConfig from "../app.config";

/**
 * PHASE-022 T-P22-4-a — structural validation of the Android release
 * workflow (.github/workflows/mobile-release.yml), the DR-P22-10 port of
 * apps/desktop/__tests__/desktop-release-ci.test.ts (PHASE-021 T12).
 *
 * HONEST LIMITATION (documented, deliberate — the desktop precedent): this
 * spec does NOT parse the YAML into a document model (the repo has no YAML
 * dependency and gains none). It asserts on the RAW TEXT with ordered
 * regexes: every required step marker must appear, IN PIPELINE ORDER, which
 * is exactly the guarantee the pipeline contract needs (install → mobile
 * gates → check:mobile-shell → tokens/i18n → native install → EAS build →
 * SBOM → upload → staged-rollout config → release manifest). Real execution
 * happens on GitHub runners with the S-15 secrets — the sandbox has no
 * Android SDK / EAS CLI (the k6 precedent; MASTER-PLAN §0/§10).
 */

const here = dirname(fileURLToPath(import.meta.url));
const workflowPath = join(here, "../../../.github/workflows/mobile-release.yml");
const workflow = readFileSync(workflowPath, "utf8");

/** The workflow minus its comment lines — ordered/step assertions must match
 * STEP CONTENT, never the prose comments (which narrate the same pipeline
 * order and would make indexOf lie about positions). */
const steps = workflow
  .split("\n")
  .filter((line) => !/^\s*#/.test(line))
  .join("\n");

/** Ordered marker assertion: finds `marker` AFTER the previous one. */
function assertOrdered(markers: readonly string[]): void {
  let position = -1;
  let previous = "<start>";
  for (const marker of markers) {
    const index = steps.indexOf(marker);
    expect(index, `marker "${marker}" must exist in mobile-release.yml`).toBeGreaterThanOrEqual(0);
    expect(
      index,
      `marker "${marker}" must come AFTER "${previous}" (pipeline order)`,
    ).toBeGreaterThan(position);
    position = index;
    previous = marker;
  }
}

describe("mobile-release.yml — the Android release pipeline (PHASE-022 T-P22-4-a)", () => {
  it("exists and is a sane YAML document (basic structural shape)", () => {
    // Cheap structural sanity without a YAML parser: top-level keys present,
    // both jobs, consistent step indentation, no tabs.
    expect(workflow.startsWith("name: mobile-release")).toBe(true);
    expect(workflow).toContain("jobs:");
    expect(workflow).toContain("android-release:");
    expect(workflow).toContain("device-farm:");
    expect((workflow.match(/^ {6}- (name|uses|run|working-directory):/gm) ?? []).length).toBeGreaterThan(10);
    expect(workflow).not.toMatch(/\t/); // YAML forbids tabs for indentation
  });

  it("triggers on version tags (v*) plus the manual device-farm dispatch leg", () => {
    expect(workflow).toMatch(/on:\s*\n\s*push:\s*\n\s*tags:\s*\[\s*"v\*"\s*\]/);
    expect(workflow).toContain("workflow_dispatch:");
  });

  it("runs on ubuntu-latest with the pinned toolchain (pnpm 9.15.9, node 22.12)", () => {
    expect(workflow).toContain("runs-on: ubuntu-latest");
    expect(workflow).toContain("version: 9.15.9");
    expect(workflow).toContain("node-version: 22.12");
    // The repo .nvmrc pins the same 22.12 line (full "22.12.0" there,
    // "22.12" in the workflow — the same major.minor).
    const nvmrc = readFileSync(join(here, "../../../.nvmrc"), "utf8").trim();
    expect(nvmrc).toMatch(/^22\.12(\.\d+)?$/);
  });

  it("requires the ordered pipeline: install → gates → shell → tokens/i18n → native install → EAS → SBOM → upload → rollout config → manifest", () => {
    assertOrdered([
      "pnpm install --frozen-lockfile",
      "pnpm --filter @erp/mobile typecheck",
      "pnpm --filter @erp/mobile lint",
      "pnpm --filter @erp/mobile test",
      "pnpm check:mobile-shell",
      "pnpm check:mobile-tokens",
      "pnpm check:mobile-i18n",
      "pnpm install --no-frozen-lockfile",
      "--platform android --profile production",
      "cyclonedx-npm",
      "uses: actions/upload-artifact@v4",
      "rollout-config.json",
      '"minVersion": "${RELEASE_VERSION}"',
    ]);
  });

  it("builds the production EAS profile (the eas.json profile, non-interactive local build)", () => {
    // The EAS invocation runs from the project root (apps/mobile — eas.json,
    // app.config.ts, metro.config.js) against the native/ glue dir.
    const easSteps = steps.match(/eas-cli build[^\n]*/g) ?? [];
    expect(easSteps.length).toBeGreaterThanOrEqual(1);
    for (const step of easSteps) {
      expect(step).toContain("--platform android");
      expect(step).toContain("--profile production");
      expect(step).toContain("--non-interactive");
    }
  });

  it("wires the S-15 signing + FCM + EAS seams from secrets, warn-and-continue (the signtool precedent)", () => {
    expect(workflow).toContain("EXPO_TOKEN: ${{ secrets.EXPO_TOKEN }}");
    expect(workflow).toContain("ANDROID_KEYSTORE_BASE64: ${{ secrets.ANDROID_KEYSTORE_BASE64 }}");
    expect(workflow).toContain("ANDROID_KEYSTORE_ALIAS: ${{ secrets.ANDROID_KEYSTORE_ALIAS }}");
    expect(workflow).toContain("ANDROID_KEYSTORE_PASSWORD: ${{ secrets.ANDROID_KEYSTORE_PASSWORD }}");
    expect(workflow).toContain("ANDROID_KEY_PASSWORD: ${{ secrets.ANDROID_KEY_PASSWORD }}");
    expect(workflow).toContain("FCM_PROJECT_ID: ${{ secrets.FCM_PROJECT_ID }}");
    expect(workflow).toContain("FCM_APP_ID: ${{ secrets.FCM_APP_ID }}");
    expect(workflow).toContain("FCM_API_KEY: ${{ secrets.FCM_API_KEY }}");
    // Each seam warns and continues when unset — never a silent skip.
    expect(workflow).toMatch(/::warning::Android signing skipped/);
    expect(workflow).toMatch(/::warning::FCM config skipped/);
    expect(workflow).toMatch(/::warning::EAS build skipped/);
    // The credentials + FCM files are materialized into the native dir.
    expect(steps).toContain("cat > credentials.json");
    expect(steps).toContain("cat > google-services.json");
  });

  it("assembles the staged-rollout config with the binding gates (10/50/100, 99.5/99.7/98.5)", () => {
    // The artifact must serialize exactly what src/release/rollout.ts
    // consumes (MASTER-PLAN §0): stages ladder, promote gates, halt remedy.
    expect(steps).toContain('"stages": [10, 50, 100]');
    expect(steps).toContain('"to50": { "crashFree": 0.995, "sessions": 200 }');
    expect(steps).toContain('"to100": { "crashFree": 0.997, "sessions": 500 }');
    expect(steps).toContain('"halt": { "crashFree": 0.985');
    expect(steps).toContain('"stagePercent": 10');
    expect(steps).toContain('"cohortSeed": "erp-field-${RELEASE_VERSION}"');
    expect(steps).toContain('"windowHours": 24');
  });

  it("documents the device-farm leg honestly (workflow_dispatch + C-06/C-07/C-13 + D-02)", () => {
    expect(workflow).toContain("if: github.event_name == 'workflow_dispatch'");
    expect(workflow).toContain("C-06");
    expect(workflow).toContain("C-07");
    expect(workflow).toContain("C-13");
    expect(workflow).toContain("D-02");
    expect(workflow).toContain("requires an Android runner");
  });

  it("never embeds secrets inline (documented placeholders only)", () => {
    // All secret references go through the ${{ secrets.* }} context — no raw
    // key material in the workflow file itself. The base64-run heuristic
    // requires mixed case + digits (real key material always has both); a
    // long lowercase Gradle path is not key-looking, a 60+ char blob is.
    const runs = workflow.match(/[A-Za-z0-9+/]{60,}={0,2}(?![A-Za-z0-9+/])/g) ?? [];
    const keyLooking = [
      ...workflow.match(/-----BEGIN [A-Z ]*PRIVATE KEY-----/g) ?? [],
      ...runs.filter((run) => /[A-Z]/.test(run) && /\d/.test(run)),
    ];
    expect(keyLooking).toEqual([]);
  });

  it("eas.json carries the real build profiles (preview + production)", () => {
    const eas = JSON.parse(readFileSync(join(here, "../eas.json"), "utf8")) as {
      cli?: { version?: string };
      build?: Record<string, Record<string, unknown>>;
      submit?: Record<string, unknown>;
    };
    expect(eas.cli?.version).toMatch(/^>=\s*\d/);
    const preview = eas.build?.preview;
    expect(preview?.distribution).toBe("internal");
    expect((preview?.android as { buildType?: string } | undefined)?.buildType).toBe("apk");
    expect(preview?.developmentClient).toBe(false);
    const production = eas.build?.production;
    expect(production?.autoIncrement).toBe(true);
    expect((production?.android as { buildType?: string } | undefined)?.buildType).toBe("app-bundle");
    const env = (production?.env ?? {}) as Record<string, string>;
    expect(env["EXPO_NO_TELEMETRY"]).toBe("1");
    expect(eas.submit?.production).toBeDefined();
  });

  it("native/package.json declares the expo toolchain at the DR-P22-01 pins", () => {
    const nativePkg = JSON.parse(readFileSync(join(here, "../native/package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      packageManager?: string;
    };
    const deps = nativePkg.dependencies ?? {};
    for (const name of [
      "expo",
      "expo-sqlite",
      "expo-secure-store",
      "expo-local-authentication",
      "expo-notifications",
      "expo-background-fetch",
      "expo-task-manager",
    ]) {
      expect(deps[name], `native dep ${name} must be declared`).toBeTruthy();
      expect(deps[name]).toMatch(/^~/);
    }
    expect(deps["react"]).toBe("18.3.1");
    expect(deps["react-native"]).toBe("0.76.5");
    // The workspace twin must agree (check:mobile-shell proves the range
    // relationship; the pin is asserted here at its face value).
    const mobilePkg = JSON.parse(readFileSync(join(here, "../package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
    };
    expect(mobilePkg.dependencies?.["react"]).toBe("18.3.1");
    expect(mobilePkg.dependencies?.["react-native"]).toMatch(/^\^0\.76\./);
    // The CI install follows this pin (corepack reads it on the runner).
    expect(nativePkg.packageManager).toBe("pnpm@9.15.9");
  });

  it("app.config.ts carries the android platform + the com.erp.field package id", () => {
    expect(appConfig.platforms).toEqual(["android"]);
    expect(appConfig.android?.package).toBe("com.erp.field");
    expect(appConfig.slug).toBe("erp-field");
    expect(appConfig.name).toBe("ERP Field");
    expect(typeof appConfig.version).toBe("string");
  });
});
