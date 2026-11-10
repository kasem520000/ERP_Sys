/**
 * PHASE-022 (DR-P22-10) — the minimal Expo application config.
 * Source-only in the sandbox: nothing in the pnpm workspace install reads
 * this file — EAS CI and the native toolchain do (a later task refines).
 *
 * Deliberately imports nothing (not even `ExpoConfig` from "expo/config") so
 * the sandbox lint/typecheck/dependency-cruiser gates never need `expo`
 * installed (DR-P22-01: the native glue dir owns the expo toolchain). The
 * shape mirrors expo/config's ExpoConfig for the fields we pin; `extra` is
 * intentionally absent (none); `jsEngine` is the RN 0.76 / Expo 52 default
 * (Hermes), pinned explicitly for the record.
 */
const appConfig = {
  name: "ERP Field",
  slug: "erp-field",
  scheme: "erpfield",
  version: "0.1.0",
  platforms: ["android"] as const,
  android: {
    // placeholder applicationId — task 4-a pins the real id + signing config
    package: "com.erp.field",
  },
  jsEngine: "hermes" as const,
};

export default appConfig;
