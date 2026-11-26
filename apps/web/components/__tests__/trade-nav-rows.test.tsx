/**
 * PHASE-051 (W-39 — T-14) — the five foreign-trade navigation rows'
 * registry tests (the NAV_ITEMS contract is BINDING data: the sidebar,
 * the command menu and the mobile tabs all consume it — these pins keep
 * the trade family's rows exactly as the wave declared them, D-17):
 *
 * - THE FEATURE KEYS: `trade.lc` on the LC row + `trade.customs` on the
 *   customs row (the two composable plane units — D-04) and the
 *   whole-module `trade` key on the shipments board, the Incoterms
 *   reference page and the certificates print surface.
 * - THE PERMISSION KEYS: the exact 0122-seeded keys the trade
 *   controllers enforce verbatim (trade.lc.view · trade.customs.view ·
 *   trade.shipments.view · trade.view).
 * - BOTH LABEL SIDES present (real Arabic on the ar side — Arabic-first).
 * - The family rides the PURCHASING group (the trade module composes on
 *   purchasing.landed_costs — D-04's own dependency).
 */
import { describe, expect, it } from "vitest";

import { NAV_ITEMS } from "@erp/contracts";

const TRADE_ROUTES = [
  "/trade/lc",
  "/trade/customs",
  "/trade/shipments",
  "/trade/incoterms",
  "/trade/certificates",
] as const;

function rowByRoute(route: string) {
  return NAV_ITEMS.find((item) => item.route === route);
}

describe("PHASE-051 W-39 — the five foreign-trade navigation rows (NAV_ITEMS)", () => {
  it("(a) the five rows carry the exact ids, routes and feature keys (trade.lc + trade.customs + trade ×3)", () => {
    for (const route of TRADE_ROUTES) {
      const row = rowByRoute(route);
      expect(row, `the ${route} registry row exists`).toBeDefined();
    }
    expect(rowByRoute("/trade/lc")).toMatchObject({
      id: "trade.lc",
      featureKey: "trade.lc",
      route: "/trade/lc",
    });
    expect(rowByRoute("/trade/customs")).toMatchObject({
      id: "trade.customs",
      featureKey: "trade.customs",
      route: "/trade/customs",
    });
    // The three whole-module rows ride the plain `trade` key (D-04's
    // binding shape — the two composable plane units carry their own).
    expect(rowByRoute("/trade/shipments")).toMatchObject({
      id: "trade.shipments",
      featureKey: "trade",
      route: "/trade/shipments",
    });
    expect(rowByRoute("/trade/incoterms")).toMatchObject({
      id: "trade.incoterms",
      featureKey: "trade",
      route: "/trade/incoterms",
    });
    expect(rowByRoute("/trade/certificates")).toMatchObject({
      id: "trade.certificates",
      featureKey: "trade",
      route: "/trade/certificates",
    });
    // The family rides the PURCHASING group (the trade module composes on
    // purchasing.landed_costs — D-04's own dependency; the import leg is
    // procurement's own foreign-trade face).
    for (const route of TRADE_ROUTES) {
      expect(rowByRoute(route)).toMatchObject({
        parentGroup: "purchasing",
      });
    }
  });

  it("(b) the permission keys mirror the route-permissions rows verbatim", () => {
    expect(rowByRoute("/trade/lc")?.permission).toBe("trade.lc.view");
    expect(rowByRoute("/trade/customs")?.permission).toBe("trade.customs.view");
    expect(rowByRoute("/trade/shipments")?.permission).toBe("trade.shipments.view");
    // The reference page + the certificates register ride the
    // whole-module viewer key (the incoterms/bonded reads' own shape).
    expect(rowByRoute("/trade/incoterms")?.permission).toBe("trade.view");
    expect(rowByRoute("/trade/certificates")?.permission).toBe("trade.view");
  });

  it("(c) both label sides present on every row (real Arabic — Arabic-first)", () => {
    expect(rowByRoute("/trade/lc")?.label).toEqual({
      ar: "الاعتمادات المستندية",
      en: "Letters of credit",
    });
    expect(rowByRoute("/trade/customs")?.label).toEqual({
      ar: "التصريحات الجمركية",
      en: "Customs declarations",
    });
    expect(rowByRoute("/trade/shipments")?.label).toEqual({
      ar: "تتبع الشحنات",
      en: "Shipment tracking",
    });
    expect(rowByRoute("/trade/incoterms")?.label).toEqual({
      ar: "مصطلحات التجارة",
      en: "Incoterms",
    });
    expect(rowByRoute("/trade/certificates")?.label).toEqual({
      ar: "شهادات المنشأ والمطابقة",
      en: "Certificates of origin",
    });
    // Every label side is non-empty (both sides render in the registry).
    for (const route of TRADE_ROUTES) {
      const label = rowByRoute(route)?.label;
      expect(label?.ar.length ?? 0).toBeGreaterThan(0);
      expect(label?.en.length ?? 0).toBeGreaterThan(0);
    }
  });
});
