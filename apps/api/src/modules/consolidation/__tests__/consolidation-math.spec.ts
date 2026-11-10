import { describe, expect, it } from "vitest";

import {
  assertInv026,
  assertTrialBalanceBalanced,
  computeConsolidatedLines,
  detectSnapshotTamper,
  throwOnDrift,
  type EliminationEffectLine,
  type MemberExtractLine,
} from "../application/consolidation-math";
import { ConsolidationDriftError } from "../domain/consolidation-errors";

/**
 * PHASE-034 T12 · the INV-026 unit suite (the pure half — the DB suites
 * re-run the same scenarios over the live harness per the completion
 * report): consolidated = Σ member statements (group currency, dated FX) −
 * eliminations, LINE-BY-LINE; seeded drift (a tampered snapshot value, an
 * unbalanced elimination) is DETECTED (ASSERTION_FAILED + export blocked
 * at the contract layer); the consolidated TB balances.
 */

const RUN = "01990000-0000-7000-8000-000000000001";

function member(
  memberTenantId: string,
  accountCode: string,
  accountType: string,
  debit: string,
  credit: string,
  purposeKey: string | null = null,
): MemberExtractLine {
  return { memberTenantId, accountCode, accountType, purposeKey, amounts: { debit, credit } };
}

function elimination(
  eliminationId: string,
  accountCode: string,
  accountType: string,
  debit: string,
  credit: string,
  purposeKey: string | null = null,
): EliminationEffectLine {
  return {
    eliminationId,
    eliminationNo: "EL-2026-000001",
    accountCode,
    purposeKey,
    amounts: { debit, credit },
  };
}

describe("INV-026 · computeConsolidatedLines (Σ members + the elimination journals' nets)", () => {
  it("sums members per account then adds the elimination journals' lines (the intra-group positions net out)", () => {
    const members = [
      member("tenant-a", "1130", "ASSET", "500.0000", "0.0000", "AR_CONTROL"),
      member("tenant-b", "2130", "LIABILITY", "0.0000", "500.0000", "AP_CONTROL"),
      member("tenant-a", "4100", "REVENUE", "0.0000", "900.0000"),
      member("tenant-b", "4100", "REVENUE", "0.0000", "100.0000"),
    ];
    // G-32: DR AP_CONTROL (entity B) · CR AR_CONTROL (entity A) — the
    // journal carries the OPPOSITE side of each intra-group position, so
    // ADDing its lines nets the positions out of the group view.
    const eliminations = [
      elimination("elim-1", "1130", "ASSET", "0.0000", "300.0000", "AR_CONTROL"),
      elimination("elim-1", "2130", "LIABILITY", "300.0000", "0.0000", "AP_CONTROL"),
    ];
    const lines = computeConsolidatedLines(members, eliminations);
    const byCode = new Map(lines.map((line) => [line.accountCode, line]));
    // 1130: A's DR 500 + the elimination CR 300 → net +200 (gross DR 500 / CR 300).
    expect(byCode.get("1130")!.amounts).toEqual({ debit: "500.0000", credit: "300.0000" });
    expect(byCode.get("2130")!.amounts).toEqual({ debit: "300.0000", credit: "500.0000" });
    expect(byCode.get("4100")!.amounts).toEqual({ debit: "0.0000", credit: "1000.0000" });
    // Deterministic ordering: account code ascending.
    expect(lines.map((line) => line.accountCode)).toEqual(["1130", "2130", "4100"]);
  });

  it("a full intercompany elimination nets both control accounts to zero (the canonical case)", () => {
    const members = [
      member("tenant-a", "1130", "ASSET", "300.0000", "0.0000"),
      member("tenant-b", "2130", "LIABILITY", "0.0000", "300.0000"),
    ];
    const eliminations = [
      elimination("elim-1", "1130", "ASSET", "0.0000", "300.0000"),
      elimination("elim-1", "2130", "LIABILITY", "300.0000", "0.0000"),
    ];
    const lines = computeConsolidatedLines(members, eliminations);
    for (const line of lines) {
      // Gross both sides 300/300 → NET zero: the intra-group position is
      // eliminated from the group view exactly as INV-026 demands.
      expect(line.amounts.debit).toBe("300.0000");
      expect(line.amounts.credit).toBe("300.0000");
    }
    // And the consolidated TB still balances (the elimination journal is
    // itself balanced — G-32's one-balanced-journal rule).
    expect(assertTrialBalanceBalanced(lines).status).toBe("PASS");
  });
});

describe("INV-026 · assertInv026 (the headline line-by-line gate)", () => {
  it("PASSes on the reconciling fixture (owner + 2 members, FX + eliminations)", () => {
    const members = [
      // The owner (SAR base — pass-through).
      member("owner", "1110", "ASSET", "10000.0000", "0.0000"),
      member("owner", "3210", "EQUITY", "0.0000", "10000.0000"),
      // Member A (USD base — translated 3.75): cash 1000 USD → 3750 SAR.
      member("member-a", "1110", "ASSET", "3750.0000", "0.0000"),
      member("member-a", "4100", "REVENUE", "0.0000", "3750.0000"),
      // Member B (SAR base — pass-through): owes A 500.
      member("member-b", "2130", "LIABILITY", "0.0000", "500.0000"),
      member("member-b", "1130", "ASSET", "500.0000", "0.0000"),
    ];
    // A's intercompany AR 500 · B's intercompany AP 500 — the G-32 journal
    // nets both out (A sold to B: group revenue is A's 3750 only).
    const eliminations = [
      elimination("elim-1", "1130", "ASSET", "0.0000", "500.0000", "AR_CONTROL"),
      elimination("elim-1", "2130", "LIABILITY", "500.0000", "0.0000", "AP_CONTROL"),
    ];
    const consolidated = computeConsolidatedLines(members, eliminations);
    const result = assertInv026({ runId: RUN, consolidated, members, eliminations });
    expect(result.status).toBe("PASS");
    expect(result.brokenLines).toEqual([]);
    // The consolidated TB balances (double-entry held through Σ + nets).
    expect(assertTrialBalanceBalanced(consolidated).status).toBe("PASS");
    // The intercompany positions net to zero: 1130 nets 500−500 = 0.
    const ar = consolidated.find((line) => line.accountCode === "1130")!;
    expect(ar.amounts.debit).toBe("500.0000");
    expect(ar.amounts.credit).toBe("500.0000");
  });

  it("FAILs on a tampered snapshot value (seeded drift — line named)", () => {
    const members = [member("a", "1110", "ASSET", "100.0000", "0.0000")];
    const eliminations: EliminationEffectLine[] = [];
    const honest = computeConsolidatedLines(members, eliminations);
    const tampered = honest.map((line) =>
      line.accountCode === "1110"
        ? { ...line, amounts: { ...line.amounts, debit: "999.0000" } }
        : line,
    );
    const result = detectSnapshotTamper({
      runId: RUN,
      snapshotLines: tampered,
      members,
      eliminations,
    });
    expect(result.status).toBe("FAIL");
    expect(result.brokenLines[0]).toContain("1110");
  });

  it("FAILs when an unbalanced elimination breaks the balance (one leg only)", () => {
    const members = [
      member("a", "1130", "ASSET", "500.0000", "0.0000"),
      member("b", "2130", "LIABILITY", "0.0000", "500.0000"),
    ];
    // UNBALANCED elimination: only one leg (the failure-pack shape — the
    // service rejects it at authoring; the assertion engine still catches
    // it if one ever lands: the consolidated TB stops balancing).
    const eliminations = [elimination("elim-bad", "1130", "ASSET", "0.0000", "500.0000")];
    const consolidated = computeConsolidatedLines(members, eliminations);
    expect(assertTrialBalanceBalanced(consolidated).status).toBe("FAIL");
    // And a member-set drift (a tampered member extract) breaks the
    // line-by-line reconstruction:
    const tamperedMembers = [member("a", "1130", "ASSET", "400.0000", "0.0000"), members[1]!];
    const drift = assertInv026({
      runId: RUN,
      consolidated,
      members: tamperedMembers,
      eliminations,
    });
    expect(drift.status).toBe("FAIL");
  });

  it("throwOnDrift raises the typed ConsolidationDriftError (build-time gate)", () => {
    const members = [member("a", "1110", "ASSET", "100.0000", "0.0000")];
    const consolidated = computeConsolidatedLines(members, []);
    const tampered = consolidated.map((line) => ({ ...line, amounts: { debit: "1.0000", credit: "0.0000" } }));
    const result = assertInv026({ runId: RUN, consolidated: tampered, members, eliminations: [] });
    expect(() => throwOnDrift({ runId: RUN, result })).toThrow(ConsolidationDriftError);
  });
});

describe("INV-026 · the consolidated TB balance (FINANCIAL_REPORT_RULES §3)", () => {
  it("reports the DR/CR totals with tolerance 0", () => {
    const balanced = computeConsolidatedLines(
      [member("a", "1110", "ASSET", "50.0000", "0.0000"), member("a", "4100", "REVENUE", "0.0000", "50.0000")],
      [],
    );
    const check = assertTrialBalanceBalanced(balanced);
    expect(check.status).toBe("PASS");
    expect(check.debit).toBe("50.0000");
    expect(check.credit).toBe("50.0000");
  });
});
