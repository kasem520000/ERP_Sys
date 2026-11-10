/**
 * /{locale}/notes/calendar — the PDC maturity calendar (§1 dashboard
 * variant, BR-045): the two-sided bucket fold over the LIVE note set with
 * the staleness labeling (stale → warning chip + computedAt + the
 * staleAfterHours hint — NEVER STALE-SILENT), the partner/bank drill lists
 * and the live-notes list. Pure read — no posting can originate here.
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import { NotesTabs } from "../../../../components/notes-tabs";
import { PdcCalendar } from "../../../../components/pdc-calendar";
import { RetryButton } from "../../../../components/retry-button";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type { PdcCalendarSnapshot } from "../../../../lib/api-types";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function NotesCalendarPage({
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

  const snapshot = await fetchApi<PdcCalendarSnapshot>("notes/pdc-calendar");
  if (!snapshot.ok && snapshot.status === 401) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!snapshot.ok) {
    const forbidden = snapshot.status === 403 || snapshot.error.code === "FORBIDDEN";
    content = (
      <div className="flex flex-col gap-4">
        <NotesTabs locale={localeValue} active="calendar" />
        <ErrorState
          title={
            forbidden
              ? d.errorsForbidden
              : localizedApiError(d, snapshot.error, snapshot.retryAfterSeconds)
          }
          retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
        />
      </div>
    );
  } else {
    content = (
      <div className="flex flex-col gap-4">
        <NotesTabs locale={localeValue} active="calendar" />
        <PdcCalendar locale={localeValue} snapshot={snapshot.data} />
      </div>
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="notes/calendar" title={d.notesCalendarTitle}>
      {content}
    </AppShell>
  );
}
