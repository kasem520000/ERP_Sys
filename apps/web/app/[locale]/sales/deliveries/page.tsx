/**
 * /{locale}/sales/deliveries — delivery-note workspace (BR-007 flow A):
 * sales.deliveries.view for the list; sales.deliveries.create gates the
 * create/post/cancel actions server-side (matrix §3.2).
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import { RetryButton } from "../../../../components/retry-button";
import { SalesDeliveries } from "../../../../components/sales-deliveries";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type {
  BranchRow,
  CurrentSession,
  DeliveryNoteRow,
  ItemRow,
  PartnerRow,
  SalesOrderRow,
  TenantProfile,
  WarehouseRow,
} from "../../../../lib/api-types";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function SalesDeliveriesPage({
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

  const [deliveries, orders, customers, items, warehouses, branches, profile, session] = await Promise.all([
    fetchApi<readonly DeliveryNoteRow[]>("sales/delivery-notes?limit=200"),
    fetchApi<readonly SalesOrderRow[]>("sales/sales-orders?limit=200"),
    fetchApi<readonly PartnerRow[]>("partners?limit=500"),
    fetchApi<readonly ItemRow[]>("inventory/items?limit=500"),
    fetchApi<readonly WarehouseRow[]>("inventory/warehouses"),
    fetchApi<readonly BranchRow[]>("tenancy/branches"),
    fetchApi<TenantProfile>("tenancy/profile"),
    fetchApi<CurrentSession>("identity/sessions/current"),
  ]);
  if ((!deliveries.ok && deliveries.status === 401) || (!session.ok && session.status === 401)) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!deliveries.ok) {
    const forbidden = deliveries.status === 403 || deliveries.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden
            ? d.errorsForbidden
            : localizedApiError(d, deliveries.error, deliveries.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    const permissions = session.ok ? session.data.permissions : [];
    content = (
      <SalesDeliveries
        locale={localeValue}
        initialDeliveries={deliveries.data}
        orders={orders.ok ? orders.data : []}
        customers={customers.ok ? customers.data : []}
        items={items.ok ? items.data : []}
        warehouses={warehouses.ok ? warehouses.data : []}
        branches={branches.ok ? branches.data : []}
        baseCurrency={profile.ok ? profile.data.baseCurrency : ""}
        canCreate={permissions.includes("sales.deliveries.create")}
      />
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="sales/deliveries" title={d.salesDeliveriesTitle}>
      {content}
    </AppShell>
  );
}
