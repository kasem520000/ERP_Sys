/**
 * /{locale}/fixed-assets/[id]/edit — asset edit (PAGE_ARCHETYPES §3):
 * the mutable set only (name/nameAr/branch/custodian/notes); the basis
 * fields render read-only (faFormImmutableHint) — corrections are
 * reversal-only through the engine.
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../../components/client-ui";

import { AppShell } from "../../../../../components/app-shell";
import { FixedAssetForm } from "../../../../../components/fixed-asset-form";
import { FixedAssetsTabs } from "../../../../../components/fixed-assets-tabs";
import { RetryButton } from "../../../../../components/retry-button";
import { getDictionary, isLocale, type Locale } from "../../../../../i18n/dictionaries";
import type {
  BranchRow,
  FixedAssetCategoryRow,
  FixedAssetDetailRow,
  TenantProfile,
  TenantUserRow,
} from "../../../../../lib/api-types";
import { localizedName, localizedApiError } from "../../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../../lib/server-api";

export default async function EditFixedAssetPage({
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

  const detail = await fetchApi<FixedAssetDetailRow>(`fixed-assets/assets/${id}`);
  if (!detail.ok && detail.status === 401) {
    redirect(`/${locale}/login`);
  }
  if (!detail.ok && detail.status === 404) {
    notFound();
  }
  if (!detail.ok) {
    const forbidden = detail.status === 403 || detail.error.code === "FORBIDDEN";
    return (
      <AppShell locale={localeValue} pagePath={`fixed-assets/${id}/edit`} title={d.faFormTitleEdit}>
        <div className="flex flex-col gap-4">
          <FixedAssetsTabs locale={localeValue} active="assets" />
          <ErrorState
            title={
              forbidden
                ? d.errorsForbidden
                : localizedApiError(d, detail.error, detail.retryAfterSeconds)
            }
            retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
          />
        </div>
      </AppShell>
    );
  }

  const row = detail.data;
  const [categories, branches, users, profile] = await Promise.all([
    fetchApi<readonly FixedAssetCategoryRow[]>("fixed-assets/categories"),
    fetchApi<readonly BranchRow[]>("tenancy/branches"),
    fetchApi<readonly TenantUserRow[]>("identity/users"),
    fetchApi<TenantProfile>("tenancy/profile"),
  ]);
  if (
    (!categories.ok && categories.status === 401) ||
    (!branches.ok && branches.status === 401) ||
    (!users.ok && users.status === 401) ||
    (!profile.ok && profile.status === 401)
  ) {
    redirect(`/${locale}/login`);
  }

  return (
    <AppShell
      locale={localeValue}
      pagePath={`fixed-assets/${id}/edit`}
      title={d.faFormTitleEdit}
    >
      <div className="flex flex-col gap-4">
        <FixedAssetsTabs locale={localeValue} active="assets" />
        <FixedAssetForm
          locale={localeValue}
          mode="edit"
          asset={row}
          categories={categories.ok ? categories.data : []}
          branches={branches.ok ? branches.data : []}
          users={users.ok ? users.data : []}
          baseCurrency={profile.ok ? profile.data.baseCurrency : ""}
          today={row.acquisitionDate}
        />
        <p className="text-sm text-gray-600">
          {localizedName(row.name, row.nameAr, localeValue)}
        </p>
      </div>
    </AppShell>
  );
}
