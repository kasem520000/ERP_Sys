import { describe, expect, it } from "vitest";

import { normalizeAlertRules } from "./alert-rules";

/**
 * PHASE-052 (W-47 — T-07's rules half) THE ALERT-RULES FOLD'S OWN
 * TESTS: the fail-closed direction for a NOTIFICATION plane — the
 * garbage never alerts, never crashes; the envelope's defaults (owner
 * audience, warning severity) documented; the conditions field passes
 * through VERBATIM (the D-06 fold is its own validator at evaluation
 * time — never a parallel schema here).
 */

describe("normalizeAlertRules (the fail-closed notification direction)", () => {
  it("a non-array stored value reads as NO rules (the default [] world)", () => {
    expect(normalizeAlertRules(undefined)).toEqual([]);
    expect(normalizeAlertRules(null)).toEqual([]);
    expect(normalizeAlertRules("garbage")).toEqual([]);
    expect(normalizeAlertRules({ all: [] })).toEqual([]);
  });

  it("a well-formed rule normalizes with the documented defaults (owner + warning)", () => {
    const rules = normalizeAlertRules([
      { name: "High-value PO", conditions: { all: [{ field: "amountBase", op: "gt", value: "100000.0000" }] } },
    ]);
    expect(rules).toEqual([
      {
        name: "High-value PO",
        conditions: { all: [{ field: "amountBase", op: "gt", value: "100000.0000" }] },
        audience: "owner",
        severity: "warning",
      },
    ]);
  });

  it("the explicit audience + severity members survive verbatim", () => {
    const rules = normalizeAlertRules([
      {
        name: "Creator alert",
        conditions: { any: [] },
        audience: "creator",
        severity: "info",
      },
    ]);
    expect(rules[0]?.audience).toBe("creator");
    expect(rules[0]?.severity).toBe("info");
  });

  it("the malformed members are DROPPED one by one (never a crash, never an alert)", () => {
    const rules = normalizeAlertRules([
      "not-an-object",
      null,
      { conditions: { all: [] } }, // no name
      { name: "", conditions: { all: [] } }, // empty name
      { name: "x".repeat(201), conditions: { all: [] } }, // overlong name
      { name: "no-conditions" }, // absent conditions
      { name: "bad-conditions", conditions: "all" }, // non-object conditions
      { name: "bad-conditions-2", conditions: [{ field: "amountBase" }] }, // array conditions
      { name: "bad-audience", conditions: { all: [] }, audience: "everyone" },
      { name: "bad-severity", conditions: { all: [] }, severity: "critical" },
      { name: "good", conditions: { all: [] }, audience: "creator", severity: "info" },
    ]);
    expect(rules).toEqual([
      { name: "good", conditions: { all: [] }, audience: "creator", severity: "info" },
    ]);
  });

  it("the conditions field passes through VERBATIM (the D-06 fold is its own validator)", () => {
    const conditions = { all: [{ field: "customFields.urgency", op: "eq", value: "high" }] };
    const rules = normalizeAlertRules([{ name: "custom-field rule", conditions }]);
    expect(rules[0]?.conditions).toBe(conditions);
  });
});
