/**
 * /{locale}/budgeting/[id] — the budget grid workspace (PAGE_ARCHETYPES §4
 * variant with fiscal-period columns): server-fetches the version detail
 * (budget + supersede chain) + the grid (periods + lines + live totals)
 * + the account/cost-center/project/branch reference pools (the same
 * routes the accounting pages use — accounting/accounts,
 * accounting/cost-centers, accounting/projects, tenancy/branches); the
 * client workspace owns the DRAFT grid edits, the BR-050 lifecycle
 * actions, the consumption banner and the XLSX export. 404 → notFound;
 * 401 → login; reference 403s degrade to empty pools (the honest scope).
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import { BudgetWorkspace } from "../../../../components/budget-workspace";
import { RetryButton } from "../../../../components/retry-button";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type {
  AccountRow,
  BranchRow,
  BudgetDetailRow,
  BudgetGridResponse,
  BudgetListRow,
  CostCenterRow,
  FiscalYearRow,
  ProjectRow,
} from "../../../../lib/api-types";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function BudgetDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}): Promise<JSX.Element> {
  const { locale, id } = await params;
  if (!isLocale(locale)) {
    notFound();
  }
  const localeValue = locale as Locale;
  const d = getDictionary(localeValue);

  await requireSessionToken(localeValue);

  const detail = await fetchApi<BudgetDetailRow>(`budgeting/budgets/${id}`);
  if (!detail.ok && detail.status === 401) {
    redirect(`/${locale}/login`);
  }
  if (!detail.ok && detail.status === 404) {
    notFound();
  }
  if (!detail.ok) {
    const forbidden = detail.status === 403 || detail.error.code === "FORBIDDEN";
    return (
      <AppShell locale={localeValue} pagePath={`budgeting/${id}`} title={d.budgetsTitle}>
        <ErrorState
          title={
            forbidden
              ? d.errorsForbidden
              : localizedApiError(d, detail.error, detail.retryAfterSeconds)
          }
          retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
        />
      </AppShell>
    );
  }

  const grid = await fetchApi<BudgetGridResponse>(`budgeting/budgets/${id}/grid`);
  if (!grid.ok && grid.status === 401) {
    redirect(`/${locale}/login`);
  }
  if (!grid.ok) {
    return (
      <AppShell locale={localeValue} pagePath={`budgeting/${id}`} title={detail.data.budget.code}>
        <ErrorState
          title={localizedApiError(d, grid.error, grid.retryAfterSeconds)}
          retry={<RetryButton label={d.retryLabel} />}
        />
      </AppShell>
    );
  }

  const [years, accounts, costCenters, projects, branches, siblings] = await Promise.all([
    fetchApi<readonly FiscalYearRow[]>("accounting/fiscal-years"),
    fetchApi<readonly AccountRow[]>("accounting/accounts?limit=500"),
    fetchApi<readonly CostCenterRow[]>("accounting/cost-centers"),
    fetchApi<readonly ProjectRow[]>("accounting/projects"),
    fetchApi<readonly BranchRow[]>("tenancy/branches"),
    // The successor pool: revisions supersede within the same (fiscal
    // year, scope) — the register filter's own vocabulary.
    fetchApi<readonly BudgetListRow[]>(
      `budgeting/budgets?fiscalYearId=${encodeURIComponent(detail.data.budget.fiscalYearId)}&scope=${detail.data.budget.scope}`,
    ),
  ]);
  if (
    (!years.ok && years.status === 401) ||
    (!accounts.ok && accounts.status === 401) ||
    (!costCenters.ok && costCenters.status === 401) ||
    (!projects.ok && projects.status === 401) ||
    (!branches.ok && branches.status === 401) ||
    (!siblings.ok && siblings.status === 401)
  ) {
    redirect(`/${locale}/login`);
  }

  const successors = siblings.ok
    ? siblings.data.filter((row) => row.supersedesId === detail.data.budget.id)
    : [];

  return (
    <AppShell
      locale={localeValue}
      pagePath={`budgeting/${id}`}
      title={detail.data.budget.code}
    >
      <BudgetWorkspace
        locale={localeValue}
        detail={detail.data}
        grid={grid.data}
        successors={successors}
        years={years.ok ? years.data : []}
        accounts={accounts.ok ? accounts.data : []}
        costCenters={costCenters.ok ? costCenters.data : []}
        projects={projects.ok ? projects.data : []}
        branches={branches.ok ? branches.data : []}
      />
    </AppShell>
  );
}
