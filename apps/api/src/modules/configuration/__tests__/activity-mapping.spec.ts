import { describe, expect, it } from "vitest";

import {
  SUPPORTED_ACTIVITIES,
  resolveTemplateForActivity,
} from "../application/apply/activity-mapping";

/**
 * PHASE-015 T5 unit tests — the activity → template resolution
 * (industries/README §4 step 1): exact bilingual keyword hits, suggested
 * containment hits, and the unknown-activity contract (null ⇒ plain
 * onboarding, never a wrong-industry guess).
 */
describe("activity → template resolution", () => {
  it("ships a bilingual catalog for all thirteen shipped templates", () => {
    expect(SUPPORTED_ACTIVITIES.map((entry) => entry.templateKey).sort()).toEqual([
      "industry.agriculture",
      "industry.automotive",
      "industry.distribution",
      "industry.education",
      "industry.electronics",
      "industry.food_manufacturing",
      "industry.grocery",
      "industry.healthcare",
      "industry.professional_services",
      "industry.rental_logistics",
      "industry.restaurant",
      "industry.retail",
      "industry.wholesale",
    ]);
    for (const entry of SUPPORTED_ACTIVITIES) {
      expect(entry.label.ar.length).toBeGreaterThan(0);
      expect(entry.label.en.length).toBeGreaterThan(0);
      // Both languages carry keywords — an Arabic-only registrant resolves.
      expect(entry.keywords.some((keyword) => /[\u0600-\u06FF]/.test(keyword))).toBe(true);
      expect(entry.keywords.some((keyword) => /^[a-z]/.test(keyword))).toBe(true);
      expect(entry.templateKey).toMatch(/^industry\.[a-z][a-z0-9_]{2,30}$/);
    }
  });

  it("resolves exact keywords (EN + AR) with exact confidence", () => {
    expect(resolveTemplateForActivity("retail")).toEqual({
      templateKey: "industry.retail",
      confidence: "exact",
    });
    expect(resolveTemplateForActivity("Retail Store")).toEqual({
      templateKey: "industry.retail",
      confidence: "exact",
    });
    expect(resolveTemplateForActivity("سوبرماركت")).toEqual({
      templateKey: "industry.grocery",
      confidence: "exact",
    });
    expect(resolveTemplateForActivity("مطعم")).toEqual({
      templateKey: "industry.restaurant",
      confidence: "exact",
    });
    expect(resolveTemplateForActivity("  CAFE ")).toEqual({
      templateKey: "industry.restaurant",
      confidence: "exact",
    });
    expect(resolveTemplateForActivity("grocery store")).toEqual({
      templateKey: "industry.grocery",
      confidence: "exact",
    });
  });

  it("suggests on containment (the wizard confirms before applying)", () => {
    const suggestion = resolveTemplateForActivity("supermarket and wholesale branch");
    expect(suggestion).toEqual({ templateKey: "industry.grocery", confidence: "suggested" });
    expect(resolveTemplateForActivity("متجر تجزئة وملابس")?.confidence).toBe("suggested");
    // A short stray fragment never fires (keyword-length ≥ 4 guard).
    expect(resolveTemplateForActivity("caf")).toBeNull();
  });

  it("resolves the newer shells' exact keywords too (EN + AR)", () => {
    expect(resolveTemplateForActivity("law office")).toEqual({
      templateKey: "industry.professional_services",
      confidence: "exact",
    });
    expect(resolveTemplateForActivity("ورشة سيارات")).toEqual({
      templateKey: "industry.automotive",
      confidence: "exact",
    });
    expect(resolveTemplateForActivity("car rental")).toEqual({
      templateKey: "industry.rental_logistics",
      confidence: "exact",
    });
    expect(resolveTemplateForActivity("صيدلية")).toEqual({
      templateKey: "industry.healthcare",
      confidence: "exact",
    });
    expect(resolveTemplateForActivity("مدرسة")).toEqual({
      templateKey: "industry.education",
      confidence: "exact",
    });
    expect(resolveTemplateForActivity("مزرعة")).toEqual({
      templateKey: "industry.agriculture",
      confidence: "exact",
    });
    expect(resolveTemplateForActivity("wholesale")).toEqual({
      templateKey: "industry.wholesale",
      confidence: "exact",
    });
    expect(resolveTemplateForActivity("موزع")).toEqual({
      templateKey: "industry.distribution",
      confidence: "exact",
    });
    expect(resolveTemplateForActivity("مصنع غذائي")).toEqual({
      templateKey: "industry.food_manufacturing",
      confidence: "exact",
    });
    expect(resolveTemplateForActivity("محل جوالات")).toEqual({
      templateKey: "industry.electronics",
      confidence: "exact",
    });
  });

  it("unknown activities resolve to null — plain onboarding, no guess", () => {
    // Genuinely outside the catalog (no keyword hit in either direction —
    // "farm"-style substrings that DO hit a keyword resolve as suggestions
    // above, so the null contract is exercised with catalog-foreign text).
    expect(resolveTemplateForActivity("crypto mining rig")).toBeNull();
    expect(resolveTemplateForActivity("تعدين العملات الرقمية")).toBeNull();
    expect(resolveTemplateForActivity("yoga studio")).toBeNull();
    expect(resolveTemplateForActivity("")).toBeNull();
    expect(resolveTemplateForActivity("   ")).toBeNull();
  });
});
