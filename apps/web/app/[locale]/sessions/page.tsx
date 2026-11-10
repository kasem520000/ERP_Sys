/**
 * /{locale}/sessions — active sessions of the tenant with per-row revoke
 * buttons (POST /api/bff/identity/sessions/{id}/revoke). Revoking your own
 * session signs you out: the next render hits 401 → redirect to login.
 * tokenHash is part of the wire row but is never rendered here.
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../components/client-ui";

import { AppShell } from "../../../components/app-shell";
import { RetryButton } from "../../../components/retry-button";
import { SessionsTable } from "../../../components/sessions-table";
import { getDictionary, isLocale, type Locale } from "../../../i18n/dictionaries";
import type { TenantSessionRow } from "../../../lib/api-types";
import { localizedApiError } from "../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../lib/server-api";

export default async function SessionsPage({
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

  const sessions = await fetchApi<readonly TenantSessionRow[]>("identity/sessions/tenant");
  if (!sessions.ok && sessions.status === 401) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!sessions.ok) {
    content = (
      <ErrorState
        title={localizedApiError(d, sessions.error, sessions.retryAfterSeconds)}
        retry={<RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    content = (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-gray-600">{d.sessionsHint}</p>
        <SessionsTable locale={localeValue} rows={sessions.data} />
      </div>
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="sessions" title={d.sessionsTitle}>
      {content}
    </AppShell>
  );
}
