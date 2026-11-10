import { describe, expect, it } from "vitest";

import {
  buildReversalLines,
  parseEliminationLines,
  validateEliminationLines,
  type EliminationLine,
} from "../application/elimination-lines";
import {
  EliminationNotBalancedError,
  EliminationPurposeNotMappedError,
} from "../domain/consolidation-errors";

/**
 * PHASE-034 T12 · the G-32 elimination-line unit suite (the pure failure
 * pack — the DB golden re-runs the post path over the live harness):
 * unbalanced ⇒ ENTRY_NOT_BALANCED; the kind's purposes (INTERCOMPANY →
 * AR_CONTROL/AP_CONTROL, INVESTMENT_EQUITY → CONSOLIDATION_ADJUSTMENT) ⇒
 * the PURPOSE shape errors; the member-pair requirement; the reversal
 * counter-entry builder (BR-056 — every direction flipped); zero residue
 * everywhere (pure functions — nothing to clean up by construction).
 */

const A = "01990000-0000-7000-8000-0000000000a1";
const B = "01990000-0000-7000-8000-0000000000b2";
const ELIM = "01990000-0000-7000-8000-0000000000e3";

function g32Lines(amount = "500.0000"): EliminationLine[] {
  return [
    {
      purposeKey: "AP_CONTROL",
      direction: "DEBIT",
      amount,
      memberTenantId: B,
      memoEn: "Intercompany payable — entity B",
      memoAr: "ذمم دافعة بين الشركات — الشركة ب",
    },
    {
      purposeKey: "AR_CONTROL",
      direction: "CREDIT",
      amount,
      memberTenantId: A,
      memoEn: "Intercompany receivable — entity A",
      memoAr: "ذمم مدينة بين الشركات — الشركة أ",
    },
  ];
}

describe("G-32 · validateEliminationLines (the authoring failure pack)", () => {
  it("accepts the canonical intercompany pair (DR AP entity B · CR AR entity A)", () => {
    const totals = validateEliminationLines({
      eliminationId: ELIM,
      kind: "INTERCOMPANY",
      memberATenantId: A,
      memberBTenantId: B,
      lines: g32Lines(),
    });
    expect(totals).toEqual({ debitTotal: "500.0000", creditTotal: "500.0000" });
  });

  it("rejects the unbalanced body with the typed ENTRY_NOT_BALANCED (zero residue)", () => {
    const lines = g32Lines();
    lines[1] = { ...lines[1]!, amount: "499.0000" };
    expect(() =>
      validateEliminationLines({
        eliminationId: ELIM,
        kind: "INTERCOMPANY",
        memberATenantId: A,
        memberBTenantId: B,
        lines,
      }),
    ).toThrow(EliminationNotBalancedError);
    expect(() =>
      validateEliminationLines({
        eliminationId: ELIM,
        kind: "INTERCOMPANY",
        memberATenantId: A,
        memberBTenantId: B,
        lines,
      }),
    ).toThrow(expect.objectContaining({ code: "ENTRY_NOT_BALANCED" }));
  });

  it("rejects an empty line set (nothing to post)", () => {
    expect(() =>
      validateEliminationLines({
        eliminationId: ELIM,
        kind: "INTERCOMPANY",
        memberATenantId: A,
        memberBTenantId: B,
        lines: [],
      }),
    ).toThrow(EliminationNotBalancedError);
  });

  it("rejects a non-positive amount", () => {
    const lines = g32Lines("0.0000");
    expect(() =>
      validateEliminationLines({
        eliminationId: ELIM,
        kind: "INTERCOMPANY",
        memberATenantId: A,
        memberBTenantId: B,
        lines,
      }),
    ).toThrow(EliminationNotBalancedError);
  });

  it("rejects a wrong-purpose line on INTERCOMPANY (only AR_CONTROL/AP_CONTROL — fail closed)", () => {
    const lines: EliminationLine[] = [
      { ...g32Lines()[0]!, purposeKey: "CONSOLIDATION_ADJUSTMENT" },
      g32Lines()[1]!,
    ];
    expect(() =>
      validateEliminationLines({
        eliminationId: ELIM,
        kind: "INTERCOMPANY",
        memberATenantId: A,
        memberBTenantId: B,
        lines,
      }),
    ).toThrow(EliminationPurposeNotMappedError);
  });

  it("INVESTMENT_EQUITY rides CONSOLIDATION_ADJUSTMENT (the §2 v2.0 purpose)", () => {
    const lines: EliminationLine[] = [
      {
        purposeKey: "CONSOLIDATION_ADJUSTMENT",
        direction: "DEBIT",
        amount: "1000.0000",
        memberTenantId: null,
        memoEn: "Investment in entity B",
        memoAr: "استثمار في الشركة ب",
      },
      {
        purposeKey: "CONSOLIDATION_ADJUSTMENT",
        direction: "CREDIT",
        amount: "1000.0000",
        memberTenantId: null,
        memoEn: "Entity B equity",
        memoAr: "حقوق الشركة ب",
      },
    ];
    const totals = validateEliminationLines({
      eliminationId: ELIM,
      kind: "INVESTMENT_EQUITY",
      memberATenantId: null,
      memberBTenantId: null,
      lines,
    });
    expect(totals.debitTotal).toBe("1000.0000");
    expect(totals.creditTotal).toBe("1000.0000");
  });

  it("rejects AR/AP purposes on an INVESTMENT_EQUITY document (and vice versa)", () => {
    expect(() =>
      validateEliminationLines({
        eliminationId: ELIM,
        kind: "INVESTMENT_EQUITY",
        memberATenantId: null,
        memberBTenantId: null,
        lines: g32Lines(),
      }),
    ).toThrow(EliminationPurposeNotMappedError);
  });

  it("INTERCOMPANY requires BOTH pair members set and present in the lines", () => {
    expect(() =>
      validateEliminationLines({
        eliminationId: ELIM,
        kind: "INTERCOMPANY",
        memberATenantId: null,
        memberBTenantId: B,
        lines: g32Lines(),
      }),
    ).toThrow(EliminationPurposeNotMappedError);
    // Both ids set but one member has no line: the pair requirement.
    const oneSided: EliminationLine[] = [
      g32Lines()[0]!,
      { ...g32Lines()[1]!, memberTenantId: B },
    ];
    expect(() =>
      validateEliminationLines({
        eliminationId: ELIM,
        kind: "INTERCOMPANY",
        memberATenantId: A,
        memberBTenantId: B,
        lines: oneSided,
      }),
    ).toThrow(EliminationPurposeNotMappedError);
  });
});

describe("BR-056 · buildReversalLines (the reversal-only counter-entry body)", () => {
  it("flips every direction, keeps purposes/amounts/members, marks the memos", () => {
    const original = g32Lines();
    const reversal = buildReversalLines(original);
    expect(reversal).toHaveLength(2);
    expect(reversal[0]!.direction).toBe("CREDIT");
    expect(reversal[1]!.direction).toBe("DEBIT");
    expect(reversal[0]!.purposeKey).toBe("AP_CONTROL");
    expect(reversal[1]!.purposeKey).toBe("AR_CONTROL");
    expect(reversal[0]!.amount).toBe("500.0000");
    expect(reversal[1]!.amount).toBe("500.0000");
    expect(reversal[0]!.memberTenantId).toBe(B);
    expect(reversal[1]!.memberTenantId).toBe(A);
    expect(reversal[0]!.memoEn.startsWith("Reversal — ")).toBe(true);
    expect(reversal[0]!.memoAr.startsWith("قيد عكسي — ")).toBe(true);
    // The reversal body itself validates as a balanced counter-entry.
    const totals = validateEliminationLines({
      eliminationId: "(reversal)",
      kind: "INTERCOMPANY",
      memberATenantId: A,
      memberBTenantId: B,
      lines: reversal,
    });
    expect(totals.debitTotal).toBe(totals.creditTotal);
  });
});

describe("parseEliminationLines (the jsonb → typed seam)", () => {
  it("narrows well-formed rows and skips malformed ones", () => {
    const parsed = parseEliminationLines([
      { purposeKey: "AP_CONTROL", direction: "DEBIT", amount: "1.0000", memberTenantId: B, memoEn: "x", memoAr: "س" },
      { purposeKey: "AP_CONTROL", direction: "SIDEWAYS", amount: "1.0000" },
      "not-an-object",
      null,
    ]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.purposeKey).toBe("AP_CONTROL");
  });

  it("returns an empty array on a non-array body", () => {
    expect(parseEliminationLines(null)).toEqual([]);
    expect(parseEliminationLines({})).toEqual([]);
  });
});
