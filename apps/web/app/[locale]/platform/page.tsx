/**
 * P4-T12a — /{locale}/platform (platform admin console): tenant list + q
 * search (GET /api/bff/platform/tenants?limit=200 through the BFF's internal
 * fetch). Non-platform sessions get the localized "platform administration
 * area" notice (the API 403s + audits every escalation attempt — S-07). Row
 * names link to the tenant detail screen.
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../components/client-ui";

import { AppShell } from "../../../components/app-shell";
import { InfoNotice } from "../../../components/notices";
import { PlatformSearchForm } from "../../../components/platform-search-form";
import { PlatformTenantsTable } from "../../../components/platform-tenants-table";
import { RetryButton } from "../../../components/retry-button";
import { getDictionary, isLocale, type Locale } from "../../../i18n/dictionaries";
import type { ConsoleTenantSummary } from "../../../lib/api-types";
import { localizedApiError } from "../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../lib/server-api";

export default async function PlatformPage({
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
  const rawQuery = query.q;
  const search = typeof rawQuery === "string" ? rawQuery.trim() : "";

  const path = `platform/tenants?limit=200${search === "" ? "" : `&q=${encodeURIComponent(search)}`}`;
  const tenants = await fetchApi<readonly ConsoleTenantSummary[]>(path);
  if (!tenants.ok && tenants.status === 401) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!tenants.ok) {
    const forbidden = tenants.status === 403 || tenants.error.code === "FORBIDDEN";
    content = forbidden ? (
      <InfoNotice>{d.platformNoAccess}</InfoNotice>
    ) : (
      <ErrorState
        title={localizedApiError(d, tenants.error, tenants.retryAfterSeconds)}
        retry={<RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    content = (
      <div className="flex flex-col gap-4">
        <PlatformSearchForm locale={localeValue} initialQuery={search} />
        <PlatformTenantsTable locale={localeValue} rows={tenants.data} />
      </div>
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="platform" title={d.platformConsoleTitle}>
      {content}
    </AppShell>
  );
}
