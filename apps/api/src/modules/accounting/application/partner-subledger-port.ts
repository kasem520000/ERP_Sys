/**
 * Partner-subledger port (PHASE-007 T14; MODULE_BOUNDARIES write matrix;
 * DEPENDENCY_RULES §2 — accounting → tenancy only, partners → accounting):
 * the AR/AP subledger-write seam declared by the ACCOUNTING module and
 * implemented by the PARTNERS module (its table, its recompute rules),
 * bound at the composition root. The posting transaction calls it with the
 * per-line effects so entry + subledger rows commit atomically (INV-009
 * exact from entry #1) — no cross-module table writes anywhere else.
 */

export interface PartnerSubledgerEffect {
  partnerId: string;
  journalEntryId: string;
  journalLineId: string;
  entryDate: string;
  direction: "DEBIT" | "CREDIT";
  amount: string;
  baseAmount: string;
  currencyCode: string;
  sourceType: string;
  sourceId: string | null;
  memo: string | null;
}

export interface PartnerSubledgerPort {
  /** Append rows + recompute affected partner balances — same transaction. */
  recordJournalEffects(effects: readonly PartnerSubledgerEffect[]): Promise<void>;
}

export const PARTNER_SUBLEDGER_PORT = Symbol("PARTNER_SUBLEDGER_PORT");
