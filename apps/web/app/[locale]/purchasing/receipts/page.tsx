/**
 * /{locale}/purchasing/receipts — GRN workspace (G-07): goods_receipts.view
 * for the list; create/approve keys gate the actions (matrix §3.3).
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import { RetryButton } from "../../../../components/retry-button";
import { PurchasingReceipts } from "../../../../components/purchasing-receipts";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type {
  CurrentSession,
  GoodsReceiptRow,
  ItemRow,
  PartnerRow,
  PurchaseOrderRow,
  WarehouseRow,
} from "../../../../lib/api-types";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function PurchasingReceiptsPage({
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

  const [receipts, orders, suppliers, items, warehouses, session] = await Promise.all([
    fetchApi<readonly GoodsReceiptRow[]>("purchasing/goods-receipts?limit=200"),
    fetchApi<readonly PurchaseOrderRow[]>("purchasing/purchase-orders?limit=200"),
    fetchApi<readonly PartnerRow[]>("partners?limit=500"),
    fetchApi<readonly ItemRow[]>("inventory/items?limit=500"),
    fetchApi<readonly WarehouseRow[]>("inventory/warehouses"),
    fetchApi<CurrentSession>("identity/sessions/current"),
  ]);
  if ((!receipts.ok && receipts.status === 401) || (!session.ok && session.status === 401)) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!receipts.ok) {
    const forbidden = receipts.status === 403 || receipts.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden
            ? d.errorsForbidden
            : localizedApiError(d, receipts.error, receipts.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    const permissions = session.ok ? session.data.permissions : [];
    content = (
      <PurchasingReceipts
        locale={localeValue}
        initialReceipts={receipts.data}
        orders={orders.ok ? orders.data : []}
        suppliers={suppliers.ok ? suppliers.data : []}
        items={items.ok ? items.data : []}
        warehouses={warehouses.ok ? warehouses.data : []}
        canCreate={permissions.includes("purchasing.goods_receipts.create")}
        canPost={permissions.includes("purchasing.goods_receipts.approve")}
      />
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="purchasing/receipts" title={d.purchasingReceiptsTitle}>
      {content}
    </AppShell>
  );
}
