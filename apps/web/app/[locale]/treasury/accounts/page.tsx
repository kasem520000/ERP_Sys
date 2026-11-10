/**
 * /{locale}/treasury/accounts — cash/bank/petty accounts (requires
 * treasury.accounts.view for the list; treasury.accounts.manage for
 * open/close — enforced server-side). The GL account picker and branch
 * select load best-effort so members without accounting/tenancy grants
 * still get a working read-only list.
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import { RetryButton } from "../../../../components/retry-button";
import { TreasuryAccounts } from "../../../../components/treasury-accounts";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type { AccountRow, BranchRow, CashAccountRow, CurrentSession } from "../../../../lib/api-types";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function TreasuryAccountsPage({
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

  const [accounts, glAccounts, branches, session] = await Promise.all([
    fetchApi<readonly CashAccountRow[]>("treasury/cash-accounts"),
    fetchApi<readonly AccountRow[]>("accounting/accounts?limit=500"),
    fetchApi<readonly BranchRow[]>("tenancy/branches"),
    fetchApi<CurrentSession>("identity/sessions/current"),
  ]);
  if (
    (!accounts.ok && accounts.status === 401) ||
    (!session.ok && session.status === 401)
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
    const permissions = session.ok ? session.data.permissions : [];
    content = (
      <TreasuryAccounts
        locale={localeValue}
        initialAccounts={accounts.data}
        glAccounts={glAccounts.ok ? glAccounts.data : []}
        branches={branches.ok ? branches.data : []}
        canManage={permissions.includes("treasury.accounts.manage")}
      />
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="treasury/accounts" title={d.treasuryAccountsTitle}>
      {content}
    </AppShell>
  );
}
