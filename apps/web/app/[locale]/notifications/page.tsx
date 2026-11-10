/**
 * T19-WEB (PHASE-014) — /{locale}/notifications (session; self plane — every
 * user manages their own inbox; the matrix carries no permission key). The
 * server resolves the initial unread list + channel preferences through the
 * BFF; the client center owns the filter toggle, mark-read PATCHes, the
 * preferences PUTs and the 60s poll. Inbox routes stay usable during
 * read-only grace upstream (exempt by design — SUBSCRIPTION §8).
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../components/client-ui";

import { AppShell } from "../../../components/app-shell";
import { NotificationsCenter } from "../../../components/notifications-center";
import { RetryButton } from "../../../components/retry-button";
import { getDictionary, isLocale, type Locale } from "../../../i18n/dictionaries";
import type { NotificationPrefRow, NotificationRow } from "../../../lib/api-types";
import { localizedApiError } from "../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../lib/server-api";

export default async function NotificationsPage({
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

  const [rows, prefs] = await Promise.all([
    fetchApi<readonly NotificationRow[]>("notifications?unread=true&limit=50"),
    fetchApi<readonly NotificationPrefRow[]>("notifications/preferences"),
  ]);
  if ((!rows.ok && rows.status === 401) || (!prefs.ok && prefs.status === 401)) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!rows.ok) {
    content = (
      <ErrorState
        title={localizedApiError(d, rows.error, rows.retryAfterSeconds)}
        retry={<RetryButton label={d.retryLabel} />}
      />
    );
  } else if (!prefs.ok) {
    content = (
      <ErrorState
        title={localizedApiError(d, prefs.error, prefs.retryAfterSeconds)}
        retry={<RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    content = (
      <NotificationsCenter locale={localeValue} initialRows={rows.data} initialPrefs={prefs.data} />
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="notifications" title={d.notificationsTitle}>
      {content}
    </AppShell>
  );
}
