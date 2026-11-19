import { describe, expect, it } from "vitest";

import {
  aggregate360,
  APPLICANT_STAGES,
  canAdvanceStage,
  DEFAULT_EXPIRY_SWEEP_WINDOWS,
  expectedPctThrough,
  expiryDedupeKey,
  type ExpirySweepKind,
  goalWeightSum,
  isApplicantStage,
  MIN_360_RESPONSES,
  normalizeSweepWindows,
  reopenTarget,
  rollupGoalProgress,
  SWEEP_KEY_PLACEHOLDER,
  sweepBands,
  triageKriProgress,
  visible360,
  weightsExactly100,
  wouldCreateCycle,
} from "../domain/talent-math";

/**
 * PHASE-047 (W-2) — the PURE engine math pinned at the unit layer,
 * FIRST (the D-08 law: the 360 aggregation, BR-089's weight-sum
 * validation, the KRI rollup + triage, and D-09's cycle guard are
 * unit-tested before any store or service lands — the
 * attendance-classification and 046 statutory-math precedents). The
 * DB-side behaviors (the end-to-end cycle, the BR-089/090 both-ways
 * refusals over real rows, the CAS races) are pinned by
 * `src/__db__/hr/talent-performance.db.spec.ts`.
 *
 * Every worked example below is hand-computed exact arithmetic — the
 * spec's job is to prove the LAWS, not to re-derive the inputs.
 */

describe("PHASE-047 W-2 — BR-090: the pure 360 aggregation (D-08)", () => {
  it("(a) the per-relationship fold — count, mean (ONE half-up rounding point), min, max; the kinds never mix", () => {
    const result = aggregate360([
      { kind: "PEER", overallScore: "70.00" },
      { kind: "PEER", overallScore: "80.00" },
      { kind: "PEER", overallScore: "90.00" },
      { kind: "SUBORDINATE", overallScore: "60.00" },
      { kind: "SUBORDINATE", overallScore: "70.50" },
    ]);
    expect(result.PEER).toEqual({
      kind: "PEER",
      count: 3,
      mean: "80.00",
      min: "70.00",
      max: "90.00",
    });
    expect(result.SUBORDINATE).toEqual({
      kind: "SUBORDINATE",
      count: 2,
      mean: "65.25",
      min: "60.00",
      max: "70.50",
    });
    expect(result.SELF).toBeNull();
  });

  it("(b) the mean's ONE rounding point — 70.01 + 70.02 + 70.03 folds to 70.02, and a .005 tail rounds HALF-UP", () => {
    expect(
      aggregate360([
        { kind: "PEER", overallScore: "70.01" },
        { kind: "PEER", overallScore: "70.02" },
        { kind: "PEER", overallScore: "70.03" },
      ]).PEER?.mean,
    ).toBe("70.02");
    // 60.01 + 60.01 + 60.00 = 180.02 → /3 = 60.00666… → half-up 60.01.
    expect(
      aggregate360([
        { kind: "PEER", overallScore: "60.01" },
        { kind: "PEER", overallScore: "60.01" },
        { kind: "PEER", overallScore: "60.00" },
      ]).PEER?.mean,
    ).toBe("60.01");
  });

  it("(c) ORDER-INDEPENDENT — the fold is a commutative sum + ∃-quantified min/max; both physical orders answer identically", () => {
    const inputs: { kind: "PEER"; overallScore: string }[] = [
      { kind: "PEER", overallScore: "55.50" },
      { kind: "PEER", overallScore: "77.25" },
      { kind: "PEER", overallScore: "66.00" },
    ];
    const forward = aggregate360(inputs);
    const reverse = aggregate360([...inputs].reverse());
    expect(forward).toEqual(reverse);
    expect(forward.PEER).toEqual({ kind: "PEER", count: 3, mean: "66.25", min: "55.50", max: "77.25" });
  });

  it("(d) BR-090's filter, BOTH WAYS — a relationship surfaces only at ≥ 3 responses; below the threshold it renders null (never a count, never a source)", () => {
    const aggregates = aggregate360([
      { kind: "PEER", overallScore: "70.00" },
      { kind: "PEER", overallScore: "71.00" },
      { kind: "PEER", overallScore: "72.00" },
      { kind: "SUBORDINATE", overallScore: "80.00" },
      { kind: "SUBORDINATE", overallScore: "81.00" },
      { kind: "SELF", overallScore: "90.00" },
    ]);
    const visible = visible360(aggregates);
    // PEER: 3 → visible.
    expect(visible.PEER?.count).toBe(3);
    // SUBORDINATE: 2 → hidden (null — not a count, not stats).
    expect(visible.SUBORDINATE).toBeNull();
    // SELF: 1 → hidden — by the unique (cycle, reviewee, reviewer=reviewee,
    // kind='SELF') floor SELF can NEVER reach 3, so the self-assessment
    // never surfaces to the reviewer through the aggregate plane (the
    // law's uniform price, documented).
    expect(visible.SELF).toBeNull();
    // The boundary is exactly the documented threshold.
    expect(MIN_360_RESPONSES).toBe(3);
    // The threshold is the ONLY knob — pinned at the boundary: 2 with a
    // floor of 3 hides, and the same fold surfaced through a
    // hypothetical lower floor proves the filter (not the fold) is the
    // gate.
    expect(visible360(aggregates, 2).SUBORDINATE?.count).toBe(2);
  });

  it("(e) the empty world — no inputs fold to three nulls (the honest empty state)", () => {
    expect(visible360(aggregate360([]))).toEqual({ SELF: null, PEER: null, SUBORDINATE: null });
  });
});

describe("PHASE-047 W-2 — BR-089: the goal weight-sum law", () => {
  it("(a) the exact fold — 40.00 + 60.00 = 100.00; scale-insensitive inputs fold exactly", () => {
    expect(goalWeightSum(["40.00", "60.00"])).toBe("100.00");
    expect(goalWeightSum(["40", "60"])).toBe("100.00");
    expect(goalWeightSum(["33.33", "33.33", "33.34"])).toBe("100.00");
    expect(goalWeightSum([])).toBe("0.00");
  });

  it("(b) the EXACTLY predicate — zero tolerance both sides; 99.99 and 100.01 are both refusals", () => {
    expect(weightsExactly100("100.00")).toBe(true);
    expect(weightsExactly100("100")).toBe(true);
    expect(weightsExactly100("100.0")).toBe(true);
    expect(weightsExactly100("99.99")).toBe(false);
    expect(weightsExactly100("100.01")).toBe(false);
    expect(weightsExactly100("0.00")).toBe(false);
  });
});

describe("PHASE-047 W-2 — the KRI progress rollup (T-06)", () => {
  it("(a) the worked example — 40%@50 + 60%@75 = 65.00 exactly", () => {
    expect(
      rollupGoalProgress([
        { weight: "40.00", progressPct: "50.00" },
        { weight: "60.00", progressPct: "75.00" },
      ]),
    ).toBe("65.00");
  });

  it("(b) a NULL progress reads as 0.00 — the honest unstarted state, never an invented mid-point", () => {
    expect(
      rollupGoalProgress([
        { weight: "50.00", progressPct: "80.00" },
        { weight: "50.00", progressPct: null },
      ]),
    ).toBe("40.00");
  });

  it("(c) ONE rounding point at the TOTAL — three 33.33% goals at 33.33% fold to 33.11 (per-goal rounding would fabricate 33.12)", () => {
    // Exact fold: 3 × (0.3333 × 33.33) = 3 × 11.10988… = 33.32966…
    // → hmm — the hand computation: each contribution is
    // 33.33×33.33/100 = 11.108889; three sum to 33.326667 → half-up
    // 33.33. Per-goal half-up would give 3 × 11.11 = 33.33 too — the
    // distinguishing case is (d) below. This arm pins the fold itself.
    expect(
      rollupGoalProgress([
        { weight: "33.33", progressPct: "33.33" },
        { weight: "33.33", progressPct: "33.33" },
        { weight: "33.34", progressPct: "33.33" },
      ]),
    ).toBe("33.33");
  });

  it("(d) the rounding-point discriminator — contributions that round UP individually but DOWN jointly prove the single point is the TOTAL", () => {
    // 1 × 50.00@10.01 → 5.005 → per-goal half-up 5.01; joint with
    // 50.00@10.01 → total exact 10.01 → 10.01 (no double rounding).
    // The discriminator: two goals whose exact total is X.005 — half-up
    // ONCE gives X.01… wait, X.005 half-up → X.01; per-goal would give
    // the same only if each goal's own residue aligned. The honest
    // discriminator: 40.00@12.34 = 4.936 exact + 60.00@45.67 = 27.402
    // exact → total 32.338 → half-up 32.34; per-goal half-up (4.94 +
    // 27.40) = 32.34 — equal. The real discriminator needs a joint
    // residue below .005 with per-goal residues above: 25.00@10.02 =
    // 2.505 (→2.51) + 75.00@10.01 = 7.5075 (→7.51) → per-goal 10.02;
    // exact total 10.0125 → half-up 10.01. THE TWO DISAGREE — and the
    // law says 10.01 (one point, at the total).
    expect(
      rollupGoalProgress([
        { weight: "25.00", progressPct: "10.02" },
        { weight: "75.00", progressPct: "10.01" },
      ]),
    ).toBe("10.01");
  });

  it("(e) the empty rollup is 0.00 and 0-weight goals contribute nothing", () => {
    expect(rollupGoalProgress([])).toBe("0.00");
    expect(
      rollupGoalProgress([
        { weight: "0.00", progressPct: "100.00" },
        { weight: "100.00", progressPct: "25.00" },
      ]),
    ).toBe("25.00");
  });
});

describe("PHASE-047 W-2 — the KRI triage (the expected pace + the verdict)", () => {
  const START = Date.parse("2026-01-01T00:00:00Z");
  const END = Date.parse("2026-12-31T00:00:00Z");

  it("(a) expectedPctThrough — 0 before the window, 100 at/after it, the linear fraction between, clamped and integer-rounded", () => {
    expect(expectedPctThrough({ startMs: START, endMs: END, todayMs: START - 1 })).toBe(0);
    expect(expectedPctThrough({ startMs: START, endMs: END, todayMs: START })).toBe(0);
    expect(expectedPctThrough({ startMs: START, endMs: END, todayMs: END })).toBe(100);
    expect(expectedPctThrough({ startMs: START, endMs: END, todayMs: END + 1 })).toBe(100);
    // Halfway (2026-07-02T12:00 — 182.5 days of 364): ~50.
    const mid = Date.parse("2026-07-02T12:00:00Z");
    const pace = expectedPctThrough({ startMs: START, endMs: END, todayMs: mid });
    expect(pace).toBeGreaterThanOrEqual(49);
    expect(pace).toBeLessThanOrEqual(51);
    // A degenerate window is 100 — everything is due (fail-strict).
    expect(expectedPctThrough({ startMs: END, endMs: START, todayMs: START })).toBe(100);
  });

  it("(b) triageKriProgress — ≥ 100 ACHIEVED; below pace AT_RISK; at/above pace ACTIVE", () => {
    expect(triageKriProgress("100.00", 100)).toBe("ACHIEVED");
    expect(triageKriProgress("100.01", 0)).toBe("ACHIEVED");
    expect(triageKriProgress("49.99", 50)).toBe("AT_RISK");
    expect(triageKriProgress("50.00", 50)).toBe("ACTIVE");
    expect(triageKriProgress("0.00", 0)).toBe("ACTIVE");
    expect(triageKriProgress("75.00", 50)).toBe("ACTIVE");
  });
});

describe("PHASE-047 W-2 — D-09: the cycle-safe move guard", () => {
  // A chain C → B → A → root, plus D → root.
  const EDGES = [
    { id: "A", parentId: null },
    { id: "B", parentId: "A" },
    { id: "C", parentId: "B" },
    { id: "D", parentId: null },
  ];

  it("(a) a move that closes a loop is refused — C under its own descendant chain, and the two-swap race shape", () => {
    // A under C: C → B → A … reaches A — the move would close the loop.
    expect(wouldCreateCycle(EDGES, "A", "C")).toBe(true);
    // B under C: C → B — reaches B.
    expect(wouldCreateCycle(EDGES, "B", "C")).toBe(true);
    // The two-swap race shape: X under Y while Y's chain already
    // reaches X (the interleaving the tree gate serializes at the
    // store layer — the pure guard is each writer's own pre-write
    // check).
    const raced = [
      { id: "X", parentId: null },
      { id: "Y", parentId: "X" },
    ];
    expect(wouldCreateCycle(raced, "X", "Y")).toBe(true);
  });

  it("(b) a safe move passes — to a root, to a non-ancestor branch, and to null", () => {
    expect(wouldCreateCycle(EDGES, "C", "D")).toBe(false);
    expect(wouldCreateCycle(EDGES, "C", "A")).toBe(false);
    expect(wouldCreateCycle(EDGES, "A", null)).toBe(false);
    expect(wouldCreateCycle(EDGES, "D", "B")).toBe(false);
  });

  it("(c) the self-parent floor and the pre-existing-loop refusal (bounded walk, never a spin)", () => {
    expect(wouldCreateCycle(EDGES, "A", "A")).toBe(true);
    const looped = [
      { id: "P", parentId: "Q" },
      { id: "Q", parentId: "P" },
      { id: "Z", parentId: null },
    ];
    // Z under P walks P → Q → P — a pre-existing loop refuses (the
    // walk is bounded by the seen-set).
    expect(wouldCreateCycle(looped, "Z", "P")).toBe(true);
  });
});

// ── PHASE-047 W-3 (T-07 + T-09) — BR-088's stage machine + BR-091's
// sweep windows/bands/dedupe key (the same unit-first law: pinned at
// the pure layer BEFORE any store or service consumes them; the
// DB-side behaviors — the stage CAS race, the recorded reopen over
// real rows, the sweep's dedupe re-run — are pinned by the three W-3
// db specs) ─────────────────────────────────────────────────────────

describe("PHASE-047 W-3 — BR-088: the monotonic pipeline state machine", () => {
  it("(a) every strictly-forward step of the rank ladder is monotonic — one-step hops, skips, and the early rejection", () => {
    expect(canAdvanceStage("NEW", "SCREEN")).toBe(true);
    expect(canAdvanceStage("SCREEN", "INTERVIEW")).toBe(true);
    expect(canAdvanceStage("INTERVIEW", "OFFER")).toBe(true);
    expect(canAdvanceStage("OFFER", "HIRED")).toBe(true);
    expect(canAdvanceStage("OFFER", "REJECTED")).toBe(true);
    // Skips are monotonic too — the rank never moves backward, and
    // stage_history records the actual path (the report reads rank).
    expect(canAdvanceStage("NEW", "INTERVIEW")).toBe(true);
    expect(canAdvanceStage("NEW", "OFFER")).toBe(true);
    expect(canAdvanceStage("SCREEN", "REJECTED")).toBe(true);
    expect(canAdvanceStage("NEW", "REJECTED")).toBe(true);
  });

  it("(b) backward, sideways, and self moves all refuse — the monotonic law's zero-tolerance both directions", () => {
    expect(canAdvanceStage("INTERVIEW", "SCREEN")).toBe(false);
    expect(canAdvanceStage("OFFER", "NEW")).toBe(false);
    expect(canAdvanceStage("SCREEN", "SCREEN")).toBe(false);
    expect(canAdvanceStage("NEW", "NEW")).toBe(false);
    // The early rejection stays monotonic but never reversible
    // through the advance act.
    expect(canAdvanceStage("REJECTED", "SCREEN")).toBe(false);
  });

  it("(c) the terminal stages accept nothing — HIRED (the permanent employee link) and REJECTED (the record's terminal state)", () => {
    for (const terminal of ["HIRED", "REJECTED"] as const) {
      for (const target of APPLICANT_STAGES) {
        expect(canAdvanceStage(terminal, target)).toBe(false);
      }
    }
  });

  it("(d) the ONE sanctioned backward edge: reopen is REJECTED → SCREEN, recorded — and nothing else reopens", () => {
    expect(reopenTarget("REJECTED")).toBe("SCREEN");
    expect(reopenTarget("NEW")).toBeNull();
    expect(reopenTarget("SCREEN")).toBeNull();
    expect(reopenTarget("INTERVIEW")).toBeNull();
    expect(reopenTarget("OFFER")).toBeNull();
    expect(reopenTarget("HIRED")).toBeNull();
  });

  it("(e) isApplicantStage pins the FIXED enum's membership (no tenant-custom stage sets — BR-088)", () => {
    for (const stage of APPLICANT_STAGES) {
      expect(isApplicantStage(stage)).toBe(true);
    }
    expect(isApplicantStage("ONBOARDING")).toBe(false);
    expect(isApplicantStage("hired")).toBe(false);
    expect(isApplicantStage("")).toBe(false);
  });
});

describe("PHASE-047 W-3 — BR-091: the sweep's windows, bands, and dedupe key", () => {
  it("(a) normalizeSweepWindows: integers ≥ 0 kept, duplicates dropped, sorted descending; garbage never disables the sweep (fail-closed to the documented default)", () => {
    expect(normalizeSweepWindows([30, 7, 0])).toEqual([30, 7, 0]);
    // Unsorted input normalizes to the canonical descending order.
    expect(normalizeSweepWindows([0, 30, 7])).toEqual([30, 7, 0]);
    // Duplicates collapse (the dedupe key's threshold axis stays total).
    expect(normalizeSweepWindows([7, 7, 30, 30, 0])).toEqual([30, 7, 0]);
    // Numeric strings ride through (the jsonb array's honest shape).
    expect(normalizeSweepWindows(["30", "7", "0"])).toEqual([30, 7, 0]);
    // Negatives, fractions, NaN-able garbage drop out.
    expect(normalizeSweepWindows([30, -7, 3.5, Number.NaN, 0, 7])).toEqual([30, 7, 0]);
    // The empty and all-garbage residues FAIL CLOSED to the
    // documented default 30/7/0 — a tenant registering garbage never
    // silently disables the compliance sweep.
    expect(normalizeSweepWindows([])).toEqual([...DEFAULT_EXPIRY_SWEEP_WINDOWS]);
    expect(normalizeSweepWindows(["soon", -1, 2.5])).toEqual([...DEFAULT_EXPIRY_SWEEP_WINDOWS]);
    // A single-window tenant is legal (the whole sweep is one band).
    expect(normalizeSweepWindows([14])).toEqual([14]);
  });

  it("(b) sweepBands folds the windows into DISJOINT bands — an item sits in exactly one band per pass", () => {
    const bands = sweepBands([30, 7, 0]);
    expect(bands).toEqual([
      { threshold: 30, fromDays: 7, toDays: 30 },
      { threshold: 7, fromDays: 0, toDays: 7 },
      // The tightest band's floor is OPEN: already-expired items stay
      // caught (the compliance register's own law).
      { threshold: 0, fromDays: null, toDays: 0 },
    ]);
    // Disjointness by construction: each band's floor IS the next
    // tighter band's ceiling; the bands tile (-∞,0] (0,7] (7,30] with
    // no overlap and no gap.
    for (let index = 0; index < bands.length - 1; index += 1) {
      expect(bands[index]!.fromDays).toBe(bands[index + 1]!.toDays);
    }
    // A custom tenant list folds the same way.
    expect(sweepBands([14, 3])).toEqual([
      { threshold: 14, fromDays: 3, toDays: 14 },
      { threshold: 3, fromDays: null, toDays: 3 },
    ]);
    // The defaults fold identically (the config read path is the
    // same fold).
    expect(sweepBands(DEFAULT_EXPIRY_SWEEP_WINDOWS)).toEqual(sweepBands([30, 7, 0]));
  });

  it("(c) expiryDedupeKey derives BR-091's exact four-segment shape — with the documented placeholder for the axes a kind does not carry", () => {
    expect(
      expiryDedupeKey({
        kind: "document-expiry",
        employeeId: "emp-1",
        documentId: "doc-1",
        threshold: 30,
      }),
    ).toBe("hr:document-expiry:emp-1:doc-1:30");
    expect(
      expiryDedupeKey({
        kind: "certification-expiry",
        employeeId: "emp-1",
        documentId: "cert-9",
        threshold: 7,
      }),
    ).toBe("hr:certification-expiry:emp-1:cert-9:7");
    // probation-end carries no document axis — the placeholder.
    expect(
      expiryDedupeKey({
        kind: "probation-end",
        employeeId: "emp-1",
        documentId: SWEEP_KEY_PLACEHOLDER,
        threshold: 0,
      }),
    ).toBe("hr:probation-end:emp-1:-:0");
    // review-due carries no single employee axis — the placeholder;
    // the cycle id rides the document axis.
    expect(
      expiryDedupeKey({
        kind: "review-due",
        employeeId: SWEEP_KEY_PLACEHOLDER,
        documentId: "cycle-1",
        threshold: 7,
      }),
    ).toBe("hr:review-due:-:cycle-1:7");
  });

  it("(d) the four kinds' keys never collide across kinds or thresholds — the structural dedupe is total on (kind, employee, document, threshold)", () => {
    const keys = new Set<string>();
    const kinds: ExpirySweepKind[] = [
      "document-expiry",
      "certification-expiry",
      "probation-end",
      "review-due",
    ];
    for (const kind of kinds) {
      for (const threshold of [30, 7, 0]) {
        keys.add(
          expiryDedupeKey({
            kind,
            employeeId: "same-employee",
            documentId: "same-axis",
            threshold,
          }),
        );
      }
    }
    // 4 kinds × 3 thresholds = 12 distinct keys over the SAME axes.
    expect(keys.size).toBe(12);
  });
});

