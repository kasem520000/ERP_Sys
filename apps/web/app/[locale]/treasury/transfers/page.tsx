/**
 * /{locale}/treasury/transfers — cash transfers between accounts (requires
 * treasury.transfers.create for list + create; approve/post additionally
 * permission-checked server-side).
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import { RetryButton } from "../../../../components/retry-button";
import { TreasuryTransfers } from "../../../../components/treasury-transfers";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type { CashAccountRow, CurrentSession, TransferRow } from "../../../../lib/api-types";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function TreasuryTransfersPage({
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

  const [transfers, cashAccounts, session] = await Promise.all([
    fetchApi<readonly TransferRow[]>("treasury/cash-transfers"),
    fetchApi<readonly CashAccountRow[]>("treasury/cash-accounts"),
    fetchApi<CurrentSession>("identity/sessions/current"),
  ]);
  if (!transfers.ok && transfers.status === 401) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!transfers.ok) {
    const forbidden = transfers.status === 403 || transfers.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden
            ? d.errorsForbidden
            : localizedApiError(d, transfers.error, transfers.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    const permissions = session.ok ? session.data.permissions : [];
    content = (
      <TreasuryTransfers
        locale={localeValue}
        initialRows={transfers.data}
        cashAccounts={cashAccounts.ok ? cashAccounts.data : []}
        canCreate={permissions.includes("treasury.transfers.create")}
        canApprove={permissions.includes("treasury.transfers.approve")}
      />
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="treasury/transfers" title={d.treasuryTransfersTitle}>
      {content}
    </AppShell>
  );
}
