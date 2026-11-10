/**
 * PHASE-022 T-P22-3-b · the reconciliation area barrel (MASTER-PLAN §2
 * layout: src/reconciliation/ — the parked-rejection surface, the FULL
 * CONFLICT_RESOLUTION §3 table). This area OWNS the write path (the
 * resend executors go through sync-core's enqueue/cancel); the companion
 * + personal areas stay read-only (their structural no-write proof is in
 * __tests__/companion-personal.test).
 */
export {
  REJECTION_ACTION_TABLE,
  REJECTION_AUDIT_CAP,
  REJECTION_AUDIT_META_KEY,
  acceptPartial,
  acceptServerPrice,
  actionsForRejectionCode,
  cancelRejected,
  discardRejected,
  editAndResend,
  entityIdOfPayload,
  parkedActionLabelKey,
  rejectionAuditTrail,
  requestApprovalOnline,
  substituteAndResend,
  traceIdOfRow,
  type ParkedActionCode,
  type ParkedActionSet,
  type RejectionAuditEntry,
  type ResendOptions,
  type ResendOutcome,
} from "./rejection-actions";
