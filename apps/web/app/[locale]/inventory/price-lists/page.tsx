/**
 * /{locale}/inventory/price-lists — price-list workbench (requires
 * items.view; 403 → "no permission" state). The server fetches page one plus
 * the UoM registry and the first 100 items (picker options + row labels);
 * the client editor owns the kind filter, create form and rows editor.
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import { PriceListEditor } from "../../../../components/price-list-editor";
import { RetryButton } from "../../../../components/retry-button";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type { ItemRow, PriceListRow, UomRow } from "../../../../lib/api-types";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

const PAGE_LIMIT = 25;
const PICKER_ITEM_LIMIT = 100;

export default async function PriceListsPage({
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

  const [priceLists, uoms, items] = await Promise.all([
    fetchApi<readonly PriceListRow[]>(`items/price-lists?limit=${PAGE_LIMIT}`),
    fetchApi<readonly UomRow[]>("items/uoms"),
    fetchApi<readonly ItemRow[]>(`items/items?limit=${PICKER_ITEM_LIMIT}`),
  ]);
  if (
    (!priceLists.ok && priceLists.status === 401) ||
    (!uoms.ok && uoms.status === 401) ||
    (!items.ok && items.status === 401)
  ) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!priceLists.ok) {
    const forbidden = priceLists.status === 403 || priceLists.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden
            ? d.errorsForbidden
            : localizedApiError(d, priceLists.error, priceLists.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    content = (
      <PriceListEditor
        locale={localeValue}
        initialLists={priceLists.data}
        initialHasMore={priceLists.meta?.hasMore ?? false}
        initialNextCursor={priceLists.meta?.nextCursor}
        uoms={uoms.ok ? uoms.data : []}
        items={items.ok ? items.data : []}
      />
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="inventory/price-lists" title={d.navPriceLists}>
      {content}
    </AppShell>
  );
}
