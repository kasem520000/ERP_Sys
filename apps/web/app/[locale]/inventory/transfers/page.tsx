/**
 * /{locale}/inventory/transfers — the transfer wizard surface (Wizard §9):
 * requires inventory.transfers.view; create/dispatch under
 * inventory.transfers.create; receive (the in-transit approval step) under
 * inventory.transfers.approve. Items load best-effort for the line picker.
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import { RetryButton } from "../../../../components/retry-button";
import { InventoryTransfers } from "../../../../components/inventory-transfers";
import { WmsLpnMover } from "../../../../components/wms-lpn-mover";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type {
  CurrentSession,
  ItemRow,
  StockTransferRow,
  WarehouseRow,
  WmsLpnRow,
} from "../../../../lib/api-types";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function InventoryTransfersPage({
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

  const [transfers, warehouses, items, session] = await Promise.all([
    fetchApi<readonly StockTransferRow[]>("inventory/transfers?limit=200"),
    fetchApi<readonly WarehouseRow[]>("inventory/warehouses"),
    fetchApi<readonly ItemRow[]>("items/items?limit=500"),
    fetchApi<CurrentSession>("identity/sessions/current"),
  ]);
  if (
    (!transfers.ok && transfers.status === 401) ||
    (!session.ok && session.status === 401)
  ) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!transfers.ok) {
    const forbidden = transfers.status === 403 || transfers.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden
            ? d.errorsForbidden
            : localizedApiError(d, transfers.error, transfers.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    const permissions = session.ok ? session.data.permissions : [];
    // PHASE-044 (T-15): the LPN move-by-scan card rides the transfer screen
    // — best-effort (members without the WMS key keep the plain wizard).
    const canWms = permissions.includes("inventory.wms.locations");
    const lpns = canWms
      ? await fetchApi<readonly WmsLpnRow[]>("inventory/wms/lpns?limit=100")
      : null;
    content = (
      <div className="flex flex-col gap-6">
        <InventoryTransfers
          locale={localeValue}
          initialRows={transfers.data}
          warehouses={warehouses.ok ? warehouses.data : []}
          items={items.ok ? items.data : []}
          canCreate={permissions.includes("inventory.transfers.create")}
          canApprove={permissions.includes("inventory.transfers.approve")}
        />
        {lpns !== null && lpns.ok && <WmsLpnMover locale={localeValue} lpns={lpns.data} />}
      </div>
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="inventory/transfers" title={d.transfersTitle}>
      {content}
    </AppShell>
  );
}
