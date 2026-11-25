/**
 * /{locale}/purchasing/orders — PR + PO workspace (transaction-entry §4):
 * purchasing.purchase_orders.view for the lists; create/approve keys gate
 * the actions server-side (matrix §3.3).
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import { RetryButton } from "../../../../components/retry-button";
import { PurchasingOrders } from "../../../../components/purchasing-orders";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type {
  CurrentSession,
  ItemRow,
  PartnerRow,
  PurchaseOrderRow,
  PurchaseRequestRow,
  TradeIncotermRow,
} from "../../../../lib/api-types";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function PurchasingOrdersPage({
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

  const [orders, requests, suppliers, items, incoterms, session] = await Promise.all([
    fetchApi<readonly PurchaseOrderRow[]>("purchasing/purchase-orders?limit=200"),
    fetchApi<readonly PurchaseRequestRow[]>("purchasing/purchase-requests?limit=200"),
    fetchApi<readonly PartnerRow[]>("partners?limit=500"),
    fetchApi<readonly ItemRow[]>("inventory/items?limit=500"),
    // PHASE-051 (W-39 — T-14, D-17): the Incoterms registry read feeds the
    // selector embedded in the PO create form (BR-106's mandate is
    // server-side; the selector degrades to [] on its own 403 — additive).
    fetchApi<readonly TradeIncotermRow[]>("trade/incoterms"),
    fetchApi<CurrentSession>("identity/sessions/current"),
  ]);
  if ((!orders.ok && orders.status === 401) || (!session.ok && session.status === 401)) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!orders.ok) {
    const forbidden = orders.status === 403 || orders.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden
            ? d.errorsForbidden
            : localizedApiError(d, orders.error, orders.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    const permissions = session.ok ? session.data.permissions : [];
    content = (
      <PurchasingOrders
        locale={localeValue}
        initialRequests={requests.ok ? requests.data : []}
        initialOrders={orders.data}
        suppliers={suppliers.ok ? suppliers.data : []}
        items={items.ok ? items.data : []}
        incoterms={incoterms.ok ? incoterms.data : []}
        canCreate={permissions.includes("purchasing.purchase_orders.create")}
        canApprove={permissions.includes("purchasing.purchase_orders.approve")}
      />
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="purchasing/orders" title={d.purchasingOrdersTitle}>
      {content}
    </AppShell>
  );
}
