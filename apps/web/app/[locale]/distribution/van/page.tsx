/**
 * /{locale}/distribution/van — the van fleet & van stock (PHASE-017 T14
 * 9a-dist): vans are the VAN slice of warehouses (one van per rep), the
 * per-van balances come off the `van_stocks` mirror (refreshed inside the
 * owning transaction on every read), and load-out/unload are ordinary
 * two-leg stock transfers (IN_TRANSIT until received — never sellable,
 * BR-016). Vans are the primary resource — 403 renders the forbidden
 * state; branches/reps/warehouses/items degrade to empty.
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import { DistributionVan } from "../../../../components/distribution-van";
import { RetryButton } from "../../../../components/retry-button";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type {
  BranchRow,
  ItemRow,
  SalesRepRow,
  StockTransferRow,
  VanRow,
  VanStockRow,
  WarehouseRow,
} from "../../../../lib/api-types";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function DistributionVanPage({
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

  const [vans, stock, branches, reps, warehouses, items, transfers] = await Promise.all([
    fetchApi<readonly VanRow[]>("distribution/vans"),
    fetchApi<readonly VanStockRow[]>("distribution/van-stock"),
    fetchApi<readonly BranchRow[]>("tenancy/branches"),
    fetchApi<readonly SalesRepRow[]>("sales/reps"),
    fetchApi<readonly WarehouseRow[]>("inventory/warehouses"),
    fetchApi<readonly ItemRow[]>("items/items?limit=100"),
    fetchApi<readonly StockTransferRow[]>("inventory/transfers?status=IN_TRANSIT&limit=200"),
  ]);
  if (!vans.ok && vans.status === 401) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!vans.ok) {
    const forbidden = vans.status === 403 || vans.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden
            ? d.errorsForbidden
            : localizedApiError(d, vans.error, vans.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    const vanIds = new Set(vans.data.map((van) => van.id));
    content = (
      <DistributionVan
        locale={localeValue}
        initialVans={vans.data}
        initialStock={stock.ok ? stock.data : []}
        branches={branches.ok ? branches.data : []}
        reps={reps.ok ? reps.data : []}
        warehouses={(warehouses.ok ? warehouses.data : []).filter(
          (warehouse) => warehouse.isActive && !vanIds.has(warehouse.id),
        )}
        items={(items.ok ? items.data : []).filter((item) => item.kind === "STOCK" && item.deletedAt === null)}
        inTransit={
          transfers.ok
            ? transfers.data.filter((transfer) => vanIds.has(transfer.toWarehouseId))
            : []
        }
      />
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="distribution/van" title={d.distributionVanTitle}>
      {content}
    </AppShell>
  );
}
