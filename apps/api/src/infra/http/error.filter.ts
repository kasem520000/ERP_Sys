import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  InternalServerErrorException,
  Logger,
} from "@nestjs/common";
import type { Response } from "express";

import { ZodError } from "zod";

import { DomainError } from "@erp/domain-core";

import { getCorrelationId } from "../observability/request-context";
import { setRetryAfter } from "./envelope";
import {
  AccountLockedError,
  ForbiddenError,
  InvalidCredentialsError,
  InvalidResetTokenError,
  InvalidTotpCodeError,
  InvitationNotAcceptableError,
  MfaBootstrapNotEligibleError,
  MfaEnrollmentRequiredError,
  MfaRequiredError,
  NotFoundError,
  RateLimitedError,
  StaleVersionError,
  TenantContextRequiredError,
  TenantSuspendedError,
  UnauthenticatedError,
} from "../../modules/identity/domain/identity-errors";
import { InvalidAuditEventError } from "../../modules/audit/api/audit";
import { WeakPasswordError } from "../../modules/identity/domain/password-policy";
import {
  BranchCodeTakenError,
  BranchNotActiveError,
  BranchScopeViolationError,
  EmailAlreadyRegisteredError,
  FeatureDependenciesMissingError,
  FeatureNotEntitledError,
  InvalidRegistrationInputError,
  InvalidTenantTransitionError,
  ManualGrantExpiryRequiredError,
  PlanClosureInvalidError,
  PlanNotFoundError,
  SupportAccessDeniedError,
  SupportSessionExpiredError,
  SupportSessionNotActiveError,
  UnknownFeatureKeyError,
} from "../../modules/tenancy/domain/tenancy-errors";
import {
  InvalidSettingValueError,
  UnknownSettingKeyError,
} from "../../modules/configuration/api";
import {
  AttachmentNotFoundError,
  AttachmentOwnerNotFoundError,
  CreditTermsCodeTakenError,
  CreditTermsNotFoundError,
  OpeningBalanceDraftError,
  OpeningBalanceDraftExistsError,
  PartnerArchivedError,
  PartnerCodeTakenError,
  PartnerInvalidTransitionError,
  PartnerKindChangeForbiddenError,
  PartnerNotFoundError,
  PriceListNotFoundError as PartnerPriceListNotFound,
  SystemCreditTermsImmutableError,
} from "../../modules/partners/domain/partner-errors";
import {
  VehicleArchivedError,
  VehicleChassisInvalidError,
  VehicleDuplicateChassisError,
  VehicleNotFoundError,
} from "../../modules/partners/vehicles/domain/vehicle-errors";
import {
  FreeGoodsRuleCodeDuplicateError,
  FreeGoodsRuleNotFoundError,
  SettlementDayLockedError,
  SettlementNotFoundError,
  SettlementStateError,
  TierCodeDuplicateError,
  TierNotFoundError,
} from "../../modules/distribution/domain/distribution-errors";
import { CommissionRunNotFoundError } from "../../modules/sales/commissions/domain/commission-errors";
import {
  BomActiveExistsError,
  BomCycleError,
  BomItemNotStockError,
  BomLineInvalidError,
  BomNotFoundError,
  BomNotActiveError,
  BomNotDraftError,
  BomRequiredError,
  BomSelfReferenceError,
  BomTooDeepError,
  BomUomMismatchError,
  BomVersionConflictError,
  BomYieldInvalidError,
  CompleteWithoutConsumptionError,
  ConsumptionNotPlannedError,
  FgShelfLifeRequiredError,
  OrderNotCancelableError,
  ProductionCostRoundingError,
  ProductionOrderInputInvalidError,
  ProductionOrderItemNotStockError,
  ProductionOrderNotFoundError,
  ProductionOrderStateError,
  ScrapExceedsWipError,
  ScrapReasonRequiredError,
  GenealogyBatchNotFoundError,
  InspectionDispositionInvalidError,
  InspectionDispositionRequiredError,
  InspectionInputInvalidError,
  InspectionNotFoundError,
  InspectionTargetInvalidError,
  InspectionTargetNotFoundError,
  QcScrapEmptyBatchError,
  QcScrapBatchNotQuarantinedError,
} from "../../modules/manufacturing/domain/manufacturing-errors";
import {
  ActivityInputInvalidError,
  AdvanceInsufficientOnAccountError,
  AdvanceStateError,
  ContractInputInvalidError,
  ContractNotFoundError,
  ContractStateError,
  ContractTermInvalidError,
  LeadConvertedError,
  LeadInputInvalidError,
  LeadLostReasonRequiredError,
  LeadMergeTargetRequiredError,
  LeadNotFoundError,
  ScheduleEntryNotFoundError,
  ServiceOrderInputInvalidError,
  ServiceOrderLineError,
  ServiceOrderNotFoundError,
  ServiceOrderPostingNotConfiguredError,
  ServiceOrderStateError,
  TaskInputInvalidError,
  TaskNotFoundError,
  TaskStateError,
  TimeEntryCaseRequiredError,
  TimeEntryInputInvalidError,
  TimeEntryNotFoundError,
  TimeEntryStateError,
  TimesheetEmptyError,
} from "../../modules/crm/domain/crm-errors";
import {
  BarcodeNotFoundError,
  BarcodeTakenError,
  CategoryCodeTakenError,
  CategoryCycleError,
  CategoryNotFoundError,
  CategoryParentArchivedError,
  ConversionDuplicateError,
  ConversionNotFoundError,
  ImportCommitConflictError,
  ImportFileInvalidError,
  ImportJobNotFoundError,
  ImportNotPreviewedError,
  ItemArchivedError,
  ItemNotFoundError,
  ItemSkuTakenError,
  PriceListInvalidError,
  PriceListNotFoundError,
  PriceListRowNotFoundError,
  SystemUomImmutableError,
  TrackingFlagsInvalidError,
  UomCodeTakenError,
  UomNotFoundError,
} from "../../modules/items/domain/items-errors";
import { PostingError } from "../../modules/accounting/domain/posting-engine/posting-errors";
import {
  StatementAlreadyReconciledError,
  BankRecPeriodLockedError,
  CashAccountAlreadyExistsError,
  CashAccountNotCloseableError,
  CashAccountClosedError,
  CashAccountCurrencyMismatchError,
  CashAccountTypeInvalidError,
  ExpenseCategoryCodeTakenError,
  MovementAlreadyMatchedError,
  PettyCashLimitExceededError,
  ShiftAlreadyOpenError,
  ShiftSupervisorPinInvalidError,
  ShiftSupervisorRequiredError,
  ShiftReasonRequiredError,
  StatementTooLargeError,
  StatementFormatInvalidError,
  TREASURY_NOT_FOUND_ERRORS,
  TreasuryDocumentStateError,
} from "../../modules/treasury/domain/treasury-errors";
// PHASE-027 (in-phase): the notes error taxonomy (T2 — the phase's doc-sync
// step completes the action keys for discount/return; the HTTP mapping
// registers here per the fixed_assets-intended-but-skipped pattern — see
// the SF-027 finding: the 026 fixed_assets classes were never registered,
// fixed below as the honest in-phase repair).
import {
  NoteAlreadyResolvedError,
  NoteCashAccountNotFoundError,
  NoteNotFoundError,
  NotePartnerNotFoundError,
  NoteSourceInvalidError,
} from "../../modules/notes/domain/notes-errors";
// PHASE-028 (in-phase): the budgeting error taxonomy (T2 — registration
// is expected in-phase per the SF-027-001 lesson): 404 not-founds (A7
// parity — unknown == foreign ids, never an existence disclosure), 409
// lifecycle conflicts (the state machine, SoD self-approval, DRAFT-only
// grid immutability, the BR-050 one-ACTIVE race backstop); the 422
// validation family (period mismatch, scope dimensions, line caps,
// duplicate keys, BUDGET_EXCEEDED, import shape) falls through to the
// 422 default by design.
import {
  BudgetActiveExistsError,
  BudgetBranchNotFoundError,
  BudgetCostCenterNotFoundError,
  BudgetImmutableError,
  BudgetNotFoundError,
  BudgetNotApprovedError,
  BudgetSelfApprovalError,
  BudgetStateError,
} from "../../modules/budgeting/domain/budgeting-errors";
// PHASE-029 (in-phase): the payroll error taxonomy (registration is
// expected in-phase per the SF-027-001 lesson): 404 not-founds (A7
// parity — unknown == foreign ids, never an existence disclosure), 409
// lifecycle conflicts (run state machine, SoD self-approval, IMMUTABLE_
// DOCUMENT on posted runs/loan schedules, the one-live-run-per-period
// law, BR-052 structure freeze); the 422 family (currency/shape, cap,
// EOS basis, payout bound, code conflicts) falls through to the 422
// default by design.
import {
  ComponentAccountNotFoundError,
  ComponentNotFoundError,
  EmployeeNotFoundError,
  EosSettlementExceedsBalanceError,
  LoanLineNotFoundError,
  LoanNotFoundError,
  PayrollCodeConflictError,
  PayrollStateError,
  RunImmutableError,
  RunNotFoundError,
  RunPeriodExistsError,
  RunSelfApprovalError,
  StructureInUseError,
  StructureNotActiveError,
  StructureNotFoundError,
} from "../../modules/payroll/domain/payroll-errors";
// SF-027-001 (the honest 026 gap repair): the fixed_assets error classes
// were never registered in domainStatus (verified at 027 HEAD — they
// surfaced over HTTP with the 422 fallback while the codes stayed typed at
// the service level). Registered here exactly as the depreciation-errors
// header's status map documents them (404 not-founds, 409 lifecycle
// conflicts, 422 fall-through for the policy/validation family).
import {
  AlreadyCapitalizedError,
  AssetCategoryCodeConflictError,
  AssetCategoryNotFoundError,
  AssetCodeConflictError,
  AssetNotFoundError,
} from "../../modules/fixed_assets/domain/fixed-assets-errors";
import {
  DepreciationRunNotFoundError,
  RunAlreadyExistsError,
  RunNotPostableError,
} from "../../modules/fixed_assets/application/depreciation-errors";
import {
  DisposalNotApprovedError,
  DisposalNotFoundError,
  DisposedAssetReuseError,
  LiveDraftConflictError,
  RevaluationNotFoundError,
  RevaluationNotPostableError,
} from "../../modules/fixed_assets/application/lifecycle-errors";
import {
  AccountNotFoundError,
  FiscalYearNotFoundError,
  GlAccountNotFoundError,
  JournalDraftNotFoundError,
  PeriodNotFoundError,
  ProjectCodeTakenError,
  ProjectNotFoundError,
  RecurringJournalNotFoundError,
} from "../../modules/accounting/domain/accounting-errors";
import {
  PurchasingDocumentStateError,
  PurchaseRequestNotFoundError,
  PurchaseOrderNotFoundError,
  GoodsReceiptNotFoundError,
  SupplierInvoiceNotFoundError,
  DebitNoteNotFoundError,
  LandedCostNotFoundError,
  SupplierNotFoundError,
} from "../../modules/purchasing/domain/purchasing-errors";
import {
  ForbiddenAtRunError,
  AssertionFailedExportBlockedError,
  ReportNotFoundError,
  ReportRunNotFoundError,
  ReportParamsInvalidError,
  ContractVersionMismatchError,
} from "../../modules/reporting/domain/reporting-errors";
import {
  SubscriptionReadOnlyError,
  LimitExceededError,
  DowngradeBlockedError,
  WebhookSignatureInvalidError,
  WebhookReplayError,
  CheckoutSessionNotFoundError,
  CheckoutSessionSettledError,
  ManualPaymentNotAllowedError,
  ManualPaymentReasonRequiredError,
  InvalidSubscriptionTransitionError,
  PlanUnchangedError,
  SubscriptionInvoiceNotFoundError,
} from "../../modules/tenancy/domain/subscription-errors";
import {
  BatchNotActiveError,
  BatchNotQuarantinedError,
  BatchProvenanceConflictError,
  BatchQuarantinedError,
} from "../../modules/inventory/domain/inventory-errors";
import {
  SyncCommandInvalidError,
  SyncContractUnsupportedError,
  SyncDeviceRevokedError,
  SyncEntityNotPulledError,
  SyncRateLimitedError,
  SyncTenantSuspendedError,
} from "../../modules/sync/domain/sync-errors";
import {
  DeviceAttestationFailedError,
  DeviceAttestationUnavailableError,
  DeviceNotFoundError,
} from "../../modules/sync/application/device-registry-service";
import {
  DeviceRefreshInvalidError,
  DeviceRevokedError,
} from "../../modules/sync/application/device-tokens";

/**
 * ERROR_MODEL exception filter: the single error envelope —
 * `{ error: { code, message, details, traceId, retryable } }`. Codes are
 * contracts; messages are display-only. Domain errors map to their stable
 * HTTP statuses (§2); lockout stays indistinguishable from credential
 * failure (§5.2); 429 always carries Retry-After; anything unmapped is a
 * 500 INTERNAL_ERROR that never leaks internals.
 */

const log = new Logger("http-errors");

interface ErrorBody {
  code: string;
  message: string;
  details?: unknown;
  retryable: boolean;
}

interface ErrorEnvelope {
  error: ErrorBody & { traceId: string };
}

@Catch()
export class ErrorModelFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const { status, body, retryAfter } = this.map(exception);

    if (status >= 500) {
      log.error(exception instanceof Error ? exception.stack : String(exception));
    } else {
      log.debug(
        `http ${status} ${body.code} — ${exception instanceof Error ? exception.message : String(exception)}`,
      );
    }
    if (retryAfter !== undefined) {
      setRetryAfter(response, retryAfter);
    }
    const envelope: ErrorEnvelope = {
      error: { ...body, traceId: getCorrelationId() ?? "" },
    };
    response.status(status).json(envelope);
  }

  private map(exception: unknown): { status: number; body: ErrorBody; retryAfter?: number } {
    if (exception instanceof ZodError) {
      // API_CONVENTIONS §3: unknown/malformed fields are rejected loudly —
      // zod issues surface as typed fieldErrors inside details.
      return {
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        body: {
          code: "VALIDATION_ERROR",
          message: "request payload failed validation",
          details: {
            fieldErrors: exception.issues.map((issue) => ({
              path: issue.path.join("."),
              message: issue.message,
              code: issue.code,
            })),
          },
          retryable: false,
        },
      };
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      if (exception instanceof InternalServerErrorException) {
        return internal();
      }
      return {
        status,
        body: {
          code: nestCode(status),
          message: exception.message,
          retryable: status >= 500,
        },
      };
    }
    if (exception instanceof DomainError) {
      return { status: domainStatus(exception), body: fromDomain(exception), retryAfter: retryAfterOf(exception) };
    }
    return internal();
  }
}

function internal(): { status: number; body: ErrorBody } {
  return {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    body: { code: "INTERNAL_ERROR", message: "internal server error", retryable: true },
  };
}

function nestCode(status: number): string {
  switch (status) {
    case HttpStatus.UNAUTHORIZED:
      return "UNAUTHENTICATED";
    case HttpStatus.FORBIDDEN:
      return "FORBIDDEN";
    case HttpStatus.NOT_FOUND:
      return "NOT_FOUND";
    case HttpStatus.CONFLICT:
      return "STALE_VERSION";
    case HttpStatus.UNPROCESSABLE_ENTITY:
      return "VALIDATION_ERROR";
    case HttpStatus.SERVICE_UNAVAILABLE:
      return "SERVICE_UNAVAILABLE";
    case HttpStatus.BAD_REQUEST:
      return "BAD_REQUEST";
    default:
      return "INTERNAL_ERROR";
  }
}

function domainStatus(error: DomainError): number {
  if (
    error instanceof InvalidCredentialsError ||
    error instanceof AccountLockedError ||
    error instanceof UnauthenticatedError
  ) {
    return HttpStatus.UNAUTHORIZED;
  }
  if (error instanceof RateLimitedError) {
    return HttpStatus.TOO_MANY_REQUESTS;
  }
  if (error instanceof MfaRequiredError) {
    return HttpStatus.LOCKED; // 423 per ERROR_MODEL §2
  }
  // PHASE-024: the enrollment-gate + bootstrap-eligibility contracts.
  if (error instanceof MfaEnrollmentRequiredError) {
    return HttpStatus.LOCKED; // 423 — same family as MFA_REQUIRED
  }
  if (error instanceof MfaBootstrapNotEligibleError) {
    return HttpStatus.CONFLICT; // 409 — conflicts with the account state
  }
  if (
    error instanceof ForbiddenError ||
    error instanceof TenantContextRequiredError ||
    error instanceof WeakPasswordError ||
    error instanceof BranchScopeViolationError ||
    error instanceof BranchNotActiveError ||
    error instanceof FeatureNotEntitledError ||
    error instanceof SubscriptionReadOnlyError ||
    error instanceof ForbiddenAtRunError ||
    error instanceof SupportAccessDeniedError ||
    error instanceof SupportSessionExpiredError
  ) {
    return HttpStatus.FORBIDDEN;
  }
  if (
    error instanceof NotFoundError ||
    error instanceof PlanNotFoundError ||
    // PHASE-006 master-data not-founds (404; A7 404-parity).
    error instanceof PartnerNotFoundError ||
    error instanceof CreditTermsNotFoundError ||
    error instanceof ItemNotFoundError ||
    error instanceof CategoryNotFoundError ||
    error instanceof BarcodeNotFoundError ||
    error instanceof UomNotFoundError ||
    error instanceof PriceListNotFoundError ||
    error instanceof PartnerPriceListNotFound ||
    error instanceof PriceListRowNotFoundError ||
    error instanceof ImportJobNotFoundError ||
    error instanceof AttachmentNotFoundError ||
    error instanceof AttachmentOwnerNotFoundError ||
    // PHASE-013 reporting not-founds (404-shaped; A-series parity).
    error instanceof ReportNotFoundError ||
    error instanceof ReportRunNotFoundError ||
    error instanceof ConversionNotFoundError ||
    // PHASE-014 billing not-founds (404; A7 parity).
    error instanceof CheckoutSessionNotFoundError ||
    error instanceof SubscriptionInvoiceNotFoundError
  ) {
    return HttpStatus.NOT_FOUND;
  }
  // PHASE-007 accounting not-founds (404; A7 404-parity — identical shape
  // for unknown-vs-foreign ids, no existence disclosure).
  if (
    error instanceof AccountNotFoundError ||
    error instanceof FiscalYearNotFoundError ||
    error instanceof PeriodNotFoundError ||
    error instanceof JournalDraftNotFoundError ||
    error instanceof RecurringJournalNotFoundError ||
    error instanceof GlAccountNotFoundError ||
    // PHASE-019 (T44): the projects dimension's controller surface — PATCH
    // by id is a resource lookup (the module's 404 shape, A7 parity).
    error instanceof ProjectNotFoundError
  ) {
    return HttpStatus.NOT_FOUND;
  }
  // PHASE-008 treasury not-founds (404; same A7 parity).
  if (TREASURY_NOT_FOUND_ERRORS.some((type) => error instanceof type)) {
    return HttpStatus.NOT_FOUND;
  }
  // PHASE-011 purchasing not-founds (404; A7 parity — identical shape for
  // unknown-vs-foreign ids, no existence disclosure).
  if (
    error instanceof PurchaseRequestNotFoundError ||
    error instanceof PurchaseOrderNotFoundError ||
    error instanceof GoodsReceiptNotFoundError ||
    error instanceof SupplierInvoiceNotFoundError ||
    error instanceof DebitNoteNotFoundError ||
    error instanceof LandedCostNotFoundError ||
    error instanceof SupplierNotFoundError
  ) {
    return HttpStatus.NOT_FOUND;
  }
  // PHASE-017 vehicle registry (404/409/422; same A7 parity): unknown vs
  // foreign ids, the chassis natural-key + archive lifecycle conflicts,
  // and the VIN-shape pre-check.
  if (error instanceof VehicleNotFoundError) {
    return HttpStatus.NOT_FOUND;
  }
  // PHASE-017 rep settlements (404/409; same A7 parity): unknown vs foreign
  // ids, lifecycle/state violations, and the POSTED day lock (uq + the
  // immutable-day rule — corrections are new documents). The policy-class
  // rejections (reason/approval/pending-gate/self-approval) fall through to
  // the 422 default.
  if (error instanceof SettlementNotFoundError) {
    return HttpStatus.NOT_FOUND;
  }
  // PHASE-017 commission runs (404; state/rule rejections stay 422).
  if (error instanceof CommissionRunNotFoundError) {
    return HttpStatus.NOT_FOUND;
  }
  // PHASE-027 notes (T2 — 404/409; A7 parity: unknown == foreign ids, never
  // an existence disclosure). The 422 family (custody transitions, reason
  // required, rate/currency/account validation, immutability) falls through
  // to the 422 default by design.
  if (
    error instanceof NoteNotFoundError ||
    error instanceof NotePartnerNotFoundError ||
    error instanceof NoteSourceInvalidError ||
    error instanceof NoteCashAccountNotFoundError
  ) {
    return HttpStatus.NOT_FOUND;
  }
  if (error instanceof NoteAlreadyResolvedError) {
    return HttpStatus.CONFLICT;
  }
  // PHASE-028 budgeting (T2 — 404/409; A7 parity: unknown == foreign
  // budget/cost-center/branch ids, never an existence disclosure). The
  // reused accounting not-founds (FiscalYear/Period/Account/Project) are
  // registered above. The 422 family (period mismatch, scope dimensions,
  // line caps, duplicate keys, BUDGET_EXCEEDED, import shape) falls
  // through to the 422 default by design.
  if (
    error instanceof BudgetNotFoundError ||
    error instanceof BudgetCostCenterNotFoundError ||
    error instanceof BudgetBranchNotFoundError
  ) {
    return HttpStatus.NOT_FOUND;
  }
  if (
    error instanceof BudgetStateError ||
    error instanceof BudgetSelfApprovalError ||
    error instanceof BudgetImmutableError ||
    error instanceof BudgetNotApprovedError ||
    error instanceof BudgetActiveExistsError
  ) {
    return HttpStatus.CONFLICT;
  }
  // PHASE-029 payroll (in-phase): 404 not-founds (A7 parity — unknown ==
  // foreign employee/structure/component/run/loan/line/account ids);
  // 409 lifecycle conflicts (the run state machine + SoD, posted-run
  // immutability + loan-schedule immutability + the one-live-run law +
  // the BR-052 structure freeze). The 422 family (structure currency,
  // component shape, employee structure missing, BR-054 cap, EOS basis,
  // settlement/payout bounds, code conflicts) falls through to the 422
  // default by design.
  if (
    error instanceof EmployeeNotFoundError ||
    error instanceof StructureNotFoundError ||
    error instanceof ComponentNotFoundError ||
    error instanceof ComponentAccountNotFoundError ||
    error instanceof RunNotFoundError ||
    error instanceof LoanNotFoundError ||
    error instanceof LoanLineNotFoundError
  ) {
    return HttpStatus.NOT_FOUND;
  }
  if (
    error instanceof PayrollStateError ||
    error instanceof RunSelfApprovalError ||
    error instanceof RunImmutableError ||
    error instanceof RunPeriodExistsError ||
    error instanceof StructureInUseError ||
    error instanceof StructureNotActiveError ||
    error instanceof PayrollCodeConflictError ||
    error instanceof EosSettlementExceedsBalanceError
  ) {
    return HttpStatus.CONFLICT;
  }
  // SF-027-001: the fixed_assets 404s + 409s (the policy/validation family
  // falls through to the 422 default — PERIOD_LOCKED, CATEGORY_NOT_USABLE,
  // NBV_FLOOR_VIOLATION, SELF_APPROVAL_BLOCKED, … exactly as the 026
  // depreciation-errors header documents them).
  if (
    error instanceof AssetCategoryNotFoundError ||
    error instanceof AssetNotFoundError ||
    error instanceof DepreciationRunNotFoundError ||
    error instanceof RevaluationNotFoundError ||
    error instanceof DisposalNotFoundError
  ) {
    return HttpStatus.NOT_FOUND;
  }
  if (
    error instanceof AssetCategoryCodeConflictError ||
    error instanceof AssetCodeConflictError ||
    error instanceof AlreadyCapitalizedError ||
    error instanceof LiveDraftConflictError ||
    error instanceof RevaluationNotPostableError ||
    error instanceof DisposalNotApprovedError ||
    error instanceof DisposedAssetReuseError ||
    error instanceof RunAlreadyExistsError ||
    error instanceof RunNotPostableError
  ) {
    return HttpStatus.CONFLICT;
  }
  // PHASE-017 customer tiers + free-goods rules (T11; 404/409; same A7
  // parity): unknown vs foreign ids, and the tenant-unique natural keys
  // (uq_customer_tiers_tenant_code / uq_free_goods_rules_tenant_code).
  // The policy-class rejections (tier price-list kind, discount caps, rule
  // windows/quantities) fall through to the 422 default.
  if (error instanceof TierNotFoundError || error instanceof FreeGoodsRuleNotFoundError) {
    return HttpStatus.NOT_FOUND;
  }
  if (error instanceof TierCodeDuplicateError || error instanceof FreeGoodsRuleCodeDuplicateError) {
    return HttpStatus.CONFLICT;
  }
  if (error instanceof SettlementStateError || error instanceof SettlementDayLockedError) {
    return HttpStatus.CONFLICT;
  }
  if (error instanceof VehicleDuplicateChassisError || error instanceof VehicleArchivedError) {
    return HttpStatus.CONFLICT;
  }
  if (error instanceof VehicleChassisInvalidError) {
    return HttpStatus.UNPROCESSABLE_ENTITY;
  }
  // Purchasing lifecycle conflicts (409): wrong-state transitions,
  // immutable posted documents, duplicate invoices (BR-011), GRN over-
  // receipt, PO state.
  if (error instanceof PurchasingDocumentStateError) {
    return HttpStatus.CONFLICT;
  }
  // BR-022 fixed: the period lock + the reconcile-once rule are conflicts.
  if (
    error instanceof StatementAlreadyReconciledError ||
    error instanceof BankRecPeriodLockedError ||
    error instanceof MovementAlreadyMatchedError
  ) {
    return HttpStatus.CONFLICT;
  }
  // Treasury lifecycle conflicts (409): duplicate names/codes, closed
  // accounts, a not-closeable account, an OPEN shift, IMMUTABLE_DOCUMENT-
  // style state violations.
  if (
    error instanceof CashAccountAlreadyExistsError ||
    error instanceof ExpenseCategoryCodeTakenError ||
    error instanceof CashAccountClosedError ||
    error instanceof CashAccountNotCloseableError ||
    error instanceof ShiftAlreadyOpenError ||
    error instanceof TreasuryDocumentStateError
  ) {
    return HttpStatus.CONFLICT;
  }
  // Treasury policy rejections (422): caps, attestation, format, currency
  // compatibility (INV-005-style), bounds.
  if (
    error instanceof PettyCashLimitExceededError ||
    error instanceof ShiftSupervisorRequiredError ||
    error instanceof ShiftSupervisorPinInvalidError ||
    error instanceof ShiftReasonRequiredError ||
    error instanceof StatementTooLargeError ||
    error instanceof StatementFormatInvalidError ||
    error instanceof CashAccountCurrencyMismatchError ||
    error instanceof CashAccountTypeInvalidError
  ) {
    return HttpStatus.UNPROCESSABLE_ENTITY;
  }
  // Posting-engine taxonomy (POSTING_ENGINE §3; ERROR_MODEL §2): stable
  // codes with their documented statuses.
  if (error instanceof PostingError) {
    if (error.code === "ALREADY_POSTED" || error.code === "ALREADY_REVERSED") {
      return HttpStatus.CONFLICT;
    }
    if (
      error.code === "PERIOD_NOT_FOUND" ||
      error.code === "ACCOUNT_NOT_POSTABLE" ||
      error.code === "ACCOUNT_ARCHIVED" ||
      error.code === "PURPOSE_NOT_MAPPED"
    ) {
      return HttpStatus.NOT_FOUND;
    }
    return HttpStatus.UNPROCESSABLE_ENTITY;
  }
  if (
    error instanceof StaleVersionError ||
    error instanceof EmailAlreadyRegisteredError ||
    error instanceof BranchCodeTakenError ||
    error instanceof InvalidTenantTransitionError ||
    error instanceof SupportSessionNotActiveError ||
    // PHASE-014 billing conflicts (409).
    error instanceof InvalidSubscriptionTransitionError ||
    error instanceof PlanUnchangedError ||
    error instanceof CheckoutSessionSettledError ||
    // PHASE-006 natural-key conflicts + lifecycle states (409).
    error instanceof PartnerCodeTakenError ||
    error instanceof CreditTermsCodeTakenError ||
    error instanceof ItemSkuTakenError ||
    error instanceof CategoryCodeTakenError ||
    error instanceof BarcodeTakenError ||
    error instanceof UomCodeTakenError ||
    error instanceof ConversionDuplicateError ||
    error instanceof ImportCommitConflictError ||
    error instanceof PartnerKindChangeForbiddenError ||
    error instanceof OpeningBalanceDraftExistsError ||
    error instanceof PartnerArchivedError ||
    error instanceof ItemArchivedError ||
    error instanceof PartnerInvalidTransitionError ||
    // PHASE-019 (T44): the projects natural key (uq_projects_tenant_code
    // surfaced typed — duplicate project codes are 409 conflicts).
    error instanceof ProjectCodeTakenError
  ) {
    return HttpStatus.CONFLICT;
  }
  if (error instanceof TenantSuspendedError) {
    return HttpStatus.SERVICE_UNAVAILABLE;
  }
  // PHASE-018 (migration 0026): the manufacturing quarantine/provenance
  // lifecycle conflicts (409) — the internal inventory surface the QC gate
  // and completion flow call. The policy-class rejections
  // (WAREHOUSE_ROLE_INVALID, ITEM_SHELF_LIFE_INVALID) fall through to the
  // 422 default.
  if (
    error instanceof BatchQuarantinedError ||
    error instanceof BatchNotActiveError ||
    error instanceof BatchNotQuarantinedError ||
    error instanceof BatchProvenanceConflictError
  ) {
    return HttpStatus.CONFLICT;
  }
  // PHASE-018 manufacturing (T38a — the BOM slice; same A7 parity): the
  // version-lifecycle conflicts (409) — one-active invariant, version
  // collision, DRAFT/ACTIVE-gated transitions — the 404 not-found, and the
  // 422 policy class (recipe shape, uom equality, cycle/depth guards).
  if (
    error instanceof BomVersionConflictError ||
    error instanceof BomNotDraftError ||
    error instanceof BomNotActiveError ||
    error instanceof BomActiveExistsError
  ) {
    return HttpStatus.CONFLICT;
  }
  if (error instanceof BomNotFoundError) {
    return HttpStatus.NOT_FOUND;
  }
  if (
    error instanceof BomLineInvalidError ||
    error instanceof BomCycleError ||
    error instanceof BomTooDeepError ||
    error instanceof BomItemNotStockError ||
    error instanceof BomSelfReferenceError ||
    error instanceof BomYieldInvalidError ||
    error instanceof BomUomMismatchError
  ) {
    return HttpStatus.UNPROCESSABLE_ENTITY;
  }
  // PHASE-018 manufacturing (T38b — the production-order slice): lifecycle
  // state conflicts (409) — off-matrix transitions + the cancel-after-
  // consumption guard; the 404 not-found; and the 422 policy class
  // (input shape, unplanned consumption, BOM-required at release, scrap
  // reason policy + WIP-balance guard, completion guards, cost rounding).
  if (
    error instanceof ProductionOrderStateError ||
    error instanceof OrderNotCancelableError
  ) {
    return HttpStatus.CONFLICT;
  }
  if (error instanceof ProductionOrderNotFoundError) {
    return HttpStatus.NOT_FOUND;
  }
  if (
    error instanceof ProductionOrderInputInvalidError ||
    error instanceof ProductionOrderItemNotStockError ||
    error instanceof BomRequiredError ||
    error instanceof ConsumptionNotPlannedError ||
    error instanceof ScrapReasonRequiredError ||
    error instanceof ScrapExceedsWipError ||
    error instanceof CompleteWithoutConsumptionError ||
    error instanceof ProductionCostRoundingError ||
    error instanceof FgShelfLifeRequiredError
  ) {
    return HttpStatus.UNPROCESSABLE_ENTITY;
  }
  // PHASE-018 manufacturing (T39 — QC + genealogy): the QC gate's not-founds
  // (inspection, GRN target, genealogy batch — A7 parity), the one 409
  // (FAIL+SCRAP without a QUARANTINED FG batch to empty), and the 422 policy
  // class (target shape, sampled/sampleSize consistency, FAIL-without-
  // disposition, PASS/RETURN_TO_SUPPLIER disposition mismatches, scrap of an
  // already-empty quarantined batch).
  if (
    error instanceof InspectionNotFoundError ||
    error instanceof InspectionTargetNotFoundError ||
    error instanceof GenealogyBatchNotFoundError
  ) {
    return HttpStatus.NOT_FOUND;
  }
  if (error instanceof QcScrapBatchNotQuarantinedError) {
    return HttpStatus.CONFLICT;
  }
  if (
    error instanceof InspectionTargetInvalidError ||
    error instanceof InspectionInputInvalidError ||
    error instanceof InspectionDispositionRequiredError ||
    error instanceof InspectionDispositionInvalidError ||
    error instanceof QcScrapEmptyBatchError
  ) {
    return HttpStatus.UNPROCESSABLE_ENTITY;
  }
  // PHASE-019 crm (T45 — leads + tasks/activities): the 404 not-founds
  // (lead, task — A7 parity; the MERGE target probe reads identically for
  // unknown vs foreign partners), the 409 state conflicts (the converted
  // lead's immutability + off-lifecycle task transitions), and the 422
  // policy class (input shapes, the lost-reason requirement).
  // PHASE-019 crm (T46 — contracts/schedule/advances/time): the same three
  // classes — 404 not-founds (contract, schedule entry, time entry), 409
  // state conflicts (contract lifecycle, advance guards, timeslip
  // transitions), 422 policy class (contract input/term shapes, the
  // on-account insufficiency, the case-required policy, timeslip shapes,
  // the empty-timesheet review).
  // PHASE-019 crm (T48 — service orders): the job-card error family mapped
  // — 404 not-found (A7), 409 lifecycle (the folded never-cancelable guard
  // rides the same code, the T46 ADVANCE_STATE precedent), 422 the
  // input/line classes. SERVICE_ORDER_POSTING_NOT_CONFIGURED is a wiring
  // fault, not a client input: 503 (retryable posture — the module wires
  // the port at controller construction, so this is the belt).
  if (
    error instanceof LeadNotFoundError ||
    error instanceof TaskNotFoundError ||
    error instanceof LeadMergeTargetRequiredError ||
    error instanceof ContractNotFoundError ||
    error instanceof ScheduleEntryNotFoundError ||
    error instanceof TimeEntryNotFoundError ||
    error instanceof ServiceOrderNotFoundError
  ) {
    return HttpStatus.NOT_FOUND;
  }
  if (
    error instanceof LeadConvertedError ||
    error instanceof TaskStateError ||
    error instanceof ContractStateError ||
    error instanceof AdvanceStateError ||
    error instanceof TimeEntryStateError ||
    error instanceof ServiceOrderStateError
  ) {
    return HttpStatus.CONFLICT;
  }
  if (error instanceof ServiceOrderPostingNotConfiguredError) {
    return HttpStatus.SERVICE_UNAVAILABLE;
  }
  if (
    error instanceof LeadInputInvalidError ||
    error instanceof LeadLostReasonRequiredError ||
    error instanceof TaskInputInvalidError ||
    error instanceof ActivityInputInvalidError ||
    error instanceof ContractInputInvalidError ||
    error instanceof ContractTermInvalidError ||
    error instanceof AdvanceInsufficientOnAccountError ||
    error instanceof TimeEntryCaseRequiredError ||
    error instanceof TimeEntryInputInvalidError ||
    error instanceof TimesheetEmptyError ||
    error instanceof ServiceOrderInputInvalidError ||
    error instanceof ServiceOrderLineError
  ) {
    return HttpStatus.UNPROCESSABLE_ENTITY;
  }
  if (
    error instanceof InvalidResetTokenError ||
    error instanceof InvalidTotpCodeError ||
    error instanceof InvitationNotAcceptableError ||
    error instanceof InvalidAuditEventError ||
    error instanceof UnknownSettingKeyError ||
    error instanceof InvalidSettingValueError ||
    error instanceof InvalidRegistrationInputError ||
    error instanceof FeatureDependenciesMissingError ||
    error instanceof UnknownFeatureKeyError ||
    error instanceof ManualGrantExpiryRequiredError ||
    error instanceof PlanClosureInvalidError ||
    // PHASE-006 rule violations (422): draft shapes/signs, tracking flags,
    // price-list windows, import files, immutable seeds, category trees.
    error instanceof OpeningBalanceDraftError ||
    error instanceof TrackingFlagsInvalidError ||
    error instanceof PriceListInvalidError ||
    error instanceof ImportFileInvalidError ||
    error instanceof ImportNotPreviewedError ||
    error instanceof CategoryCycleError ||
    error instanceof CategoryParentArchivedError ||
    error instanceof SystemCreditTermsImmutableError ||
    error instanceof SystemUomImmutableError
  ) {
    return HttpStatus.UNPROCESSABLE_ENTITY;
  }
  // PHASE-013 reporting policy rejections (422): params, export block,
  // version mismatch (ERROR_MODEL; ASSERTION_FAILED export block).
  if (
    error instanceof AssertionFailedExportBlockedError ||
    error instanceof ReportParamsInvalidError ||
    error instanceof ContractVersionMismatchError
  ) {
    return HttpStatus.UNPROCESSABLE_ENTITY;
  }
  // PHASE-014 billing policy rejections (422 per ERROR_MODEL; the phase
  // doc's limit_exceeded / downgrade_blocked / webhook concepts): §6 hard
  // blocks on creation actions, the §8 downgrade gate, manual-payment
  // shape, and webhook signature/replay validation (400).
  if (
    error instanceof LimitExceededError ||
    error instanceof DowngradeBlockedError ||
    error instanceof ManualPaymentNotAllowedError ||
    error instanceof ManualPaymentReasonRequiredError
  ) {
    return HttpStatus.UNPROCESSABLE_ENTITY;
  }
  if (error instanceof WebhookSignatureInvalidError || error instanceof WebhookReplayError) {
    return HttpStatus.BAD_REQUEST;
  }
  // PHASE-020 (the sync plane; MASTER-PLAN §1.6 — codes double as the
  // push rejection registry, these are the request-level spellings): the
  // feed-group 404-equivalent (no existence leak across device classes),
  // the device/registry not-founds + revocation/suspension gates, the
  // credential-exchange 401, the v2 contract gate 422, the per-device
  // rate limiter 429, and the malformed-envelope 400s.
  if (
    error instanceof SyncEntityNotPulledError ||
    error instanceof DeviceNotFoundError
  ) {
    return HttpStatus.NOT_FOUND;
  }
  if (
    error instanceof SyncDeviceRevokedError ||
    error instanceof DeviceRevokedError ||
    error instanceof SyncTenantSuspendedError
  ) {
    return HttpStatus.FORBIDDEN;
  }
  if (error instanceof DeviceRefreshInvalidError) {
    return HttpStatus.UNAUTHORIZED;
  }
  if (error instanceof SyncContractUnsupportedError) {
    return HttpStatus.UNPROCESSABLE_ENTITY;
  }
  if (error instanceof SyncRateLimitedError) {
    return HttpStatus.TOO_MANY_REQUESTS;
  }
  if (
    error instanceof SyncCommandInvalidError ||
    error instanceof DeviceAttestationUnavailableError ||
    error instanceof DeviceAttestationFailedError
  ) {
    return HttpStatus.BAD_REQUEST;
  }
  return HttpStatus.UNPROCESSABLE_ENTITY;
}

function fromDomain(error: DomainError): ErrorBody {
  return {
    code: error.code,
    message: error.message,
    details: error.details,
    retryable: false,
  };
}

function retryAfterOf(error: DomainError): number | undefined {
  if (error instanceof RateLimitedError) {
    return error.retryAfterSeconds;
  }
  if (error instanceof AccountLockedError) {
    return error.retryAfterSeconds; // header only — body stays uniform (§5.2)
  }
  return undefined;
}
