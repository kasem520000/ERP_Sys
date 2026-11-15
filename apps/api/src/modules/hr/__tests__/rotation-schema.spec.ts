import { describe, expect, it } from "vitest";

import { rotationBody } from "../presentation/hr.controller";

/**
 * PHASE-045 (T-03, the owner's independent review of 81f09e9) — the
 * rotation body's typed contract at the HTTP edge: employeeIds must be
 * UNIQUE. Pre-fix the schema accepted a repeated id and the request died
 * later at the bulk upsert on PostgreSQL's raw
 * "ON CONFLICT DO UPDATE command cannot affect row a second time"
 * (an untyped 500). The schema now refuses the duplicate list itself
 * (a 422 VALIDATION_ERROR naming employeeIds — the error filter's Zod
 * mapping), and the SERVICE re-verifies the same law for every caller
 * (ROTATION_INVALID — pinned in __db__/hr/shifts-roster.spec.ts (f)):
 * the defense-in-depth pair, one law at both layers.
 *
 * THE CASE LAW (the owner's independent review of c537113): the
 * uniqueness check was TEXTUAL, so the SAME uuid spelled once in
 * lowercase hex and once in uppercase hex passed as "distinct" — then
 * died at the bulk upsert on the SAME raw ON CONFLICT protocol error
 * (PostgreSQL's uuid type is case-insensitive: 018F… and 018f… are ONE
 * value, so the upsert still touched the same row twice). The check now
 * NORMALIZES to the canonical lowercase form BEFORE comparing — a
 * case-varied duplicate is a DUPLICATE, while a mixed-case list of
 * genuinely DISTINCT employees stays legitimate.
 */

const EMPLOYEE_A = "018f3a7a-7a7a-7000-8000-000000000001";
const EMPLOYEE_B = "018f3a7a-7a7a-7000-8000-000000000002";
const SHIFT = "018f3a7a-7a7a-7000-8000-000000000003";

function validBody(employeeIds: string[]): {
  employeeIds: string[];
  pattern: (string | null)[];
  startDate: string;
  endDate: string;
} {
  return {
    employeeIds,
    pattern: [SHIFT, SHIFT, SHIFT, SHIFT, SHIFT, null, null],
    startDate: "2026-10-01",
    endDate: "2026-10-07",
  };
}

describe("the rotation body schema — employeeIds must be UNIQUE (the duplicate-employee law)", () => {
  it("accepts the legitimate body: distinct employee ids, the 7-entry pattern, ISO dates", () => {
    const parsed = rotationBody.safeParse(validBody([EMPLOYEE_A, EMPLOYEE_B]));
    expect(parsed.success).toBe(true);
  });

  it("rejects the SAME employee twice — the field error names employeeIds (pre-fix the schema accepted it and SQL died on the raw ON CONFLICT protocol error)", () => {
    const parsed = rotationBody.safeParse(
      validBody([EMPLOYEE_A, EMPLOYEE_B, EMPLOYEE_A]),
    );
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const employeeIssues = parsed.error.issues.filter((issue) =>
        issue.path.includes("employeeIds"),
      );
      expect(employeeIssues.length).toBeGreaterThan(0);
      // The issue names the uniqueness law, not a generic shape failure.
      const messages = employeeIssues.map((issue) => issue.message).join(" ");
      expect(messages).toContain("unique");
    }
  });

  it("still enforces the standing shape bounds: empty list refused, >200 refused, non-uuid refused", () => {
    expect(rotationBody.safeParse(validBody([])).success).toBe(false);
    const tooMany = Array.from({ length: 201 }, (_, i) =>
      // 201 DISTINCT valid uuids — the ceiling law, independent of uniqueness.
      `018f3a7a-7a7a-7000-8000-${String(i).padStart(12, "0")}`,
    );
    expect(rotationBody.safeParse(validBody(tooMany)).success).toBe(false);
    expect(
      rotationBody.safeParse(validBody(["not-a-uuid", EMPLOYEE_B])).success,
    ).toBe(false);
  });

  it("rejects the SAME employee across HEX CASE (the c537113 review): 018f… and 018F… are ONE uuid to PostgreSQL, so the case-varied pair is a DUPLICATE — pre-fix the textual Set saw two 'distinct' strings and the request died later at the raw ON CONFLICT protocol error; the field error still names employeeIds and the message the uniqueness law", () => {
    // The SAME uuid as EMPLOYEE_A, every hex letter uppercased.
    const parsed = rotationBody.safeParse(
      validBody([EMPLOYEE_A, EMPLOYEE_B, EMPLOYEE_A.toUpperCase()]),
    );
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const employeeIssues = parsed.error.issues.filter((issue) =>
        issue.path.includes("employeeIds"),
      );
      expect(employeeIssues.length).toBeGreaterThan(0);
      const messages = employeeIssues.map((issue) => issue.message).join(" ");
      expect(messages).toContain("unique");
    }

    // And with a PARTIAL case mix (only some segments uppercased) — the
    // normalization must be total, never a full-uppercase special case.
    const partiallyCased = `${EMPLOYEE_A.slice(0, 14).toUpperCase()}${EMPLOYEE_A.slice(14)}`;
    const partial = rotationBody.safeParse(
      validBody([partiallyCased, EMPLOYEE_B, EMPLOYEE_A]),
    );
    expect(partial.success).toBe(false);
    if (!partial.success) {
      const employeeIssues = partial.error.issues.filter((issue) =>
        issue.path.includes("employeeIds"),
      );
      expect(employeeIssues.length).toBeGreaterThan(0);
      const messages = employeeIssues.map((issue) => issue.message).join(" ");
      expect(messages).toContain("unique");
    }
  });

  it("accepts a MIXED-CASE list of genuinely DISTINCT employees — the normalization exists to catch the case-varied duplicate, never to reject a legitimate mixed-case list", () => {
    const parsed = rotationBody.safeParse(
      validBody([EMPLOYEE_A.toUpperCase(), EMPLOYEE_B.toLowerCase()]),
    );
    expect(parsed.success).toBe(true);
  });
});
