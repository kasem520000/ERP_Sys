/**
 * /{locale}/fixed-assets — the asset register (PAGE_ARCHETYPES §2,
 * List+Search): server-fetches the register snapshot + reference lists
 * (categories, branches, users); the client table owns the debounced
 * search + filters and re-fetches through the BFF. 403 renders the honest
 * forbidden state; reference-list 403s degrade to empty options.
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../components/client-ui";

import { AppShell } from "../../../components/app-shell";
import { FixedAssetsTable } from "../../../components/fixed-assets-table";
import { FixedAssetsTabs } from "../../../components/fixed-assets-tabs";
import { RetryButton } from "../../../components/retry-button";
import { getDictionary, isLocale, type Locale } from "../../../i18n/dictionaries";
import type {
  BranchRow,
  FixedAssetCategoryRow,
  FixedAssetListRow,
  TenantUserRow,
} from "../../../lib/api-types";
import { localizedApiError } from "../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../lib/server-api";

export default async function FixedAssetsPage({
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

  const [assets, categories, branches, users] = await Promise.all([
    fetchApi<readonly FixedAssetListRow[]>("fixed-assets/assets?limit=200"),
    fetchApi<readonly FixedAssetCategoryRow[]>("fixed-assets/categories"),
    fetchApi<readonly BranchRow[]>("tenancy/branches"),
    fetchApi<readonly TenantUserRow[]>("identity/users"),
  ]);
  if (!assets.ok && assets.status === 401) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!assets.ok) {
    const forbidden = assets.status === 403 || assets.error.code === "FORBIDDEN";
    content = (
      <div className="flex flex-col gap-4">
        <FixedAssetsTabs locale={localeValue} active="assets" />
        <ErrorState
          title={
            forbidden
              ? d.errorsForbidden
              : localizedApiError(d, assets.error, assets.retryAfterSeconds)
          }
          retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
        />
      </div>
    );
  } else {
    content = (
      <div className="flex flex-col gap-4">
        <FixedAssetsTabs locale={localeValue} active="assets" />
        <FixedAssetsTable
          locale={localeValue}
          initialRows={assets.data}
          categories={categories.ok ? categories.data : []}
          branches={branches.ok ? branches.data : []}
          users={users.ok ? users.data : []}
        />
      </div>
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="fixed-assets" title={d.faTitle}>
      {content}
    </AppShell>
  );
}
