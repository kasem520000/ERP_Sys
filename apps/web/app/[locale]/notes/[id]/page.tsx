/**
 * /{locale}/notes/[id] — note document detail (PAGE_ARCHETYPES §5): the
 * overview + the CUSTODY TIMELINE (note_events via the TimelinePanel) + the
 * state-machine actions per the BR-047 custody machine. 404 → notFound;
 * 401 → login; reference 403s degrade (cash accounts/permissions empty).
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import { NoteDetail } from "../../../../components/note-detail";
import { NotesTabs } from "../../../../components/notes-tabs";
import { RetryButton } from "../../../../components/retry-button";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type {
  CashAccountRow,
  CurrentSession,
  NoteDetailRow,
  PartnerRow,
} from "../../../../lib/api-types";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function NoteDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}): Promise<JSX.Element> {
  const { locale, id } = await params;
  if (!isLocale(locale)) {
    notFound();
  }
  const localeValue = locale as Locale;
  const d = getDictionary(localeValue);

  await requireSessionToken(localeValue);

  const detail = await fetchApi<NoteDetailRow>(`notes/${id}`);
  if (!detail.ok && detail.status === 401) {
    redirect(`/${locale}/login`);
  }
  if (!detail.ok && detail.status === 404) {
    notFound();
  }
  if (!detail.ok) {
    const forbidden = detail.status === 403 || detail.error.code === "FORBIDDEN";
    return (
      <AppShell locale={localeValue} pagePath={`notes/${id}`} title={d.notesTitle}>
        <div className="flex flex-col gap-4">
          <NotesTabs locale={localeValue} active="notes" />
          <ErrorState
            title={
              forbidden
                ? d.errorsForbidden
                : localizedApiError(d, detail.error, detail.retryAfterSeconds)
            }
            retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
          />
        </div>
      </AppShell>
    );
  }

  const [partners, cashAccounts, session] = await Promise.all([
    fetchApi<readonly PartnerRow[]>("partners?limit=500"),
    fetchApi<readonly CashAccountRow[]>("treasury/cash-accounts"),
    fetchApi<CurrentSession>("identity/sessions/current"),
  ]);
  if (
    (!partners.ok && partners.status === 401) ||
    (!cashAccounts.ok && cashAccounts.status === 401) ||
    (!session.ok && session.status === 401)
  ) {
    redirect(`/${locale}/login`);
  }

  const partner =
    partners.ok ? partners.data.find((entry) => entry.id === detail.data.note.partnerId) ?? null : null;

  return (
    <AppShell
      locale={localeValue}
      pagePath={`notes/${id}`}
      title={detail.data.note.number ?? d.notesTitle}
    >
      <div className="flex flex-col gap-4">
        <NotesTabs locale={localeValue} active="notes" />
        <NoteDetail
          locale={localeValue}
          detail={detail.data}
          partner={partner}
          cashAccounts={cashAccounts.ok ? cashAccounts.data : []}
          permissions={session.ok ? session.data.permissions : []}
          today={new Date().toISOString().slice(0, 10)}
        />
      </div>
    </AppShell>
  );
}
