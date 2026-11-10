/**
 * /{locale}/notes/reports — the module report page (PAGE_ARCHETYPES §7):
 * the PHASE-013 report workspace reused with the module prefix — the
 * registry snapshot is filtered to the `notes.*` keys; the run history
 * scopes to the same prefix. Until the reporting module registers the
 * notes contracts, the page renders the honest empty note (never a
 * fabricated catalog).
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import { InfoNotice } from "../../../../components/notices";
import { NotesTabs } from "../../../../components/notes-tabs";
import { ReportWorkspace } from "../../../../components/report-workspace";
import { RetryButton } from "../../../../components/retry-button";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type {
  CurrentSession,
  ReportRegistryItem,
  ReportRunSummary,
} from "../../../../lib/api-types";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

const REPORT_KEY_PREFIX = "notes.";

export default async function NotesReportsPage({
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

  const [registry, runs, session] = await Promise.all([
    fetchApi<readonly ReportRegistryItem[]>("reporting/reports"),
    fetchApi<readonly ReportRunSummary[]>("reporting/report-runs?limit=20"),
    fetchApi<CurrentSession>("identity/sessions/current"),
  ]);
  if (
    (!registry.ok && registry.status === 401) ||
    (!runs.ok && runs.status === 401) ||
    (!session.ok && session.status === 401)
  ) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!registry.ok) {
    const forbidden = registry.status === 403 || registry.error.code === "FORBIDDEN";
    content = (
      <div className="flex flex-col gap-4">
        <NotesTabs locale={localeValue} active="reports" />
        <ErrorState
          title={
            forbidden
              ? d.errorsForbidden
              : localizedApiError(d, registry.error, registry.retryAfterSeconds)
          }
          retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
        />
      </div>
    );
  } else {
    const moduleRegistry = registry.data.filter((item) =>
      item.id.startsWith(REPORT_KEY_PREFIX),
    );
    const moduleRuns = (runs.ok ? runs.data : []).filter((row) =>
      row.reportKey.startsWith(REPORT_KEY_PREFIX),
    );
    content = (
      <div className="flex flex-col gap-4">
        <NotesTabs locale={localeValue} active="reports" />
        <p className="text-sm text-gray-600">{d.notesReportsHint}</p>
        {moduleRegistry.length === 0 ? (
          <InfoNotice>{d.notesReportsEmpty}</InfoNotice>
        ) : (
          <ReportWorkspace
            locale={localeValue}
            registry={moduleRegistry}
            initialRuns={moduleRuns}
            permissions={session.ok ? session.data.permissions : []}
            canExport={
              session.ok ? session.data.permissions.includes("reporting.reports.export") : false
            }
            reportKeyPrefix={REPORT_KEY_PREFIX}
          />
        )}
      </div>
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="notes/reports" title={d.notesReportsTitle}>
      {content}
    </AppShell>
  );
}
