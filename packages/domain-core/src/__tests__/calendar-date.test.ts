import { describe, expect, it } from "vitest";
import { CalendarDate, InvalidValueError } from "../index";

describe("CalendarDate", () => {
  it("parses valid ISO calendar dates", () => {
    const d = CalendarDate.fromString("2026-10-27");
    expect(d.iso).toBe("2026-10-27");
    expect(d.toJSON()).toBe("2026-10-27");
  });

  it("rejects malformed and non-padded dates", () => {
    expect(() => CalendarDate.fromString("2026-1-7")).toThrow(InvalidValueError);
    expect(() => CalendarDate.fromString("20261027")).toThrow(InvalidValueError);
    expect(() => CalendarDate.fromString("27/10/2026")).toThrow(InvalidValueError);
  });

  it("rejects impossible calendar dates (leap-year aware)", () => {
    expect(() => CalendarDate.fromString("2026-02-29")).toThrow(InvalidValueError);
    expect(() => CalendarDate.fromString("2026-02-30")).toThrow(InvalidValueError);
    expect(() => CalendarDate.fromString("2026-13-01")).toThrow(InvalidValueError);
    expect(CalendarDate.fromString("2024-02-29").iso).toBe("2024-02-29");
  });

  it("adds days across month and year boundaries", () => {
    expect(CalendarDate.fromString("2026-01-31").addDays(1).iso).toBe("2026-02-01");
    expect(CalendarDate.fromString("2026-12-31").addDays(1).iso).toBe("2027-01-01");
    expect(CalendarDate.fromString("2026-10-27").addDays(-1).iso).toBe("2026-10-26");
  });

  it("computes day distances and comparisons", () => {
    const a = CalendarDate.fromString("2026-10-27");
    const b = CalendarDate.fromString("2026-10-31");
    expect(a.daysBetween(b)).toBe(4);
    expect(b.daysBetween(a)).toBe(-4);
    expect(a.equals(a)).toBe(true);
    expect(a.compare(b)).toBeLessThan(0);
  });

  it("resolves today in a given IANA timezone to a valid date", () => {
    const today = CalendarDate.today("Asia/Riyadh");
    expect(today.iso).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(() => CalendarDate.fromString(today.iso)).not.toThrow();
  });
});
