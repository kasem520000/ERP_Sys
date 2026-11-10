import { DomainError } from "@erp/domain-core";

/**
 * PHASE-007 posting-engine error taxonomy (POSTING_ENGINE.md §3 — the codes
 * are STABLE CONTRACTS, ERROR_MODEL §4: code is the enum, message is
 * display-only). Codes are verbatim per the phase document; each carries a
 * machine-readable `details` payload. Localized display strings live at the
 * HTTP edge (Accept-Language) — never here.
 */

export class PostingError extends DomainError {
  constructor(
    code: PostingErrorCode,
    message: string,
    details?: Readonly<Record<string, unknown>>,
  ) {
    super(code, message, details);
  }
}

export type PostingErrorCode =
  | "ENTRY_NOT_BALANCED"
  | "PERIOD_LOCKED"
  | "PERIOD_NOT_FOUND"
  | "ACCOUNT_NOT_POSTABLE"
  | "ACCOUNT_ARCHIVED"
  | "CURRENCY_MISMATCH"
  | "PURPOSE_NOT_MAPPED"
  | "MISSING_PARTNER_ON_CONTROL"
  | "MISSING_FX_RATE"
  | "ALREADY_POSTED"
  | "ALREADY_REVERSED"
  | "INVALID_AMOUNT"
  | "PROJECT_NOT_FOUND"
  | "PROJECT_CLOSED"
  | "PAYROLL_ACCOUNT_ENGINE_ONLY";

export function entryNotBalanced(details: {
  debit: string;
  credit: string;
  baseDebit?: string;
  baseCredit?: string;
}): PostingError {
  return new PostingError(
    "ENTRY_NOT_BALANCED",
    "journal entry is not balanced (Σdebit must equal Σcredit in document and base currency, 0 tolerance)",
    details,
  );
}

export function periodLocked(details: { entryDate: string; status: string }): PostingError {
  return new PostingError(
    "PERIOD_LOCKED",
    `entry date ${details.entryDate} falls in a ${details.status} fiscal period`,
    details,
  );
}

export function periodNotFound(details: { entryDate: string }): PostingError {
  return new PostingError(
    "PERIOD_NOT_FOUND",
    `no fiscal period covers entry date ${details.entryDate}`,
    details,
  );
}

export function accountNotPostable(details: { accountId: string; code?: string }): PostingError {
  return new PostingError(
    "ACCOUNT_NOT_POSTABLE",
    `account ${details.code ?? details.accountId} is a group node — only active leaf accounts accept lines (INV-004)`,
    details,
  );
}

export function accountArchived(details: { accountId: string; code?: string }): PostingError {
  return new PostingError(
    "ACCOUNT_ARCHIVED",
    `account ${details.code ?? details.accountId} is archived`,
    details,
  );
}

export function currencyMismatch(details: {
  accountId: string;
  accountCurrency: string;
  entryCurrency: string;
}): PostingError {
  return new PostingError(
    "CURRENCY_MISMATCH",
    `account ${details.accountId} is restricted to ${details.accountCurrency}; entry currency is ${details.entryCurrency} (INV-005)`,
    details,
  );
}

export function purposeNotMapped(details: { purposeKey: string }): PostingError {
  return new PostingError(
    "PURPOSE_NOT_MAPPED",
    `purpose ${details.purposeKey} has no active account mapping — posting fails closed, no fallback (CHART_OF_ACCOUNTS §2)`,
    details,
  );
}

export function missingPartnerOnControl(details: {
  accountId: string;
  purposeKey: string;
}): PostingError {
  return new PostingError(
    "MISSING_PARTNER_ON_CONTROL",
    `line hitting ${details.purposeKey} control account must carry a partner (INV-009)`,
    details,
  );
}

export function missingFxRate(details: { currency: string; base: string }): PostingError {
  return new PostingError(
    "MISSING_FX_RATE",
    `foreign-currency entry (${details.currency} on base ${details.base}) requires an exchange rate`,
    details,
  );
}

export function alreadyPosted(details: {
  sourceType: string;
  sourceId: string;
  operation: string;
}): PostingError {
  return new PostingError(
    "ALREADY_POSTED",
    `source ${details.sourceType}:${details.sourceId} operation ${details.operation} is already posted`,
    details,
  );
}

export function alreadyReversed(details: { entryId: string }): PostingError {
  return new PostingError(
    "ALREADY_REVERSED",
    `entry ${details.entryId} is already reversed (INV-014 — at most one reversal)`,
    details,
  );
}

export function invalidAmount(details: { amount: string }): PostingError {
  return new PostingError(
    "INVALID_AMOUNT",
    `amount ${details.amount} must be a positive decimal`,
    details,
  );
}

/** PHASE-019 (§8): the projects dimension stamp — unknown id fails closed
 * (no fallback dimension), 404-parity with PERIOD_NOT_FOUND. */
export function projectNotFound(details: { projectId: string }): PostingError {
  return new PostingError(
    "PROJECT_NOT_FOUND",
    `project ${details.projectId} does not exist in this tenant — the stamp fails closed (PHASE-019 §8)`,
    details,
  );
}

/** PHASE-019 (§8): a CLOSED project rejects NEW journal-line stamps (posted
 * history stays); the 422 mirrors PERIOD_LOCKED. */
export function projectClosed(details: { projectId: string }): PostingError {
  return new PostingError(
    "PROJECT_CLOSED",
    `project ${details.projectId} is CLOSED — new journal-line stamps are rejected (posted history stays; PHASE-019 §8)`,
    details,
  );
}

/**
 * PHASE-029 (BR-053): a manual journal (source `journal_entry`) touched an
 * account actively mapped to one of the six payroll purposes — payroll
 * accounts post ONLY via runs (G-29/G-30/G-31 module sources; the phase
 * §2 item 3 source-guard). Covers both the purpose-keyed line and the
 * explicit-accountId smuggle.
 */
export function payrollAccountEngineOnly(details: {
  accountId: string;
  purposeKey?: string;
  sourceType: string;
}): PostingError {
  return new PostingError(
    "PAYROLL_ACCOUNT_ENGINE_ONLY",
    `account ${details.accountId} is a payroll account (${details.purposeKey ?? "explicit id"}) — payroll accounts post only via payroll runs (BR-053; manual journals are rejected)`,
    details,
  );
}
