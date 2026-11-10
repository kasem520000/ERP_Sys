/**
 * /{locale}/inventory/counting — the count workspace (Transaction Entry
 * Workspace §4 variant; Journey D): requires inventory.counts.view;
 * create/enter/submit/recount/cancel under inventory.counts.create;
 * approve (the variance-review posting step, supervisor-flagged) under
 * inventory.counts.approve. Items load best-effort for the pick list.
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import { RetryButton } from "../../../../components/retry-button";
import { InventoryCounting } from "../../../../components/inventory-counting";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type {
  CountRow,
  CurrentSession,
  ItemRow,
  WarehouseRow,
} from "../../../../lib/api-types";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function InventoryCountingPage({
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

  const [counts, warehouses, items, session] = await Promise.all([
    fetchApi<readonly CountRow[]>("inventory/counts?limit=200"),
    fetchApi<readonly WarehouseRow[]>("inventory/warehouses"),
    fetchApi<readonly ItemRow[]>("items/items?limit=500"),
    fetchApi<CurrentSession>("identity/sessions/current"),
  ]);
  if ((!counts.ok && counts.status === 401) || (!session.ok && session.status === 401)) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!counts.ok) {
    const forbidden = counts.status === 403 || counts.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden
            ? d.errorsForbidden
            : localizedApiError(d, counts.error, counts.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    const permissions = session.ok ? session.data.permissions : [];
    content = (
      <InventoryCounting
        locale={localeValue}
        initialRows={counts.data}
        warehouses={warehouses.ok ? warehouses.data : []}
        items={items.ok ? items.data : []}
        canCreate={permissions.includes("inventory.counts.create")}
        canApprove={permissions.includes("inventory.counts.approve")}
      />
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="inventory/counting" title={d.countingTitle}>
      {content}
    </AppShell>
  );
}
