/**
 * Public surface of the accounting module (DEPENDENCY_RULES §1 `api/`):
 * the posting engine + services consumed by later phases (treasury PHASE-008,
 * tax PHASE-009, …) and the port the partners module implements.
 */

export { PostingEngine, type PostingReadModel } from "../domain/posting-engine/posting-engine";
export {
  PostingService,
} from "../application/posting-service";
export {
  PARTNER_SUBLEDGER_PORT,
  type PartnerSubledgerEffect,
  type PartnerSubledgerPort,
} from "../application/partner-subledger-port";
export { JournalService, advanceSchedule } from "../application/journal-service";
export { CoaService } from "../application/coa-service";
export { PeriodService } from "../application/period-service";
export { FxService } from "../application/fx-service";
export { GlQueries } from "../application/gl-queries";
export { NumberingService } from "../application/numbering-service";
export { OpeningBalancesPostingService } from "../application/opening-balances-service";
export { YearEndService } from "../application/year-end-service";
export { ReconciliationService, type ChecklistItem, type CheckState } from "../application/reconciliation-service";
export type {
  JournalSpec,
  JournalLineSpec,
  JournalSource,
  PostingPlan,
  PostingResult,
  ReversalInput,
  Direction,
} from "../domain/posting-engine/journal-spec";
export {
  PostingError,
  type PostingErrorCode,
  entryNotBalanced,
  periodLocked,
  periodNotFound,
  accountNotPostable,
  accountArchived,
  currencyMismatch,
  purposeNotMapped,
  missingPartnerOnControl,
  missingFxRate,
  alreadyPosted,
  alreadyReversed,
  invalidAmount,
} from "../domain/posting-engine/posting-errors";
