/**
 * /{locale}/accounting/journals/[id] — journal detail: the draft document
 * with its lines and lifecycle actions (submit/approve/post from here for
 * a single entry), or — once posted — the immutable ledger entry view via
 * the GL drill-down endpoint (lines + source chain, INV-006).
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../../components/client-ui";

import { AppShell } from "../../../../../components/app-shell";
import { JournalDetailPanel } from "../../../../../components/journal-detail-panel";
import { RetryButton } from "../../../../../components/retry-button";
import { getDictionary, isLocale, type Locale } from "../../../../../i18n/dictionaries";
import type {
  AccountRow,
  CurrentSession,
  JournalEntryRow,
  JournalLineRow,
  ManualJournalRow,
} from "../../../../../lib/api-types";
import { localizedApiError } from "../../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../../lib/server-api";

export default async function JournalDetailPage({
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

  const [draft, entry, accounts, session] = await Promise.all([
    fetchApi<{ draft: ManualJournalRow; lines: Array<{ direction: string; amount: string; accountId: string; memo: string | null }> }>(
      `accounting/journal-entries/${id}`,
    ),
    // Posted view through the GL drill-down (works once the id is a ledger entry).
    fetchApi<{ entry: JournalEntryRow; lines: JournalLineRow[] }>(`accounting/gl/entries/${id}`),
    fetchApi<readonly AccountRow[]>("accounting/accounts?limit=500"),
    fetchApi<CurrentSession>("identity/sessions/current"),
  ]);
  if (
    (!draft.ok && draft.status === 401) ||
    (!entry.ok && entry.status === 401) ||
    (!session.ok && session.status === 401)
  ) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!draft.ok) {
    const forbidden = draft.status === 403 || draft.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden
            ? d.errorsForbidden
            : localizedApiError(d, draft.error, draft.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    const permissions = session.ok ? session.data.permissions : [];
    content = (
      <JournalDetailPanel
        locale={localeValue}
        journalId={id}
        draft={draft.data.draft}
        draftLines={draft.data.lines}
        posted={entry.ok ? entry.data : null}
        accounts={accounts.ok ? accounts.data : []}
        canApprove={permissions.includes("accounting.journal_entries.approve")}
        canPost={permissions.includes("accounting.journal_entries.post")}
        canReverse={permissions.includes("accounting.journal_entries.reverse")}
      />
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="accounting/journals" title={d.accountingPreviewTitle}>
      {content}
    </AppShell>
  );
}
