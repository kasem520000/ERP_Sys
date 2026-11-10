/**
 * /{locale}/fixed-assets/[id] — asset detail (PAGE_ARCHETYPES §5): the
 * overview + financial DefLists, the append-only depreciation history
 * (reversed runs marked), and the lifecycle actions (capitalize G-21 while
 * the source is missing, revaluate, dispose → the wizard). 404 → notFound;
 * 401 → login; reference 403s degrade.
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import { FixedAssetDetail } from "../../../../components/fixed-asset-detail";
import { FixedAssetsTabs } from "../../../../components/fixed-assets-tabs";
import { RetryButton } from "../../../../components/retry-button";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type {
  BranchRow,
  FixedAssetCategoryRow,
  FixedAssetDetailRow,
  PartnerRow,
  TenantProfile,
  TenantUserRow,
} from "../../../../lib/api-types";
import { localizedName, localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function FixedAssetDetailPage({
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
      <AppShell locale={localeValue} pagePath={`fixed-assets/${id}`} title={d.faTitle}>
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
  const [categories, users, partners, profile, branch] = await Promise.all([
    fetchApi<readonly FixedAssetCategoryRow[]>("fixed-assets/categories"),
    fetchApi<readonly TenantUserRow[]>("identity/users"),
    fetchApi<readonly PartnerRow[]>("partners/partners?limit=200"),
    fetchApi<TenantProfile>("tenancy/profile"),
    fetchApi<readonly BranchRow[]>("tenancy/branches"),
  ]);
  if (
    (!categories.ok && categories.status === 401) ||
    (!users.ok && users.status === 401) ||
    (!partners.ok && partners.status === 401) ||
    (!profile.ok && profile.status === 401)
  ) {
    redirect(`/${locale}/login`);
  }

  const category = categories.ok
    ? categories.data.find((entry) => entry.id === row.categoryId) ?? null
    : null;
  const custodian = users.ok
    ? users.data.find((entry) => entry.userId === row.custodianUserId) ?? null
    : null;
  const branchRow = branch.ok
    ? branch.data.find((entry) => entry.id === row.branchId) ?? null
    : null;

  return (
    <AppShell
      locale={localeValue}
      pagePath={`fixed-assets/${id}`}
      title={localizedName(row.name, row.nameAr, localeValue)}
    >
      <div className="flex flex-col gap-4">
        <FixedAssetsTabs locale={localeValue} active="assets" />
        <FixedAssetDetail
          locale={localeValue}
          detail={row}
          category={category}
          branch={branchRow}
          custodian={custodian}
          partners={partners.ok ? partners.data : []}
          baseCurrency={profile.ok ? profile.data.baseCurrency : ""}
        />
      </div>
    </AppShell>
  );
}
