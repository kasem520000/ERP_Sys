/**
 * /{locale}/treasury/shifts — cashier shifts (requires
 * treasury.shifts.manage on every route — the whole screen is one
 * permission family). The OPEN shift auto-selects into the ShiftPanel.
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import { RetryButton } from "../../../../components/retry-button";
import { TreasuryShifts } from "../../../../components/treasury-shifts";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type { CashAccountRow, ShiftRow } from "../../../../lib/api-types";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function TreasuryShiftsPage({
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

  const [shifts, cashAccounts] = await Promise.all([
    fetchApi<readonly ShiftRow[]>("treasury/shifts"),
    fetchApi<readonly CashAccountRow[]>("treasury/cash-accounts"),
  ]);
  if (!shifts.ok && shifts.status === 401) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!shifts.ok) {
    const forbidden = shifts.status === 403 || shifts.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden
            ? d.errorsForbidden
            : localizedApiError(d, shifts.error, shifts.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    content = (
      <TreasuryShifts
        locale={localeValue}
        initialRows={shifts.data}
        cashAccounts={cashAccounts.ok ? cashAccounts.data : []}
      />
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="treasury/shifts" title={d.treasuryShiftsTitle}>
      {content}
    </AppShell>
  );
}
