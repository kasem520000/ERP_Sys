"use client";
/**
 * PHASE-021 T2-b · the CONFLICT_RESOLUTION §3 action model — the FULL
 * typed-reason → user-actions table, implemented EXACTLY (the doc's
 * "unknown reason is not a valid UX state" rule included):
 *
 *   PERIOD_LOCKED           → [edit-and-resend, cancel]
 *   PRICE_CHANGED           → [accept-server-price, edit-and-resend, cancel]
 *   INSUFFICIENT_STOCK      → [edit-and-resend, accept-partial, cancel]
 *   CREDIT_LIMIT_EXCEEDED   → [edit-and-resend, request-approval-online, cancel]
 *   STALE_VERSION           → [review-and-merge (diff), discard]
 *   ITEM_INACTIVE           → [cancel, substitute-and-resend]
 *   PARTNER_INACTIVE        → [cancel, substitute-and-resend]
 *   VALIDATION_ERROR        → [edit-and-resend]
 *   DEVICE_REVOKED          → admin state, no resubmission
 *   TENANT_SUSPENDED        → admin state, no resubmission
 *
 * Unknown reasons (the registry grows without a console update) fall back
 * to the registry fallback: message + traceId + support hint — never a
 * silent drop. Pure model — the outbox view renders it.
 */
import type { Dictionary } from "../../i18n/dictionaries";

/** The §3 user-action ids (the local_events `choice` vocabulary). */
export type RejectionActionId =
  | "edit_and_resend"
  | "accept_server_price"
  | "cancel"
  | "accept_partial"
  | "request_approval_online"
  | "review_and_merge"
  | "discard"
  | "substitute_and_resend";

export interface RejectionActionModel {
  readonly id: RejectionActionId;
  readonly labelKey: keyof Dictionary;
}

/** The reasons that render as an administrative state (no resubmission). */
const ADMIN_REASONS: ReadonlySet<string> = new Set(["DEVICE_REVOKED", "TENANT_SUSPENDED"]);

export function isAdministrative(reason: string): boolean {
  return ADMIN_REASONS.has(reason);
}

/** The §3 table (in the doc's listed order per reason). */
export function rejectionActionsFor(reason: string): readonly RejectionActionModel[] {
  if (isAdministrative(reason)) return [];
  switch (reason) {
    case "PERIOD_LOCKED":
      return [
        { id: "edit_and_resend", labelKey: "offlineActionEditResend" },
        { id: "cancel", labelKey: "offlineActionCancel" },
      ];
    case "PRICE_CHANGED":
      return [
        { id: "accept_server_price", labelKey: "offlineActionAcceptServerPrice" },
        { id: "edit_and_resend", labelKey: "offlineActionEditResend" },
        { id: "cancel", labelKey: "offlineActionCancel" },
      ];
    case "INSUFFICIENT_STOCK":
      return [
        { id: "edit_and_resend", labelKey: "offlineActionEditResend" },
        { id: "accept_partial", labelKey: "offlineActionAcceptPartial" },
        { id: "cancel", labelKey: "offlineActionCancel" },
      ];
    case "CREDIT_LIMIT_EXCEEDED":
      return [
        { id: "edit_and_resend", labelKey: "offlineActionEditResend" },
        { id: "request_approval_online", labelKey: "offlineActionRequestApproval" },
        { id: "cancel", labelKey: "offlineActionCancel" },
      ];
    case "STALE_VERSION":
      return [
        { id: "review_and_merge", labelKey: "offlineActionReviewMerge" },
        { id: "discard", labelKey: "offlineActionDiscard" },
      ];
    case "ITEM_INACTIVE":
    case "PARTNER_INACTIVE":
      return [
        { id: "cancel", labelKey: "offlineActionCancel" },
        { id: "substitute_and_resend", labelKey: "offlineActionSubstitute" },
      ];
    case "VALIDATION_ERROR":
      return [{ id: "edit_and_resend", labelKey: "offlineActionEditResend" }];
    default:
      // Unknown reason (registry grew, console predates it): the registry
      // fallback — no actions, message + trace + support hint only.
      return [];
  }
}

/** The reason's label + meaning dictionary keys (§3's Meaning column). */
export function rejectionLabelKeys(
  reason: string,
): { labelKey: keyof Dictionary; meaningKey: keyof Dictionary } {
  switch (reason) {
    case "PERIOD_LOCKED":
      return { labelKey: "offlineRejPeriodLocked", meaningKey: "offlineRejMeaningPeriodLocked" };
    case "PRICE_CHANGED":
      return { labelKey: "offlineRejPriceChanged", meaningKey: "offlineRejMeaningPriceChanged" };
    case "INSUFFICIENT_STOCK":
      return { labelKey: "offlineRejInsufficientStock", meaningKey: "offlineRejMeaningInsufficientStock" };
    case "CREDIT_LIMIT_EXCEEDED":
      return { labelKey: "offlineRejCreditLimitExceeded", meaningKey: "offlineRejMeaningCreditLimitExceeded" };
    case "STALE_VERSION":
      return { labelKey: "offlineRejStaleVersion", meaningKey: "offlineRejMeaningStaleVersion" };
    case "ITEM_INACTIVE":
      return { labelKey: "offlineRejItemInactive", meaningKey: "offlineRejMeaningItemInactive" };
    case "PARTNER_INACTIVE":
      return { labelKey: "offlineRejPartnerInactive", meaningKey: "offlineRejMeaningPartnerInactive" };
    case "VALIDATION_ERROR":
      return { labelKey: "offlineRejValidationError", meaningKey: "offlineRejMeaningValidationError" };
    case "DEVICE_REVOKED":
      return { labelKey: "offlineRejDeviceRevoked", meaningKey: "offlineRejMeaningDeviceRevoked" };
    case "TENANT_SUSPENDED":
      return { labelKey: "offlineRejTenantSuspended", meaningKey: "offlineRejMeaningTenantSuspended" };
    default:
      // The reason code itself is the honest label for unknown reasons.
      return { labelKey: "offlineRejValidationError", meaningKey: "offlineRejMeaningValidationError" };
  }
}

/** Parse the outbox row's typed lastError JSON (v2 rejections carry
 * {reason, resubmittable, details, message}); DEFENSIVE — a plain-string
 * lastError (older rows) yields null fields, never a throw. */
export interface TypedRejection {
  readonly reason: string;
  readonly resubmittable: boolean | null;
  readonly details: Record<string, unknown> | null;
  readonly message: string | null;
  readonly traceId: string | null;
}

export function parseTypedRejection(lastError: string | null, rejectionReason: string | null): TypedRejection {
  const reason = rejectionReason ?? lastError ?? "VALIDATION_ERROR";
  if (lastError === null) {
    return { reason, resubmittable: null, details: null, message: null, traceId: null };
  }
  try {
    const parsed: unknown = JSON.parse(lastError);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      const record = parsed as Record<string, unknown>;
      return {
        reason,
        resubmittable: typeof record.resubmittable === "boolean" ? record.resubmittable : null,
        details:
          typeof record.details === "object" && record.details !== null && !Array.isArray(record.details)
            ? (record.details as Record<string, unknown>)
            : null,
        message: typeof record.message === "string" ? record.message : null,
        // Honest finding #2 (T-P21-3b): the typed lastError carries the
        // rejecting response's traceId under details.traceId (the server
        // error envelope shape); the top-level spelling stays as a
        // compat fallback for older rows.
        traceId:
          typeof record.traceId === "string"
            ? record.traceId
            : typeof (record.details as Record<string, unknown> | undefined)?.traceId === "string"
              ? String((record.details as Record<string, unknown>).traceId)
              : null,
      };
    }
  } catch {
    // a plain-string lastError — older rows; render it as the message
    return { reason, resubmittable: null, details: null, message: lastError, traceId: null };
  }
  return { reason, resubmittable: null, details: null, message: null, traceId: null };
}

/** The server price for PRICE_CHANGED (details.serverPrice → currentPrice,
 * either as a decimal string or number — anything else is "absent"). */
export function serverPriceFromDetails(details: Record<string, unknown> | null): string | null {
  if (details === null) return null;
  for (const key of ["serverPrice", "currentPrice", "price"]) {
    const value = details[key];
    if (typeof value === "string" && value.length > 0) return value;
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

/** The available qty for INSUFFICIENT_STOCK (details.availableQty →
 * availableQuantity). */
export function availableQtyFromDetails(details: Record<string, unknown> | null): string | null {
  if (details === null) return null;
  for (const key of ["availableQty", "availableQuantity", "available"]) {
    const value = details[key];
    if (typeof value === "string" && value.length > 0) return value;
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}
