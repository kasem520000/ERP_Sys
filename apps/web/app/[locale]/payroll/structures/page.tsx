/**
 * /{locale}/payroll/structures — the salary-structures register
 * (PAGE_ARCHETYPES §2, the settings archetype): server-fetches the
 * BR-052 version register; the client surface owns the inline create +
 * the table. 403 renders the honest forbidden state.
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import { RetryButton } from "../../../../components/retry-button";
import { SalaryStructures } from "../../../../components/salary-structures";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type { SalaryStructureRow } from "../../../../lib/api-types";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function PayrollStructuresPage({
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

  const structures = await fetchApi<readonly SalaryStructureRow[]>("payroll/salary-structures");
  if (!structures.ok && structures.status === 401) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!structures.ok) {
    const forbidden = structures.status === 403 || structures.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden
            ? d.errorsForbidden
            : localizedApiError(d, structures.error, structures.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    content = <SalaryStructures locale={localeValue} initialRows={structures.data} />;
  }

  return (
    <AppShell locale={localeValue} pagePath="payroll/structures" title={d.payStructuresTitle}>
      {content}
    </AppShell>
  );
}
