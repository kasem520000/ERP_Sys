"use client";
/**
 * PHASE-021 T2-b · HonestStateBadge (DR-P21-06/§6; OFFLINE_CAPABILITIES
 * MATRIX post-sync state machines): the honest local statuses —
 * DRAFT_LOCAL / PENDING_MERGE / SYNC_FAILED / MERGED / CANCELLED_LOCAL
 * (draft_docs), plus the outbox statuses QUEUED / IN_FLIGHT / ACKED /
 * REJECTED / CANCELLED. A draft never renders as posted; the official
 * number appears nowhere until the server assigned it.
 */
import type { JSX } from "react";

import { getDictionary, type Locale } from "../../i18n/dictionaries";
import type { DraftStatus } from "../../lib/shell/store-client";
import type { OutboxStatus } from "@erp/sync-core";

export function HonestStateBadge({ locale, status }: { locale: Locale; status: DraftStatus }): JSX.Element {
  const d = getDictionary(locale);
  const label =
    status === "DRAFT_LOCAL"
      ? d.offlineStateDraftLocal
      : status === "PENDING_MERGE"
        ? d.offlineStatePendingMerge
        : status === "SYNC_FAILED"
          ? d.offlineStateSyncFailed
          : status === "MERGED"
            ? d.offlineStateMerged
            : d.offlineStateCancelledLocal;
  const tone =
    status === "SYNC_FAILED"
      ? "border-danger-border bg-danger-bg text-danger-text"
      : status === "MERGED"
        ? "border-success-border bg-success-bg text-success-text"
        : status === "PENDING_MERGE"
          ? "border-warning-border bg-warning-bg text-warning-text"
          : status === "CANCELLED_LOCAL"
            ? "border-default bg-surface-sunken text-gray-500"
            : "border-subtle bg-surface-card text-gray-700";
  return (
    <span
      lang={locale}
      dir={locale === "ar" ? "rtl" : "ltr"}
      className={`inline-flex w-fit items-center rounded-sm border px-2 py-1 text-xs font-medium ${tone}`}
    >
      {label}
    </span>
  );
}

export function OutboxStatusBadge({ locale, status }: { locale: Locale; status: OutboxStatus }): JSX.Element {
  const d = getDictionary(locale);
  const label =
    status === "QUEUED"
      ? d.offlineStatusQueued
      : status === "IN_FLIGHT"
        ? d.offlineStatusInFlight
        : status === "ACKED"
          ? d.offlineStatusAcked
          : status === "REJECTED"
            ? d.offlineStatusRejected
            : d.offlineStatusCancelled;
  const tone =
    status === "REJECTED"
      ? "border-danger-border bg-danger-bg text-danger-text"
      : status === "ACKED"
        ? "border-success-border bg-success-bg text-success-text"
        : status === "IN_FLIGHT"
          ? "border-default bg-surface-sunken text-gray-700"
          : "border-subtle bg-surface-card text-gray-700";
  return (
    <span
      lang={locale}
      dir={locale === "ar" ? "rtl" : "ltr"}
      className={`inline-flex w-fit items-center rounded-sm border px-2 py-1 text-xs font-medium ${tone}`}
    >
      {label}
    </span>
  );
}
