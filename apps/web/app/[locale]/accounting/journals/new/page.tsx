/**
 * /{locale}/accounting/journals/new — the journal entry workspace
 * (PAGE_ARCHETYPES archetype 4, transaction entry): header fields + the
 * @erp/ui JournalEntryGrid pattern with its embedded MoneySummaryBar.
 * Requires accounting.journal_entries.create. Saving creates a DRAFT —
 * posting flows through submit → approve → post from the list.
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../../components/client-ui";

import { AppShell } from "../../../../../components/app-shell";
import { JournalWorkspace } from "../../../../../components/journal-workspace";
import { RetryButton } from "../../../../../components/retry-button";
import { getDictionary, isLocale, type Locale } from "../../../../../i18n/dictionaries";
import type {
  AccountRow,
  CostCenterRow,
  PartnerRow,
  PurposeRow,
  TenantProfile,
} from "../../../../../lib/api-types";
import { localizedApiError } from "../../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../../lib/server-api";

const REFERENCE_LIMIT = 200;

export default async function NewJournalPage({
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

  const [accounts, purposes, partners, costCenters, profile] = await Promise.all([
    fetchApi<readonly AccountRow[]>("accounting/accounts?limit=500"),
    fetchApi<readonly PurposeRow[]>("accounting/purposes"),
    fetchApi<readonly PartnerRow[]>(`partners/partners?limit=${REFERENCE_LIMIT}`),
    fetchApi<readonly CostCenterRow[]>("accounting/cost-centers"),
    // Best effort: the base currency is display-only. Members without
    // tenancy.settings.manage still get a working workspace (currency blank
    // posts in the tenant base by server default).
    fetchApi<TenantProfile>("tenancy/profile"),
  ]);
  if (
    (!accounts.ok && accounts.status === 401) ||
    (!purposes.ok && purposes.status === 401) ||
    (!partners.ok && partners.status === 401)
  ) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!accounts.ok) {
    const forbidden = accounts.status === 403 || accounts.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden
            ? d.errorsForbidden
            : localizedApiError(d, accounts.error, accounts.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    content = (
      <JournalWorkspace
        locale={localeValue}
        accounts={accounts.data}
        partners={partners.ok ? partners.data : []}
        costCenters={costCenters.ok ? costCenters.data : []}
        purposes={purposes.ok ? purposes.data : []}
        baseCurrency={profile.ok ? profile.data.baseCurrency : ""}
      />
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="accounting/journals/new" title={d.accountingJournalsNew}>
      {content}
    </AppShell>
  );
}
