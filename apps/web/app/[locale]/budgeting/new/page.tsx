/**
 * /{locale}/budgeting/new — budget registration (PAGE_ARCHETYPES §3,
 * Create/Edit): fiscal year + scope + bilingual name (+ optional note) —
 * the reference list (fiscal years) is fetched server-side; the client
 * form owns the inputs and the create POST through the BFF. The server
 * mints the BUD-<year>-<seq> code and the DRAFT status; the grid entry
 * happens in the workspace the form routes to.
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import { BudgetForm } from "../../../../components/budget-form";
import { RetryButton } from "../../../../components/retry-button";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type { FiscalYearRow } from "../../../../lib/api-types";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function NewBudgetPage({
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

  const years = await fetchApi<readonly FiscalYearRow[]>("accounting/fiscal-years");
  if (!years.ok && years.status === 401) {
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
    content = <BudgetForm locale={localeValue} years={years.data} />;
  }

  return (
    <AppShell locale={localeValue} pagePath="budgeting/new" title={d.budgetsNewTitle}>
      {content}
    </AppShell>
  );
}
