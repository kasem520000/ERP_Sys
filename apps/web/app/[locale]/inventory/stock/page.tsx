/**
 * /{locale}/inventory/stock — stock on hand (List+Search archetype §2):
 * requires inventory.stock.view. The item_stock read model (maintained
 * transactionally with every move) + the availability drill (BR-016
 * netting: on-hand − reserved − in-transit).
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import { RetryButton } from "../../../../components/retry-button";
import { InventoryStock } from "../../../../components/inventory-stock";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type { StockOnHandRow, WarehouseRow } from "../../../../lib/api-types";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function InventoryStockPage({
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

  const [stock, warehouses] = await Promise.all([
    fetchApi<readonly StockOnHandRow[]>("inventory/stock?limit=300"),
    fetchApi<readonly WarehouseRow[]>("inventory/warehouses"),
  ]);
  if (!stock.ok && stock.status === 401) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!stock.ok) {
    const forbidden = stock.status === 403 || stock.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden
            ? d.errorsForbidden
            : localizedApiError(d, stock.error, stock.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    content = (
      <InventoryStock
        locale={localeValue}
        initialRows={stock.data}
        warehouses={warehouses.ok ? warehouses.data : []}
      />
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="inventory/stock" title={d.stockTitle}>
      {content}
    </AppShell>
  );
}
