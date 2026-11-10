import { addExact, compareExact } from "../../accounting/application/decimal-strings";

import { EliminationNotBalancedError, EliminationPurposeNotMappedError } from "../domain/consolidation-errors";

/**
 * PHASE-034 T5 · elimination document lines — PURE shape/validation (exported
 * for the unit suite; the service composes them into the engine spec).
 *
 * The G-32 golden shape (JOURNAL_RULES §7): intercompany elimination =
 * DR AP_CONTROL (entity B intercompany) · CR AR_CONTROL (entity A
 * intercompany) — posted in the PARENT tenant's consolidation books ONLY.
 * Investment/equity elimination lines post through the CONSOLIDATION_ADJUSTMENT
 * purpose (CHART_OF_ACCOUNTS §2 v2.0 row — used only in the parent's
 * consolidation books).
 *
 * The DRAFT body is authored over MEMBER-PAIR lines (manual authoring — the
 * surface suggests intercompany pairings from the members' AR/AP
 * subledgers; matching is human-confirmed; the automatic matching engine is
 * out of scope per the phase plan).
 */

/** The elimination document line (the jsonb DRAFT body's row shape). */
export interface EliminationLine {
  purposeKey: string;
  direction: "DEBIT" | "CREDIT";
  amount: string;
  /** Which member's intercompany position the line eliminates (the pair
   * member A/B on INTERCOMPANY documents; null on INVESTMENT_EQUITY). */
  memberTenantId: string | null;
  memoEn: string;
  memoAr: string;
}

export type EliminationKind = "INTERCOMPANY" | "INVESTMENT_EQUITY";

/** The purposes each kind may ride (fail-closed shape check; account
 * RESOLUTION stays the engine's PURPOSE_NOT_MAPPED surface). */
export const INTERCOMPANY_PURPOSES: readonly string[] = ["AR_CONTROL", "AP_CONTROL"] as const;
export const INVESTMENT_EQUITY_PURPOSES: readonly string[] = ["CONSOLIDATION_ADJUSTMENT"] as const;

/**
 * Validate the DRAFT body (zero-residue failure pack):
 * - at least one line, every amount > 0;
 * - the kind's purpose set (INTERCOMPANY → AR_CONTROL/AP_CONTROL — G-32;
 *   INVESTMENT_EQUITY → CONSOLIDATION_ADJUSTMENT);
 * - INTERCOMPANY requires BOTH pair members set and at least one line per
 *   member (the DR/CR pair over two members);
 * - balanced: Σ DR == Σ CR (ENTRY_NOT_BALANCED).
 */
export function validateEliminationLines(input: {
  eliminationId: string;
  kind: EliminationKind;
  memberATenantId: string | null;
  memberBTenantId: string | null;
  lines: readonly EliminationLine[];
}): { debitTotal: string; creditTotal: string } {
  const { lines } = input;
  if (lines.length === 0) {
    throw new EliminationNotBalancedError({
      eliminationId: input.eliminationId,
      debitTotal: "0.0000",
      creditTotal: "0.0000",
    });
  }
  const allowed =
    input.kind === "INTERCOMPANY" ? INTERCOMPANY_PURPOSES : INVESTMENT_EQUITY_PURPOSES;
  let debitTotal = "0.0000";
  let creditTotal = "0.0000";
  const memberSet = new Set<string>();
  for (const line of lines) {
    if (!allowed.includes(line.purposeKey)) {
      throw new EliminationPurposeNotMappedError({
        purposeKey: line.purposeKey,
        surface: `elimination kind ${input.kind} (allowed: ${allowed.join(", ")})`,
      });
    }
    if (compareExact(line.amount, "0.0000") <= 0) {
      throw new EliminationNotBalancedError({
        eliminationId: input.eliminationId,
        debitTotal: "0.0000",
        creditTotal: "0.0000",
      });
    }
    if (line.direction === "DEBIT") {
      debitTotal = addExact(debitTotal, line.amount);
    } else {
      creditTotal = addExact(creditTotal, line.amount);
    }
    if (line.memberTenantId !== null) {
      memberSet.add(line.memberTenantId);
    }
  }
  if (compareExact(debitTotal, creditTotal) !== 0) {
    throw new EliminationNotBalancedError({
      eliminationId: input.eliminationId,
      debitTotal,
      creditTotal,
    });
  }
  if (input.kind === "INTERCOMPANY") {
    if (input.memberATenantId === null || input.memberBTenantId === null) {
      throw new EliminationPurposeNotMappedError({
        purposeKey: "(member pair)",
        surface: "INTERCOMPANY eliminations require both pair members",
      });
    }
    if (!memberSet.has(input.memberATenantId) || !memberSet.has(input.memberBTenantId)) {
      throw new EliminationPurposeNotMappedError({
        purposeKey: "(member pair)",
        surface: "INTERCOMPANY eliminations require lines on both members of the pair",
      });
    }
  }
  return { debitTotal, creditTotal };
}

/**
 * Build the REVERSAL counter-entry body (BR-056 — reversal-only corrections):
 * a new DRAFT with every line's direction flipped (the same purposes,
 * amounts, members; fresh bilingual memos referencing the original). The
 * service posts it as a NEW elimination document linked through reversal_of.
 */
export function buildReversalLines(original: readonly EliminationLine[]): EliminationLine[] {
  return original.map((line) => ({
    purposeKey: line.purposeKey,
    direction: line.direction === "DEBIT" ? ("CREDIT" as const) : ("DEBIT" as const),
    amount: line.amount,
    memberTenantId: line.memberTenantId,
    memoEn: `Reversal — ${line.memoEn}`,
    memoAr: `قيد عكسي — ${line.memoAr}`,
  }));
}

/** Parse + narrow the jsonb DRAFT body (unknown → EliminationLine[]; the
 * store's row shape is untyped jsonb — this is the typed seam). Throws the
 * balanced error shape on a malformed row (zero residue). */
export function parseEliminationLines(raw: unknown): EliminationLine[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const lines: EliminationLine[] = [];
  for (const row of raw) {
    if (row === null || typeof row !== "object") {
      continue;
    }
    const record = row as Record<string, unknown>;
    if (
      typeof record.purposeKey !== "string" ||
      (record.direction !== "DEBIT" && record.direction !== "CREDIT") ||
      typeof record.amount !== "string"
    ) {
      continue;
    }
    lines.push({
      purposeKey: record.purposeKey,
      direction: record.direction,
      amount: record.amount,
      memberTenantId:
        typeof record.memberTenantId === "string" ? record.memberTenantId : null,
      memoEn: typeof record.memoEn === "string" ? record.memoEn : "",
      memoAr: typeof record.memoAr === "string" ? record.memoAr : "",
    });
  }
  return lines;
}
