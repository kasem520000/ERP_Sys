/**
 * /{locale}/treasury/bank-rec — the bank reconciliation wizard (requires
 * treasury.bank_reconciliation.manage on every route): statement import →
 * statements list → match workspace + aging + reconcile, plus the INV-019
 * on-demand cash check.
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import { RetryButton } from "../../../../components/retry-button";
import { TreasuryBankRec } from "../../../../components/treasury-bank-rec";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type {
  CashAccountRow,
  ImportAdapterRow,
  StatementRow,
} from "../../../../lib/api-types";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function TreasuryBankRecPage({
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

  const [statements, cashAccounts, adapters] = await Promise.all([
    fetchApi<readonly StatementRow[]>("treasury/bank-statements"),
    fetchApi<readonly CashAccountRow[]>("treasury/cash-accounts"),
    fetchApi<readonly ImportAdapterRow[]>("treasury/import-adapters"),
  ]);
  if (!statements.ok && statements.status === 401) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!statements.ok) {
    const forbidden = statements.status === 403 || statements.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden
            ? d.errorsForbidden
            : localizedApiError(d, statements.error, statements.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    content = (
      <TreasuryBankRec
        locale={localeValue}
        cashAccounts={cashAccounts.ok ? cashAccounts.data : []}
        adapters={adapters.ok ? adapters.data : []}
        initialStatements={statements.data}
      />
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="treasury/bank-rec" title={d.treasuryBankRecTitle}>
      {content}
    </AppShell>
  );
}
