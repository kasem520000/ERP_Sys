import { describe, expect, it } from "vitest";

import { WEBVIEW2_MINIMUM, WEBVIEW2_RECOMMENDED } from "../src/index";
import { compareVersions, parseWebview2Version, webview2Policy } from "../src/system/webview2";

/**
 * PHASE-021 T11 · WebView2 runtime probe matrix (MASTER-PLAN §0 constants:
 * minimum 109.0.1518.78, recommended 120.0.2210.61): parsing tolerance,
 * numeric segment comparison, and the unsupported/degraded/supported policy
 * bands with bilingual guidance (below minimum ⇒ Evergreen standalone
 * installer guidance; exactly minimum ⇒ supported).
 */

describe("parseWebview2Version", () => {
  it("parses the canonical four-part Evergreen string", () => {
    expect(parseWebview2Version("109.0.1518.78")).toEqual({ major: 109, minor: 0, build: 1518, revision: 78 });
  });

  it("tolerates short forms (missing segments read as 0)", () => {
    expect(parseWebview2Version("109.0.1518")).toEqual({ major: 109, minor: 0, build: 1518, revision: 0 });
    expect(parseWebview2Version("109")).toEqual({ major: 109, minor: 0, build: 0, revision: 0 });
  });

  it("tolerates surrounding whitespace and a leading WV2 probe prefix", () => {
    expect(parseWebview2Version("  109.0.1518.78  ")).toEqual({ major: 109, minor: 0, build: 1518, revision: 78 });
    expect(parseWebview2Version("WV2 109.0.1518.78")).toEqual({ major: 109, minor: 0, build: 1518, revision: 78 });
    expect(parseWebview2Version("wv2 120.0.2210.61")).toEqual({ major: 120, minor: 0, build: 2210, revision: 61 });
  });

  const invalid: readonly string[] = [
    "",
    "   ",
    "abc",
    "109.x.1518.78",
    "109..1518",
    "-1.0.0.0",
    "1.2.3.4.5",
    "109.0.1518.78.9",
  ];
  for (const raw of invalid) {
    it(`rejects ${JSON.stringify(raw)} (null, never a throw)`, () => {
      expect(parseWebview2Version(raw)).toBeNull();
    });
  }
});

describe("compareVersions (numeric segment-wise)", () => {
  it("compares equal strings to 0", () => {
    expect(compareVersions("109.0.1518.78", "109.0.1518.78")).toBe(0);
  });

  it("compares numerically per segment (109.0.1518 < 109.0.1518.78)", () => {
    expect(compareVersions("109.0.1518", "109.0.1518.78")).toBe(-1);
    expect(compareVersions("120.0.2210.61", "109.0.1518.78")).toBe(1);
    expect(compareVersions("109.1.0.0", "109.0.999.999")).toBe(1);
  });

  it("returns null when either side does not parse", () => {
    expect(compareVersions("nonsense", "109.0.0.0")).toBeNull();
    expect(compareVersions("109.0.0.0", "nonsense")).toBeNull();
  });
});

describe("webview2Policy (banding against the shipped constants)", () => {
  it("the golden constants are what the policy bands against", () => {
    expect(WEBVIEW2_MINIMUM).toBe("109.0.1518.78");
    expect(WEBVIEW2_RECOMMENDED).toBe("120.0.2210.61");
  });

  it("below minimum (108.x) ⇒ unsupported + Evergreen installer guidance", () => {
    const policy = webview2Policy("108.0.1518.78");
    expect(policy.status).toBe("unsupported");
    expect(policy.current).toBe("108.0.1518.78");
    expect(policy.minimum).toBe(WEBVIEW2_MINIMUM);
    expect(policy.recommended).toBe(WEBVIEW2_RECOMMENDED);
    expect(policy.guidance.ar).toContain("Evergreen");
    expect(policy.guidance.en).toContain("Evergreen Standalone Installer");
  });

  it("exactly the minimum (109.0.1518.78) ⇒ supported (inclusive floor)", () => {
    expect(webview2Policy("109.0.1518.78").status).toBe("supported");
  });

  it("above minimum but below recommended (110.0) ⇒ degraded + capability notice", () => {
    const policy = webview2Policy("110.0");
    expect(policy.status).toBe("degraded");
    expect(policy.guidance.ar.length).toBeGreaterThan(0);
    expect(policy.guidance.en).toContain("recommended");
  });

  it("exactly the recommended (120.0.2210.61) ⇒ supported", () => {
    expect(webview2Policy("120.0.2210.61").status).toBe("supported");
  });

  it("newer than recommended (121.0) ⇒ supported", () => {
    expect(webview2Policy("121.0").status).toBe("supported");
  });

  it("an unparseable probe result fails CLOSED to unsupported with installer guidance", () => {
    const policy = webview2Policy("garbage-probe-output");
    expect(policy.status).toBe("unsupported");
    expect(policy.guidance.en).toContain("could not be determined");
    expect(policy.guidance.ar).toContain("تعذّر");
  });

  it("every band carries non-empty bilingual guidance (AR + EN)", () => {
    for (const version of ["108.0.0.0", "110.0", "121.0", ""]) {
      const policy = webview2Policy(version);
      expect(policy.guidance.ar.trim().length).toBeGreaterThan(10);
      expect(policy.guidance.en.trim().length).toBeGreaterThan(10);
    }
  });
});
