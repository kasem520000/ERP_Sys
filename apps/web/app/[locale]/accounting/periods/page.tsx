/**
 * /{locale}/accounting/periods — fiscal calendar management (requires
 * accounting.journal_entries.view): years + generated periods, state
 * actions (soft-close/lock/reopen with reason — INV-020), the live close
 * checklist (PC-04 gate), AR/AP reconciliation runs, and the year-end
 * close actions.
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AccountingPeriods } from "../../../../components/accounting-periods";
import { AppShell } from "../../../../components/app-shell";
import { RetryButton } from "../../../../components/retry-button";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type { FiscalYearRow, ReconciliationRunRow } from "../../../../lib/api-types";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function PeriodsPage({
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

  const [years, runs] = await Promise.all([
    fetchApi<readonly FiscalYearRow[]>("accounting/fiscal-years"),
    fetchApi<readonly ReconciliationRunRow[]>("accounting/reconciliation/runs"),
  ]);
  if ((!years.ok && years.status === 401) || (!runs.ok && runs.status === 401)) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!years.ok) {
    const forbidden = years.status === 403 || years.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden
            ? d.errorsForbidden
            : localizedApiError(d, years.error, years.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    content = (
      <AccountingPeriods
        locale={localeValue}
        initialYears={years.data}
        initialRuns={runs.ok ? runs.data : []}
      />
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="accounting/periods" title={d.accountingPeriodsTitle}>
      {content}
    </AppShell>
  );
}
