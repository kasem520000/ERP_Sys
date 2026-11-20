import { DomainError } from "@erp/domain-core";

/**
 * PHASE-048 (Projects & Contracting) domain errors (W-9: the WBS +
 * budgets + actuals engines T-05…T-07; W-10: the EVM engine T-08, the
 * change-order gate T-09, the IAS-23 service D-11 — the plan §3). Codes
 * are stable API contracts (ERROR_MODEL §4) — the HTTP layer maps each
 * to its status; A7-sensitive not-founds render identically for
 * unknown-vs-foreign ids. The projects substrate itself is accounting's
 * (D-01: extended, never replaced) — these are the ENGINE's refusals,
 * never the GL's.
 */

// -- T-05: the WBS tree (BR-095 / D-03) -------------------------------------

/** Unknown or foreign WBS task id (A7: no existence disclosure). */
export class WbsTaskNotFoundError extends DomainError {
  constructor(id: string) {
    super("WBS_TASK_NOT_FOUND", `WBS task ${id} does not exist in this tenant`);
  }
}

/** Unknown or foreign project id on the WBS plane (A7). */
export class ProjectPlaneNotFoundError extends DomainError {
  constructor(projectId: string) {
    super("PROJECT_PLANE_NOT_FOUND", `project ${projectId} does not exist in this tenant`);
  }
}

/** WBS-level input validation (codes, dates, weights, percents) — the
 * 422 policy class for the WBS slice. */
export class WbsInputInvalidError extends DomainError {
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super("WBS_INPUT_INVALID", message, details);
  }
}

/**
 * D-03's cycle refusal — the dependency edge or the parent move would
 * close a loop. The details carry the cycle path (the ordered node ids)
 * so the refusal is actionable; the API is the ONLY move path, and this
 * guard fires BEFORE any write (the illegal state never saves).
 */
export class WbsCycleError extends DomainError {
  constructor(message: string, details: { cyclePath: readonly string[] }) {
    super("WBS_CYCLE", message, details);
  }
}

/** The cross-project contamination guard: a parent, a predecessor, or a
 * budget line's WBS node must belong to the SAME project as the row
 * being written (the composite tenant FK protects the tenant; the
 * engine protects the project boundary). */
export class WbsCrossProjectError extends DomainError {
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super("WBS_CROSS_PROJECT", message, details);
  }
}

/** The children-first law: the parent/predecessor RESTRICT edges mean a
 * task with dependents or children cannot be deleted until they move
 * away first (the evidence order). */
export class WbsTaskInUseError extends DomainError {
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super("WBS_TASK_IN_USE", message, details);
  }
}

// -- T-06: the budgets + allocations (D-04) ----------------------------------

/** Unknown or foreign budget id (A7). */
export class ProjectBudgetNotFoundError extends DomainError {
  constructor(id: string) {
    super("PROJECT_BUDGET_NOT_FOUND", `project budget ${id} does not exist in this tenant`);
  }
}

/** Budget-level input validation (names, windows, money shapes) — the
 * 422 policy class for the budget slice. */
export class BudgetInputInvalidError extends DomainError {
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super("BUDGET_INPUT_INVALID", message, details);
  }
}

/** The lifecycle guard: DRAFT budgets accept line edits; APPROVED is
 * the variance truth (PV reads it alone — D-04); CLOSED is readable
 * history. A status conflict is the typed 409 (the 028 precedent). */
export class BudgetStateError extends DomainError {
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super("BUDGET_STATE", message, details);
  }
}

/** Allocation-level input validation + the XOR target law (EMPLOYEE xor
 * ASSET — the 0101 CHECK's service-side mirror with the actionable
 * message). */
export class AllocationInputInvalidError extends DomainError {
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super("ALLOCATION_INPUT_INVALID", message, details);
  }
}

/** Unknown or foreign allocation id (A7). */
export class AllocationNotFoundError extends DomainError {
  constructor(id: string) {
    super("ALLOCATION_NOT_FOUND", `project resource allocation ${id} does not exist in this tenant`);
  }
}

// -- T-07: the actual collectors + INV-033 (D-05) ----------------------------

/** Actuals-plane input validation (windows, asOf shapes). */
export class ActualsInputInvalidError extends DomainError {
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super("ACTUALS_INPUT_INVALID", message, details);
  }
}

/**
 * INV-033 (the EVM consistency invariant — D-05's wording, the
 * INV-032(b) tolerance-0 spirit): the four-leg AC (labor + materials +
 * subcontract + allocated overhead) must reconcile to the GL project
 * dimension TO THE CENT. The typed reconciliation service REFUSES to
 * report at any residual — this error carries the per-leg breakdown and
 * the residual so the refusal is auditable and actionable.
 */
export class Inv033ReconciliationError extends DomainError {
  constructor(
    message: string,
    details: {
      projectId: string;
      labor: string;
      materials: string;
      subcontract: string;
      overheadAllocated: string;
      acTotal: string;
      glProjectDimension: string;
      residual: string;
    },
  ) {
    super("INV033_RECONCILIATION", message, details);
  }
}

// -- W-10 / T-08: the EVM engine (D-06) --------------------------------------

/** EVM-plane input validation (asOf shapes, budget ids). */
export class EvmInputInvalidError extends DomainError {
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super("EVM_INPUT_INVALID", message, details);
  }
}

/**
 * THE EV CEILING REFUSAL (acceptance #4 / D-06): the earned value
 * never exceeds the approved budget at the scope it is earned against
 * — a node's EV against the node's planned cells, the project's EV
 * against BAC (the approved budget + the approved change-order deltas).
 * The boundary EV = budget is legal (100% complete earns exactly the
 * budget); any excess is the typed refusal carrying the figures.
 */
export class EvCeilingExceededError extends DomainError {
  constructor(
    message: string,
    details: { ev: string; budget: string; percent: string | null },
  ) {
    super("EV_CEILING_EXCEEDED", message, details);
  }
}

// -- W-10 / T-09: the change-order gate (BR-094 / G-58 / D-07) ----------------

/** Unknown or foreign change-order id (A7: no existence disclosure). */
export class ChangeOrderNotFoundError extends DomainError {
  constructor(id: string) {
    super("CHANGE_ORDER_NOT_FOUND", `change order ${id} does not exist in this tenant`);
  }
}

/** Change-order input validation (titles, the signed delta shapes,
 * the non-zero schedule delta, the rejection reason). */
export class ChangeOrderInputInvalidError extends DomainError {
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super("CHANGE_ORDER_INPUT_INVALID", message, details);
  }
}

/**
 * The gate's lifecycle law (BR-094): DRAFT → SUBMITTED → APPROVED /
 * REJECTED — a wrong-state transition, a raced CAS move, or an edit on
 * a decided order is the typed 409-class refusal (the 045
 * simple-approval shape; the order stays exactly as it was).
 */
export class ChangeOrderStateError extends DomainError {
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super("CHANGE_ORDER_STATE", message, details);
  }
}

/**
 * G-58's exactly-once stamp (D-07): the effect application is
 * SINGLE-USE — `effect_applied_at` is consumed exactly once; a second
 * application attempt is the typed refusal (INV-013's engine-level
 * idempotency converges retries; the stamp refuses re-application).
 */
export class ChangeOrderEffectAlreadyAppliedError extends DomainError {
  constructor(message: string, details: { changeOrderId: string; effectAppliedAt: string }) {
    super("CHANGE_ORDER_EFFECT_ALREADY_APPLIED", message, details);
  }
}

// -- W-10 / D-11: the IAS-23 capitalization service ---------------------------

/** IAS-23-plane input validation (asOf shapes, project ids). */
export class Ias23InputInvalidError extends DomainError {
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super("IAS23_INPUT_INVALID", message, details);
  }
}

/**
 * THE RATE REGISTER'S LAW (D-11 / R-04 — REQUIRES_VERIFICATION): the
 * capitalization rate register (`projects.ias23_capitalization_rate`)
 * is tenant-entered WITH SOURCE EVIDENCE and the explicit verified
 * acknowledgement; while unset, malformed, or unverified the
 * capitalization computation AND the posting REFUSE — never a
 * fabricated rate (red line 5, the BR-055 family).
 */
export class Ias23RateUnverifiedError extends DomainError {
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super("IAS23_RATE_UNVERIFIED", message, details);
  }
}

/**
 * The window law: a qualifying project carries at least one WBS task
 * with BOTH schedule dates — the window [min start, max end] is the
 * construction window; without it the capitalization refuses (never a
 * fabricated window).
 */
export class Ias23WindowUndefinedError extends DomainError {
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super("IAS23_WINDOW_UNDEFINED", message, details);
  }
}

/**
 * The scope law: the capitalization rides the APPROVED budget's lines
 * (D-11) — a project with no APPROVED budget (or whose window overlaps
 * no line) has nothing to capitalize and the typed refusal names it.
 */
export class Ias23ScopeEmptyError extends DomainError {
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super("IAS23_SCOPE_EMPTY", message, details);
  }
}

/**
 * The never-future stop rule: the POSTING arm of the capitalization
 * covers ELAPSED expenditure only — asOf beyond today is the typed
 * refusal (the projection arm stays free: the preview computes at any
 * asOf and says so).
 */
export class Ias23AsOfInFutureError extends DomainError {
  constructor(message: string, details: { asOf: string; today: string }) {
    super("IAS23_AS_OF_IN_FUTURE", message, details);
  }
}

/**
 * The honest-empty posting refusal: a capitalization run whose total
 * capitalized amount is zero (every line's eligible accrual is zero —
 * the rate may be 0, the window may not have started) has nothing to
 * post and refuses rather than minting an empty entry.
 */
export class Ias23NothingToCapitalizeError extends DomainError {
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super("IAS23_NOTHING_TO_CAPITALIZE", message, details);
  }
}

/**
 * The single-use posting stamp: a window already POSTED (the
 * `ias23_capitalizations` rows carry status POSTED for this
 * budget-line/window slice) refuses re-capitalization — the history is
 * computation evidence (no delete, the 0103 law); a re-planned window
 * opens a NEW slice, never a re-post of the old one.
 */
export class Ias23AlreadyPostedError extends DomainError {
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super("IAS23_ALREADY_POSTED", message, details);
  }
}

// -- W-11 / T-10 + T-11 + T-12: the contracting core (D-08/D-09/D-10) --------

/** Unknown or foreign subcontractor agreement id (A7). */
export class SubcontractAgreementNotFoundError extends DomainError {
  constructor(id: string) {
    super(
      "SUBCONTRACT_AGREEMENT_NOT_FOUND",
      `subcontractor agreement ${id} does not exist in this tenant`,
    );
  }
}

/** Unknown or foreign subcontractor certificate id (A7). */
export class SubcontractCertificateNotFoundError extends DomainError {
  constructor(id: string) {
    super(
      "SUBCONTRACT_CERTIFICATE_NOT_FOUND",
      `subcontractor certificate ${id} does not exist in this tenant`,
    );
  }
}

/** Contracting-plane input validation (money shapes, percents, dates,
 * the retention terms, the void reason) — the 422 policy class. */
export class ContractingInputInvalidError extends DomainError {
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super("CONTRACTING_INPUT_INVALID", message, details);
  }
}

/**
 * The subcontract lifecycles' CAS law (0103): agreements
 * DRAFT → ACTIVE → CLOSED/CANCELLED, certificates DRAFT → APPROVED/VOID
 * — a wrong-state transition or a raced CAS move is the typed 409-class
 * refusal (the verdict stamps land in the same guarded statement, the
 * 0103 CHECKs' own shape).
 */
export class SubcontractStateError extends DomainError {
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super("SUBCONTRACT_STATE", message, details);
  }
}

/**
 * The sub certificate's approved-history law: an APPROVED certificate
 * is terminal evidence (no VOID, no re-decide — the 0103 approval-link
 * CHECK pins voided_at to the never-approved path); the single-use AP
 * stamp refuses a second linkage.
 */
export class SubcontractCertificateAlreadyApprovedError extends DomainError {
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super("SUBCONTRACT_CERTIFICATE_ALREADY_APPROVED", message, details);
  }
}

/** Unknown or foreign retention account id (A7). */
export class RetentionAccountNotFoundError extends DomainError {
  constructor(id: string) {
    super("RETENTION_ACCOUNT_NOT_FOUND", `retention account ${id} does not exist in this tenant`);
  }
}

/** The register's input law (the commercial spine's own shapes). */
export class RetentionInputInvalidError extends DomainError {
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super("RETENTION_INPUT_INVALID", message, details);
  }
}

/**
 * THE ONE-REGISTER-PER-PROJECT LAW (0103's partial unique, the side
 * law): the CUSTOMER row IS the customer contract's commercial spine —
 * a second register for the same project is the typed 23505 refusal
 * (never a silent replace).
 */
export class RetentionRegisterExistsError extends DomainError {
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super("RETENTION_REGISTER_EXISTS", message, details);
  }
}

/**
 * THE REGISTER'S IMMUTABLE CORE: the contract value + currency never
 * move after creation — the ONLY re-planning path is the approved
 * change order (W-10's ruling, BR-093's ceiling base); the customer
 * partner is the contract's counterparty. The patchable terms are the
 * hold % (the contract's own retention terms), the release schedule
 * and the notes.
 */
export class RetentionRegisterImmutableError extends DomainError {
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super("RETENTION_REGISTER_IMMUTABLE", message, details);
  }
}

/**
 * The release's gate law (G-56's documented schedule): the retention
 * releases only after the taking-over date (set and elapsed) and, when
 * contracted, the defect-liability date elapsed — the retention secures
 * the DLP, so releasing before it would defeat its purpose.
 */
export class RetentionReleaseGateError extends DomainError {
  constructor(message: string, details: { blocker: string; [key: string]: unknown }) {
    super("RETENTION_RELEASE_GATE", message, details);
  }
}

/**
 * The retention ledger's state law: a RELEASED row never re-releases
 * (the single-consumption CAS); an ACTIVE row with a zero accrued
 * balance has nothing to release (the honest refusal, never an empty
 * posting).
 */
export class RetentionStateError extends DomainError {
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super("RETENTION_STATE", message, details);
  }
}

/** Unknown or foreign progress certificate id (A7). */
export class ProgressCertificateNotFoundError extends DomainError {
  constructor(id: string) {
    super(
      "PROGRESS_CERTIFICATE_NOT_FOUND",
      `progress certificate ${id} does not exist in this tenant`,
    );
  }
}

/**
 * THE BR-092 FAIL-CLOSED LAW (the retention % from the contract): a
 * project with no CUSTOMER retention register (the contract's
 * commercial spine) cannot bill — the hold % is tenant DATA per
 * contract, never a global constant and never a guessed default; the
 * approval refuses (the certificate stays SUBMITTED).
 */
export class RetentionRegisterMissingError extends DomainError {
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super("RETENTION_REGISTER_MISSING", message, details);
  }
}

/**
 * THE BR-093 CEILING REFUSAL (the typed refusal, NO silent
 * truncation): cumulative billing (Σ the APPROVED certificates' gross
 * + THIS certificate's gross) never exceeds the approved contract
 * value including approved change orders (the effective contract value
 * — the retention register + Σ the APPROVED price deltas, W-10's
 * one-law read). The refusal carries the full figures so the approver
 * sees the exact overage.
 */
export class BillingCeilingExceededError extends DomainError {
  constructor(
    message: string,
    details: {
      projectId: string;
      alreadyBilled: string;
      thisGross: string;
      cumulativeAfter: string;
      ceiling: string;
      overage: string;
    },
  ) {
    super("BILLING_CEILING_EXCEEDED", message, details);
  }
}

/**
 * The customer certificate's lifecycle law (0103):
 * DRAFT → SUBMITTED → APPROVED / VOID — the verdict stamps land in the
 * same guarded CAS; an APPROVED certificate is terminal (the 0103
 * approval-link CHECK pins VOID to the never-approved path).
 */
export class ProgressCertificateStateError extends DomainError {
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super("PROGRESS_CERTIFICATE_STATE", message, details);
  }
}

/**
 * The certificate's invoice stamp is single-consumption: an APPROVED
 * certificate that already generated its sales invoice never generates
 * a second one (the guarded UPDATE refuses; INV-013 converges retries).
 */
export class CertificateInvoiceAlreadyGeneratedError extends DomainError {
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super("CERTIFICATE_INVOICE_ALREADY_GENERATED", message, details);
  }
}

// -- W-12 / T-13: the field service (D-12 — BR-096) ---------------------------

/** Unknown or foreign service visit id (A7). */
export class ServiceVisitNotFoundError extends DomainError {
  constructor(id: string) {
    super(
      "SERVICE_VISIT_NOT_FOUND",
      `service visit ${id} does not exist in this tenant`,
    );
  }
}

/**
 * Field-service-plane input validation (the window's shape, the
 * technician reference, the completion notes' length, the SLA register's
 * malformed shape) — the 422 policy class.
 */
export class FieldserviceInputInvalidError extends DomainError {
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super("FIELDSERVICE_INPUT_INVALID", message, details);
  }
}

/**
 * THE VISIT MACHINE'S CAS LAW (0103 — D-12): NEW → SCHEDULED →
 * DISPATCHED → IN_PROGRESS → COMPLETED → CLOSED, one row per visit, the
 * transitions are CAS writes with the 0103 stamp floors; a wrong-state
 * transition or a raced move is the typed 409-class refusal. CLOSED is
 * terminal (the evidence discipline: no DELETE, no reopen).
 */
export class ServiceVisitStateError extends DomainError {
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super("SERVICE_VISIT_STATE", message, details);
  }
}

/**
 * THE TECHNICIAN-FROM-DISPATCH LAW (0103's own CHECK, surfaced typed):
 * the technician is required from DISPATCHED on — the board's law. A
 * dispatch without a technician (neither on the row nor in the input)
 * refuses before the CHECK ever fires.
 */
export class ServiceVisitTechnicianRequiredError extends DomainError {
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super("SERVICE_VISIT_TECHNICIAN_REQUIRED", message, details);
  }
}

/**
 * THE CANCELLED-ORDER LAW: service visits ride the EXISTING
 * service_orders (never a new order surface — D-12); a CANCELLED order
 * accepts no visit writes (create/dispatch/complete all re-check — the
 * typed refusal, never a silent no-op).
 */
export class ServiceOrderCancelledError extends DomainError {
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super("SERVICE_ORDER_CANCELLED", message, details);
  }
}

/**
 * THE SLA REGISTER'S MALFORMED LAW (the settings key
 * projects.fieldservice_sla_targets): a register that exists but does
 * not parse to { response_target_hours, resolution_target_hours } is the
 * typed refusal — never a fabricated target and never a silent skip of
 * the breach evaluation (red line 5's fail-closed reading).
 */
export class SlaRegisterMalformedError extends DomainError {
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super("SLA_REGISTER_MALFORMED", message, details);
  }
}
