/**
 * T19-WEB (PHASE-014) — /{locale}/dashboard (session): the owner/CEO landing
 * dashboard (NAVIGATION_MODEL §5; PAGE_ARCHETYPES §1). The server resolves
 * the session (permissions), the derived entitlements (the reporting.dashboards
 * gate — the nav item's own featureKey) and the usage snapshot (banner +
 * summary-strip data; a 403 degrades honestly — the widgets do not depend on
 * it), computes TODAY server-side, and hands everything to the client
 * component which runs the four report-bound widgets.
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../components/client-ui";

import { AppShell } from "../../../components/app-shell";
import { OwnerDashboard } from "../../../components/owner-dashboard";
import { RetryButton } from "../../../components/retry-button";
import { getDictionary, isLocale, type Locale } from "../../../i18n/dictionaries";
import type {
  CurrentSession,
  DerivedEntitlements,
  UsageSnapshotData,
} from "../../../lib/api-types";
import { localizedApiError } from "../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../lib/server-api";

export default async function DashboardPage({
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

  const [session, entitlements, usage] = await Promise.all([
    fetchApi<CurrentSession>("identity/sessions/current"),
    fetchApi<DerivedEntitlements>("tenancy/entitlements"),
    fetchApi<UsageSnapshotData>("tenancy/usage"),
  ]);
  if (
    (!session.ok && session.status === 401) ||
    (!entitlements.ok && entitlements.status === 401) ||
    (!usage.ok && usage.status === 401)
  ) {
    redirect(`/${locale}/login`);
  }

  // The gate mirrors the nav item's resolution (featureKey + permission).
  const canDashboard =
    session.ok &&
    session.data.permissions.includes("reporting.reports.run") &&
    entitlements.ok &&
    entitlements.data.featureKeys.includes("reporting.dashboards");

  let content: JSX.Element;
  if (!session.ok) {
    content = (
      <ErrorState
        title={localizedApiError(d, session.error, session.retryAfterSeconds)}
        retry={<RetryButton label={d.retryLabel} />}
      />
    );
  } else if (!entitlements.ok) {
    content = (
      <ErrorState
        title={localizedApiError(d, entitlements.error, entitlements.retryAfterSeconds)}
        retry={<RetryButton label={d.retryLabel} />}
      />
    );
  } else if (!canDashboard) {
    // Registry discipline: an ungranted route is a 404-equivalent opaque
    // state — never a feature-existence leak.
    content = <ErrorState title={d.errorsForbidden} />;
  } else {
    const today = new Date().toISOString().slice(0, 10);
    // PHASE-019 (T50): the CRM summary card's gate — the session's own
    // crm.leads.manage permission (the dashboard's existing gating pattern;
    // the card fetch re-enforces server-side regardless).
    const canCrm = session.data.permissions.includes("crm.leads.manage");
    content = (
      <OwnerDashboard
        locale={localeValue}
        today={today}
        usage={usage.ok ? usage.data : null}
        canCrm={canCrm}
      />
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="dashboard" title={d.dashboardTitle}>
      {content}
    </AppShell>
  );
}
