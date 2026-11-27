import { describe, expect, it } from "vitest";

import {
  DEFAULT_ESCALATION_REMINDER_HOURS,
  dueDateAxis,
  escalationDedupeKey,
  isBreached,
  normalizeReminderHours,
  reminderDue,
  slaDueAt,
} from "./sla-fold";

/**
 * PHASE-052 (W-43 — the unit-first law) THE SLA FOLD'S PROPERTY TESTS
 * (the lc-sweep-math precedent: the pure layer proven BEFORE the W-45
 * sweep renders it) — the derived due date, the breach verdict, the
 * reminder cadence's fail-closed normalize, and the structural dedupe
 * key's own axes (the day axis the DUE DATE, never the current day).
 */

describe("THE DUE DATE (the derived step — no Date.now() in this path)", () => {
  it("the assignment instant + whole hours (absolute epoch math, no DST drift)", () => {
    expect(slaDueAt("2026-11-27T09:00:00Z", 24)).toBe("2026-11-28T09:00:00.000Z");
    expect(slaDueAt("2026-11-27T09:00:00Z", 1)).toBe("2026-11-27T10:00:00.000Z");
    expect(slaDueAt("2026-12-31T23:00:00Z", 2)).toBe("2027-01-01T01:00:00.000Z");
  });

  it("the 0127 floor defended: whole hours ≥ 1 only", () => {
    expect(() => slaDueAt("2026-11-27T09:00:00Z", 0)).toThrow(RangeError);
    expect(() => slaDueAt("2026-11-27T09:00:00Z", -1)).toThrow(RangeError);
    expect(() => slaDueAt("2026-11-27T09:00:00Z", 1.5)).toThrow(RangeError);
  });
});

describe("the breach verdict", () => {
  it("the due instant passed at the sweep's own now", () => {
    expect(isBreached("2026-11-27T09:00:00Z", "2026-11-27T09:00:01Z")).toBe(true);
    expect(isBreached("2026-11-27T09:00:00Z", "2026-11-27T09:00:00Z")).toBe(false);
    expect(isBreached("2026-11-27T09:00:00Z", "2026-11-26T09:00:00Z")).toBe(false);
  });
});

describe("THE REMINDER CADENCE (the settings registry's fail-closed normalize)", () => {
  it("the documented default: ONE reminder 24h after the due instant", () => {
    expect(DEFAULT_ESCALATION_REMINDER_HOURS).toBe(24);
    expect(normalizeReminderHours([])).toEqual([24]);
    expect(normalizeReminderHours(["garbage", null, false, {}, 1.5])).toEqual([24]);
  });

  it("THE COERCION CLASS REFUSED: null/bool/floats DROP, never coerce (Number(null) === 0 would fabricate an immediate reminder)", () => {
    expect(normalizeReminderHours([null, 24, 48])).toEqual([24, 48]);
    expect(normalizeReminderHours([null])).toEqual([24]);
    expect(normalizeReminderHours([0])).toEqual([24]); // 0 is below the floor — the default
  });

  it("duplicates drop; integers and STRICT integer strings parse; the sort ASCENDING", () => {
    expect(normalizeReminderHours([48, 24, 48, "24"])).toEqual([24, 48]);
    expect(normalizeReminderHours([" 72 ", 6])).toEqual([6, 72]);
    expect(normalizeReminderHours(["1.0", "01", "-3"])).toEqual([24]);
  });

  it("the reminder threshold: crossed at the cadence hours after the due instant", () => {
    const due = "2026-11-27T09:00:00Z";
    expect(reminderDue(due, "2026-11-27T09:00:00Z", [24])).toBe(false);
    expect(reminderDue(due, "2026-11-28T08:59:59Z", [24])).toBe(false);
    expect(reminderDue(due, "2026-11-28T09:00:00Z", [24])).toBe(true);
    expect(reminderDue(due, "2026-11-30T09:00:00Z", [24, 72])).toBe(true);
  });
});

describe("THE STRUCTURAL DEDUPE (the 0111/0123 axes law)", () => {
  it("THE DAY AXIS IS THE DUE DATE (never the current day — the convergence law)", () => {
    expect(dueDateAxis("2026-11-27T23:59:59Z")).toBe("2026-11-27");
    expect(dueDateAxis("2026-11-28T00:00:01Z")).toBe("2026-11-28");
    expect(escalationDedupeKey("step-1", "REMINDER", "2026-11-27T09:00:00Z")).toBe(
      "workflow:sla:step-1:REMINDER:2026-11-27",
    );
    expect(escalationDedupeKey("step-1", "REASSIGN", "2026-11-27T09:00:00Z")).toBe(
      "workflow:sla:step-1:REASSIGN:2026-11-27",
    );
  });

  it("one key per step + kind + day, EVER — re-runs and raced passes converge", () => {
    const first = escalationDedupeKey("step-1", "NOTIFY", "2026-11-27T09:00:00Z");
    const replay = escalationDedupeKey("step-1", "NOTIFY", "2026-11-27T09:00:00Z");
    expect(first).toBe(replay);
    // a DIFFERENT step or kind is a different event; the SAME step the
    // next day is a different day axis ONLY through a new due date
    // (the due date never moves for a step — one day axis per breach).
    expect(escalationDedupeKey("step-2", "NOTIFY", "2026-11-27T09:00:00Z")).not.toBe(first);
    expect(escalationDedupeKey("step-1", "REMINDER", "2026-11-27T09:00:00Z")).not.toBe(first);
  });
});
