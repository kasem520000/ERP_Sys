/**
 * PHASE-020 T14 — /{locale}/platform/sync-reconciliation (tenant admin):
 * the revoked-device pending-ops queue from
 * GET /api/v1/sync/admin/reconciliation, with the reassign-drafts action
 * (POST /api/v1/sync/admin/drafts/reassign). The active-device list for the
 * reassign target select is fetched best-effort (GET /api/v1/devices) — a
 * user without identity.devices.manage still gets the queue with a manual
 * target input (honest degrade; the API re-validates every id).
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import { InfoNotice } from "../../../../components/notices";
import { RetryButton } from "../../../../components/retry-button";
import {
  SyncReconciliationQueue,
  type QueueDeviceOption,
  type ReconciliationRowWire,
} from "../../../../components/sync-reconciliation-queue";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function PlatformSyncReconciliationPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<JSX.Element> {
  const { locale } = await params;
  if (!isLocale(locale)) {
    notFound();
  }
  const localeValue = locale as Locale;
  const d = getDictionary(localeValue);

  await requireSessionToken(localeValue);

  const queue = await fetchApi<readonly ReconciliationRowWire[]>("sync/admin/reconciliation");
  if (!queue.ok && queue.status === 401) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!queue.ok) {
    const forbidden = queue.status === 403 || queue.error.code === "FORBIDDEN";
    content = forbidden ? (
      <InfoNotice>{d.platformNoAccess}</InfoNotice>
    ) : (
      <ErrorState
        title={localizedApiError(d, queue.error, queue.retryAfterSeconds)}
        retry={<RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    // Best-effort target list (needs identity.devices.manage): null ⇒ the
    // dialog falls back to a manual device-id input.
    const devicesResult = await fetchApi<readonly QueueDeviceOption[]>("devices");
    const devices: readonly QueueDeviceOption[] | null = devicesResult.ok
      ? devicesResult.data.map((device) => ({
          id: device.id,
          name: device.name,
          revokedAt: device.revokedAt,
        }))
      : null;

    content = (
      <div className="flex flex-col gap-4">
        <p lang={localeValue} className="max-w-3xl text-sm text-gray-600">
          {d.syncReconciliationSubtitle}
        </p>
        <SyncReconciliationQueue locale={localeValue} rows={queue.data} devices={devices} />
      </div>
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="platform/sync-reconciliation" title={d.syncReconciliationTitle}>
      {content}
    </AppShell>
  );
}
