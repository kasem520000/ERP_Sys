/**
 * /{locale}/accounting/journals — journal entries list + recurring section
 * (requires accounting.journal_entries.view). The server loads the first
 * page of manual journals (all statuses) + the recurring definitions; the
 * client panel owns the lifecycle actions (submit/approve/post/reverse/
 * cancel are permission-checked server-side; buttons that need permissions
 * the viewer lacks simply fail with a localized error from the API).
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AccountingJournalsTable } from "../../../../components/accounting-journals-table";
import { AppShell } from "../../../../components/app-shell";
import { RetryButton } from "../../../../components/retry-button";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type { CurrentSession, ManualJournalRow, RecurringJournalRow } from "../../../../lib/api-types";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function JournalsPage({
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

  const [entries, recurring, session] = await Promise.all([
    fetchApi<readonly ManualJournalRow[]>("accounting/journal-entries?limit=100"),
    fetchApi<readonly RecurringJournalRow[]>("accounting/recurring-journals"),
    fetchApi<CurrentSession>("identity/sessions/current"),
  ]);
  if (
    (!entries.ok && entries.status === 401) ||
    (!recurring.ok && recurring.status === 401) ||
    (!session.ok && session.status === 401)
  ) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!entries.ok) {
    const forbidden = entries.status === 403 || entries.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden
            ? d.errorsForbidden
            : localizedApiError(d, entries.error, entries.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    const permissions = session.ok ? session.data.permissions : [];
    content = (
      <AccountingJournalsTable
        locale={localeValue}
        initialRows={entries.data}
        recurringRows={recurring.ok ? recurring.data : []}
        canApprove={permissions.includes("accounting.journal_entries.approve")}
        canPost={permissions.includes("accounting.journal_entries.post")}
        canReverse={permissions.includes("accounting.journal_entries.reverse")}
      />
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="accounting/journals" title={d.accountingJournalsTitle}>
      {content}
    </AppShell>
  );
}
