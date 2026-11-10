/**
 * /{locale}/inventory/items/new — item creation (Create-Edit archetype). The
 * server fetches the UoM registry (create requires a uomId) and the category
 * tree first; the form POSTs and routes to the new record's detail page.
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { AppShell } from "../../../../../components/app-shell";
import { ErrorState } from "../../../../../components/client-ui";
import { ItemForm } from "../../../../../components/item-form";
import { RetryButton } from "../../../../../components/retry-button";
import { getDictionary, isLocale, type Locale } from "../../../../../i18n/dictionaries";
import type { ItemCategoryRow, UomRow } from "../../../../../lib/api-types";
import { localizedApiError } from "../../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../../lib/server-api";

export default async function NewItemPage({
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

  const [uoms, categories] = await Promise.all([
    fetchApi<readonly UomRow[]>("items/uoms"),
    fetchApi<readonly ItemCategoryRow[]>("items/item-categories"),
  ]);
  if ((!uoms.ok && uoms.status === 401) || (!categories.ok && categories.status === 401)) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!uoms.ok) {
    // Without the UoM registry the create contract (uomId uuid) cannot be
    // satisfied — block the page (403 → no permission, else retryable).
    const forbidden = uoms.status === 403 || uoms.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden ? d.errorsForbidden : localizedApiError(d, uoms.error, uoms.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    content = (
      <ItemForm
        locale={localeValue}
        mode="create"
        uoms={uoms.data}
        categories={categories.ok ? categories.data : []}
      />
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="inventory/items/new" title={d.navItemsNew}>
      {content}
    </AppShell>
  );
}
