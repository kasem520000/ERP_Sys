/**
 * /{locale}/sales/commissions — commission runs + per-rep rules
 * (PHASE-017 T14 9a-dist): a run computes every line on ONE basis
 * (INVOICED or COLLECTED — basis-mismatched reps are excluded with a zero
 * note-line), and posting is the accrual point: ONE journal (DR
 * COMMISSION_EXPENSE per rep · CR COMMISSION_ACCRUAL). POSTED runs are
 * immutable — corrections reverse the accrual journal, never a recompute.
 * Runs are the primary resource — 403 renders the forbidden state.
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import { Commissions } from "../../../../components/commissions";
import { RetryButton } from "../../../../components/retry-button";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type { CommissionRunRow, SalesRepRow } from "../../../../lib/api-types";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function CommissionsPage({
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

  const [runs, reps] = await Promise.all([
    fetchApi<readonly CommissionRunRow[]>("sales/commission-runs"),
    fetchApi<readonly SalesRepRow[]>("sales/reps"),
  ]);
  if (!runs.ok && runs.status === 401) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!runs.ok) {
    const forbidden = runs.status === 403 || runs.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden
            ? d.errorsForbidden
            : localizedApiError(d, runs.error, runs.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    content = (
      <Commissions
        locale={localeValue}
        initialRuns={runs.data}
        reps={reps.ok ? reps.data : []}
      />
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="sales/commissions" title={d.commissionsTitle}>
      {content}
    </AppShell>
  );
}
