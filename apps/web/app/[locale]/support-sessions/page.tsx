/**
 * P4-T12a — /{locale}/support-sessions (session, tenancy.settings.manage):
 * the tenant-side review trail. Lists every support session with status
 * badges (ACTIVE/CLOSED/EXPIRED/TERMINATED), reason, ticket ref, opt-in flag
 * and the opened→expires window; ACTIVE opt-in sessions carry a terminate
 * button (DELETE /api/bff/tenancy/support-sessions/:id).
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../components/client-ui";

import { AppShell } from "../../../components/app-shell";
import { RetryButton } from "../../../components/retry-button";
import { SupportSessionsTable } from "../../../components/support-sessions-table";
import { getDictionary, isLocale, type Locale } from "../../../i18n/dictionaries";
import type { SupportSessionRow } from "../../../lib/api-types";
import { localizedApiError } from "../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../lib/server-api";

export default async function SupportSessionsPage({
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

  const sessions = await fetchApi<readonly SupportSessionRow[]>("tenancy/support-sessions");
  if (!sessions.ok && sessions.status === 401) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!sessions.ok) {
    const forbidden = sessions.status === 403 || sessions.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden
            ? d.errorsForbidden
            : localizedApiError(d, sessions.error, sessions.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    content = (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-gray-600">{d.supportSessionsHint}</p>
        <SupportSessionsTable locale={localeValue} rows={sessions.data} />
      </div>
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="support-sessions" title={d.supportSessionsTitle}>
      {content}
    </AppShell>
  );
}
