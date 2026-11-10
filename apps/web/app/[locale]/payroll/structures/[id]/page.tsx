/**
 * /{locale}/payroll/structures/[id] — the structure builder
 * (PAGE_ARCHETYPES §4): server-fetches the structure + its component
 * rows + the postable GL account pool + the tenant base currency (the
 * money field's chip); the client builder owns the component edits, the
 * PUT components replace and the BR-052 version create. 404 → notFound;
 * 401 → login; reference 403s degrade to empty pools.
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../../components/client-ui";

import { AppShell } from "../../../../../components/app-shell";
import { RetryButton } from "../../../../../components/retry-button";
import { StructureBuilder } from "../../../../../components/structure-builder";
import { getDictionary, isLocale, type Locale } from "../../../../../i18n/dictionaries";
import type {
  AccountRow,
  SalaryComponentRow,
  SalaryStructureRow,
  TenantProfile,
} from "../../../../../lib/api-types";
import { localizedApiError } from "../../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../../lib/server-api";

export default async function StructureDetailPage({
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

  const detail = await fetchApi<{ structure: SalaryStructureRow; components: SalaryComponentRow[] }>(
    `payroll/salary-structures/${id}`,
  );
  if (!detail.ok && detail.status === 401) {
    redirect(`/${locale}/login`);
  }
  if (!detail.ok && detail.status === 404) {
    notFound();
  }
  if (!detail.ok) {
    const forbidden = detail.status === 403 || detail.error.code === "FORBIDDEN";
    return (
      <AppShell locale={localeValue} pagePath={`payroll/structures/${id}`} title={d.payStructuresTitle}>
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

  const [accounts, profile] = await Promise.all([
    fetchApi<readonly AccountRow[]>("accounting/accounts?limit=500"),
    fetchApi<TenantProfile>("tenancy/profile"),
  ]);
  if ((!accounts.ok && accounts.status === 401) || (!profile.ok && profile.status === 401)) {
    redirect(`/${locale}/login`);
  }

  return (
    <AppShell locale={localeValue} pagePath={`payroll/structures/${id}`} title={detail.data.structure.code}>
      <StructureBuilder
        locale={localeValue}
        structure={detail.data.structure}
        components={detail.data.components}
        accounts={accounts.ok ? accounts.data : []}
        currency={profile.ok ? profile.data.baseCurrency : "SAR"}
      />
    </AppShell>
  );
}
