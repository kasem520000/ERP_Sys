import { describe, expect, it } from "vitest";

import { compareVersions } from "../application/apply/apply-service";
import { driftKind } from "../application/closure/drift-service";

/**
 * PHASE-015 T7 unit tests — the drift machinery's pure core: semver
 * ordering + the §8 drift-kind classification (PATCH/MINOR ⇒ offer, MAJOR ⇒
 * critical offer). The recorded-notification leg runs against the real
 * inbox inside template-apply.db.spec (db suite).
 */
describe("semver compare (apply/drift shared core)", () => {
  it("orders MAJOR.MINOR.PATCH numerically", () => {
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
    expect(compareVersions("1.0.0", "1.0.1")).toBe(-1);
    expect(compareVersions("1.0.1", "1.0.0")).toBe(1);
    expect(compareVersions("1.2.0", "1.10.0")).toBe(-1); // numeric, not lexical
    expect(compareVersions("2.0.0", "1.99.99")).toBe(1);
    expect(compareVersions("1.0.0", "0.9.9")).toBe(1);
  });
});

describe("drift kind (industries/README §8 versioning table)", () => {
  it("classifies which segment moved first", () => {
    expect(driftKind("1.0.0", "1.0.1")).toBe("patch");
    expect(driftKind("1.0.0", "1.1.0")).toBe("minor");
    expect(driftKind("1.0.0", "1.2.3")).toBe("minor");
    expect(driftKind("1.4.2", "2.0.0")).toBe("major");
    expect(driftKind("1.0.0", "2.1.3")).toBe("major");
  });

  it("patch drift is still a drift even when minor also moves (minor wins)", () => {
    // 1.0.0 → 1.1.1: the MINOR segment moved — a MINOR offer with the
    // "what changed" review semantics (§5 R9), not a bare PATCH.
    expect(driftKind("1.0.0", "1.1.1")).toBe("minor");
  });
});
