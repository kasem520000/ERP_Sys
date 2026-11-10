/**
 * /{locale}/fixed-assets/new — asset creation (PAGE_ARCHETYPES §3,
 * Create/Edit): reference lists server-side; the client form owns the
 * category-driven defaults (life/method, UoP units), exact money inputs
 * and the create POST through the BFF.
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import { FixedAssetForm } from "../../../../components/fixed-asset-form";
import { FixedAssetsTabs } from "../../../../components/fixed-assets-tabs";
import { RetryButton } from "../../../../components/retry-button";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type {
  BranchRow,
  FixedAssetCategoryRow,
  TenantUserRow,
  TenantProfile,
} from "../../../../lib/api-types";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function NewFixedAssetPage({
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

  let content: JSX.Element;
  if (!categories.ok) {
    const forbidden = categories.status === 403 || categories.error.code === "FORBIDDEN";
    content = (
      <div className="flex flex-col gap-4">
        <FixedAssetsTabs locale={localeValue} active="assets" />
        <ErrorState
          title={
            forbidden
              ? d.errorsForbidden
              : localizedApiError(d, categories.error, categories.retryAfterSeconds)
          }
          retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
        />
      </div>
    );
  } else {
    content = (
      <div className="flex flex-col gap-4">
        <FixedAssetsTabs locale={localeValue} active="assets" />
        <FixedAssetForm
          locale={localeValue}
          mode="create"
          categories={categories.data}
          branches={branches.ok ? branches.data : []}
          users={users.ok ? users.data : []}
          baseCurrency={profile.ok ? profile.data.baseCurrency : ""}
          today={new Date().toISOString().slice(0, 10)}
        />
      </div>
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="fixed-assets/new" title={d.faFormTitleCreate}>
      {content}
    </AppShell>
  );
}
