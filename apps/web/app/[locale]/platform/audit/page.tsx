/**
 * P4-T12a — /{locale}/platform/audit (platform admin): the cross-tenant audit
 * viewer. Filters (platformOnly checkbox, tenantId, action) submit through
 * the router (URL-encoded, shareable); pagination rides the opaque cursor in
 * the URL (meta.nextCursor from the paginated envelope) with a next-page
 * link that preserves the filters.
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import { AuditFilterForm } from "../../../../components/audit-filter-form";
import { InfoNotice } from "../../../../components/notices";
import { PlatformAuditTable } from "../../../../components/platform-audit-table";
import { RetryButton } from "../../../../components/retry-button";
import { LinkButton } from "../../../../components/link-button";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type { PlatformAuditEvent } from "../../../../lib/api-types";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

const PAGE_LIMIT = 200;

export default async function PlatformAuditPage({
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
  const platformOnly = query.platformOnly === "true" || query.platformOnly === "on";
  const tenantId = typeof query.tenantId === "string" ? query.tenantId.trim() : "";
  const action = typeof query.action === "string" ? query.action.trim() : "";
  const cursor = typeof query.cursor === "string" ? query.cursor : "";

  const search = new URLSearchParams({ limit: String(PAGE_LIMIT) });
  if (platformOnly) {
    search.set("platformOnly", "true");
  }
  if (tenantId !== "") {
    search.set("tenantId", tenantId);
  }
  if (action !== "") {
    search.set("action", action);
  }
  if (cursor !== "") {
    search.set("cursor", cursor);
  }

  const events = await fetchApi<readonly PlatformAuditEvent[]>(`platform/audit/events?${search.toString()}`);
  if (!events.ok && events.status === 401) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!events.ok) {
    const forbidden = events.status === 403 || events.error.code === "FORBIDDEN";
    content = forbidden ? (
      <InfoNotice>{d.platformNoAccess}</InfoNotice>
    ) : (
      <ErrorState
        title={localizedApiError(d, events.error, events.retryAfterSeconds)}
        retry={<RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    const nextCursor = events.meta?.nextCursor;
    const nextLink = new URLSearchParams();
    if (platformOnly) {
      nextLink.set("platformOnly", "true");
    }
    if (tenantId !== "") {
      nextLink.set("tenantId", tenantId);
    }
    if (action !== "") {
      nextLink.set("action", action);
    }
    if (nextCursor !== undefined) {
      nextLink.set("cursor", nextCursor);
    }

    content = (
      <div className="flex flex-col gap-4">
        <AuditFilterForm locale={localeValue} initial={{ platformOnly, tenantId, action }} />
        <PlatformAuditTable locale={localeValue} rows={events.data} />
        {nextCursor !== undefined && (
          <div>
            <LinkButton href={`/${locale}/platform/audit?${nextLink.toString()}`}>
              {d.platformAuditNextPage}
            </LinkButton>
          </div>
        )}
      </div>
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="platform/audit" title={d.platformAuditTitle}>
      {content}
    </AppShell>
  );
}
