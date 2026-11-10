/**
 * /{locale}/treasury/expenses — expense claims + category management
 * (requires treasury.expenses.view for the lists; create/approve/post are
 * permission-checked server-side and gate the forms/actions client-side).
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import { RetryButton } from "../../../../components/retry-button";
import { TreasuryExpenses } from "../../../../components/treasury-expenses";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type {
  AccountRow,
  CashAccountRow,
  CurrentSession,
  ExpenseCategoryRow,
  ExpenseRow,
} from "../../../../lib/api-types";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function TreasuryExpensesPage({
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

  const [categories, expenses, cashAccounts, glAccounts, session] = await Promise.all([
    fetchApi<readonly ExpenseCategoryRow[]>("treasury/expense-categories?includeInactive=true"),
    fetchApi<readonly ExpenseRow[]>("treasury/expenses"),
    fetchApi<readonly CashAccountRow[]>("treasury/cash-accounts"),
    fetchApi<readonly AccountRow[]>("accounting/accounts?limit=500"),
    fetchApi<CurrentSession>("identity/sessions/current"),
  ]);
  if (
    (!expenses.ok && expenses.status === 401) ||
    (!categories.ok && categories.status === 401)
  ) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!expenses.ok) {
    const forbidden = expenses.status === 403 || expenses.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden
            ? d.errorsForbidden
            : localizedApiError(d, expenses.error, expenses.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    const permissions = session.ok ? session.data.permissions : [];
    content = (
      <TreasuryExpenses
        locale={localeValue}
        initialCategories={categories.ok ? categories.data : []}
        initialExpenses={expenses.data}
        cashAccounts={cashAccounts.ok ? cashAccounts.data : []}
        glAccounts={glAccounts.ok ? glAccounts.data : []}
        canCreate={permissions.includes("treasury.expenses.create")}
        canApprove={permissions.includes("treasury.expenses.approve")}
      />
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="treasury/expenses" title={d.treasuryExpensesTitle}>
      {content}
    </AppShell>
  );
}
