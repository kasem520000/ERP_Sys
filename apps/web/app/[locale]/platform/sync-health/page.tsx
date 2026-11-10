/**
 * PHASE-020 T14 — /{locale}/platform/sync-health (tenant admin): the sync
 * health dashboard from GET /api/v1/sync/admin/health (push stats + p95,
 * cursor lag per entity, conflicts by type, rejections by reason, the
 * outbox lag gauge, revoked pending ops, and derived alerts).
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import { InfoNotice } from "../../../../components/notices";
import { RetryButton } from "../../../../components/retry-button";
import { SyncHealthPanels, type SyncHealthReportWire } from "../../../../components/sync-health-panels";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function PlatformSyncHealthPage({
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

  const health = await fetchApi<SyncHealthReportWire>("sync/admin/health");
  if (!health.ok && health.status === 401) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!health.ok) {
    const forbidden = health.status === 403 || health.error.code === "FORBIDDEN";
    content = forbidden ? (
      <InfoNotice>{d.platformNoAccess}</InfoNotice>
    ) : (
      <ErrorState
        title={localizedApiError(d, health.error, health.retryAfterSeconds)}
        retry={<RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    content = (
      <div className="flex flex-col gap-4">
        <p lang={localeValue} className="max-w-3xl text-sm text-gray-600">
          {d.syncHealthSubtitle}
        </p>
        <SyncHealthPanels locale={localeValue} report={health.data} />
      </div>
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="platform/sync-health" title={d.syncHealthTitle}>
      {content}
    </AppShell>
  );
}
