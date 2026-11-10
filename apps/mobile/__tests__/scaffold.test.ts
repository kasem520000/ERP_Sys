import { describe, expect, it } from "vitest";
import {
  ANDROID_PLATFORM,
  CRASH_FREE_GATES,
  MOBILE_DEVICE_CLASSES,
  MOBILE_STORAGE_BUDGET_BYTES,
  PERSONAL_BACKGROUND_PULL_BUDGET_BYTES,
  PRICE_TOLERANCE_FIELD_PCT,
  ROLLOUT_STAGES,
  SYNC_BACKGROUND_MIN_INTERVAL_MS,
  SYNC_CONNECTIVITY_DEBOUNCE_MS,
  SYNC_FOREGROUND_INTERVAL_MS,
  SYNC_PULL_BUDGET_BYTES,
  SYNC_PUSH_BUDGET_BYTES,
  TOUCH_TARGET_MIN,
} from "../src/constants";
import * as barrel from "../src/index";

describe("PHASE-022 scaffold — golden constants (MASTER-PLAN §0)", () => {
  it("declares the two Android device classes of the ONE app", () => {
    expect(MOBILE_DEVICE_CLASSES).toEqual({
      field: "android-field",
      personal: "android-personal",
    });
  });

  it("pins the registration platform and the 128 MB storage budget", () => {
    expect(ANDROID_PLATFORM).toBe("android");
    expect(MOBILE_STORAGE_BUDGET_BYTES).toBe(134_217_728); // 128 MB, byte-exact
  });

  it("pins the sync schedule (2 min foreground / 15 min background / 5 s debounce)", () => {
    expect(SYNC_FOREGROUND_INTERVAL_MS).toBe(120_000);
    expect(SYNC_BACKGROUND_MIN_INTERVAL_MS).toBe(900_000);
    expect(SYNC_CONNECTIVITY_DEBOUNCE_MS).toBe(5_000);
  });

  it("pins the per-cycle bandwidth budgets (8 MB pull / 2 MB push / 256 KB personal background)", () => {
    expect(SYNC_PULL_BUDGET_BYTES).toBe(8_388_608);
    expect(SYNC_PUSH_BUDGET_BYTES).toBe(2_097_152);
    expect(PERSONAL_BACKGROUND_PULL_BUDGET_BYTES).toBe(262_144);
  });

  it("pins the rollout stages + crash-free gates + a11y/price floors", () => {
    expect(ROLLOUT_STAGES).toEqual([10, 50, 100]);
    expect(CRASH_FREE_GATES.to50).toEqual({ crashFree: 0.995, sessions: 200 });
    expect(CRASH_FREE_GATES.to100).toEqual({ crashFree: 0.997, sessions: 500 });
    expect(CRASH_FREE_GATES.halt).toBe(0.985);
    expect(TOUCH_TARGET_MIN).toBe(44);
    expect(PRICE_TOLERANCE_FIELD_PCT).toBe(2);
  });

  it("re-exports the constants through the root barrel (the @erp/mobile surface)", () => {
    expect(barrel.MOBILE_DEVICE_CLASSES).toBe(MOBILE_DEVICE_CLASSES);
    expect(barrel.CRASH_FREE_GATES.halt).toBe(0.985);
  });
});
