/**
 * /{locale}/accounting/accounts — chart of accounts editor (requires
 * accounting.accounts.view; 403 → "no permission" state): the account tree
 * + the purpose-mapping panel (fail-closed resolution substrate).
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AccountingAccounts } from "../../../../components/accounting-accounts";
import { AppShell } from "../../../../components/app-shell";
import { RetryButton } from "../../../../components/retry-button";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type { AccountRow, PurposeRow } from "../../../../lib/api-types";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function AccountingAccountsPage({
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

  const [accounts, purposes] = await Promise.all([
    fetchApi<readonly AccountRow[]>("accounting/accounts?limit=500"),
    fetchApi<readonly PurposeRow[]>("accounting/purposes"),
  ]);
  if (
    (!accounts.ok && accounts.status === 401) ||
    (!purposes.ok && purposes.status === 401)
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
      <AccountingAccounts
        locale={localeValue}
        initialAccounts={accounts.data}
        initialPurposes={purposes.ok ? purposes.data : []}
      />
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="accounting/accounts" title={d.accountingCoaTitle}>
      {content}
    </AppShell>
  );
}
