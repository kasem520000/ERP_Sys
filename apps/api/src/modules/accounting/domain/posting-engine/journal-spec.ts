/**
 * PHASE-007 JournalSpec contract (POSTING_ENGINE.md §1 verbatim + ADR-0007).
 * The types are infrastructure-free: money travels as canonical decimal
 * STRINGS (ADR-0009 — never JS numbers), dates as ISO calendar dates.
 */

export type Direction = "DEBIT" | "CREDIT";

/** Bilingual free text (dictionary §10): EN primary + AR display. */
export interface LocalizedText {
  en?: string | null;
  ar?: string | null;
}

/** The posting-source discriminator — INV-013's key component. */
export interface JournalSource {
  /** e.g. 'journal_entry' | 'opening_balances' | 'year_end_close' | 'fx_revaluation'. */
  docType: string;
  /** NULL only for standalone manual entries (idempotency binds when set). */
  docId: string | null;
  /** e.g. 'post' | 'reverse' | 'execute' | 'fx_diff'. */
  operation: string;
}

export interface JournalLineSpec {
  /** Purpose OR explicit account (manual journals) — exactly one. */
  purpose?: string;
  accountId?: string;
  direction: Direction;
  /** Canonical decimal string, document currency, > 0 (ADR-0009). */
  amount: string;
  partnerId?: string;
  itemId?: string;
  costCenterId?: string;
  taxCodeId?: string;
  /** PHASE-019 (§8): the projects dimension stamp — validated at the
   * account-resolution stage (PROJECT_NOT_FOUND / PROJECT_CLOSED). */
  projectId?: string;
  memo?: LocalizedText;
}

export interface JournalSpec {
  source: JournalSource;
  /** ISO date (yyyy-mm-dd) — the posting date, validated against periods. */
  entryDate: string;
  description?: LocalizedText;
  /** Official doc number once assigned (reference column). */
  reference?: string;
  /** Document currency (ISO-4217). */
  currency: string;
  /** Base per 1 foreign; required + > 0 when currency ≠ base; stored on entry (INV-008). */
  exchangeRate?: string;
  lines: JournalLineSpec[];
  /**
   * Explicit period override for the special windows (OPENING posting,
   * year-end CLOSING). When set, validation #4 checks THIS period and the
   * entry date must fall inside it; when absent the period is resolved by
   * date (REGULAR periods win over specials).
   */
  fiscalPeriodId?: string;
  /**
   * PC-02 soft-close path: set ONLY by callers that verified the actor
   * holds `accounting.periods.post_to_soft_closed` and captured a reason.
   */
  softCloseReason?: string;
}

export interface ReversalInput {
  /** The POSTED entry to negate. */
  originalEntryId: string;
  /** Counter-entry date: ≤ today, must fall in an OPEN period. */
  entryDate: string;
  reason: string;
}

/** Resolved line — the engine's write plan component. */
export interface ResolvedLine {
  lineNo: number;
  accountId: string;
  /** The purpose that resolved this account, when the spec used one. */
  purposeKey?: string;
  direction: Direction;
  amount: string;
  baseAmount: string;
  partnerId?: string;
  itemId?: string;
  costCenterId?: string;
  taxCodeId?: string;
  projectId?: string;
  memo?: LocalizedText;
  /** True when the resolved account is the active AR/AP control mapping. */
  isArApControl: boolean;
}

/** The engine's output plan — the application layer writes it atomically. */
export interface PostingPlan {
  spec: JournalSpec;
  fiscalPeriodId: string;
  exchangeRate: string;
  /** Effective rate = 1 for base currency entries. */
  effectiveRate: string;
  lines: ResolvedLine[];
}

/** Stored result returned for idempotent re-posts (INV-013). */
export interface PostingResult {
  journalEntryId: string;
  entryNo: string | null;
  /** True when this call returned a previously stored result. */
  idempotentReplay: boolean;
  status: "POSTED" | "REVERSED";
}
