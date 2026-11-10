/**
 * /{locale}/inventory/warehouses — warehouse management (Settings archetype
 * §8): requires inventory.stock.view for the list; inventory.warehouses.
 * manage for create + deactivate/reactivate (enforced server-side). The GL
 * account picker loads best-effort so members without accounting grants
 * still get a working read-only list.
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import { RetryButton } from "../../../../components/retry-button";
import { InventoryWarehouses } from "../../../../components/inventory-warehouses";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type { AccountRow, BranchRow, CurrentSession, WarehouseRow } from "../../../../lib/api-types";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function InventoryWarehousesPage({
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

  const [warehouses, branches, glAccounts, session] = await Promise.all([
    fetchApi<readonly WarehouseRow[]>("inventory/warehouses"),
    fetchApi<readonly BranchRow[]>("tenancy/branches"),
    fetchApi<readonly AccountRow[]>("accounting/accounts?limit=500"),
    fetchApi<CurrentSession>("identity/sessions/current"),
  ]);
  if (
    (!warehouses.ok && warehouses.status === 401) ||
    (!session.ok && session.status === 401)
  ) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!warehouses.ok) {
    const forbidden = warehouses.status === 403 || warehouses.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden
            ? d.errorsForbidden
            : localizedApiError(d, warehouses.error, warehouses.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    const permissions = session.ok ? session.data.permissions : [];
    content = (
      <InventoryWarehouses
        locale={localeValue}
        initialRows={warehouses.data}
        branches={branches.ok ? branches.data : []}
        glAccounts={glAccounts.ok ? glAccounts.data : []}
        canManage={permissions.includes("inventory.warehouses.manage")}
      />
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="inventory/warehouses" title={d.warehousesTitle}>
      {content}
    </AppShell>
  );
}
