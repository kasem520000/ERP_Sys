/**
 * /{locale}/vehicles — the per-partner vehicle registry (PHASE-017 T6, 9-a):
 * the searchable registry list (partners.vehicles.manage is the single
 * matrix key; 403 renders the forbidden state) plus the partner directory
 * for the create dialog's owner select. Service-history and archive ride
 * client-side bffFetch calls from the component.
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../components/client-ui";

import { AppShell } from "../../../components/app-shell";
import { RetryButton } from "../../../components/retry-button";
import { Vehicles } from "../../../components/vehicles";
import { getDictionary, isLocale, type Locale } from "../../../i18n/dictionaries";
import type { PartnerRow, VehicleRow } from "../../../lib/api-types";
import { localizedApiError } from "../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../lib/server-api";

export default async function VehiclesPage({
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

  const [vehicles, partners] = await Promise.all([
    fetchApi<readonly VehicleRow[]>("partners/vehicles?limit=100"),
    fetchApi<readonly PartnerRow[]>("partners/partners?limit=100"),
  ]);
  if (!vehicles.ok && vehicles.status === 401) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!vehicles.ok) {
    const forbidden = vehicles.status === 403 || vehicles.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden
            ? d.errorsForbidden
            : localizedApiError(d, vehicles.error, vehicles.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    content = (
      <Vehicles
        locale={localeValue}
        initialRows={vehicles.data}
        partners={partners.ok ? partners.data : []}
      />
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="vehicles" title={d.vehiclesTitle}>
      {content}
    </AppShell>
  );
}
