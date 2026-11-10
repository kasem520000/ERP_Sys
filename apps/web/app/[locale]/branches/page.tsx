/**
 * P4-T12a — /{locale}/branches (session, tenancy.branches.manage): branch
 * list with active badges, the create form and per-row activate/deactivate
 * toggles. Data loads through the BFF's internal fetch; mutations go through
 * the BFF proxy from the client components (CSRF double-submit handled by
 * the client wrapper).
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../components/client-ui";

import { AppShell } from "../../../components/app-shell";
import { BranchCreateForm } from "../../../components/branch-create-form";
import { BranchesTable } from "../../../components/branches-table";
import { Card } from "../../../components/card";
import { RetryButton } from "../../../components/retry-button";
import { getDictionary, isLocale, type Locale } from "../../../i18n/dictionaries";
import type { BranchRow } from "../../../lib/api-types";
import { localizedApiError } from "../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../lib/server-api";

export default async function BranchesPage({
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

  const branches = await fetchApi<readonly BranchRow[]>("tenancy/branches");
  if (!branches.ok && branches.status === 401) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!branches.ok) {
    const forbidden = branches.status === 403 || branches.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden
            ? d.errorsForbidden
            : localizedApiError(d, branches.error, branches.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    content = (
      <div className="flex flex-col gap-6">
        <section aria-label={d.branchesTitle} className="flex flex-col gap-2">
          <h2 className="text-md font-semibold text-gray-900">{d.branchesTitle}</h2>
          <BranchesTable locale={localeValue} rows={branches.data} interactive />
        </section>

        <Card title={d.branchesCreateTitle} ariaLabel={d.branchesCreateTitle} className="w-full max-w-xl">
          <BranchCreateForm locale={localeValue} />
        </Card>
      </div>
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="branches" title={d.branchesTitle}>
      {content}
    </AppShell>
  );
}
