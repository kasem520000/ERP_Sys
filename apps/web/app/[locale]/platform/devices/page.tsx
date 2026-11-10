/**
 * PHASE-020 T14 — /{locale}/platform/devices (tenant admin): the device
 * registry table. Filters (device class + status) submit through the router
 * (URL-encoded, shareable — the platform/audit pattern); rows come from
 * GET /api/v1/devices through the BFF session fetch.
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import { DevicesFilterForm } from "../../../../components/devices-filter-form";
import { DevicesTable, type DeviceRow } from "../../../../components/devices-table";
import { InfoNotice } from "../../../../components/notices";
import { RetryButton } from "../../../../components/retry-button";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function PlatformDevicesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<JSX.Element> {
  const { locale } = await params;
  if (!isLocale(locale)) {
    notFound();
  }
  const localeValue = locale as Locale;
  const d = getDictionary(localeValue);

  await requireSessionToken(localeValue);

  const query = await searchParams;
  const classFilter = typeof query.class === "string" ? query.class : "";
  const statusFilter = typeof query.status === "string" ? query.status : "";

  const devices = await fetchApi<readonly DeviceRow[]>("devices");
  if (!devices.ok && devices.status === 401) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!devices.ok) {
    const forbidden = devices.status === 403 || devices.error.code === "FORBIDDEN";
    content = forbidden ? (
      <InfoNotice>{d.platformNoAccess}</InfoNotice>
    ) : (
      <ErrorState
        title={localizedApiError(d, devices.error, devices.retryAfterSeconds)}
        retry={<RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    // URL-param filters (server-side, shareable): class + status.
    const rows = devices.data.filter((row) => {
      if (classFilter !== "" && row.deviceClass !== classFilter) return false;
      if (statusFilter === "active" && row.revokedAt !== null) return false;
      if (statusFilter === "revoked" && row.revokedAt === null) return false;
      return true;
    });

    content = (
      <div className="flex flex-col gap-4">
        <p lang={localeValue} className="max-w-3xl text-sm text-gray-600">
          {d.syncDevicesSubtitle}
        </p>
        <DevicesFilterForm locale={localeValue} initialClass={classFilter} initialStatus={statusFilter} />
        <DevicesTable locale={localeValue} rows={rows} />
      </div>
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="platform/devices" title={d.syncDevicesTitle}>
      {content}
    </AppShell>
  );
}
