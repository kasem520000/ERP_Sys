import { describe, expect, it } from "vitest";

import {
  compareVersions,
  evaluateReleasePolicy,
  parseReleaseManifest,
  type MobileReleaseManifest,
} from "../src/release/release-policy";

/**
 * PHASE-022 T-P22-4-a — the client-side release policy (DR-P22-10):
 * calver `v1.YY.MM.patch` comparisons (the desktop compareSemver port),
 * manifest structural validation, and the minimum-version force-update
 * decision. The manifest is SIMULATED here (DR-P22-10: "simulated in tests
 * → force-update screen") — the real one is assembled by
 * .github/workflows/mobile-release.yml and served per the updater-hosting
 * runbook.
 */

const fixtureManifest: MobileReleaseManifest = {
  version: "1.26.11.3",
  pub_date: "2026-11-05T12:00:00Z",
  minVersion: "1.26.10.0",
  platforms: { android: { url: "https://updates.erp.example/mobile/stable/1.26.11.3/" } },
  rollout: { stagePercent: 10, cohortSeed: "erp-field-1.26.11.3" },
  notes: "ERP Field 1.26.11.3 — staged rollout 10%.",
};

describe("compareVersions — calver v1.YY.MM.patch (the desktop compareSemver port)", () => {
  it("orders 4-segment calver numerically per segment", () => {
    expect(compareVersions("1.26.11.2", "1.26.11.3")).toBe(-1);
    expect(compareVersions("1.26.11.3", "1.26.11.2")).toBe(1);
    expect(compareVersions("1.26.11.2", "1.26.11.2")).toBe(0);
    // month rollover: YY then MM are the compared segments
    expect(compareVersions("1.26.12.0", "1.27.01.0")).toBe(-1);
    expect(compareVersions("1.27.01.0", "1.26.12.0")).toBe(1);
  });

  it("pads missing segments with zero (3-segment semver vs 4-segment calver)", () => {
    expect(compareVersions("1.26.11", "1.26.11.0")).toBe(0);
    expect(compareVersions("1.26.11.1", "1.26.11")).toBe(1);
    expect(compareVersions("1.26", "1.26.0.0")).toBe(0);
  });

  it("compares leading zeros numerically (calver pads with 0X)", () => {
    expect(compareVersions("1.26.11.02", "1.26.11.2")).toBe(0);
    expect(compareVersions("1.26.01.2", "1.26.1.2")).toBe(0);
    expect(compareVersions("1.26.09.2", "1.26.10.0")).toBe(-1);
  });

  it("strips an optional v/V prefix (the tag form vs the manifest form)", () => {
    expect(compareVersions("v1.26.11.2", "1.26.11.2")).toBe(0);
    expect(compareVersions("V1.26.11.2", "1.26.11.3")).toBe(-1);
    expect(compareVersions("v1.26.11.3", "1.26.11.2")).toBe(1);
  });

  it("sorts a non-numeric (prerelease) segment before the numeric release", () => {
    expect(compareVersions("1.26.11.2-rc1", "1.26.11.2")).toBe(-1);
    expect(compareVersions("1.26.11.2", "1.26.11.2-rc1")).toBe(1);
    expect(compareVersions("1.26.11.2-rc1", "1.26.11.2-rc2")).toBe(-1);
  });

  it("fails CLOSED on junk — never throws, junk sorts before anything numeric", () => {
    // A broken value must force-update (fail closed), never silently pass.
    expect(compareVersions("", "1.0.0")).toBe(-1);
    expect(compareVersions("not-a-version", "1.0.0")).toBe(-1);
    expect(compareVersions("1.26.11.2", "junk")).toBe(1);
  });
});

describe("parseReleaseManifest — structural validation (the desktop parseManifest port)", () => {
  it("accepts the full fixture manifest", () => {
    const result = parseReleaseManifest(fixtureManifest);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.manifest.minVersion).toBe("1.26.10.0");
      expect(result.manifest.rollout?.stagePercent).toBe(10);
      expect(result.manifest.platforms.android.url).toContain("1.26.11.3");
    }
  });

  it("tolerates unknown ADDITIVE fields (forward compatibility)", () => {
    const result = parseReleaseManifest({ ...fixtureManifest, futureField: { nested: true } });
    expect(result.ok).toBe(true);
  });

  it("rejects a non-object manifest", () => {
    expect(parseReleaseManifest("nope").ok).toBe(false);
  });

  it("names the field on every validation failure", () => {
    const cases: ReadonlyArray<[unknown, string]> = [
      [{ ...fixtureManifest, version: "" }, "manifest.version"],
      [{ ...fixtureManifest, version: 42 }, "manifest.version"],
      [{ ...fixtureManifest, pub_date: "" }, "manifest.pub_date"],
      [{ ...fixtureManifest, pub_date: "not-a-date" }, "manifest.pub_date"],
      [{ ...fixtureManifest, platforms: {} }, "manifest.platforms.android"],
      [{ ...fixtureManifest, platforms: { android: {} } }, "manifest.platforms.android.url"],
      [{ ...fixtureManifest, minVersion: "" }, "manifest.minVersion"],
      [{ ...fixtureManifest, minVersion: "   " }, "manifest.minVersion"],
      [{ ...fixtureManifest, rollout: { stagePercent: 101 } }, "manifest.rollout.stagePercent"],
      [{ ...fixtureManifest, rollout: { stagePercent: 10.5 } }, "manifest.rollout.stagePercent"],
      [{ ...fixtureManifest, rollout: { stagePercent: 10, cohortSeed: "" } }, "manifest.rollout.cohortSeed"],
    ];
    for (const [json, expectedField] of cases) {
      const result = parseReleaseManifest(json);
      expect(result.ok, `expected failure for ${JSON.stringify(json)}`).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain(expectedField);
      }
    }
  });

  it("accepts a manifest without minVersion (no enforcement)", () => {
    const { minVersion: _dropped, ...withoutMinimum } = fixtureManifest;
    const result = parseReleaseManifest(withoutMinimum);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.manifest.minVersion).toBeUndefined();
    }
  });
});

describe("evaluateReleasePolicy — the minimum-version force-update decision", () => {
  it("force-updates a build below the published minimum", () => {
    const decision = evaluateReleasePolicy({ appVersion: "1.26.09.4", manifest: fixtureManifest });
    expect(decision.action).toBe("force-update");
    if (decision.action === "force-update") {
      expect(decision.minVersion).toBe("1.26.10.0");
      expect(decision.reason).toContain("1.26.09.4");
      expect(decision.reason).toContain("1.26.10.0");
    }
  });

  it("is ok at exactly the minimum (the boundary is inclusive)", () => {
    const decision = evaluateReleasePolicy({ appVersion: "1.26.10.0", manifest: fixtureManifest });
    expect(decision.action).toBe("ok");
  });

  it("is ok above the minimum", () => {
    const decision = evaluateReleasePolicy({ appVersion: "1.26.11.3", manifest: fixtureManifest });
    expect(decision.action).toBe("ok");
    expect(decision.reason).toContain("1.26.11.3");
  });

  it("tolerates the v-prefixed app version form (builds report what they were tagged from)", () => {
    const decision = evaluateReleasePolicy({ appVersion: "v1.26.09.4", manifest: fixtureManifest });
    expect(decision.action).toBe("force-update");
  });

  it("enforces nothing when no minimum is published", () => {
    const { minVersion: _dropped, ...withoutMinimum } = fixtureManifest;
    const decision = evaluateReleasePolicy({ appVersion: "0.0.1", manifest: withoutMinimum });
    expect(decision.action).toBe("ok");
    expect(decision.reason).toContain("no published minimum");
  });

  it("fails CLOSED on a junk app version (junk sorts below any minimum)", () => {
    const decision = evaluateReleasePolicy({ appVersion: "garbage", manifest: fixtureManifest });
    expect(decision.action).toBe("force-update");
  });
});
