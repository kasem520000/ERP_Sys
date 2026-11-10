/**
 * /{locale}/budgeting/import — the XLSX grid import wizard
 * (PAGE_ARCHETYPES §9): server-fetches the DRAFT budget set (the import
 * replaces a draft's grid whole — non-DRAFT parents are immutable,
 * BR-050) and renders the client wizard (file → base64 → dry-run report
 * → commit). The workspace's deep link lands here preselecting the draft
 * via /budgeting/import?budgetId=….
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import { BudgetImportWizard } from "../../../../components/budget-import-wizard";
import { InfoNotice } from "../../../../components/notices";
import { RetryButton } from "../../../../components/retry-button";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type { BudgetListRow } from "../../../../lib/api-types";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function BudgetImportPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<JSX.Element> {
  const { locale } = await params;
  const query = await searchParams;
  if (!isLocale(locale)) {
    notFound();
  }
  const localeValue = locale as Locale;
  const d = getDictionary(localeValue);

  await requireSessionToken(localeValue);

  // The workspace's preselect deep link (budgeting/[id] → import grid).
  const raw = query.budgetId;
  const budgetId = typeof raw === "string" && UUID_RE.test(raw) ? raw : "";

  const budgets = await fetchApi<readonly BudgetListRow[]>("budgeting/budgets?status=DRAFT");
  if (!budgets.ok && budgets.status === 401) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!budgets.ok) {
    const forbidden = budgets.status === 403 || budgets.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden
            ? d.errorsForbidden
            : localizedApiError(d, budgets.error, budgets.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else if (budgets.data.length === 0) {
    content = <InfoNotice>{d.budgetImportNoDrafts}</InfoNotice>;
  } else {
    content = (
      <BudgetImportWizard locale={localeValue} budgets={budgets.data} initialBudgetId={budgetId} />
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="budgeting/import" title={d.budgetsImportTitle}>
      {content}
    </AppShell>
  );
}
