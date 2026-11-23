/**
 * PHASE-050 (W-29 — T-15) — the six QMS navigation rows' registry tests
 * (the NAV_ITEMS contract is BINDING data: the sidebar, the command menu
 * and the mobile tabs all consume it — these pins keep the QMS family's
 * rows exactly as the wave declared them):
 *
 * - THE FEATURE KEYS: the five register screens ride the whole-module
 *   `quality` key (D-04); the SPC screen rides the `quality.spc`
 *   composable unit.
 * - THE PERMISSION KEYS: the exact 0116-seeded viewer keys the quality
 *   controllers enforce verbatim (quality.view / quality.spc.view).
 * - BOTH LABEL SIDES present (real Arabic on the ar side — Arabic-first).
 */
import { describe, expect, it } from "vitest";

import { NAV_ITEMS } from "@erp/contracts";

const QUALITY_ROUTES = [
  "/quality/ncr",
  "/quality/capa",
  "/quality/calibration",
  "/quality/spc",
  "/quality/complaints",
  "/quality/coa",
] as const;

function rowByRoute(route: string) {
  return NAV_ITEMS.find((item) => item.route === route);
}

describe("PHASE-050 W-29 — the six QMS navigation rows (NAV_ITEMS)", () => {
  it("(a) the six rows carry the exact ids, routes and feature keys (quality ×5, quality.spc on spc)", () => {
    for (const route of QUALITY_ROUTES) {
      const row = rowByRoute(route);
      expect(row, `the ${route} registry row exists`).toBeDefined();
    }
    expect(rowByRoute("/quality/ncr")).toMatchObject({
      id: "quality.ncr",
      featureKey: "quality",
      route: "/quality/ncr",
    });
    expect(rowByRoute("/quality/capa")).toMatchObject({
      id: "quality.capa",
      featureKey: "quality",
      route: "/quality/capa",
    });
    expect(rowByRoute("/quality/calibration")).toMatchObject({
      id: "quality.calibration",
      featureKey: "quality",
      route: "/quality/calibration",
    });
    expect(rowByRoute("/quality/spc")).toMatchObject({
      id: "quality.spc",
      featureKey: "quality.spc",
      route: "/quality/spc",
    });
    expect(rowByRoute("/quality/complaints")).toMatchObject({
      id: "quality.complaints",
      featureKey: "quality",
      route: "/quality/complaints",
    });
    expect(rowByRoute("/quality/coa")).toMatchObject({
      id: "quality.coa",
      featureKey: "quality",
      route: "/quality/coa",
    });
    // The manufacturing-adjacent family (production consumes what quality
    // releases) — the list-search archetype on every row.
    for (const route of QUALITY_ROUTES) {
      expect(rowByRoute(route)).toMatchObject({
        parentGroup: "manufacturing",
        archetype: "list-search",
      });
    }
  });

  it("(b) the permission keys mirror the route-permissions rows verbatim", () => {
    expect(rowByRoute("/quality/ncr")?.permission).toBe("quality.view");
    expect(rowByRoute("/quality/capa")?.permission).toBe("quality.view");
    expect(rowByRoute("/quality/calibration")?.permission).toBe("quality.view");
    // The SPC screen rides its own composable unit's viewer key.
    expect(rowByRoute("/quality/spc")?.permission).toBe("quality.spc.view");
    expect(rowByRoute("/quality/complaints")?.permission).toBe("quality.view");
    expect(rowByRoute("/quality/coa")?.permission).toBe("quality.view");
  });

  it("(c) both label sides present on every row (real Arabic — Arabic-first)", () => {
    expect(rowByRoute("/quality/ncr")?.label).toEqual({
      ar: "حالات عدم المطابقة",
      en: "Nonconformities",
    });
    expect(rowByRoute("/quality/capa")?.label).toEqual({
      ar: "الإجراءات التصحيحية",
      en: "Corrective actions",
    });
    expect(rowByRoute("/quality/calibration")?.label).toEqual({
      ar: "معايرة الأجهزة",
      en: "Instrument calibration",
    });
    expect(rowByRoute("/quality/spc")?.label).toEqual({
      ar: "خرائط المراقبة",
      en: "Control charts",
    });
    expect(rowByRoute("/quality/complaints")?.label).toEqual({
      ar: "شكاوى العملاء",
      en: "Customer complaints",
    });
    expect(rowByRoute("/quality/coa")?.label).toEqual({
      ar: "شهادات التحليل",
      en: "Certificates of analysis",
    });
    // Every label side is non-empty (both sides render in the registry).
    for (const route of QUALITY_ROUTES) {
      const label = rowByRoute(route)?.label;
      expect(label?.ar.length ?? 0).toBeGreaterThan(0);
      expect(label?.en.length ?? 0).toBeGreaterThan(0);
    }
  });
});
