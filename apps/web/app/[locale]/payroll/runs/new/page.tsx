/**
 * /{locale}/payroll/runs/new — payroll run create (PAGE_ARCHETYPES §3):
 * fiscal year + REGULAR period (+ optional bilingual note); the initial
 * year's period list rides the server fetch, later year switches reload
 * through the BFF (the client form). The server enforces one live run
 * per period (the monthly law) with the typed mirror.
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../../components/client-ui";

import { AppShell } from "../../../../../components/app-shell";
import { RetryButton } from "../../../../../components/retry-button";
import { RunForm } from "../../../../../components/run-form";
import { getDictionary, isLocale, type Locale } from "../../../../../i18n/dictionaries";
import type { FiscalPeriodRow, FiscalYearRow } from "../../../../../lib/api-types";
import { localizedApiError } from "../../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../../lib/server-api";

export default async function NewRunPage({
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
    // The initial year's periods ride the server fetch (year switches in
    // the client form reload through the BFF).
    const initialYear = years.data[0];
    const periods =
      initialYear === undefined
        ? await Promise.resolve<{ ok: true; data: readonly FiscalPeriodRow[] }>({
            ok: true,
            data: [],
          })
        : await fetchApi<readonly FiscalPeriodRow[]>(
            `accounting/fiscal-years/${initialYear.id}/periods`,
          );
    if (!periods.ok && periods.status === 401) {
      redirect(`/${locale}/login`);
    }
    content = (
      <RunForm
        locale={localeValue}
        years={years.data}
        initialPeriods={periods.ok ? periods.data : []}
      />
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="payroll/runs/new" title={d.payRunNew}>
      {content}
    </AppShell>
  );
}
