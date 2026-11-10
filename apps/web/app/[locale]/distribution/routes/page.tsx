/**
 * /{locale}/distribution/routes — routes & the visit board (PHASE-017 T14
 * 9a-dist): the route registry (planning-only data — never posts), the
 * composition + plan-visits workspace for the selected route, and the
 * day's visit board (check-in / complete / skip). Routes are the primary
 * resource — 403 renders the forbidden state; supporting selects (reps,
 * vans, customers) degrade to empty on their own failures.
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import { DistributionRoutes } from "../../../../components/distribution-routes";
import { RetryButton } from "../../../../components/retry-button";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type {
  PartnerRow,
  RouteRow,
  RouteVisitRow,
  SalesRepRow,
  VanRow,
} from "../../../../lib/api-types";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function DistributionRoutesPage({
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

  const boardDate = new Date().toISOString().slice(0, 10);
  const [routes, visits, reps, vans, customers] = await Promise.all([
    fetchApi<readonly RouteRow[]>("distribution/routes"),
    fetchApi<readonly RouteVisitRow[]>(`distribution/visits?date=${boardDate}`),
    fetchApi<readonly SalesRepRow[]>("sales/reps"),
    fetchApi<readonly VanRow[]>("distribution/vans"),
    fetchApi<readonly PartnerRow[]>("partners?limit=100"),
  ]);
  if (!routes.ok && routes.status === 401) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!routes.ok) {
    const forbidden = routes.status === 403 || routes.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden
            ? d.errorsForbidden
            : localizedApiError(d, routes.error, routes.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    content = (
      <DistributionRoutes
        locale={localeValue}
        initialRoutes={routes.data}
        initialVisits={visits.ok ? visits.data : []}
        boardDate={boardDate}
        reps={reps.ok ? reps.data : []}
        vans={vans.ok ? vans.data : []}
        customers={(customers.ok ? customers.data : []).filter(
          (partner) =>
            partner.deletedAt === null &&
            (partner.kind === "CUSTOMER" || partner.kind === "BOTH"),
        )}
      />
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="distribution/routes" title={d.distributionRoutesTitle}>
      {content}
    </AppShell>
  );
}
