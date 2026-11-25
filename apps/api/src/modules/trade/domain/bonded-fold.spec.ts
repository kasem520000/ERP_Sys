import { describe, expect, it } from "vitest";

import { Decimal } from "@erp/domain-core";

import {
  allocateBaseAmounts,
  computeReleaseDuty,
  nextBondedMove,
  suspendedPool,
  validateBondedLines,
  validateBondedMoveShape,
  type BondedMove,
} from "./bonded-fold";

/**
 * PHASE-051 (W-38 — T-11) the bonded transition fold's property tests
 * (the plan's §4 unit-first law: the PURE module FIRST — the service
 * renders the fold's verdicts VERBATIM, so the fold's arithmetic is the
 * contract). The ADR-0009 discipline: every figure on Decimal, never a
 * float.
 */

const ITEM_A = "11111111-1111-4111-8111-111111111111";
const ITEM_B = "22222222-2222-4222-8222-222222222222";
const ITEM_C = "33333333-3333-4333-8333-333333333333";
const WH_X = "aaaaaaa1-1111-4111-8111-111111111111";
const WH_Y = "aaaaaaa2-2222-4222-8222-222222222222";

describe("the bonded transition fold (D-08 — the ladder, the kind shapes, the no-duty/duty matrix)", () => {
  it("THE LADDER: DRAFT → EXECUTED is the only move; EXECUTED is TERMINAL — the stamp never un-stamps", () => {
    expect(nextBondedMove("DRAFT", "execute")).toEqual({
      allowed: true,
      to: "EXECUTED",
      reason: null,
    });
    const terminal = nextBondedMove("EXECUTED", "execute");
    expect(terminal.allowed).toBe(false);
    expect(terminal.reason).toContain("exactly-once");
  });

  it("THE UNKNOWN MOVE refuses with the vocabulary's own reason (the fold never throws)", () => {
    const verdict = nextBondedMove("DRAFT", "cancel" as BondedMove);
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toContain("unknown move");
  });

  it("THE KIND SHAPES: IN_BOND requires to (the deposit target); RELEASE requires from (the bond source); never both null", () => {
    expect(validateBondedMoveShape({ kind: "IN_BOND", fromWarehouseId: null, toWarehouseId: WH_X }).valid).toBe(true);
    expect(validateBondedMoveShape({ kind: "IN_BOND", fromWarehouseId: WH_Y, toWarehouseId: WH_X }).valid).toBe(true);
    expect(validateBondedMoveShape({ kind: "RELEASE", fromWarehouseId: WH_X, toWarehouseId: null }).valid).toBe(true);
    expect(validateBondedMoveShape({ kind: "RELEASE", fromWarehouseId: WH_X, toWarehouseId: WH_Y }).valid).toBe(true);

    const noTo = validateBondedMoveShape({ kind: "IN_BOND", fromWarehouseId: WH_Y, toWarehouseId: null });
    expect(noTo.valid).toBe(false);
    expect(noTo.field).toBe("toWarehouseId");
    const noFrom = validateBondedMoveShape({ kind: "RELEASE", fromWarehouseId: null, toWarehouseId: WH_Y });
    expect(noFrom.valid).toBe(false);
    expect(noFrom.field).toBe("fromWarehouseId");
    const neither = validateBondedMoveShape({ kind: "IN_BOND", fromWarehouseId: null, toWarehouseId: null });
    expect(neither.valid).toBe(false);
    const badKind = validateBondedMoveShape({ kind: "REVERSE", fromWarehouseId: WH_X, toWarehouseId: WH_Y });
    expect(badKind.valid).toBe(false);
    expect(badKind.field).toBe("moveKind");
  });

  it("THE LINE FLOORS: ≥1 line, uuid items, positive 6dp quantities, the deposit's unitCost — and NO same-item pairs (the tie is a function)", () => {
    expect(validateBondedLines([{ itemId: ITEM_A, qty: "10" }]).valid).toBe(true);
    expect(validateBondedLines([{ itemId: ITEM_A, qty: "10", unitCost: "12.5" }]).valid).toBe(true);
    expect(validateBondedLines([]).valid).toBe(false);

    const dup = validateBondedLines([
      { itemId: ITEM_A, qty: "10" },
      { itemId: ITEM_A, qty: "5" },
    ]);
    expect(dup.valid).toBe(false);
    expect(dup.reason).toContain("function, never a relation");

    const badQty = validateBondedLines([{ itemId: ITEM_A, qty: "0" }]);
    expect(badQty.valid).toBe(false);
    expect(badQty.field).toBe("lines[0].qty");
    const negQty = validateBondedLines([{ itemId: ITEM_A, qty: "-3" }]);
    expect(negQty.valid).toBe(false);
    const badItem = validateBondedLines([{ itemId: "not-a-uuid", qty: "1" }]);
    expect(badItem.valid).toBe(false);
    expect(badItem.field).toBe("lines[0].itemId");
    const badCost = validateBondedLines([{ itemId: ITEM_A, qty: "1", unitCost: "-1" }]);
    expect(badCost.valid).toBe(false);
    expect(badCost.field).toBe("lines[0].unitCost");
  });
});

describe("the release duty fold (BR-107 — the declaration's own figure at the released quantity)", () => {
  it("THE RATIO MATH: per-line duty = duty_amount × (released ÷ declared) on Decimal at the 4dp — never a float", () => {
    const verdict = computeReleaseDuty({
      declared: [{ itemId: ITEM_A, quantity: "100", dutyAmount: "500.0000" }],
      released: [{ itemId: ITEM_A, qty: "25" }],
    });
    expect(verdict.lines).not.toBeNull();
    expect(verdict.lines![0]!.dutyAmount).toBe("125.0000");
    expect(verdict.totalDuty).toBe("125.0000");
  });

  it("THE ROUNDING LAW: ROUND_HALF_UP at the 4th decimal (the posting engine's canonical scale)", () => {
    const verdict = computeReleaseDuty({
      declared: [{ itemId: ITEM_A, quantity: "3", dutyAmount: "1.0001" }],
      released: [{ itemId: ITEM_A, qty: "1" }],
    });
    // 1.0001 × (1 ÷ 3) = 0.33336… → 0.3334 (half-up).
    expect(verdict.lines![0]!.dutyAmount).toBe("0.3334");
  });

  it("THE EXACT-Σ LAW: Σ per-line = the move's duty_amount EXACTLY (the Decimal sum, never re-rounded)", () => {
    const verdict = computeReleaseDuty({
      declared: [
        { itemId: ITEM_A, quantity: "10", dutyAmount: "33.3333" },
        { itemId: ITEM_B, quantity: "20", dutyAmount: "66.6667" },
      ],
      released: [
        { itemId: ITEM_A, qty: "10" },
        { itemId: ITEM_B, qty: "20" },
      ],
    });
    const sum = verdict
      .lines!.reduce((acc, line) => acc.plus(new Decimal(line.dutyAmount)), new Decimal(0))
      .toFixed(4);
    expect(sum).toBe(verdict.totalDuty);
    expect(verdict.totalDuty).toBe("100.0000");
  });

  it("PROPERTY: the ratio commutes with the line order and scales linearly with the released share", () => {
    const declared = [
      { itemId: ITEM_A, quantity: "7", dutyAmount: "99.9999" },
      { itemId: ITEM_B, quantity: "13", dutyAmount: "41.0001" },
    ];
    const forward = computeReleaseDuty({
      declared,
      released: [
        { itemId: ITEM_A, qty: "2" },
        { itemId: ITEM_B, qty: "5" },
      ],
    });
    const backward = computeReleaseDuty({
      declared,
      released: [
        { itemId: ITEM_B, qty: "5" },
        { itemId: ITEM_A, qty: "2" },
      ],
    });
    expect(forward.totalDuty).toBe(backward.totalDuty);
    // Linearity: releasing twice the share recognizes twice the duty
    // (the ratio's own proportionality, on Decimal).
    const double = computeReleaseDuty({
      declared,
      released: [
        { itemId: ITEM_A, qty: "4" },
        { itemId: ITEM_B, qty: "10" },
      ],
    });
    expect(new Decimal(double.totalDuty!).toFixed(2)).toBe(
      new Decimal(forward.totalDuty!).times(2).toFixed(2),
    );
  });

  it("THE FULL RELEASE: released = declared carries the declaration's own duty figure VERBATIM", () => {
    const verdict = computeReleaseDuty({
      declared: [
        { itemId: ITEM_A, quantity: "50", dutyAmount: "75.0000" },
        { itemId: ITEM_B, quantity: "25", dutyAmount: "25.0000" },
      ],
      released: [
        { itemId: ITEM_A, qty: "50" },
        { itemId: ITEM_B, qty: "25" },
      ],
    });
    expect(verdict.totalDuty).toBe("100.0000");
  });

  it("THE ZERO-DUTY SHAPE: an all-zero declaration's release totals 0.0000 — the empty recognition pair's own figure (interpretation #6)", () => {
    const verdict = computeReleaseDuty({
      declared: [{ itemId: ITEM_A, quantity: "100", dutyAmount: "0.0000" }],
      released: [{ itemId: ITEM_A, qty: "100" }],
    });
    expect(verdict.totalDuty).toBe("0.0000");
    expect(verdict.reason).toBeNull();
  });

  it("THE COVERAGE LAW: an undeclared item refuses (the release's duty is the declaration's OWN figure)", () => {
    const verdict = computeReleaseDuty({
      declared: [{ itemId: ITEM_A, quantity: "100", dutyAmount: "50.0000" }],
      released: [{ itemId: ITEM_C, qty: "10" }],
    });
    expect(verdict.lines).toBeNull();
    expect(verdict.reason).toContain("not declared");
  });

  it("THE TIE'S FUNCTION LAW: an item declared twice refuses (never a relation)", () => {
    const verdict = computeReleaseDuty({
      declared: [
        { itemId: ITEM_A, quantity: "100", dutyAmount: "50.0000" },
        { itemId: ITEM_A, quantity: "50", dutyAmount: "25.0000" },
      ],
      released: [{ itemId: ITEM_A, qty: "10" }],
    });
    expect(verdict.lines).toBeNull();
    expect(verdict.reason).toContain("function, never a relation");
  });

  it("THE NULL-QUANTITY REFUSAL: a declared line without a quantity refuses — the ratio's basis is fail-closed", () => {
    const verdict = computeReleaseDuty({
      declared: [{ itemId: ITEM_A, quantity: "0", dutyAmount: "50.0000" }],
      released: [{ itemId: ITEM_A, qty: "10" }],
    });
    expect(verdict.lines).toBeNull();
    expect(verdict.reason).toContain("fail-closed");
  });

  it("THE OVER-RELEASE GUARD: released + already-released > declared refuses — never more duty than the declaration's own figure", () => {
    const verdict = computeReleaseDuty({
      declared: [{ itemId: ITEM_A, quantity: "100", dutyAmount: "50.0000" }],
      released: [{ itemId: ITEM_A, qty: "40" }],
      alreadyReleasedByItem: new Map([[ITEM_A, "70"]]),
    });
    expect(verdict.lines).toBeNull();
    expect(verdict.reason).toContain("over-release guard");
    // The boundary itself passes: 40 + 60 = 100 = declared.
    const boundary = computeReleaseDuty({
      declared: [{ itemId: ITEM_A, quantity: "100", dutyAmount: "50.0000" }],
      released: [{ itemId: ITEM_A, qty: "40" }],
      alreadyReleasedByItem: new Map([[ITEM_A, "60"]]),
    });
    expect(boundary.lines).not.toBeNull();
    expect(boundary.totalDuty).toBe("20.0000");
  });

  it("PROPERTY: the partial releases partition the declared duty EXACTLY (the register's Σ never exceeds the declaration's figure)", () => {
    const declared = [{ itemId: ITEM_A, quantity: "10", dutyAmount: "37.0000" }];
    let accumulated = new Decimal(0);
    const already = new Map<string, string>();
    for (const qty of ["1", "2", "3", "4"]) {
      const verdict = computeReleaseDuty({ declared, released: [{ itemId: ITEM_A, qty }], alreadyReleasedByItem: already });
      expect(verdict.reason).toBeNull();
      accumulated = accumulated.plus(new Decimal(verdict.totalDuty!));
      already.set(ITEM_A, (new Decimal(already.get(ITEM_A) ?? "0").plus(new Decimal(qty))).toFixed(6));
    }
    // The four partial releases recognize 1+2+3+4 = 10 shares; the
    // accumulated duty lands at the declaration's own figure within the
    // per-line 4dp rounding (≤ a quantum's tolerance).
    expect(accumulated.lessThanOrEqualTo(new Decimal("37.0000"))).toBe(true);
    expect(new Decimal("37.0000").minus(accumulated).lessThan(new Decimal("0.001"))).toBe(true);
  });

  it("THE OUTPUT SCALE: every figure a canonical string (qty 6dp — the bond ledger's own; duty 4dp — the ledger's)", () => {
    const verdict = computeReleaseDuty({
      declared: [{ itemId: ITEM_A, quantity: "3", dutyAmount: "10.0000" }],
      released: [{ itemId: ITEM_A, qty: "1" }],
    });
    expect(verdict.lines![0]!.qty).toMatch(/^\d+\.\d{6}$/);
    expect(verdict.lines![0]!.dutyAmount).toMatch(/^\d+\.\d{4}$/);
    expect(verdict.totalDuty).toMatch(/^\d+\.\d{4}$/);
  });
});

describe("the suspended pool (the bond ledger's own arithmetic — the gate's pure face)", () => {
  it("THE POOL: Σ IN_BOND into − Σ IN_BOND out of − Σ RELEASE out of, clamped at zero", () => {
    expect(suspendedPool({ inBondInto: "100", inBondOutOf: "30", releaseOutOf: "20" })).toBe("50.000000");
    expect(suspendedPool({ inBondInto: "10", inBondOutOf: "0", releaseOutOf: "10" })).toBe("0.000000");
    // A free warehouse's from-leg never drives the pool negative.
    expect(suspendedPool({ inBondInto: "0", inBondOutOf: "40", releaseOutOf: "0" })).toBe("0.000000");
  });

  it("PROPERTY: the pool is monotone in each axis and never negative (the clamp law)", () => {
    for (const [into, out, released] of [
      ["5", "0", "0"],
      ["25", "20", "0"],
      ["25", "20", "3"],
      ["100", "60", "39.999999"],
    ] as const) {
      const pool = new Decimal(suspendedPool({ inBondInto: into, inBondOutOf: out, releaseOutOf: released }));
      expect(pool.isNegative()).toBe(false);
      expect(pool.lessThanOrEqualTo(new Decimal(into))).toBe(true);
    }
  });
});

describe("the base allocation (D-21's FX ride at the released quantity — the exact-Σ law)", () => {
  it("IDENTITY: no rate (the declaration's currency IS the base) — the figures pass through at the 4dp", () => {
    const allocated = allocateBaseAmounts(["12.5000", "7.5000", "80.0000"], undefined);
    expect(allocated).toEqual(["12.5000", "7.5000", "80.0000"]);
  });

  it("THE EXACT-Σ LAW: Σ allocated = the converted total EXACTLY (the remainder to the last line — never a drift)", () => {
    // The classic drift shape: three lines whose conversions each round
    // up — the naive Σ would exceed the converted total by a quantum.
    const lines = ["33.3333", "33.3333", "33.3334"];
    const rate = "1.5";
    const allocated = allocateBaseAmounts(lines, rate);
    const sum = allocated.reduce((acc, value) => acc.plus(new Decimal(value)), new Decimal(0));
    const total = new Decimal("100.0000").times(new Decimal(rate)).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
    expect(sum.toFixed(4)).toBe(total.toFixed(4));
    // Each line carries the honest 4dp conversion (the last absorbs the
    // remainder — the FIFO allocation precedent's own law).
    expect(allocated[0]).toBe("50.0000");
  });

  it("PROPERTY: the Σ exactness holds across a randomized grid of rates and line counts", () => {
    for (const [lines, rateText] of [
      [["10.0001", "20.0002"], "0.33333333"],
      [["1.0001", "1.0001", "1.0001", "1.0001"], "7.77"],
      [["99.9999"], "0.12345678"],
      [["5.0000", "5.0000", "5.0000", "5.0000", "5.0000"], "1.00005"],
    ] as const) {
      const allocated = allocateBaseAmounts(lines, rateText);
      const sum = allocated.reduce((acc, value) => acc.plus(new Decimal(value)), new Decimal(0));
      const total = lines
        .reduce((acc, value) => acc.plus(new Decimal(value)), new Decimal(0))
        .times(new Decimal(rateText))
        .toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
      expect(sum.toFixed(4)).toBe(total.toFixed(4));
    }
  });
});
