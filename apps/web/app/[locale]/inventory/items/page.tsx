/**
 * /{locale}/inventory/items — item master list (requires items.view; 403 →
 * "no permission" state). The server fetches page one plus the category
 * reference list; the client table owns kind/category filters, debounced
 * search and cursor pagination.
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import { ItemsTable } from "../../../../components/items-table";
import { RetryButton } from "../../../../components/retry-button";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type { ItemCategoryRow, ItemRow } from "../../../../lib/api-types";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

const PAGE_LIMIT = 25;

export default async function ItemsPage({
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

  const [items, categories] = await Promise.all([
    fetchApi<readonly ItemRow[]>(`items/items?limit=${PAGE_LIMIT}`),
    fetchApi<readonly ItemCategoryRow[]>("items/item-categories"),
  ]);
  if ((!items.ok && items.status === 401) || (!categories.ok && categories.status === 401)) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!items.ok) {
    const forbidden = items.status === 403 || items.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden
            ? d.errorsForbidden
            : localizedApiError(d, items.error, items.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    content = (
      <ItemsTable
        locale={localeValue}
        initialRows={items.data}
        initialHasMore={items.meta?.hasMore ?? false}
        initialNextCursor={items.meta?.nextCursor}
        categories={categories.ok ? categories.data : []}
      />
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="inventory/items" title={d.navItems}>
      {content}
    </AppShell>
  );
}
