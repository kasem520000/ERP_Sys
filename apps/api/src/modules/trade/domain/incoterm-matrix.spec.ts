import { describe, expect, it } from "vitest";

import {
  incotermMandateTriggered,
  incotermMandateVerdict,
  renderIncotermMatrix,
  type IncotermRowShape,
} from "./incoterm-matrix";

/**
 * PHASE-051 (W-35 — T-08) the Incoterm matrix fold's PROPERTY TESTS
 * (the unit-first law — the pure layer proven BEFORE the service
 * renders it): the matrix renders five AR/EN lines from the row's own
 * booleans (the total 2^5 product), the lines flip with the data (the
 * registry is the one source — no parallel dictionary), and BR-106's
 * trigger rule (the owner's ruling (ج) VERBATIM) holds over the full
 * currency × marker product.
 */

const SEED_ROW: IncotermRowShape = {
  code: "CIF",
  name: "Cost, Insurance and Freight",
  nameAr: "التكلفة والتأمين والنولون",
  carriageBySeller: true,
  insuranceBySeller: true,
  exportClearanceBySeller: true,
  importClearanceBySeller: false,
  importDutyBySeller: false,
};

describe("the risk-hint matrix (the registry row's own data)", () => {
  it("FIVE LINES, AR/EN — one per ownership axis, the 0120 column set's own order", () => {
    const hints = renderIncotermMatrix(SEED_ROW);
    expect(hints.en).toHaveLength(5);
    expect(hints.ar).toHaveLength(5);
  });

  it("the lines render from the row's OWN booleans — the registry is the one source", () => {
    const hints = renderIncotermMatrix(SEED_ROW);
    expect(hints.en[0]).toContain("SELLER arranges");
    expect(hints.en[1]).toContain("SELLER procures");
    expect(hints.en[2]).toContain("SELLER's obligation");
    expect(hints.en[3]).toContain("BUYER's obligation");
    expect(hints.en[4]).toContain("BUYER bears");
    expect(hints.ar[0]).toContain("البائع يرتّبه");
    expect(hints.ar[3]).toContain("المشتري");
    expect(hints.ar[4]).toContain("المشتري");
  });

  it("TOTAL: every boolean combination renders both sides — 2^5 rows, no silence anywhere", () => {
    const keys = [
      "carriageBySeller",
      "insuranceBySeller",
      "exportClearanceBySeller",
      "importClearanceBySeller",
      "importDutyBySeller",
    ] as const;
    for (let mask = 0; mask < 1 << 5; mask += 1) {
      const booleans: Record<string, boolean> = {};
      keys.forEach((key, bit) => {
        booleans[key] = (mask & (1 << (4 - bit))) !== 0;
      });
      const row = { ...SEED_ROW, ...booleans } as IncotermRowShape;
      const hints = renderIncotermMatrix(row);
      expect(hints.en).toHaveLength(5);
      expect(hints.ar).toHaveLength(5);
      keys.forEach((key, bit) => {
        const seller = booleans[key]!;
        // The axis's line names the side that owns the obligation —
        // the seller's line on true, the buyer's on false, both AR/EN.
        expect(hints.en[bit]).toContain(seller ? "SELLER" : "BUYER");
        expect(hints.ar[bit]).toContain(seller ? "البائع" : "المشتري");
      });
    }
  });

  it("the flip property: flipping one boolean flips exactly its own line (AR/EN), never another", () => {
    const before = renderIncotermMatrix(SEED_ROW);
    const flipped: IncotermRowShape = { ...SEED_ROW, importDutyBySeller: true };
    const after = renderIncotermMatrix(flipped);
    for (let i = 0; i < 4; i += 1) {
      expect(after.en[i]).toBe(before.en[i]);
      expect(after.ar[i]).toBe(before.ar[i]);
    }
    expect(after.en[4]).not.toBe(before.en[4]);
    expect(after.ar[4]).not.toBe(before.ar[4]);
    expect(after.en[4]).toContain("SELLER bears");
    expect(after.ar[4]).toContain("البائع");
  });

  it("the 2020 seed's own shapes: EXW renders all-buyer; DDP renders all-seller (the ICC matrix as data)", () => {
    const exw = renderIncotermMatrix({
      code: "EXW",
      name: "Ex Works",
      nameAr: "تسليم المصنع",
      carriageBySeller: false,
      insuranceBySeller: false,
      exportClearanceBySeller: false,
      importClearanceBySeller: false,
      importDutyBySeller: false,
    });
    expect(exw.en.every((line) => line.includes("BUYER"))).toBe(true);
    const ddp = renderIncotermMatrix({
      code: "DDP",
      name: "Delivered Duty Paid",
      nameAr: "التسليم الرسوم مدفوعة",
      carriageBySeller: true,
      insuranceBySeller: false,
      exportClearanceBySeller: true,
      importClearanceBySeller: true,
      importDutyBySeller: true,
    });
    // DDP: the seller owns carriage, both clearances and the duty; the
    // insurance stays the buyer's under the 2020 seed (the 0122 VALUE
    // row's own booleans — never restated here from memory).
    expect(ddp.en[0]).toContain("SELLER");
    expect(ddp.en[2]).toContain("SELLER");
    expect(ddp.en[3]).toContain("SELLER");
    expect(ddp.en[4]).toContain("SELLER");
    expect(ddp.en[1]).toContain("BUYER");
  });
});

describe("BR-106's mandate trigger (the owner's ruling (ج) VERBATIM)", () => {
  it("the currency arm: a foreign-currency order triggers on its own", () => {
    const verdict = incotermMandateVerdict({
      currency: "USD",
      baseCurrency: "SAR",
      tradeDirection: null,
    });
    expect(verdict.triggered).toBe(true);
    expect(verdict.arms).toHaveLength(1);
    expect(verdict.arms[0]).toContain("CURRENCY");
  });

  it("the marker arm: a base-currency order with the import/export tag triggers on its own", () => {
    for (const direction of ["IMPORT", "EXPORT"] as const) {
      const verdict = incotermMandateVerdict({
        currency: "SAR",
        baseCurrency: "SAR",
        tradeDirection: direction,
      });
      expect(verdict.triggered).toBe(true);
      expect(verdict.arms).toHaveLength(1);
      expect(verdict.arms[0]).toContain("MARKER");
      expect(verdict.arms[0]).toContain(direction);
    }
  });

  it("both arms together: the foreign currency AND the tag — two named arms", () => {
    const verdict = incotermMandateVerdict({
      currency: "EUR",
      baseCurrency: "SAR",
      tradeDirection: "EXPORT",
    });
    expect(verdict.triggered).toBe(true);
    expect(verdict.arms).toHaveLength(2);
  });

  it("the untriggered shape: base currency, no marker — the mandate sleeps", () => {
    const verdict = incotermMandateVerdict({
      currency: "SAR",
      baseCurrency: "SAR",
      tradeDirection: null,
    });
    expect(verdict.triggered).toBe(false);
    expect(verdict.arms).toHaveLength(0);
    expect(incotermMandateTriggered({ currency: "SAR", baseCurrency: "SAR", tradeDirection: null })).toBe(false);
  });

  it("TOTAL: every currency-pair × marker product carries a verdict — no silence anywhere", () => {
    for (const same of [true, false]) {
      for (const direction of ["IMPORT", "EXPORT", null] as const) {
        const verdict = incotermMandateVerdict({
          currency: same ? "SAR" : "USD",
          baseCurrency: "SAR",
          tradeDirection: direction,
        });
        const expected = !same || direction !== null;
        expect(verdict.triggered).toBe(expected);
        expect(verdict.arms.length).toBe((same ? 0 : 1) + (direction !== null ? 1 : 0));
      }
    }
  });
});
