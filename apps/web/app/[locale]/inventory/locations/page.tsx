/**
 * /{locale}/inventory/locations — the WMS location board (PHASE-044 T-14):
 * the zone→aisle→rack→bin tree, bin contents, the INV-029 reconciliation
 * report, and the LPN registry. Requires inventory.wms.locations for the
 * read; the create forms add nothing beyond it (manage is the same key —
 * the 0071 matrix row).
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import { RetryButton } from "../../../../components/retry-button";
import { InventoryLocations } from "../../../../components/inventory-locations";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type {
  CurrentSession,
  WarehouseRow,
  WmsBinContentRow,
  WmsLpnRow,
  WmsLocationTreeNode,
  WmsReconcileRow,
} from "../../../../lib/api-types";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function InventoryLocationsPage({
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

  const [warehouses, lpns, session] = await Promise.all([
    fetchApi<readonly WarehouseRow[]>("inventory/warehouses"),
    fetchApi<readonly WmsLpnRow[]>("inventory/wms/lpns?limit=100"),
    fetchApi<CurrentSession>("identity/sessions/current"),
  ]);
  if (
    (!warehouses.ok && warehouses.status === 401) ||
    (!lpns.ok && lpns.status === 401) ||
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
    const activeWarehouse =
      warehouses.data.find((w) => w.isActive) ?? warehouses.data[0] ?? null;
    const [tree, contents, reconcile] = activeWarehouse
      ? await Promise.all([
          fetchApi<readonly WmsLocationTreeNode[]>(
            `inventory/wms/locations/tree?warehouseId=${activeWarehouse.id}`,
          ),
          fetchApi<readonly WmsBinContentRow[]>(
            `inventory/wms/bin-contents?warehouseId=${activeWarehouse.id}&limit=500`,
          ),
          fetchApi<readonly WmsReconcileRow[]>(
            `inventory/wms/reconcile?warehouseId=${activeWarehouse.id}`,
          ),
        ])
      : [null, null, null];
    const permissions = session.ok ? session.data.permissions : [];
    content = (
      <InventoryLocations
        locale={localeValue}
        warehouses={warehouses.data}
        initialWarehouseId={activeWarehouse?.id ?? ""}
        initialTree={tree !== null && tree.ok ? tree.data : []}
        initialContents={contents !== null && contents.ok ? contents.data : []}
        initialReconcile={reconcile !== null && reconcile.ok ? reconcile.data : []}
        initialLpns={lpns.ok ? lpns.data : []}
        canManage={permissions.includes("inventory.wms.locations")}
      />
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="inventory/locations" title={d.wmsLocationsTitle}>
      {content}
    </AppShell>
  );
}
