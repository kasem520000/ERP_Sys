/**
 * Pure presentation helpers shared by server pages and client forms:
 * message templates, error-code localization, status localization,
 * bilingual (EN/AR) name selection and date formatting.
 */
import { isRecord, type ApiErrorBody } from "./api-types";
import type { Dictionary, Locale } from "../i18n/dictionaries";

/** Replaces `{placeholder}` tokens — the only templating the UI needs. */
export function formatMessage(template: string, vars: Record<string, string | number>): string {
  let out = template;
  for (const [key, value] of Object.entries(vars)) {
    out = out.replaceAll(`{${key}}`, String(value));
  }
  return out;
}

/** Generic localized message for an API error (code → dictionary string). */
export function localizedApiError(
  d: Dictionary,
  error: ApiErrorBody,
  retryAfterSeconds?: number,
): string {
  switch (error.code) {
    case "NETWORK_ERROR":
      return d.errorsNetwork;
    case "UNAUTHENTICATED":
      return d.errorsUnauthorized;
    case "FORBIDDEN":
      return d.errorsForbidden;
    case "RATE_LIMITED":
      return formatMessage(d.errorsRateLimited, { seconds: retryAfterSeconds ?? 0 });
    case "VALIDATION_ERROR":
      return d.errorsValidation;
    case "NOT_FOUND":
      return d.errorsNotFound;
    default:
      return d.errorsGeneric;
  }
}

/** Login-specific mapping (INVALID_CREDENTIALS / MFA_REQUIRED / lockout). */
export function localizedLoginError(
  d: Dictionary,
  error: ApiErrorBody,
  retryAfterSeconds?: number,
): string {
  switch (error.code) {
    case "INVALID_CREDENTIALS":
      return d.loginErrorInvalidCredentials;
    case "MFA_REQUIRED":
      return d.loginErrorMfaRequired;
    case "RATE_LIMITED":
      return formatMessage(d.loginErrorRateLimited, { seconds: retryAfterSeconds ?? 0 });
    case "UNAUTHENTICATED":
      // On the login route a 401 UNAUTHENTICATED means the account is
      // temporarily locked (details.retryAfterSeconds carries the window).
      return formatMessage(d.loginErrorAccountLocked, { seconds: retryAfterSeconds ?? 0 });
    default:
      return d.loginErrorGeneric;
  }
}

/** Invitation-specific mapping (not acceptable: expired / revoked / accepted). */
export function localizedInvitationError(d: Dictionary, error: ApiErrorBody): string {
  switch (error.code) {
    case "NOT_FOUND":
      return d.acceptErrorNotFound;
    case "VALIDATION_ERROR": {
      const reason = reasonOf(error.details);
      if (reason === "expired") {
        return d.acceptErrorExpired;
      }
      if (reason === "revoked") {
        return d.acceptErrorRevoked;
      }
      if (reason === "accepted") {
        return d.acceptErrorAccepted;
      }
      return d.acceptErrorGeneric;
    }
    default:
      return d.acceptErrorGeneric;
  }
}

/**
 * P4-T12a — tenancy/platform error mapping. Known contract codes get a
 * localized message; unknown codes fall back to the API's display-safe
 * `error.message` (ERROR_MODEL §2), then to the generic message.
 */
export function localizedTenancyError(
  d: Dictionary,
  error: ApiErrorBody,
  retryAfterSeconds?: number,
): string {
  switch (error.code) {
    case "NETWORK_ERROR":
      return d.errorsNetwork;
    case "UNAUTHENTICATED":
      return d.errorsUnauthorized;
    case "FORBIDDEN":
      return d.errorsForbidden;
    case "RATE_LIMITED":
      return formatMessage(d.errorsRateLimited, { seconds: retryAfterSeconds ?? 0 });
    case "VALIDATION_ERROR":
      return d.errorsValidation;
    case "NOT_FOUND":
      return d.errorsNotFound;
    case "tenancy/email-already-registered":
      return d.registerErrorEmailTaken;
    case "tenancy/invalid-registration-input":
      // The API guarantees this message is display-safe (contract §T4).
      return error.message !== "" ? error.message : d.errorsValidation;
    case "tenancy/branch-code-taken":
      return d.branchesErrorCodeTaken;
    case "tenancy/feature-not-entitled":
      return d.tenancyErrorFeatureNotEntitled;
    case "tenancy/feature-dependencies-missing":
      return formatMessage(d.tenancyErrorDependenciesMissing, {
        keys: missingKeysOf(error.details).join(", ") || "—",
      });
    case "tenancy/manual-grant-expiry-required":
      return d.platformGrantExpiryRequired;
    case "tenancy/unknown-feature-key":
      return d.platformGrantUnknownKey;
    case "tenancy/invalid-setting-value":
      return d.settingsErrorInvalidValue;
    case "tenancy/unknown-setting-key":
      return d.errorsGeneric;
    case "tenancy/support-access-denied":
      return d.supportErrorAccessDenied;
    case "tenancy/support-session-expired":
      return d.supportErrorExpired;
    case "tenancy/support-session-not-active":
      return d.supportErrorNotActive;
    case "tenancy/invalid-tenant-transition":
      return d.platformErrorInvalidTransition;
    case "tenancy/plan-not-found":
      return d.platformErrorPlanNotFound;
    default:
      return error.message !== "" ? error.message : d.errorsGeneric;
  }
}

/** `details.missing` (dependency-closure rejections list the keys). */
export function missingKeysOf(details: unknown): string[] {
  if (isRecord(details) && Array.isArray(details.missing)) {
    return details.missing.filter((key: unknown): key is string => typeof key === "string");
  }
  return [];
}

function reasonOf(details: unknown): string | undefined {
  if (typeof details === "object" && details !== null && "reason" in details) {
    const value = (details as { reason: unknown }).reason;
    if (typeof value === "string") {
      return value;
    }
  }
  return undefined;
}

/** Localizes row statuses; unknown statuses pass through verbatim. */
export function localizedStatus(d: Dictionary, status: string): string {
  switch (status.toUpperCase()) {
    case "ACTIVE":
      return d.statusActive;
    case "PENDING":
    case "INVITED":
      return d.statusPending;
    case "REVOKED":
      return d.statusRevoked;
    case "EXPIRED":
      return d.statusExpired;
    case "ACCEPTED":
      return d.statusAccepted;
    case "SUSPENDED":
      return d.statusSuspended;
    case "CLOSED":
      return d.statusClosed;
    case "TERMINATED":
      return d.statusTerminated;
    case "OFFBOARDED":
      return d.statusOffboarded;
    // 9a-dist: shared master-data statuses (routes/tiers/vans use INACTIVE).
    case "INACTIVE":
      return d.statusInactive;
    // T19-WEB (PHASE-014): subscription lifecycle statuses (SUBSCRIPTION §7).
    case "TRIAL":
      return d.statusTrial;
    case "PAST_DUE":
      return d.statusPastDue;
    case "GRACE_READ_ONLY":
      return d.statusGraceReadOnly;
    default:
      return status;
  }
}

/**
 * T19-WEB (PHASE-014) — subscription/billing error mapping (ERROR_MODEL §2
 * module-scoped codes from apps/api subscription-errors). Known contract
 * codes get a localized message; unknown codes fall back to the generic
 * message (same policy as tenancy/master-data).
 */
export function localizedBillingError(
  d: Dictionary,
  error: ApiErrorBody,
  retryAfterSeconds?: number,
): string {
  switch (error.code) {
    case "NETWORK_ERROR":
      return d.errorsNetwork;
    case "UNAUTHENTICATED":
      return d.errorsUnauthorized;
    case "FORBIDDEN":
      return d.errorsForbidden;
    case "RATE_LIMITED":
      return formatMessage(d.errorsRateLimited, { seconds: retryAfterSeconds ?? 0 });
    case "VALIDATION_ERROR":
      return d.errorsValidation;
    case "NOT_FOUND":
      return d.errorsNotFound;
    case "tenancy/downgrade-blocked":
      return d.checkoutErrorDowngradeBlocked;
    case "tenancy/plan-unchanged":
      return d.checkoutErrorPlanUnchanged;
    case "billing/checkout-session-not-found":
      return d.checkoutErrorSessionNotFound;
    case "billing/checkout-session-settled":
      return d.checkoutErrorSessionSettled;
    case "tenancy/subscription-read-only":
      return d.readOnlyError;
    case "tenancy/invalid-subscription-transition":
      return d.checkoutErrorTransition;
    case "billing/manual-payment-not-allowed":
      return d.billingAdminErrorNotOpen;
    case "billing/manual-payment-reason-required":
      return d.billingAdminErrorReasonRequired;
    case "tenancy/limit-exceeded": {
      const details = error.details;
      const limit =
        isRecord(details) && typeof details.limit === "string" ? details.limit : "";
      const usage =
        isRecord(details) && typeof details.usage === "number" ? details.usage : 0;
      const limitValue =
        isRecord(details) && (typeof details.limitValue === "number" || details.limitValue === "unlimited")
          ? String(details.limitValue)
          : "";
      return formatMessage(d.checkoutErrorLimitExceeded, { limit, usage, limitValue });
    }
    default:
      return d.errorsGeneric;
  }
}

/**
 * T19-WEB (PHASE-014) — billing-event type vocabulary (the append-only
 * billing_events trail; SUBSCRIPTION §7–§8 transitions). Unknown types pass
 * through verbatim (stable vocabulary, like sourceType elsewhere).
 */
export function localizedBillingEvent(d: Dictionary, type: string): string {
  switch (type) {
    case "trial.started":
      return d.billingEventTrialStarted;
    case "trial.expired":
      return d.billingEventTrialExpired;
    case "grace.entered":
      return d.billingEventGraceEntered;
    case "dunning.warned":
      return d.billingEventDunningWarned;
    case "plan.change.requested":
      return d.billingEventPlanChangeRequested;
    case "plan.changed":
      return d.billingEventPlanChanged;
    case "downgrade.blocked":
      return d.billingEventDowngradeBlocked;
    case "checkout.created":
      return d.billingEventCheckoutCreated;
    case "manual_payment.recorded":
      return d.billingEventManualPaymentRecorded;
    case "suspension.executed":
      return d.billingEventSuspensionExecuted;
    case "subscription.restored":
      return d.billingEventSubscriptionRestored;
    case "entitlements.changed":
      return d.billingEventEntitlementsChanged;
    default:
      return type;
  }
}

/**
 * P5-T12 — Badge tone for a row status (non-document vocabularies render via
 * `Badge`, which exposes the neutral/primary tones; neutral keeps the text
 * label as the differentiator). ACTIVE-family statuses read as primary.
 */
export function statusTone(status: string): "primary" | "neutral" {
  switch (status.toUpperCase()) {
    case "ACTIVE":
    case "ACCEPTED":
      return "primary";
    default:
      return "neutral";
  }
}

/**
 * P6-T11a — PHASE-006 master-data error mapping (partners + items error
 * registries, ERROR_MODEL module-scoped codes). Known contract codes get a
 * localized message; unknown codes fall back to the API's display-safe
 * `error.message`, then to the generic message (same policy as tenancy).
 */
export function localizedMasterDataError(
  d: Dictionary,
  error: ApiErrorBody,
  retryAfterSeconds?: number,
): string {
  switch (error.code) {
    case "NETWORK_ERROR":
      return d.errorsNetwork;
    case "UNAUTHENTICATED":
      return d.errorsUnauthorized;
    case "FORBIDDEN":
      return d.errorsForbidden;
    case "RATE_LIMITED":
      return formatMessage(d.errorsRateLimited, { seconds: retryAfterSeconds ?? 0 });
    case "VALIDATION_ERROR":
      return d.errorsValidation;
    case "NOT_FOUND":
    case "PARTNER_NOT_FOUND":
    case "CREDIT_TERMS_NOT_FOUND":
    case "ITEM_NOT_FOUND":
    case "CATEGORY_NOT_FOUND":
    case "BARCODE_NOT_FOUND":
    case "UOM_NOT_FOUND":
    case "PRICE_LIST_NOT_FOUND":
    case "PRICE_LIST_ROW_NOT_FOUND":
    case "IMPORT_JOB_NOT_FOUND":
    case "ATTACHMENT_NOT_FOUND":
    case "ATTACHMENT_OWNER_NOT_FOUND":
      return d.errorsNotFound;
    case "STALE_VERSION":
      return d.commonVersionConflict;
    case "PARTNER_CODE_TAKEN":
      return d.partnerCodeTaken;
    case "ITEM_SKU_TAKEN":
      return d.itemSkuTaken;
    case "BARCODE_TAKEN":
      return d.barcodeTaken;
    case "PARTNER_ARCHIVED":
      return d.partnerArchivedError;
    case "ITEM_ARCHIVED":
      return d.itemArchivedError;
    case "PARTNER_KIND_IMMUTABLE":
      return d.partnerKindImmutable;
    case "OPENING_BALANCE_DUPLICATE":
      return d.obDuplicateError;
    case "OPENING_BALANCE_INVALID":
    case "TRACKING_FLAGS_INVALID":
    case "PRICE_LIST_INVALID":
      return d.errorsValidation;
    case "IMPORT_FILE_INVALID":
      return d.importErrorFileInvalid;
    case "files/upload-rejected":
      return d.attachmentIssueFailed;
    default:
      return error.message !== "" ? error.message : d.errorsGeneric;
  }
}

/** Picks the localized variant of a bilingual name (tenant/role). */
export function localizedName(name: string, nameAr: string | null, locale: Locale): string {
  return locale === "ar" && nameAr !== null && nameAr !== "" ? nameAr : name;
}

/** Medium date+time in the page locale; dashes for missing values. */
export function formatDateTime(iso: string | null | undefined, locale: Locale): string {
  if (iso === null || iso === undefined || iso === "") {
    return "—";
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return new Intl.DateTimeFormat(locale === "ar" ? "ar" : "en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

/**
 * P7-T18 — DOCUMENT_LIFECYCLE status vocabulary for the accounting surfaces
 * (manual journals, ledger entries). Feeds DocumentStatusBadge labels; the
 * component ships the tone mapping, the app ships the translation.
 */
export function localizedDocumentStatus(d: Dictionary, status: string): string {
  switch (status.toUpperCase()) {
    case "DRAFT":
      return d.statusDraft;
    case "PENDING_APPROVAL":
      return d.statusPendingApproval;
    case "APPROVED":
      return d.statusApproved;
    case "POSTED":
      return d.statusPosted;
    case "REVERSED":
      return d.statusReversed;
    case "CANCELLED":
      return d.statusCancelled;
    default:
      return status;
  }
}

/** P7-T18 — fiscal-period states (PERIOD_CLOSING.md state machine). */
export function localizedPeriodStatus(d: Dictionary, status: string): string {
  switch (status.toUpperCase()) {
    case "OPEN":
      return d.accountingStatusOpen;
    case "SOFT_CLOSED":
      return d.accountingStatusSoftClosed;
    case "LOCKED":
      return d.accountingStatusLocked;
    default:
      return status;
  }
}

/** P7-T18 — fiscal-period kinds (REGULAR / OPENING / CLOSING windows). */
export function localizedPeriodKind(d: Dictionary, kind: string): string {
  switch (kind.toUpperCase()) {
    case "REGULAR":
      return d.accountingKindRegular;
    case "OPENING":
      return d.accountingKindOpening;
    case "CLOSING":
      return d.accountingKindClosing;
    default:
      return kind;
  }
}

/**
 * P7-T18 — posting-engine error taxonomy (POSTING_ENGINE.md §error-taxonomy):
 * stable codes → localized messages. Unknown codes fall back to the API's
 * display-safe `error.message` (same policy as the master-data mapper).
 */
export function localizedAccountingError(
  d: Dictionary,
  error: ApiErrorBody,
  retryAfterSeconds?: number,
): string {
  switch (error.code) {
    case "NETWORK_ERROR":
      return d.errorsNetwork;
    case "UNAUTHENTICATED":
      return d.errorsUnauthorized;
    case "FORBIDDEN":
      return d.errorsForbidden;
    case "RATE_LIMITED":
      return formatMessage(d.errorsRateLimited, { seconds: retryAfterSeconds ?? 0 });
    case "ENTRY_NOT_BALANCED":
      return d.accountingErrEntryNotBalanced;
    case "PERIOD_LOCKED":
      return d.accountingErrPeriodLocked;
    case "PERIOD_NOT_FOUND":
    case "FISCAL_YEAR_NOT_FOUND":
    case "ACCOUNT_NOT_FOUND":
    case "GL_ACCOUNT_NOT_FOUND":
    case "JOURNAL_DRAFT_NOT_FOUND":
    case "RECURRING_JOURNAL_NOT_FOUND":
      return d.errorsNotFound;
    case "ACCOUNT_NOT_POSTABLE":
    case "ACCOUNT_ARCHIVED":
      return d.accountingErrAccountNotPostable;
    case "PURPOSE_NOT_MAPPED":
      return d.accountingErrPurposeNotMapped;
    case "MISSING_PARTNER_ON_CONTROL":
      return d.accountingErrMissingPartner;
    case "MISSING_FX_RATE":
    case "EXCHANGE_RATE_INVALID":
      return d.accountingErrMissingFxRate;
    case "ALREADY_POSTED":
      return d.accountingErrAlreadyPosted;
    case "ALREADY_REVERSED":
      return d.accountingErrAlreadyReversed;
    case "APPROVAL_LIMIT_EXCEEDED":
      return d.accountingErrApprovalLimit;
    case "SELF_APPROVAL_BLOCKED":
      return d.accountingErrSelfApproval;
    case "IMMUTABLE_DOCUMENT":
      return d.accountingErrImmutable;
    case "JOURNAL_STATE_ERROR":
    case "PERIOD_STATE_ERROR":
    case "APPROVALS_PENDING":
      return d.accountingErrState;
    // -- PHASE-019 (T50): the projects dimension (T44's typed codes).
    case "PROJECT_NOT_FOUND":
      return d.errorsNotFound;
    case "PROJECT_CODE_TAKEN":
      return d.accountingProjectErrCodeTaken;
    case "PROJECT_CLOSED":
      return d.accountingErrState;
    default:
      return error.message !== "" ? error.message : d.errorsGeneric;
  }
}

/**
 * T14-UI (PHASE-008) — treasury error taxonomy (treasury-errors.ts stable
 * codes → ERROR_MODEL §4): every contract code gets a localized message;
 * unknown codes fall back to the API's display-safe `error.message`, then
 * to the generic message (same policy as the accounting mapper).
 */
export function localizedTreasuryError(
  d: Dictionary,
  error: ApiErrorBody,
  retryAfterSeconds?: number,
): string {
  switch (error.code) {
    case "NETWORK_ERROR":
      return d.errorsNetwork;
    case "UNAUTHENTICATED":
      return d.errorsUnauthorized;
    case "FORBIDDEN":
      return d.errorsForbidden;
    case "RATE_LIMITED":
      return formatMessage(d.errorsRateLimited, { seconds: retryAfterSeconds ?? 0 });
    case "VALIDATION_ERROR":
      return d.errorsValidation;
    // A7-sensitive not-founds render identically (no existence disclosure).
    case "CASH_ACCOUNT_NOT_FOUND":
    case "RECEIPT_NOT_FOUND":
    case "PAYMENT_NOT_FOUND":
    case "CASH_TRANSFER_NOT_FOUND":
    case "OPEN_ITEM_NOT_FOUND":
    case "EXPENSE_CATEGORY_NOT_FOUND":
    case "EXPENSE_NOT_FOUND":
    case "SHIFT_NOT_FOUND":
    case "STATEMENT_NOT_FOUND":
    case "STATEMENT_LINE_NOT_FOUND":
    case "CASH_MOVEMENT_NOT_FOUND":
      return d.errorsNotFound;
    case "CASH_ACCOUNT_ALREADY_EXISTS":
      return d.treasuryErrAccountExists;
    case "CASH_ACCOUNT_CLOSED":
      return d.treasuryErrAccountClosed;
    case "CASH_ACCOUNT_NOT_CLOSEABLE":
      return d.treasuryErrAccountNotCloseable;
    case "CASH_ACCOUNT_CURRENCY_MISMATCH":
      return d.treasuryErrCurrencyMismatch;
    case "CASH_ACCOUNT_TYPE_INVALID":
      return d.treasuryErrTypeInvalid;
    case "INVALID_AMOUNT":
      return d.treasuryErrInvalidAmount;
    case "TREASURY_DOCUMENT_STATE_INVALID":
      return d.treasuryErrDocState;
    case "MISSING_FX_RATE":
      return d.treasuryErrMissingFxRate;
    case "ALLOCATION_EXCEEDS_DOCUMENT":
      return d.treasuryErrAllocationExceedsDoc;
    case "ALLOCATION_EXCEEDS_OPEN_ITEM":
      return d.treasuryErrAllocationExceedsItem;
    case "OPEN_ITEM_CURRENCY_MISMATCH":
      return d.treasuryErrOpenItemCurrency;
    case "OPEN_ITEM_PARTNER_MISMATCH":
      return d.treasuryErrOpenItemPartner;
    case "OPEN_ITEM_SIDE_INVALID":
      return d.treasuryErrOpenItemSide;
    case "PETTY_CASH_LIMIT_EXCEEDED":
      return d.treasuryErrPettyLimit;
    case "EXPENSE_CATEGORY_CODE_TAKEN":
      return d.treasuryErrCategoryTaken;
    case "EXPENSE_RECEIPT_REQUIRED":
      return d.treasuryErrReceiptRequired;
    case "EXPENSE_APPROVAL_REQUIRED":
      return d.treasuryErrApprovalRequired;
    case "SHIFT_ALREADY_OPEN":
      return d.treasuryErrShiftAlreadyOpen;
    case "SHIFT_SUPERVISOR_REQUIRED":
      return d.treasuryErrSupervisorRequired;
    case "SHIFT_SUPERVISOR_PIN_INVALID":
      return d.treasuryErrSupervisorPin;
    case "SHIFT_REASON_REQUIRED":
      return d.treasuryErrShiftReason;
    case "STATEMENT_TOO_LARGE":
      return d.treasuryErrStatementTooLarge;
    case "STATEMENT_FORMAT_INVALID":
      return d.treasuryErrStatementFormat;
    case "STATEMENT_ALREADY_RECONCILED":
      return d.treasuryErrStatementReconciled;
    case "BANK_REC_PERIOD_LOCKED":
      return d.treasuryErrPeriodLocked;
    case "MOVEMENT_ALREADY_MATCHED":
      return d.treasuryErrMovementMatched;
    default:
      return error.message !== "" ? error.message : d.errorsGeneric;
  }
}

/** T14-UI — cash-account types (CASH / BANK / PETTY). */
export function localizedCashAccountType(d: Dictionary, type: string): string {
  switch (type) {
    case "CASH":
      return d.treasuryAccountTypeCash;
    case "BANK":
      return d.treasuryAccountTypeBank;
    case "PETTY":
      return d.treasuryAccountTypePetty;
    default:
      return type;
  }
}

/** T14-UI — settlement methods (money-in / money-out). */
export function localizedTreasuryMethod(d: Dictionary, method: string): string {
  switch (method) {
    case "CASH":
      return d.treasuryMethodCash;
    case "BANK":
      return d.treasuryMethodBank;
    case "CHEQUE":
      return d.treasuryMethodCheque;
    case "CARD":
      return d.treasuryMethodCard;
    case "TRANSFER":
      return d.treasuryMethodTransfer;
    default:
      return method;
  }
}

/** T14-UI — cashier-shift statuses (OPEN / CLOSED / CANCELLED). */
export function localizedShiftStatus(d: Dictionary, status: string): string {
  switch (status) {
    case "OPEN":
      return d.treasuryShiftStatusOpen;
    case "CLOSED":
      return d.treasuryShiftStatusClosed;
    case "CANCELLED":
      return d.treasuryShiftStatusCancelled;
    default:
      return status;
  }
}

/** T14-UI — bank-statement statuses (IMPORTED / RECONCILED). */
export function localizedStatementStatus(d: Dictionary, status: string): string {
  switch (status) {
    case "IMPORTED":
      return d.treasuryBankRecStatusImported;
    case "RECONCILED":
      return d.treasuryBankRecStatusReconciled;
    default:
      return status;
  }
}

/** T14-UI — statement-line match states (unmatched / matched modes). */
export function localizedMatchMode(d: Dictionary, mode: string | null): string {
  switch (mode) {
    case null:
      return d.treasuryBankRecUnmatched;
    case "AUTO":
      return d.treasuryBankRecMatchAuto;
    case "MANUAL":
      return d.treasuryBankRecMatchManual;
    default:
      return mode;
  }
}

/**
 * T15-UI (PHASE-009) — tax error taxonomy (tax-errors.ts stable codes →
 * ERROR_MODEL §4): every contract code gets a localized message; unknown
 * codes fall back to the API's display-safe `error.message`, then to the
 * generic message (same policy as the treasury mapper).
 */
export function localizedTaxError(
  d: Dictionary,
  error: ApiErrorBody,
  retryAfterSeconds?: number,
): string {
  switch (error.code) {
    case "NETWORK_ERROR":
      return d.errorsNetwork;
    case "UNAUTHENTICATED":
      return d.errorsUnauthorized;
    case "FORBIDDEN":
      return d.errorsForbidden;
    case "RATE_LIMITED":
      return formatMessage(d.errorsRateLimited, { seconds: retryAfterSeconds ?? 0 });
    case "VALIDATION_ERROR":
      return d.errorsValidation;
    // A7-sensitive not-founds render identically (no existence disclosure).
    case "TAX_CODE_NOT_FOUND":
    case "VAT_RETURN_NOT_FOUND":
      return d.errorsNotFound;
    case "TAX_CODE_TAKEN":
      return d.taxErrCodeTaken;
    case "TAX_CODE_ARCHIVED":
      return d.taxErrCodeArchived;
    case "TAX_CODE_IN_USE":
      return d.taxErrCodeInUse;
    case "TAX_CODE_STATUS_INVALID":
    case "REGISTRATION_DEREGISTERED_SHAPE_INVALID":
    case "TAX_LINE_INVALID":
    case "PRICING_MODE_INVALID":
    case "CURRENCY_MINOR_UNITS_UNKNOWN":
      return d.errorsValidation;
    case "REGISTRATION_NUMBER_REQUIRED":
    case "REGISTRATION_NUMBER_NOT_ALLOWED":
      return d.taxErrRegistrationNumber;
    case "JURISDICTION_NOT_FOUND":
      return d.taxErrJurisdiction;
    case "NO_RATE_FOR_DATE":
      return d.taxErrNoRateForDate;
    case "VAT_RETURN_WINDOW_TAKEN":
      return d.taxErrWindowTaken;
    case "VAT_RETURN_CROSS_CHECK_FAILED":
      return d.taxErrCrossCheck;
    case "VAT_RETURN_STATE_INVALID":
      return d.taxErrState;
    case "VAT_RETURN_ALREADY_FILED":
      return d.taxErrAlreadyFiled;
    case "PACK_BINDING_INVALID":
      return d.taxErrPackBinding;
    default:
      return error.message !== "" ? error.message : d.errorsGeneric;
  }
}

/** T15-UI — tax treatments (TAX_ENGINE §2.1 vocabulary). */
export function localizedTaxTreatment(d: Dictionary, treatment: string): string {
  switch (treatment) {
    case "STANDARD_RATED":
      return d.taxTreatmentStandardRated;
    case "ZERO_RATED":
      return d.taxTreatmentZeroRated;
    case "EXEMPT":
      return d.taxTreatmentExempt;
    case "OUT_OF_SCOPE":
      return d.taxTreatmentOutOfScope;
    case "REVERSE_CHARGE":
      return d.taxTreatmentReverseCharge;
    case "NOT_SUBJECT":
      return d.taxTreatmentNotSubject;
    default:
      return treatment;
  }
}

/** T15-UI — jurisdiction pack VAT statuses (COUNTRY_PACKS §3). */
export function localizedVatStatus(d: Dictionary, vatStatus: string): string {
  switch (vatStatus) {
    case "VAT_IN_FORCE":
      return d.taxPacksVatInForce;
    case "VAT_PLANNED":
      return d.taxPacksVatPlanned;
    case "NO_VAT":
      return d.taxPacksVatNoVat;
    default:
      return vatStatus;
  }
}

/** T15-UI — tax registration statuses (one per jurisdiction). */
export function localizedRegistrationStatus(d: Dictionary, status: string): string {
  switch (status) {
    case "REGISTERED":
      return d.taxRegistrationsRegistered;
    case "NOT_REGISTERED":
      return d.taxRegistrationsNotRegistered;
    case "DEREGISTERED":
      return d.taxRegistrationsDeregistered;
    default:
      return status;
  }
}

/** T15-UI — VAT return statuses (DRAFT / READY / FILED). */
export function localizedVatReturnStatus(d: Dictionary, status: string): string {
  switch (status) {
    case "DRAFT":
      return d.vatReturnDraft;
    case "READY":
      return d.vatReturnReady;
    case "FILED":
      return d.vatReturnFiled;
    default:
      return status;
  }
}

/**
 * T14-UI (PHASE-010) — inventory error taxonomy (inventory-errors.ts stable
 * codes → ERROR_MODEL §4): every contract code gets a localized message;
 * unknown codes fall back to the API's display-safe `error.message`, then
 * to the generic message (same policy as the treasury/tax mappers).
 */
export function localizedInventoryError(
  d: Dictionary,
  error: ApiErrorBody,
  retryAfterSeconds?: number,
): string {
  switch (error.code) {
    case "NETWORK_ERROR":
      return d.errorsNetwork;
    case "UNAUTHENTICATED":
      return d.errorsUnauthorized;
    case "FORBIDDEN":
      return d.errorsForbidden;
    case "RATE_LIMITED":
      return formatMessage(d.errorsRateLimited, { seconds: retryAfterSeconds ?? 0 });
    case "VALIDATION_ERROR":
    case "INVALID_QUANTITY":
    case "INVALID_COST":
    case "COSTING_METHOD_INVALID":
      return d.errorsValidation;
    // A7-sensitive not-founds render identically (no existence disclosure).
    case "WAREHOUSE_NOT_FOUND":
    case "ITEM_NOT_FOUND":
    case "BATCH_NOT_FOUND":
    case "SERIAL_NOT_FOUND":
    case "RESERVATION_NOT_FOUND":
    case "STOCK_ADJUSTMENT_NOT_FOUND":
    case "STOCK_COUNT_NOT_FOUND":
    case "STOCK_TRANSFER_NOT_FOUND":
    case "COUNT_LINE_NOT_FOUND":
      return d.errorsNotFound;
    case "WAREHOUSE_CODE_EXISTS":
      return d.inventoryErrWarehouseCodeTaken;
    case "WAREHOUSE_INACTIVE":
      return d.inventoryErrWarehouseInactive;
    case "WAREHOUSE_NOT_DEACTIVATABLE":
      return d.inventoryErrWarehouseNotDeactivatable;
    case "ITEM_NOT_STOCKED":
      return d.inventoryErrItemNotStocked;
    case "INSUFFICIENT_STOCK":
      return d.inventoryErrInsufficientStock;
    case "BATCH_INSUFFICIENT_STOCK":
      return d.inventoryErrBatchInsufficient;
    case "BATCH_REQUIRED":
      return d.inventoryErrBatchRequired;
    case "BATCH_ALREADY_EXISTS":
      return d.inventoryErrBatchTaken;
    case "SERIAL_REQUIRED":
      return d.inventoryErrSerialRequired;
    case "SERIAL_NOT_IN_STOCK":
      return d.inventoryErrSerialNotInStock;
    case "SERIAL_ALREADY_EXISTS":
      return d.inventoryErrSerialTaken;
    case "SERIAL_RETURN_BINDING_INVALID":
      return d.inventoryErrSerialReturnBinding;
    case "STOCK_TRANSFER_STATE_INVALID":
    case "STOCK_ADJUSTMENT_STATE_INVALID":
    case "STOCK_COUNT_STATE_INVALID":
    case "RESERVATION_STATE_INVALID":
      return d.inventoryErrState;
    case "STOCK_TRANSFER_EMPTY":
      return d.inventoryErrTransferEmpty;
    case "STOCK_TRANSFER_SAME_WAREHOUSE":
      return d.inventoryErrTransferSameWarehouse;
    case "COUNT_VARIANCE_TOLERANCE_EXCEEDED":
      return d.inventoryErrCountTolerance;
    case "METHOD_SWITCH_IN_FLIGHT":
      return d.inventoryErrMethodSwitchInFlight;
    case "METHOD_SWITCH_INVALID":
      return d.inventoryErrMethodSwitchInvalid;
    case "METHOD_SWITCH_SAME":
      return d.inventoryErrMethodSwitchSame;
    default:
      return error.message !== "" ? error.message : d.errorsGeneric;
  }
}

/** T14-UI (PHASE-010) — stock move direction labels. */
export function localizedMoveDirection(d: Dictionary, direction: "IN" | "OUT"): string {
  return direction === "IN" ? d.movesDirectionIn : d.movesDirectionOut;
}

/** T14-UI (PHASE-010) — stock move kind labels (receipt/issue/transfer legs/adjust). */
export function localizedMoveKind(d: Dictionary, kind: string): string {
  switch (kind) {
    case "receipt":
      return d.movesKindReceipt;
    case "issue":
      return d.movesKindIssue;
    case "transfer_in":
      return d.movesKindTransferIn;
    case "transfer_out":
      return d.movesKindTransferOut;
    case "adjust":
      return d.movesKindAdjust;
    default:
      return kind;
  }
}

/** T14-UI (PHASE-010) — movement reason codes (BR-015/DAMAGE/EXPIRED/…). */
export function localizedMoveReason(d: Dictionary, reason: string): string {
  switch (reason) {
    case "DAMAGE":
      return d.movesReasonDamage;
    case "EXPIRED":
      return d.movesReasonExpired;
    case "COUNT_LOSS":
      return d.movesReasonCountLoss;
    case "COUNT_GAIN":
      return d.movesReasonCountGain;
    case "CUSTOMER_RETURN":
      return d.movesReasonCustomerReturn;
    default:
      return d.movesReasonOther;
  }
}

/** PHASE-011 purchasing: localized API errors (matrix §3.3 codes). */
export function localizedPurchasingError(
  d: Dictionary,
  error: ApiErrorBody,
  retryAfterSeconds?: number,
): string {
  switch (error.code) {
    case "NETWORK_ERROR":
      return d.errorsNetwork;
    case "UNAUTHENTICATED":
      return d.errorsUnauthorized;
    case "FORBIDDEN":
      return d.errorsForbidden;
    case "RATE_LIMITED":
      return formatMessage(d.errorsRateLimited, { seconds: retryAfterSeconds ?? 0 });
    case "VALIDATION_ERROR":
      return d.errorsValidation;
    // A7-sensitive not-founds render identically (no existence disclosure).
    case "PURCHASE_REQUEST_NOT_FOUND":
    case "PURCHASE_ORDER_NOT_FOUND":
    case "GOODS_RECEIPT_NOT_FOUND":
    case "SUPPLIER_INVOICE_NOT_FOUND":
    case "DEBIT_NOTE_NOT_FOUND":
    case "LANDED_COST_NOT_FOUND":
    case "SUPPLIER_NOT_FOUND":
      return d.errorsNotFound;
    case "PURCHASING_DOCUMENT_STATE":
      return d.purchasingErrState;
    case "DUPLICATE_SUPPLIER_INVOICE":
      return d.purchasingErrDuplicate;
    case "MATCH_OUTCOME_MISSING":
      return d.purchasingErrMatchMissing;
    case "MATCH_EXCEPTION_UNDISPOSED":
      return d.purchasingErrMatchException;
    case "PO_LESS_GRN_FORBIDDEN":
      return d.purchasingErrPoLess;
    case "PO_LESS_REASON_REQUIRED":
      return d.purchasingErrPoLessReason;
    case "GRN_EXCEEDS_PO_LINE":
      return d.purchasingErrOverReceipt;
    case "INVOICE_GRN_ALREADY_CLEARED":
      return d.purchasingErrOverInvoice;
    case "PARTNER_NOT_SUPPLIER":
      return d.purchasingErrNotSupplier;
    case "INVOICE_GRN_SUPPLIER_MISMATCH":
      return d.purchasingErrGrnSupplier;
    case "SELF_APPROVAL_BLOCKED":
      return d.purchasingErrSelfApproval;
    case "REALLOCATION_SOURCE_INVALID":
    case "REALLOCATION_TARGET_INVALID":
    case "REALLOCATION_AMOUNT_INVALID":
      return d.purchasingErrReallocation;
    default:
      return error.message;
  }
}

/** PHASE-011 purchasing: document status → label key mapping. */
export function purchasingStatusLabel(
  d: Dictionary,
  status: string,
): string {
  const map: Record<string, string> = {
    DRAFT: d.statusDraft,
    PENDING_APPROVAL: d.statusPendingApproval,
    APPROVED: d.statusApproved,
    ISSUED: d.statusIssued,
    CLOSED: d.statusClosed,
    POSTED: d.statusPosted,
    REVERSED: d.statusReversed,
    CANCELLED: d.statusCancelled,
    REJECTED: d.statusRejected,
    CONVERTED: d.statusConverted,
  };
  return map[status] ?? status;
}

/** PHASE-011 purchasing: match status → label key mapping. */
export function matchStatusLabel(d: Dictionary, status: string): string {
  const map: Record<string, string> = {
    PENDING: d.purchasingMatchOutcomePending,
    MATCHED: d.purchasingMatchOutcomeMatched,
    EXCEPTION: d.purchasingMatchOutcomeException,
    DISPOSITIONED: d.purchasingMatchOutcomeDispositioned,
  };
  return map[status] ?? status;
}

/** PHASE-012 sales: localized API errors (matrix §3.2 codes). */
export function localizedSalesError(
  d: Dictionary,
  error: ApiErrorBody,
  retryAfterSeconds?: number,
): string {
  switch (error.code) {
    // A7-sensitive not-founds render identically (no existence disclosure).
    case "QUOTATION_NOT_FOUND":
    case "SALES_ORDER_NOT_FOUND":
    case "DELIVERY_NOTE_NOT_FOUND":
    case "SALES_INVOICE_NOT_FOUND":
    case "CREDIT_NOTE_NOT_FOUND":
    case "SALES_REP_NOT_FOUND":
    case "CUSTOMER_NOT_FOUND":
      return d.errorsNotFound;
    case "SALES_DOCUMENT_STATE":
    case "EMPTY_DOCUMENT":
    case "ORDER_LINE_INVALID":
    case "RESERVATION_INVALID":
    case "DELIVERY_LINE_INVALID":
    case "INVOICE_LINE_INVALID":
    case "CREDIT_NOTE_REF_INVALID":
    case "AR_QUERY_INVALID":
    case "PARTNER_NOT_CUSTOMER":
      return d.salesErrState;
    case "QUOTATION_EXPIRED":
      return d.salesErrQuotationExpired;
    case "CREDIT_LIMIT_EXCEEDED":
      return d.salesErrCreditLimit;
    case "RETURN_WINDOW_EXCEEDED":
      return d.salesErrReturnWindow;
    case "PRICE_CHANGED":
      return d.salesErrPriceChanged;
    case "ITEM_INACTIVE":
      return d.salesErrItemInactive;
    case "DELIVERY_ALREADY_INVOICED":
      return d.salesErrDeliveryInvoiced;
    case "CREDIT_NOTE_EXCEEDS_INVOICE":
      return d.salesErrCreditNoteExceeds;
    case "REALLOCATION_SOURCE_INVALID":
    case "REALLOCATION_TARGET_INVALID":
    case "REALLOCATION_AMOUNT_INVALID":
      return d.salesErrReallocation;
    default:
      return localizedApiError(d, error, retryAfterSeconds);
  }
}

/** PHASE-012 sales: document status → label key mapping. */
export function salesStatusLabel(d: Dictionary, status: string): string {
  const map: Record<string, string> = {
    DRAFT: d.statusDraft,
    SENT: d.salesStatusSent,
    ACCEPTED: d.statusAccepted,
    REJECTED: d.statusRejected,
    EXPIRED: d.statusExpired,
    PENDING_APPROVAL: d.statusPendingApproval,
    APPROVED: d.statusApproved,
    ISSUED: d.statusIssued,
    CLOSED: d.statusClosed,
    POSTED: d.statusPosted,
    CANCELLED: d.statusCancelled,
    CONVERTED: d.statusConverted,
  };
  return map[status] ?? status;
}

/**
 * PHASE-016 T4/T10 — POS error mapping (pos-errors.ts codes → dictionary).
 * Shift codes reuse the treasury mapping (the POS flow delegates to the
 * treasury shift service); offline-sync conflicts carry their typed reason
 * as the code (SYNC_PROTOCOL §11).
 */
export function localizedPosError(
  d: Dictionary,
  error: ApiErrorBody,
  retryAfterSeconds?: number,
): string {
  switch (error.code) {
    case "POS_TERMINAL_CODE_TAKEN":
      return d.posTerminalsErrCodeTaken;
    case "POS_TERMINAL_INACTIVE":
      return d.posCounterErrTerminalInactive;
    case "POS_TERMINAL_DEVICE_BOUND":
    case "POS_TERMINAL_TILL_INVALID":
      return error.message !== "" ? error.message : d.errorsValidation;
    case "POS_SHIFT_OPEN_MISMATCH":
      return d.posShiftErrOpenMismatch;
    case "POS_SHIFT_NOT_ON_TERMINAL":
      return d.posShiftErrNotOnTerminal;
    case "POS_TENDER_INVALID":
      return d.posTenderErrInvalid;
    case "POS_TENDER_OVERFLOW":
      return d.posTenderErrOverflow;
    case "POS_WALK_IN_CUSTOMER_ERROR":
      return error.message !== "" ? error.message : d.errorsGeneric;
    case "POS_DISCOUNT_CEILING_EXCEEDED":
      return d.posCounterErrDiscountCeiling;
    case "POS_TABLE_NOT_FOUND":
    case "POS_CHECK_NOT_FOUND":
    case "POS_TERMINAL_NOT_FOUND":
      return d.errorsNotFound;
    case "POS_CHECK_NOT_OPEN":
      return d.posFloorErrCheckNotOpen;
    case "POS_CHECK_HAS_OPEN_TABLES":
      return d.posFloorErrOpenTables;
    // Offline sync conflicts (typed reasons as codes).
    case "PERIOD_LOCKED":
    case "PRICE_CHANGED":
    case "INSUFFICIENT_STOCK":
    case "CREDIT_LIMIT_EXCEEDED":
    case "VALIDATION_ERROR":
      return localizedPosOfflineReason(d, error.code);
    // Treasury shift codes flow through the shared shift path.
    case "SHIFT_ALREADY_OPEN":
    case "SHIFT_SUPERVISOR_REQUIRED":
    case "SHIFT_SUPERVISOR_PIN_INVALID":
    case "SHIFT_REASON_REQUIRED":
    case "SHIFT_NOT_FOUND":
      return localizedTreasuryError(d, error, retryAfterSeconds);
    default:
      return localizedApiError(d, error, retryAfterSeconds);
  }
}

/** PHASE-016 — POS order types (DINE_IN / TAKEAWAY / DELIVERY / COUNTER). */
export function localizedPosOrderType(d: Dictionary, orderType: string): string {
  switch (orderType) {
    case "DINE_IN":
      return d.posFloorOrderDineIn;
    case "TAKEAWAY":
      return d.posFloorOrderTakeaway;
    case "DELIVERY":
      return d.posFloorOrderDelivery;
    case "COUNTER":
      return d.posFloorOrderCounter;
    default:
      return orderType;
  }
}

/** PHASE-016 — guest-check statuses (OPEN / PAID / CANCELLED). */
export function localizedPosCheckStatus(d: Dictionary, status: string): string {
  switch (status) {
    case "OPEN":
      return d.treasuryShiftStatusOpen;
    case "PAID":
      return d.posFloorCheckPaid;
    case "CANCELLED":
      return d.statusCancelled;
    default:
      return status;
  }
}

/** PHASE-016 T10 — typed offline-sync rejection reasons. */
export function localizedPosOfflineReason(d: Dictionary, reason: string): string {
  switch (reason) {
    case "PERIOD_LOCKED":
      return d.posOfflineReasonPeriodLocked;
    case "PRICE_CHANGED":
      return d.posOfflineReasonPriceChanged;
    case "INSUFFICIENT_STOCK":
      return d.posOfflineReasonInsufficientStock;
    case "CREDIT_LIMIT_EXCEEDED":
      return d.posOfflineReasonCreditLimit;
    case "VALIDATION_ERROR":
      return d.posOfflineReasonValidation;
    default:
      return reason;
  }
}

// -- PHASE-017 T6 (9-a): automotive (job cards + vehicles) ---------------------

/**
 * Job-card status → label (workflow (b): DRAFT → IN_PROGRESS → COMPLETED →
 * INVOICED, CANCELLED aside). Unknown statuses pass through verbatim, the
 * same contract salesStatusLabel keeps.
 */
export function jobCardStatusLabel(d: Dictionary, status: string): string {
  const map: Record<string, string> = {
    DRAFT: d.jcStatusDraft,
    IN_PROGRESS: d.jcStatusInProgress,
    COMPLETED: d.jcStatusCompleted,
    INVOICED: d.jcStatusInvoiced,
    CANCELLED: d.jcStatusCancelled,
  };
  return map[status] ?? status;
}

/**
 * Job-card error mapping (job-card-errors.ts codes → dictionary). The
 * A7-sensitive not-found renders like every other not-found; the untyped
 * zod VALIDATION_ERROR path falls back to the generic validation message.
 */
export function localizedJobCardError(
  d: Dictionary,
  error: ApiErrorBody,
  retryAfterSeconds?: number,
): string {
  switch (error.code) {
    case "JOB_CARD_NOT_FOUND":
      return d.errorsNotFound;
    case "JOB_CARD_STATE":
      return d.jcErrState;
    case "JOB_CARD_LINE_INVALID":
      return d.jcErrLineInvalid;
    case "JOB_CARD_NOT_CANCELABLE":
      return d.jcErrNotCancelable;
    case "JOB_CARD_INPUT_INVALID":
      return d.errorsValidation;
    case "sales/job-card-posting-not-configured":
      return d.jcErrPosting;
    default:
      return localizedApiError(d, error, retryAfterSeconds);
  }
}

/** Vehicle registry status → label (ACTIVE / ARCHIVED only). */
export function vehicleStatusLabel(d: Dictionary, status: string): string {
  const map: Record<string, string> = {
    ACTIVE: d.vehStatusActive,
    ARCHIVED: d.vehStatusArchived,
  };
  return map[status] ?? status;
}

/** Service-history timeline kind → label (job card / invoice / credit note). */
export function vehicleHistoryKindLabel(d: Dictionary, kind: string): string {
  const map: Record<string, string> = {
    JOB_CARD: d.vehHistoryKindJobCard,
    INVOICE: d.vehHistoryKindInvoice,
    CREDIT_NOTE: d.vehHistoryKindCreditNote,
  };
  return map[kind] ?? kind;
}

/** Vehicle registry error mapping (vehicle-errors.ts codes → dictionary). */
export function localizedVehicleError(
  d: Dictionary,
  error: ApiErrorBody,
  retryAfterSeconds?: number,
): string {
  switch (error.code) {
    case "VEHICLE_NOT_FOUND":
      return d.errorsNotFound;
    case "VEHICLE_CHASSIS_TAKEN":
      return d.vehErrChassisTaken;
    case "VEHICLE_ARCHIVED":
      return d.vehErrArchived;
    case "VEHICLE_CHASSIS_INVALID":
      return d.vehErrChassisInvalid;
    default:
      return localizedApiError(d, error, retryAfterSeconds);
  }
}

// -- PHASE-017 T14 (9a-dist): distribution + commissions ------------------------

/** Route-visit statuses (the visit board: PLANNED → COMPLETED/SKIPPED/MISSED). */
export function localizedVisitStatus(d: Dictionary, status: string): string {
  const map: Record<string, string> = {
    PLANNED: d.distVisitPlanned,
    COMPLETED: d.distVisitCompleted,
    SKIPPED: d.distVisitSkipped,
    MISSED: d.distVisitMissed,
  };
  return map[status] ?? status;
}

/** Weekday codes (MON..SUN) → localized short day names. */
export function localizedDayCode(d: Dictionary, day: string): string {
  const map: Record<string, string> = {
    MON: d.distDayMon,
    TUE: d.distDayTue,
    WED: d.distDayWed,
    THU: d.distDayThu,
    FRI: d.distDayFri,
    SAT: d.distDaySat,
    SUN: d.distDaySun,
  };
  return map[day] ?? day;
}

/** Distribution module error mapping (distribution-errors.ts codes → dictionary).
 * The A7-sensitive not-founds render like every other not-found. */
export function localizedDistributionError(
  d: Dictionary,
  error: ApiErrorBody,
  retryAfterSeconds?: number,
): string {
  switch (error.code) {
    case "ROUTE_NOT_FOUND":
    case "VISIT_NOT_FOUND":
    case "VAN_NOT_FOUND":
    case "SETTLEMENT_NOT_FOUND":
    case "TIER_NOT_FOUND":
    case "FREE_GOODS_RULE_NOT_FOUND":
      return d.errorsNotFound;
    case "ROUTE_CODE_TAKEN":
      return d.distRoutesErrCodeTaken;
    case "ROUTE_PLANNING_INVALID":
      return d.distRoutesErrPlanning;
    case "VISIT_STATE":
      return d.distErrVisitState;
    case "VISIT_DOCUMENT_NOT_FOUND":
      return d.distErrVisitDocument;
    case "VAN_CODE_TAKEN":
      return d.distErrVanCodeTaken;
    case "VAN_REP_BINDING":
      return d.distErrVanRepBinding;
    case "VAN_LOAD_OUT":
      return d.distErrVanLoadOut;
    case "SETTLEMENT_STATE":
      return d.distErrSettlementState;
    case "SETTLEMENT_VARIANCE_REASON_REQUIRED":
      return d.distErrSettlementVarianceReason;
    case "SETTLEMENT_APPROVAL_REQUIRED":
      return d.distErrSettlementApprovalRequired;
    case "SETTLEMENT_PENDING_DOCUMENTS":
      return d.distErrSettlementPendingDocs;
    case "SETTLEMENT_SELF_APPROVAL":
      return d.distErrSettlementSelfApproval;
    case "SETTLEMENT_DAY_LOCKED":
      return d.distErrSettlementDayLocked;
    case "TIER_CODE_TAKEN":
      return d.distErrTierCodeTaken;
    case "TIER_PRICE_LIST_INVALID":
      return d.distErrTierPriceList;
    case "TIER_INVALID":
      return d.distErrTierInvalid;
    case "FREE_GOODS_RULE_CODE_TAKEN":
    case "FREE_GOODS_RULE_INVALID":
      return d.distFocErrInvalid;
    case "PERIOD_LOCKED":
    case "POSTING_NOT_CONFIGURED":
    case "POSTING_REJECTED":
    case "EXCHANGE_RATE_MISSING":
      return error.message !== "" ? error.message : d.errorsGeneric;
    default:
      return localizedApiError(d, error, retryAfterSeconds);
  }
}

/** Rep-settlement statuses (DRAFT → COUNTED → APPROVED → POSTED; CANCELLED aside). */
export function localizedSettlementStatus(d: Dictionary, status: string): string {
  const map: Record<string, string> = {
    DRAFT: d.distSettlementDraft,
    COUNTED: d.distSettlementCounted,
    APPROVED: d.distSettlementApproved,
    POSTED: d.distSettlementPosted,
    CANCELLED: d.distSettlementCancelled,
  };
  return map[status] ?? status;
}

/** Variance direction (BR-021) → label + tone. */
export function localizedVarianceDirection(d: Dictionary, direction: string | null): string {
  switch (direction) {
    case "SHORTAGE":
      return d.distSettlementShortage;
    case "SURPLUS":
      return d.distSettlementSurplus;
    case "NONE":
    case null:
      return d.distSettlementNone;
    default:
      return direction;
  }
}

/** Expected-cash component (rep_settlement_lines.component) → label. */
export function localizedSettlementComponent(d: Dictionary, component: string): string {
  const map: Record<string, string> = {
    OPENING_CASH: d.distComponentOpeningCash,
    CASH_SALE: d.distComponentCashSale,
    COLLECTION: d.distComponentCollection,
    CASH_REFUND: d.distComponentCashRefund,
    REP_EXPENSE: d.distComponentRepExpense,
    VARIANCE: d.distComponentVariance,
    BANK_DEPOSIT: d.distComponentBankDeposit,
  };
  return map[component] ?? component;
}

/** Commission run statuses (DRAFT → POSTED; CANCELLED terminal). */
export function localizedCommissionStatus(d: Dictionary, status: string): string {
  const map: Record<string, string> = {
    DRAFT: d.commissionsStatusDraft,
    POSTED: d.commissionsStatusPosted,
    CANCELLED: d.commissionsStatusCancelled,
  };
  return map[status] ?? status;
}

/** Commission basis (INVOICED / COLLECTED) → label. */
export function localizedCommissionBasis(d: Dictionary, basis: string): string {
  switch (basis) {
    case "INVOICED":
      return d.commissionsBasisInvoiced;
    case "COLLECTED":
      return d.commissionsBasisCollected;
    default:
      return basis;
  }
}

/** Line payout statuses (ACCRUED / PAID). */
export function localizedPayoutStatus(d: Dictionary, payout: string): string {
  switch (payout) {
    case "ACCRUED":
      return d.commissionsPayoutAccrued;
    case "PAID":
      return d.commissionsPayoutPaid;
    default:
      return payout;
  }
}

/** Commissions error mapping (commission-errors.ts codes → dictionary). */
export function localizedCommissionError(
  d: Dictionary,
  error: ApiErrorBody,
  retryAfterSeconds?: number,
): string {
  switch (error.code) {
    case "COMMISSION_RUN_NOT_FOUND":
    case "SALES_REP_NOT_FOUND":
      return d.errorsNotFound;
    case "COMMISSION_RUN_STATE":
      return d.commErrRunState;
    case "COMMISSION_RULE_INVALID":
      return d.commErrRuleInvalid;
    default:
      return localizedApiError(d, error, retryAfterSeconds);
  }
}

// -- PHASE-018 (T41): manufacturing ------------------------------------------------

/**
 * Manufacturing module error mapping (manufacturing-errors.ts codes →
 * dictionary). Every typed code of the 24-route surface carries its own
 * key; posting-engine codes fall back to the API message; unknown codes
 * fall through to the generic ladder (the localizedDistributionError
 * pattern — each screen calls this directly).
 */
export function localizedManufacturingError(
  d: Dictionary,
  error: ApiErrorBody,
  retryAfterSeconds?: number,
): string {
  switch (error.code) {
    case "BOM_NOT_FOUND":
      return d.mfgErrBomNotFound;
    case "BOM_VERSION_CONFLICT":
      return d.mfgErrBomVersionConflict;
    case "BOM_NOT_DRAFT":
      return d.mfgErrBomNotDraft;
    case "BOM_NOT_ACTIVE":
      return d.mfgErrBomNotActive;
    case "BOM_ACTIVE_EXISTS":
      return d.mfgErrBomActiveExists;
    case "BOM_LINE_INVALID":
      return d.mfgErrBomLineInvalid;
    case "BOM_CYCLE":
      return d.mfgErrBomCycle;
    case "BOM_TOO_DEEP":
      return d.mfgErrBomTooDeep;
    case "BOM_ITEM_NOT_STOCK":
      return d.mfgErrBomItemNotStock;
    case "BOM_SELF_REFERENCE":
      return d.mfgErrBomSelfReference;
    case "BOM_YIELD_INVALID":
      return d.mfgErrBomYieldInvalid;
    case "BOM_UOM_MISMATCH":
      return d.mfgErrBomUomMismatch;
    case "BOM_REQUIRED":
      return d.mfgErrBomRequired;
    case "PRODUCTION_ORDER_NOT_FOUND":
      return d.mfgErrOrderNotFound;
    case "PRODUCTION_ORDER_STATE":
      return d.mfgErrOrderState;
    case "PRODUCTION_ORDER_INPUT_INVALID":
      return d.mfgErrOrderInputInvalid;
    case "PRODUCTION_ORDER_ITEM_NOT_STOCK":
      return d.mfgErrOrderItemNotStock;
    case "CONSUMPTION_NOT_PLANNED":
      return d.mfgErrConsumptionNotPlanned;
    case "SCRAP_REASON_REQUIRED":
      return d.mfgErrScrapReasonRequired;
    case "SCRAP_EXCEEDS_WIP":
      return d.mfgErrScrapExceedsWip;
    case "COMPLETE_WITHOUT_CONSUMPTION":
      return d.mfgErrCompleteWithoutConsumption;
    case "PRODUCTION_COST_ROUNDING":
      return d.mfgErrCostRounding;
    case "FG_SHELF_LIFE_REQUIRED":
      return d.mfgErrFgShelfLifeRequired;
    case "ORDER_NOT_CANCELABLE":
      return d.mfgErrOrderNotCancelable;
    case "INSPECTION_NOT_FOUND":
      return d.mfgErrInspectionNotFound;
    case "INSPECTION_TARGET_NOT_FOUND":
      return d.mfgErrInspectionTargetNotFound;
    case "INSPECTION_TARGET_INVALID":
      return d.mfgErrInspectionTargetInvalid;
    case "INSPECTION_INPUT_INVALID":
      return d.mfgErrInspectionInputInvalid;
    case "INSPECTION_DISPOSITION_REQUIRED":
      return d.mfgErrDispositionRequired;
    case "INSPECTION_DISPOSITION_INVALID":
      return d.mfgErrDispositionInvalid;
    case "QC_SCRAP_BATCH_NOT_QUARANTINED":
      return d.mfgErrQcScrapBatchNotQuarantined;
    case "QC_SCRAP_EMPTY_BATCH":
      return d.mfgErrQcScrapEmptyBatch;
    case "GENEALOGY_BATCH_NOT_FOUND":
      return d.mfgErrGenealogyBatchNotFound;
    case "PERIOD_LOCKED":
    case "POSTING_NOT_CONFIGURED":
    case "POSTING_REJECTED":
    case "EXCHANGE_RATE_MISSING":
      return error.message !== "" ? error.message : d.errorsGeneric;
    default:
      return localizedApiError(d, error, retryAfterSeconds);
  }
}

/** BOM version statuses (DRAFT → ACTIVE → ARCHIVED). */
export function localizedBomStatus(d: Dictionary, status: string): string {
  const map: Record<string, string> = {
    DRAFT: d.mfgBomStatusDraft,
    ACTIVE: d.mfgBomStatusActive,
    ARCHIVED: d.mfgBomStatusArchived,
  };
  return map[status] ?? status;
}

/** Production-order lifecycle states (MASTER-PLAN §2). */
export function localizedProductionOrderStatus(d: Dictionary, status: string): string {
  const map: Record<string, string> = {
    DRAFT: d.mfgOrderStatusDraft,
    RELEASED: d.mfgOrderStatusReleased,
    IN_PROGRESS: d.mfgOrderStatusInProgress,
    COMPLETED: d.mfgOrderStatusCompleted,
    CANCELLED: d.mfgOrderStatusCancelled,
  };
  return map[status] ?? status;
}

/** Inspection results (the §4 gate decision). */
export function localizedInspectionResult(d: Dictionary, result: string): string {
  const map: Record<string, string> = {
    PASS: d.mfgQcResultPass,
    FAIL: d.mfgQcResultFail,
  };
  return map[result] ?? result;
}

/** Inspection dispositions (null = none recorded). */
export function localizedInspectionDisposition(d: Dictionary, disposition: string | null): string {
  switch (disposition) {
    case "ACCEPT":
      return d.mfgQcDispAccept;
    case "SCRAP":
      return d.mfgQcDispScrap;
    case "REWORK":
      return d.mfgQcDispRework;
    case "RETURN_TO_SUPPLIER":
      return d.mfgQcDispReturn;
    case null:
      return d.mfgQcDispNone;
    default:
      return disposition;
  }
}

/** Inspection target types (production orders vs goods receipts). */
export function localizedInspectionTargetType(d: Dictionary, targetType: string): string {
  const map: Record<string, string> = {
    production_order: d.mfgQcTargetProductionOrder,
    goods_receipt: d.mfgQcTargetGoodsReceipt,
  };
  return map[targetType] ?? targetType;
}

/** Batch statuses (the 0026 widening: ACTIVE / QUARANTINED / WRITTEN_OFF). */
export function localizedBatchStatus(d: Dictionary, status: string): string {
  const map: Record<string, string> = {
    ACTIVE: d.mfgBatchStatusActive,
    QUARANTINED: d.mfgBatchStatusQuarantined,
    WRITTEN_OFF: d.mfgBatchStatusWrittenOff,
  };
  return map[status] ?? status;
}

/** Genealogy row kinds (the batch_genealogy report vocabulary). */
export function localizedGenealogyKind(d: Dictionary, kind: string): string {
  const map: Record<string, string> = {
    MATERIAL: d.mfgGenealogyKindMaterial,
    PRODUCED: d.mfgGenealogyKindProduced,
    SOLD: d.mfgGenealogyKindSold,
  };
  return map[kind] ?? kind;
}

/** Sales-edge document types (genealogy sales edges ride stock_moves). */
export function localizedSaleDocType(d: Dictionary, docType: string): string {
  const map: Record<string, string> = {
    sales_invoice: d.mfgDocSalesInvoice,
    delivery_note: d.mfgDocDeliveryNote,
  };
  return map[docType] ?? docType;
}

// -- PHASE-019 (T50): crm ----------------------------------------------------------

/**
 * CRM module error mapping (crm-errors.ts codes → dictionary). Every typed
 * code of the 45-route surface carries its own key; posting-engine codes
 * (PERIOD_LOCKED, PROJECT_NOT_FOUND/CLOSED, PURPOSE_NOT_MAPPED, …) fall back
 * to the API message; unknown codes fall through the generic ladder (the
 * localizedManufacturingError pattern — each screen calls this directly,
 * NOT wired into localizedApiError).
 */
export function localizedCrmError(
  d: Dictionary,
  error: ApiErrorBody,
  retryAfterSeconds?: number,
): string {
  switch (error.code) {
    // -- T45: leads + tasks/activities
    case "LEAD_NOT_FOUND":
      return d.crmErrLeadNotFound;
    case "LEAD_INPUT_INVALID":
      return d.crmErrLeadInputInvalid;
    case "LEAD_CONVERTED":
      return d.crmErrLeadConverted;
    case "LEAD_LOST_REASON_REQUIRED":
      return d.crmErrLeadLostReason;
    case "LEAD_MERGE_TARGET_REQUIRED":
      return d.crmErrLeadMergeTarget;
    case "TASK_NOT_FOUND":
      return d.crmErrTaskNotFound;
    case "TASK_STATE":
      return d.crmErrTaskState;
    case "TASK_INPUT_INVALID":
      return d.crmErrTaskInput;
    case "ACTIVITY_INPUT_INVALID":
      return d.crmErrActivityInput;
    // -- T46: contracts + schedule + advances + time
    case "CONTRACT_NOT_FOUND":
      return d.crmErrContractNotFound;
    case "CONTRACT_STATE":
      return d.crmErrContractState;
    case "CONTRACT_INPUT_INVALID":
      return d.crmErrContractInput;
    case "CONTRACT_TERM_INVALID":
      return d.crmErrContractTerm;
    case "SCHEDULE_ENTRY_NOT_FOUND":
      return d.crmErrScheduleNotFound;
    case "ADVANCE_STATE":
      return d.crmErrAdvanceState;
    case "ADVANCE_INSUFFICIENT_ON_ACCOUNT":
      return d.crmErrAdvanceInsufficient;
    case "TIME_ENTRY_NOT_FOUND":
      return d.crmErrTimeNotFound;
    case "TIME_ENTRY_STATE":
      return d.crmErrTimeState;
    case "TIME_ENTRY_INPUT_INVALID":
      return d.crmErrTimeInput;
    case "TIME_ENTRY_CASE_REQUIRED":
      return d.crmErrTimeCaseRequired;
    case "TIMESHEET_EMPTY":
      return d.crmErrTimesheetEmpty;
    // -- T48: service orders
    case "SERVICE_ORDER_NOT_FOUND":
      return d.crmErrServiceOrderNotFound;
    case "SERVICE_ORDER_STATE":
      return d.crmErrServiceOrderState;
    case "SERVICE_ORDER_INPUT_INVALID":
      return d.crmErrServiceOrderInput;
    case "SERVICE_ORDER_LINE_ERROR":
      return d.crmErrServiceOrderLine;
    case "SERVICE_ORDER_POSTING_NOT_CONFIGURED":
      return d.crmErrServiceOrderPosting;
    // -- the posting-engine / accounting codes the crm surfaces rethrow
    case "PERIOD_LOCKED":
    case "PROJECT_NOT_FOUND":
    case "PROJECT_CLOSED":
    case "PURPOSE_NOT_MAPPED":
    case "POSTING_NOT_CONFIGURED":
    case "POSTING_REJECTED":
    case "EXCHANGE_RATE_MISSING":
    case "PARTNER_NOT_FOUND":
      return error.message !== "" ? error.message : d.errorsGeneric;
    default:
      return localizedApiError(d, error, retryAfterSeconds);
  }
}

/** Lead statuses (the §2 pipeline). */
export function localizedLeadStatus(d: Dictionary, status: string): string {
  const map: Record<string, string> = {
    NEW: d.crmLeadStatusNew,
    QUALIFIED: d.crmLeadStatusQualified,
    CONVERTED: d.crmLeadStatusConverted,
    LOST: d.crmLeadStatusLost,
  };
  return map[status] ?? status;
}

/** Lead sources (the §2 CHECK vocabulary). */
export function localizedLeadSource(d: Dictionary, source: string): string {
  const map: Record<string, string> = {
    WALK_IN: d.crmLeadSourceWalkIn,
    REFERRAL: d.crmLeadSourceReferral,
    WEBSITE: d.crmLeadSourceWebsite,
    CAMPAIGN: d.crmLeadSourceCampaign,
    CALL: d.crmLeadSourceCall,
    OTHER: d.crmLeadSourceOther,
  };
  return map[source] ?? source;
}

/** Task statuses (OPEN → DONE/CANCELLED; §3). */
export function localizedTaskStatus(d: Dictionary, status: string): string {
  const map: Record<string, string> = {
    OPEN: d.crmTaskStatusOpen,
    DONE: d.crmTaskStatusDone,
    CANCELLED: d.crmTaskStatusCancelled,
  };
  return map[status] ?? status;
}

/** Activity kinds (CALL/MEETING/EMAIL/NOTE; §3). */
export function localizedActivityKind(d: Dictionary, kind: string): string {
  const map: Record<string, string> = {
    CALL: d.crmActivityKindCall,
    MEETING: d.crmActivityKindMeeting,
    EMAIL: d.crmActivityKindEmail,
    NOTE: d.crmActivityKindNote,
  };
  return map[kind] ?? kind;
}

/** Task related-anchor types (§3). */
export function localizedRelatedType(d: Dictionary, relatedType: string): string {
  const map: Record<string, string> = {
    LEAD: d.crmTaskRelatedLead,
    PARTNER: d.crmTaskRelatedPartner,
    CONTRACT: d.crmTaskRelatedContract,
    SERVICE_ORDER: d.crmTaskRelatedServiceOrder,
  };
  return map[relatedType] ?? relatedType;
}

/** Contract statuses (DRAFT → ACTIVE/CANCELLED/RENEWED; §4). */
export function localizedContractStatus(d: Dictionary, status: string): string {
  const map: Record<string, string> = {
    DRAFT: d.crmContractStatusDraft,
    ACTIVE: d.crmContractStatusActive,
    CANCELLED: d.crmContractStatusCancelled,
    RENEWED: d.crmContractStatusRenewed,
  };
  return map[status] ?? status;
}

/** Contract fee models (§4). */
export function localizedFeeModel(d: Dictionary, feeModel: string): string {
  const map: Record<string, string> = {
    RETAINER: d.crmFeeModelRetainer,
    MILESTONES: d.crmFeeModelMilestones,
    HOURLY: d.crmFeeModelHourly,
  };
  return map[feeModel] ?? feeModel;
}

/** Schedule entry types (§4 grid vocabulary). */
export function localizedScheduleEntryType(d: Dictionary, entryType: string): string {
  const map: Record<string, string> = {
    RETAINER_PERIOD: d.crmScheduleEntryRetainer,
    MILESTONE: d.crmScheduleEntryMilestone,
    HOURLY_PERIOD: d.crmScheduleEntryHourly,
  };
  return map[entryType] ?? entryType;
}

/** Schedule entry statuses (PLANNED/INVOICED/SKIPPED; §4). */
export function localizedScheduleStatus(d: Dictionary, status: string): string {
  const map: Record<string, string> = {
    PLANNED: d.crmScheduleStatusPlanned,
    INVOICED: d.crmScheduleStatusInvoiced,
    SKIPPED: d.crmScheduleStatusSkipped,
  };
  return map[status] ?? status;
}

/** Advance statuses (HELD/RELEASED; §4). */
export function localizedAdvanceStatus(d: Dictionary, status: string): string {
  const map: Record<string, string> = {
    HELD: d.crmAdvanceStatusHeld,
    RELEASED: d.crmAdvanceStatusReleased,
  };
  return map[status] ?? status;
}

/** Time-entry statuses (DRAFT/APPROVED/BILLED/VOID; §6). */
export function localizedTimeEntryStatus(d: Dictionary, status: string): string {
  const map: Record<string, string> = {
    DRAFT: d.crmTimeStatusDraft,
    APPROVED: d.crmTimeStatusApproved,
    BILLED: d.crmTimeStatusBilled,
    VOID: d.crmTimeStatusVoid,
  };
  return map[status] ?? status;
}

/** Service-order statuses (the job-card lifecycle; §7). */
export function localizedServiceOrderStatus(d: Dictionary, status: string): string {
  const map: Record<string, string> = {
    DRAFT: d.crmServiceOrderStatusDraft,
    IN_PROGRESS: d.crmServiceOrderStatusInProgress,
    COMPLETED: d.crmServiceOrderStatusCompleted,
    INVOICED: d.crmServiceOrderStatusInvoiced,
    CANCELLED: d.crmServiceOrderStatusCancelled,
  };
  return map[status] ?? status;
}

/** Service-order line statuses (PENDING/RESERVED/ISSUED/INVOICED/VOID; §7). */
export function localizedServiceOrderLineStatus(d: Dictionary, status: string): string {
  const map: Record<string, string> = {
    PENDING: d.crmServiceOrderLineStatusPending,
    RESERVED: d.crmServiceOrderLineStatusReserved,
    ISSUED: d.crmServiceOrderLineStatusIssued,
    INVOICED: d.crmServiceOrderLineStatusInvoiced,
    VOID: d.crmServiceOrderLineStatusVoid,
  };
  return map[status] ?? status;
}

/** Project statuses (OPEN/CLOSED — a CLOSED project rejects new stamps; §8). */
export function localizedProjectStatus(d: Dictionary, status: string): string {
  const map: Record<string, string> = {
    OPEN: d.accountingProjectStatusOpen,
    CLOSED: d.accountingProjectStatusClosed,
  };
  return map[status] ?? status;
}

// ---------------------------------------------------------------------------
// PHASE-026 (T13-UI) — fixed assets & depreciation vocabulary + the module
// error registry (the manufacturing precedent: known contract codes get a
// localized message; unknown codes fall back to localizedApiError).
// ---------------------------------------------------------------------------

/** Asset register statuses (DATA_DICTIONARY §9 asset_status). */
export function localizedAssetStatus(d: Dictionary, status: string): string {
  const map: Record<string, string> = {
    ACTIVE: d.faStatusActive,
    FULLY_DEPRECIATED: d.faStatusFullyDepreciated,
    DISPOSED: d.faStatusDisposed,
    WRITTEN_OFF: d.faStatusWrittenOff,
  };
  return map[status] ?? status;
}

/** Depreciation methods (the §9 enum is exhaustive — three, no more). */
export function localizedDepreciationMethod(d: Dictionary, method: string): string {
  const map: Record<string, string> = {
    STRAIGHT_LINE: d.faMethodSl,
    DECLINING_BALANCE: d.faMethodDb,
    UNITS_OF_PRODUCTION: d.faMethodUop,
  };
  return map[method] ?? method;
}

/** Disposal kinds (SALE/SCRAP — the disposal-kind §9 enum). */
export function localizedDisposalKind(d: Dictionary, kind: string): string {
  const map: Record<string, string> = {
    SALE: d.faDispKindSale,
    SCRAP: d.faDispKindScrap,
  };
  return map[kind] ?? kind;
}

/** Fixed-assets module error mapping (BR-041..044 packs + engine failures). */
export function localizedFixedAssetsError(
  d: Dictionary,
  error: ApiErrorBody,
  retryAfterSeconds?: number,
): string {
  switch (error.code) {
    case "ASSET_CATEGORY_NOT_FOUND":
    case "ASSET_NOT_FOUND":
    case "DEPRECIATION_RUN_NOT_FOUND":
    case "ASSET_DISPOSAL_NOT_FOUND":
    case "ASSET_REVALUATION_NOT_FOUND":
      return d.errorsNotFound;
    case "ASSET_CATEGORY_CODE_TAKEN":
      return d.faErrCategoryCodeTaken;
    case "ASSET_CODE_TAKEN":
      return d.faErrAssetCodeTaken;
    case "ASSET_IMMUTABLE_FIELDS":
      return d.faErrAssetImmutable;
    case "PURPOSE_NOT_MAPPED":
      return d.faErrPurposesNotMapped;
    case "INVALID_AMOUNT":
    case "SALVAGE_EXCEEDS_COST":
      return d.faErrInvalidAmount;
    case "UOP_UNITS_REQUIRED":
      return d.faErrUopUnitsRequired;
    case "IMMUTABLE_DOCUMENT":
      return d.faErrImmutableDocument;
    case "RUN_ALREADY_POSTED":
      return d.faErrRunNotDraft;
    case "RUN_PERIOD_DUPLICATE":
      return d.faErrRunDuplicate;
    case "PERIOD_LOCKED":
      return d.faErrPeriodLocked;
    case "NBV_FLOOR_VIOLATION":
      return d.faErrNbvFloor;
    case "DISPOSAL_STATE_INVALID":
      return d.faErrDisposalState;
    case "DISPOSAL_SOD_VIOLATION":
      return d.faErrDisposalSod;
    case "DISPOSAL_PROCEEDS_INVALID":
      return d.faErrDisposalProceeds;
    case "REVALUATION_STATE_INVALID":
      return d.faErrRevalState;
    case "CAPITALIZATION_STATE_INVALID":
      return d.faErrCapitalizeState;
    case "ASSET_DISPOSED_REUSE":
      return d.faErrAssetDisposedReuse;
    default:
      return localizedApiError(d, error, retryAfterSeconds);
  }
}

// ---------------------------------------------------------------------------
// PHASE-027 (wave F) — cheques & notes + installment plans vocabulary and
// the two module error registries (the fixed_assets precedent: known
// contract codes get a localized message; unknown codes fall back to
// localizedApiError).
// ---------------------------------------------------------------------------

/** Note kinds (register §C note_kind enum — two, no more). */
export function localizedNoteKind(d: Dictionary, kind: string): string {
  const map: Record<string, string> = {
    CHEQUE: d.notesKindCheque,
    PROMISSORY_NOTE: d.notesKindPromissoryNote,
  };
  return map[kind] ?? kind;
}

/** Note directions (received = our AR paper; issued = our AP paper). */
export function localizedNoteDirection(d: Dictionary, direction: string): string {
  const map: Record<string, string> = {
    RECEIVED: d.notesDirectionReceived,
    ISSUED: d.notesDirectionIssued,
  };
  return map[direction] ?? direction;
}

/** Note custody statuses (register §C note_status; the BR-047 machine states). */
export function localizedNoteStatus(d: Dictionary, status: string): string {
  const map: Record<string, string> = {
    IN_CUSTODY: d.notesStatusInCustody,
    ENDORSED_OUT: d.notesStatusEndorsedOut,
    DEPOSITED: d.notesStatusDeposited,
    COLLECTED: d.notesStatusCollected,
    DISHONORED: d.notesStatusDishonored,
    DISCOUNTED: d.notesStatusDiscounted,
    RETURNED: d.notesStatusReturned,
  };
  return map[status] ?? status;
}

/** Custody event kinds (the note_events vocabulary, RECEIVE..RECLASSIFY). */
export function localizedNoteEvent(d: Dictionary, eventKind: string): string {
  const map: Record<string, string> = {
    RECEIVE: d.notesEventReceive,
    ISSUE: d.notesEventIssue,
    ENDORSE: d.notesEventEndorse,
    DEPOSIT: d.notesEventDeposit,
    COLLECT: d.notesEventCollect,
    DISHONOR: d.notesEventDishonor,
    DISCOUNT: d.notesEventDiscount,
    RETURN: d.notesEventReturn,
    RECLASSIFY: d.notesEventReclassify,
  };
  return map[eventKind] ?? eventKind;
}

/** Notes module error mapping (BR-046/047 + the G-24..G-28 failure pack). */
export function localizedNotesError(
  d: Dictionary,
  error: ApiErrorBody,
  retryAfterSeconds?: number,
): string {
  switch (error.code) {
    case "NOTE_NOT_FOUND":
    case "PARTNER_NOT_FOUND":
    case "NOTE_SOURCE_INVALID":
    case "CASH_ACCOUNT_NOT_FOUND":
      return d.errorsNotFound;
    case "ALREADY_POSTED":
      return d.notesErrAlreadyPosted;
    case "INVALID_CUSTODY_TRANSITION":
      return d.notesErrCustodyTransition;
    case "DISHONOR_REASON_REQUIRED":
      return d.notesErrDishonorReason;
    case "NOTE_RATE_MISMATCH":
      return d.notesErrRateMismatch;
    case "NOTE_CURRENCY_MISMATCH":
      return d.notesErrCurrencyMismatch;
    case "NOTE_ACCOUNT_REQUIRED":
      return d.notesErrAccountRequired;
    case "NOTE_ACCOUNT_CURRENCY_MISMATCH":
      return d.notesErrAccountCurrency;
    case "NOTE_FEE_INVALID":
      return d.notesErrFeeInvalid;
    case "NOTE_DISCOUNT_CURRENCY_UNSUPPORTED":
      return d.notesErrDiscountCurrency;
    case "NOTE_FIELDS_IMMUTABLE":
      return d.notesErrFieldsImmutable;
    default:
      return localizedApiError(d, error, retryAfterSeconds);
  }
}

/** Plan statuses (NULL status = DRAFT — the wizard's pre-activation state). */
export function localizedInstallmentStatus(d: Dictionary, status: string | null): string {
  if (status === null) {
    return d.instStatusDraft;
  }
  const map: Record<string, string> = {
    ACTIVE: d.instStatusActive,
    CLOSED: d.instStatusClosed,
    DEFAULTED: d.instStatusDefaulted,
  };
  return map[status] ?? status;
}

/** Schedule line statuses (PENDING/DUE/PAID/OVERDUE/WAIVED). */
export function localizedInstallmentLineStatus(d: Dictionary, status: string): string {
  const map: Record<string, string> = {
    PENDING: d.instLineStatusPending,
    DUE: d.instLineStatusDue,
    PAID: d.instLineStatusPaid,
    OVERDUE: d.instLineStatusOverdue,
    WAIVED: d.instLineStatusWaived,
  };
  return map[status] ?? status;
}

/** Schedule frequencies (the §9 wizard vocabulary). */
export function localizedInstallmentFrequency(d: Dictionary, frequency: string): string {
  const map: Record<string, string> = {
    WEEKLY: d.instFreqWeekly,
    BIWEEKLY: d.instFreqBiweekly,
    MONTHLY: d.instFreqMonthly,
    QUARTERLY: d.instFreqQuarterly,
  };
  return map[frequency] ?? frequency;
}

/** Plan source types (sales_invoice | service_contract). */
export function localizedInstallmentSource(d: Dictionary, sourceType: string): string {
  const map: Record<string, string> = {
    sales_invoice: d.instSourceSalesInvoice,
    service_contract: d.instSourceServiceContract,
  };
  return map[sourceType] ?? sourceType;
}

/** Installments module error mapping (BR-048/049 failure packs). */
export function localizedInstallmentsError(
  d: Dictionary,
  error: ApiErrorBody,
  retryAfterSeconds?: number,
): string {
  switch (error.code) {
    case "PLAN_NOT_FOUND":
    case "LINE_NOT_FOUND":
      return d.errorsNotFound;
    case "PLAN_SOURCE_INVALID":
      return d.instErrSourceInvalid;
    case "PLAN_SOURCE_CURRENCY_UNSUPPORTED":
      return d.instErrSourceCurrency;
    case "PLAN_SOURCE_TAKEN":
      return d.instErrSourceTaken;
    case "SCHEDULE_IMMUTABLE":
      return d.instErrScheduleImmutable;
    case "PLAN_TOTAL_MISMATCH":
      return d.instErrTotalMismatch;
    case "SCHEDULE_INVALID":
      return d.instErrScheduleInvalid;
    case "LATE_FEE_POLICY_INVALID":
      return d.instErrPolicyInvalid;
    case "LATE_FEE_NOT_CHARGEABLE":
      return d.instErrLateFeeNotChargeable;
    case "WAIVE_REASON_REQUIRED":
      return d.instErrWaiveReason;
    default:
      return localizedApiError(d, error, retryAfterSeconds);
  }
}

// ---------------------------------------------------------------------------
// PHASE-028 (budgeting): status/scope label maps + the module error pack.
// ---------------------------------------------------------------------------

/** Budget statuses (the BR-050 machine states; DATA_DICTIONARY §9). */
export function localizedBudgetStatus(d: Dictionary, status: string): string {
  const map: Record<string, string> = {
    DRAFT: d.budgetStatusDraft,
    PENDING_APPROVAL: d.budgetStatusPendingApproval,
    ACTIVE: d.budgetStatusActive,
    REVISED: d.budgetStatusRevised,
    CLOSED: d.budgetStatusClosed,
  };
  return map[status] ?? status;
}

/** Budget scopes (§9 budget_scope enum — a filter, not a fork). */
export function localizedBudgetScope(d: Dictionary, scope: string): string {
  const map: Record<string, string> = {
    ACCOUNTS: d.budgetScopeAccounts,
    COST_CENTERS: d.budgetScopeCostCenters,
    PROJECTS: d.budgetScopeProjects,
    BRANCHES: d.budgetScopeBranches,
  };
  return map[scope] ?? scope;
}

/** Budgeting module error mapping (the BR-050/051 + import failure packs). */
export function localizedBudgetsError(
  d: Dictionary,
  error: ApiErrorBody,
  retryAfterSeconds?: number,
): string {
  switch (error.code) {
    case "BUDGET_NOT_FOUND":
    case "FISCAL_YEAR_NOT_FOUND":
    case "ACCOUNT_NOT_FOUND":
    case "COST_CENTER_NOT_FOUND":
    case "PROJECT_NOT_FOUND":
    case "BRANCH_NOT_FOUND":
      return d.errorsNotFound;
    case "BUDGET_STATE_INVALID":
      return d.budgetErrState;
    case "BUDGET_SELF_APPROVAL":
      return d.budgetErrSelfApproval;
    case "IMMUTABLE_DOCUMENT":
      return d.budgetErrImmutable;
    case "BUDGET_NOT_APPROVED":
      return d.budgetErrNotApproved;
    case "BUDGET_ACTIVE_EXISTS":
      return d.budgetErrActiveExists;
    case "BUDGET_PERIOD_MISMATCH":
      return d.budgetErrPeriodMismatch;
    case "BUDGET_SCOPE_DIMENSION":
      return d.budgetErrScopeDimension;
    case "BUDGET_LINE_LIMIT":
      return d.budgetErrLineLimit;
    case "BUDGET_DUPLICATE_LINE":
      return d.budgetErrDuplicateLine;
    case "BUDGET_EXCEEDED":
      return d.budgetErrExceeded;
    case "BUDGET_IMPORT_ROW_LIMIT":
      return d.budgetErrImportRowLimit;
    case "BUDGET_IMPORT_FORMAT":
      return d.budgetErrImportFormat;
    case "BUDGET_IMPORT_ROW":
      return d.budgetErrImportRow;
    default:
      return localizedApiError(d, error, retryAfterSeconds);
  }
}

/** PHASE-029: the payroll employee/loan status label map (AR/EN). */
export function localizedPayrollEmployeeStatus(
  d: Dictionary,
  status: "ACTIVE" | "SUSPENDED" | "TERMINATED",
): string {
  if (status === "SUSPENDED") return d.payStatusSuspended;
  if (status === "TERMINATED") return d.payStatusTerminated;
  return d.payStatusActive;
}

/** PHASE-029: the payroll run status label map (AR/EN). */
export function localizedPayrollRunStatus(
  d: Dictionary,
  status: "DRAFT" | "PENDING_APPROVAL" | "POSTED",
): string {
  if (status === "PENDING_APPROVAL") return d.payRunPending;
  if (status === "POSTED") return d.payRunPosted;
  return d.payRunDraft;
}

/** PHASE-029: the payroll loan status label map (AR/EN). */
export function localizedPayrollLoanStatus(
  d: Dictionary,
  status: "ACTIVE" | "CLOSED" | "WRITE_OFF",
): string {
  if (status === "CLOSED") return d.payLoanClosed;
  if (status === "WRITE_OFF") return d.payLoanWriteOffStatus;
  return d.payLoanActive;
}

/** PHASE-029: the payroll loan-line status label map (AR/EN). */
export function localizedPayrollLoanLineStatus(
  d: Dictionary,
  status: "PENDING" | "DEDUCTED" | "WAIVED",
): string {
  if (status === "DEDUCTED") return d.payLoanDeducted;
  if (status === "WAIVED") return d.payLoanWaived;
  return d.payLoanPending;
}

/** PHASE-029: the payroll contract-type label map (AR/EN). */
export function localizedPayrollContract(
  d: Dictionary,
  contract: "FULL_TIME" | "PART_TIME" | "CONTRACTOR",
): string {
  if (contract === "PART_TIME") return d.payContractPartTime;
  if (contract === "CONTRACTOR") return d.payContractContractor;
  return d.payContractFullTime;
}

/** PHASE-029: the payroll typed-error map (the budgeting precedent). */
export function localizedPayrollError(
  d: Dictionary,
  error: ApiErrorBody,
  retryAfterSeconds?: number,
): string {
  switch (error.code) {
    case "EMPLOYEE_NOT_FOUND":
    case "SALARY_STRUCTURE_NOT_FOUND":
    case "SALARY_COMPONENT_NOT_FOUND":
    case "PAYROLL_RUN_NOT_FOUND":
    case "EMPLOYEE_LOAN_NOT_FOUND":
    case "EMPLOYEE_LOAN_LINE_NOT_FOUND":
    case "ACCOUNT_NOT_FOUND":
      return d.payErrNotFound;
    case "PAYROLL_STATE_INVALID":
    case "EMPLOYEE_STATE_INVALID":
      return d.payErrStateInvalid;
    case "PAYROLL_RUN_SELF_APPROVAL":
      return d.payErrSelfApproval;
    case "IMMUTABLE_DOCUMENT":
      return d.payErrImmutable;
    case "PAYROLL_RUN_PERIOD_EXISTS":
      return d.payErrRunPeriodExists;
    case "SALARY_STRUCTURE_IN_USE":
      return d.payErrStructureInUse;
    case "SALARY_STRUCTURE_NOT_ACTIVE":
      return d.payErrStructureNotActive;
    case "SALARY_STRUCTURE_CURRENCY":
      return d.payErrStructureCurrency;
    case "EMPLOYEE_STRUCTURE_MISSING":
      return d.payErrEmployeeStructureMissing;
    case "LOAN_DEDUCTION_CAP_EXCEEDED":
      return d.payErrLoanCap;
    case "LOAN_ACCOUNT_UNMAPPED":
      return d.payErrLoanUnmapped;
    case "EOS_BASIS_REQUIRED":
      return d.payErrEosBasis;
    case "EOS_SETTLEMENT_EXCEEDS_BALANCE":
      return d.payErrEosExceeds;
    case "PAYROLL_PAYOUT_EXCEEDS_RUN":
      return d.payErrPayoutExceeds;
    case "PAYROLL_CODE_CONFLICT":
    case "SALARY_COMPONENT_SHAPE":
      return d.payErrCodeConflict;
    case "PAYROLL_ACCOUNT_ENGINE_ONLY":
      return d.payErrEngineOnly;
    case "PURPOSE_NOT_MAPPED":
      return d.payErrPurposeNotMapped;
    case "PERIOD_LOCKED":
      return d.payErrPeriodLocked;
    default:
      return localizedApiError(d, error, retryAfterSeconds);
  }
}
