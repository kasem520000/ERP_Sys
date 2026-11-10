import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  ELECTRONICS_TEMPLATE_MANIFEST,
  GROCERY_MANIFEST,
  HEALTHCARE_TEMPLATE_MANIFEST,
  RETAIL_MANIFEST,
  WHOLESALE_TEMPLATE_MANIFEST,
} from "@erp/contracts";

import { REPORT_CONTRACTS } from "../registry";

/**
 * PHASE-030 T10 — the report-pack wiring gate (industries/reports/README
 * v2.0 mapping; register §J stays closed for 030/031):
 *
 * every report pin the new templates ship resolves against the LIVE
 * report-contract registry — wholesale (notes.maturity-calendar,
 * notes.aging, ar.aging, inventory.valuation), electronics
 * (retail.imei_register, pos.sales_by_terminal, pos.sales_by_hour,
 * inventory.valuation), and healthcare (notes.aging,
 * notes.maturity-calendar, ar.aging, inventory.expiry_list — the doc
 * spelling partners.ar_aging reconciled to the LIVE ar.aging key at the
 * manifest source per the 0025/0027/0041 convention; the other three pins
 * resolve verbatim). Resolution is exact-key, never fuzzy.
 *
 * The engine applies pins as-is (no apply-time registry check exists —
 * the PHASE-015 posture), which makes THIS spec the wiring gate: a
 * non-resolving pin in a 030/031 manifest fails here, loudly.
 *
 * Honest pre-existing note, recorded not hidden: the PHASE-015 retail +
 * grocery manifests pin `inventory.stock_valuation` — a doc spelling the
 * live registry never carried (the live key is inventory.valuation). That
 * pre-030 gap is asserted below as the KNOWN_PRE030_UNRESOLVED_PINS
 * snapshot (it predates this phase; retrofitting those two manifests is a
 * reviewed registry-hygiene change, never a silent 030/031 edit — INV-022
 * discipline: templates are versioned documents, edited only with their
 * owning phase).
 */

describe("report-pack wiring (industries/reports/README v2.0 mapping; register §J closed)", () => {
  const liveKeys = new Set(REPORT_CONTRACTS.map((contract) => contract.id));

  it("the live registry carries the 85 contracts (76 base + the 028/029 budgeting/payroll rows from the restored lineage + the 034 consolidation rows; no new report keys introduced by PHASE-030/031)", () => {
    expect(REPORT_CONTRACTS).toHaveLength(85);
  });

  it("every wholesale report pin resolves in the live registry", () => {
    const pins = WHOLESALE_TEMPLATE_MANIFEST.report_defaults;
    expect(pins.map((pin) => pin.report_key)).toEqual([
      "notes.maturity-calendar",
      "notes.aging",
      "ar.aging",
      "inventory.valuation",
    ]);
    const unresolved = pins.filter((pin) => !liveKeys.has(pin.report_key));
    expect(unresolved.map((pin) => pin.report_key).join(", ")).toBe("");
    // The two dashboard pins are the trading day's surfaces.
    expect(pins.find((pin) => pin.report_key === "notes.maturity-calendar")).toMatchObject({
      pinned: true,
      dashboard: true,
    });
    expect(pins.find((pin) => pin.report_key === "ar.aging")).toMatchObject({
      pinned: true,
      dashboard: true,
    });
  });

  it("every electronics report pin resolves in the live registry", () => {
    const pins = ELECTRONICS_TEMPLATE_MANIFEST.report_defaults;
    expect(pins.map((pin) => pin.report_key)).toEqual([
      "retail.imei_register",
      "pos.sales_by_terminal",
      "pos.sales_by_hour",
      "inventory.valuation",
    ]);
    const unresolved = pins.filter((pin) => !liveKeys.has(pin.report_key));
    expect(unresolved.map((pin) => pin.report_key).join(", ")).toBe("");
    // The two dashboard pins are the counter's surfaces.
    expect(pins.find((pin) => pin.report_key === "retail.imei_register")).toMatchObject({
      pinned: true,
      dashboard: true,
    });
    expect(pins.find((pin) => pin.report_key === "pos.sales_by_terminal")).toMatchObject({
      pinned: true,
      dashboard: true,
    });
  });

  it("every healthcare report pin resolves in the live registry (PHASE-031 — the dunning/report pack wiring)", () => {
    const pins = HEALTHCARE_TEMPLATE_MANIFEST.report_defaults;
    expect(pins.map((pin) => pin.report_key)).toEqual([
      "notes.aging",
      "notes.maturity-calendar",
      "ar.aging", // the §J reconciliation (partners.ar_aging → live registry key)
      "inventory.expiry_list", // the PHASE-015 industry contract — resolves verbatim
    ]);
    const unresolved = pins.filter((pin) => !liveKeys.has(pin.report_key));
    expect(unresolved.map((pin) => pin.report_key).join(", ")).toBe("");
    // The two dashboard pins are the billing desk's surfaces (claim aging +
    // the PDC maturity calendar); expiry control + AR aging stay pinned
    // non-dashboard (الرقابة على الصلاحية / المطالبات حسب الشركة).
    expect(pins.find((pin) => pin.report_key === "notes.aging")).toMatchObject({
      pinned: true,
      dashboard: true,
    });
    expect(pins.find((pin) => pin.report_key === "notes.maturity-calendar")).toMatchObject({
      pinned: true,
      dashboard: true,
    });
    // The PHASE-031 report-parameter extension rides the EXISTING
    // contracts — group_by_claim is a parameter on notes.aging /
    // notes.maturity-calendar / partner.statement, never a new key (the
    // schema carries the optional boolean; the register §J stays closed).
    const paramShape = (id: string) =>
      (REPORT_CONTRACTS.find((contract) => contract.id === id)!.parameters as unknown as z.ZodObject<z.ZodRawShape>)
        .shape;
    expect(paramShape("notes.aging").groupByClaim).toBeDefined();
    expect(paramShape("notes.maturity-calendar").groupByClaim).toBeDefined();
    expect(paramShape("partner.statement").groupByClaim).toBeDefined();
  });

  it("the pre-030 unresolving pins stay exactly the KNOWN_PRE030_UNRESOLVED_PINS snapshot (retail + grocery doc spellings)", () => {
    const known: readonly { manifest: string; pin: string }[] = Object.freeze([
      { manifest: "industry.retail", pin: "inventory.stock_valuation" },
      { manifest: "industry.grocery", pin: "inventory.stock_valuation" },
    ]);
    const observed: { manifest: string; pin: string }[] = [];
    for (const manifest of [RETAIL_MANIFEST, GROCERY_MANIFEST]) {
      for (const pin of manifest.report_defaults) {
        if (!liveKeys.has(pin.report_key)) {
          observed.push({ manifest: manifest.id, pin: pin.report_key });
        }
      }
    }
    expect(observed.sort((a, b) => a.manifest.localeCompare(b.manifest))).toEqual(
      [...known].sort((a, b) => a.manifest.localeCompare(b.manifest)),
    );
  });
});
