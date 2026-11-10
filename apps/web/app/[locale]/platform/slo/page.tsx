/**
 * PHASE-025 T9d — /{locale}/platform/slo (platform ops): the SLO /
 * error-budget dashboard from GET /api/v1/platform/slo (the six finalized
 * SLOs + burn alerts — MONITORING §5; the in-process SF-024-021 substrate).
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import { InfoNotice } from "../../../../components/notices";
import { RetryButton } from "../../../../components/retry-button";
import { SloPanels, type SloSnapshotWire } from "../../../../components/slo-panels";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function PlatformSloPage({
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

  const snapshot = await fetchApi<SloSnapshotWire>("platform/slo");
  if (!snapshot.ok && snapshot.status === 401) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!snapshot.ok) {
    const forbidden = snapshot.status === 403 || snapshot.error.code === "FORBIDDEN";
    content = forbidden ? (
      <InfoNotice>{d.platformNoAccess}</InfoNotice>
    ) : (
      <ErrorState
        title={localizedApiError(d, snapshot.error, snapshot.retryAfterSeconds)}
        retry={<RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    content = (
      <div className="flex flex-col gap-4">
        <p lang={localeValue} className="max-w-3xl text-sm text-gray-600">
          {d.sloSubtitle}
        </p>
        <SloPanels locale={localeValue} snapshot={snapshot.data} />
      </div>
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="platform/slo" title={d.sloTitle}>
      {content}
    </AppShell>
  );
}
