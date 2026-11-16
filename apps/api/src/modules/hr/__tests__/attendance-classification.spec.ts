import { describe, expect, it } from "vitest";

import { classifyCaptureConflict } from "../domain/attendance-classification";

/**
 * PHASE-045 (the T-19 review round) — the ORDER-INDEPENDENCE LAW of the
 * capture-conflict classification, pinned at the unit layer in BOTH row
 * orders.
 *
 * THE FINDING (the T-19 full-suite run on the unified head, 2026-11-16):
 * `listDerivationRows` carries no ORDER BY, so PostgreSQL's physical
 * (heap) order decided which row the capture path's single interleaved
 * pass met first. A duplicate-punch candidate (the same check_in as a
 * committed session, open-ended) that met the LATER sibling first
 * classified as SESSION_OVERLAP — the 0081 dedupe floor's specific
 * typed code (ATTENDANCE_DUPLICATE_PUNCH) was order-dependent. The T-17
 * suite had passed on a favorable heap order; the same code head
 * reproduced the other order in the T-19 run.
 *
 * THE FIX: the exact-match decision now runs over the WHOLE day before
 * any overlap comparison (the import path's proven floor shape —
 * ALREADY_IMPORTED before SESSION_OVERLAP), extracted as the pure
 * `classifyCaptureConflict` so the law is pinnable without a database.
 * The DB-side behaviors stay pinned by __db__/hr/attendance.spec.ts (b)
 * (the typed refusals end-to-end) and __db__/hr/inv031.spec.ts P1 (the
 * order-independent non-overlap law over six seeded permutations).
 */

const MINUTE = 60_000;
/** 2026-06-05T08:10:00+03:00 — the spec (b) day's first session opens. */
const T_0810 = Date.parse("2026-06-05T08:10:00+03:00");
const T_1200 = Date.parse("2026-06-05T12:00:00+03:00");
const T_1300 = Date.parse("2026-06-05T13:00:00+03:00");
const T_1400 = Date.parse("2026-06-05T14:00:00+03:00");
const T_1600 = Date.parse("2026-06-05T16:00:00+03:00");
const T_1100 = Date.parse("2026-06-05T11:00:00+03:00");

/** The spec (b) day: two disjoint sessions 08:10→12:00 + 13:00→16:00. */
const DAY = [
  { checkInMs: T_0810, checkOutMs: T_1200 },
  { checkInMs: T_1300, checkOutMs: T_1600 },
];

describe("PHASE-045 T-19 — the capture-conflict classification is ORDER-INDEPENDENT (the heap-order repair)", () => {
  it("(a) the exact flake shape — a duplicate-punch candidate (the same check_in, open-ended) is DUPLICATE_PUNCH in BOTH row orders: the later sibling first was the pre-fix SESSION_OVERLAP", () => {
    // Pre-fix reproduction (the T-19 full-run failure): the 13:00 row
    // met first classified the open-ended 08:10 duplicate as an overlap.
    const laterSiblingFirst = [DAY[1]!, DAY[0]!];
    expect(classifyCaptureConflict(laterSiblingFirst, T_0810, null)).toBe("DUPLICATE_PUNCH");
    expect(classifyCaptureConflict(DAY, T_0810, null)).toBe("DUPLICATE_PUNCH");
    // The closed duplicate variant (same check_in WITH a check_out) is
    // the same floor — order cannot change it either.
    expect(classifyCaptureConflict(laterSiblingFirst, T_0810, T_1200 + MINUTE)).toBe(
      "DUPLICATE_PUNCH",
    );
  });

  it("(b) a pure overlap (no exact match) is SESSION_OVERLAP in BOTH row orders — the 11:00→14:00 candidate crossing both sessions", () => {
    expect(classifyCaptureConflict(DAY, T_1100, T_1400)).toBe("SESSION_OVERLAP");
    expect(classifyCaptureConflict([DAY[1]!, DAY[0]!], T_1100, T_1400)).toBe("SESSION_OVERLAP");
    // An open-ended overlap against a LATER sibling is still an overlap.
    expect(classifyCaptureConflict(DAY, T_1100, null)).toBe("SESSION_OVERLAP");
  });

  it("(c) a disjoint candidate is accepted (null) — before, between, and after the day's sessions, open or closed", () => {
    expect(classifyCaptureConflict(DAY, T_0810 - 2 * MINUTE, T_0810 - MINUTE)).toBeNull();
    // 12:10→12:50 sits strictly inside the gap between the sessions.
    expect(classifyCaptureConflict(DAY, T_1200 + 10 * MINUTE, T_1300 - 10 * MINUTE)).toBeNull();
    expect(classifyCaptureConflict(DAY, T_1600 + MINUTE, T_1600 + 30 * MINUTE)).toBeNull();
    // An open session starting after the last sibling's end never
    // conflicts with it.
    expect(classifyCaptureConflict(DAY, T_1600 + MINUTE, null)).toBeNull();
  });

  it("(d) the ABSENT synthesis marker (null, null) never conflicts — and never masks the floor or the overlap", () => {
    const withMarker = [...DAY, { checkInMs: null, checkOutMs: null }];
    expect(classifyCaptureConflict(withMarker, T_0810, null)).toBe("DUPLICATE_PUNCH");
    expect(classifyCaptureConflict(withMarker, T_1100, T_1400)).toBe("SESSION_OVERLAP");
    expect(classifyCaptureConflict(withMarker, T_1600 + MINUTE, null)).toBeNull();
    // A marker-only day accepts any candidate.
    expect(
      classifyCaptureConflict([{ checkInMs: null, checkOutMs: null }], T_0810, T_1200),
    ).toBeNull();
  });

  it("(e) an empty day accepts everything — the capture path's first-punch case", () => {
    expect(classifyCaptureConflict([], T_0810, null)).toBeNull();
    expect(classifyCaptureConflict([], T_0810, T_1200)).toBeNull();
  });
});
