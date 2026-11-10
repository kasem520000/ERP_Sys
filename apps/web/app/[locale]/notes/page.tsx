/**
 * /{locale}/notes — the notes register (PAGE_ARCHETYPES §2, List+Search):
 * server-fetches the register snapshot + the partner reference list; the
 * client table owns the filters and re-fetches through the BFF. Calendar
 * drill-downs land here pre-filtered (maturityFrom/maturityTo/partnerId
 * query params — the API's own filter vocabulary). 403 renders the honest
 * forbidden state; the partner list 403 degrades to empty options.
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../components/client-ui";

import { AppShell } from "../../../components/app-shell";
import { NotesTable } from "../../../components/notes-table";
import { NotesTabs } from "../../../components/notes-tabs";
import { RetryButton } from "../../../components/retry-button";
import { getDictionary, isLocale, type Locale } from "../../../i18n/dictionaries";
import type { NoteListRow, PartnerRow } from "../../../lib/api-types";
import { localizedApiError } from "../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../lib/server-api";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default async function NotesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<JSX.Element> {
  const { locale } = await params;
  const query = await searchParams;
  if (!isLocale(locale)) {
    notFound();
  }
  const localeValue = locale as Locale;
  const d = getDictionary(localeValue);

  await requireSessionToken(localeValue);

  // Calendar drill-down deep links (the pdc bucket/partner cards).
  const single = (key: string): string => {
    const value = query[key];
    return typeof value === "string" ? value : "";
  };
  const filters = {
    kind: "",
    direction: "",
    status: "",
    partnerId: UUID_RE.test(single("partnerId")) ? single("partnerId") : "",
    maturityFrom: DATE_RE.test(single("maturityFrom")) ? single("maturityFrom") : "",
    maturityTo: DATE_RE.test(single("maturityTo")) ? single("maturityTo") : "",
  };

  const search = new URLSearchParams({ limit: "200" });
  if (filters.partnerId !== "") {
    search.set("partnerId", filters.partnerId);
  }
  if (filters.maturityFrom !== "") {
    search.set("maturityFrom", filters.maturityFrom);
  }
  if (filters.maturityTo !== "") {
    search.set("maturityTo", filters.maturityTo);
  }

  const [notes, partners] = await Promise.all([
    fetchApi<readonly NoteListRow[]>(`notes?${search.toString()}`),
    fetchApi<readonly PartnerRow[]>("partners?limit=500"),
  ]);
  if (!notes.ok && notes.status === 401) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!notes.ok) {
    const forbidden = notes.status === 403 || notes.error.code === "FORBIDDEN";
    content = (
      <div className="flex flex-col gap-4">
        <NotesTabs locale={localeValue} active="notes" />
        <ErrorState
          title={
            forbidden
              ? d.errorsForbidden
              : localizedApiError(d, notes.error, notes.retryAfterSeconds)
          }
          retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
        />
      </div>
    );
  } else {
    content = (
      <div className="flex flex-col gap-4">
        <NotesTabs locale={localeValue} active="notes" />
        <NotesTable
          locale={localeValue}
          initialRows={notes.data}
          partners={partners.ok ? partners.data : []}
          initialFilters={filters}
        />
      </div>
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="notes" title={d.notesTitle}>
      {content}
    </AppShell>
  );
}
