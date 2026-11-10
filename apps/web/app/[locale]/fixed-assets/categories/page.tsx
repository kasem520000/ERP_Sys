/**
 * /{locale}/fixed-assets/categories — the categories manager (PAGE_ARCHETYPES
 * §8, Settings): the list + create + edit forms server-seeded; the in-use
 * indicator is derived from the register snapshot (the asset list fetch —
 * a 403 there degrades to "no in-use badges", never a fabricated count).
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import { FixedAssetCategories } from "../../../../components/fixed-asset-categories";
import { FixedAssetsTabs } from "../../../../components/fixed-assets-tabs";
import { RetryButton } from "../../../../components/retry-button";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type { FixedAssetCategoryRow, FixedAssetListRow } from "../../../../lib/api-types";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function FixedAssetCategoriesPage({
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

  const [categories, assets] = await Promise.all([
    fetchApi<readonly FixedAssetCategoryRow[]>("fixed-assets/categories"),
    fetchApi<readonly FixedAssetListRow[]>("fixed-assets/assets?limit=200"),
  ]);
  if (!categories.ok && categories.status === 401) {
    redirect(`/${locale}/login`);
  }
  if (!assets.ok && assets.status === 401) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!categories.ok) {
    const forbidden = categories.status === 403 || categories.error.code === "FORBIDDEN";
    content = (
      <div className="flex flex-col gap-4">
        <FixedAssetsTabs locale={localeValue} active="categories" />
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
        <FixedAssetsTabs locale={localeValue} active="categories" />
        <FixedAssetCategories
          locale={localeValue}
          initialCategories={categories.data}
          usedCategoryIds={(assets.ok ? assets.data : []).map((asset) => asset.categoryId)}
        />
      </div>
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="fixed-assets/categories" title={d.faCategoriesTitle}>
      {content}
    </AppShell>
  );
}
