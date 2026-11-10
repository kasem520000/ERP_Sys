/**
 * /{locale}/sales/quotes — quotations + sales orders workspace
 * (transaction-entry §4): sales.quotations.view for the quote list;
 * the create/convert/approve keys gate the actions server-side
 * (matrix §3.2). Orders share this screen (nav item sales.quotes).
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import { RetryButton } from "../../../../components/retry-button";
import { SalesQuotes } from "../../../../components/sales-quotes";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type {
  BranchRow,
  CurrentSession,
  ItemRow,
  PartnerRow,
  QuotationRow,
  SalesOrderRow,
  TenantProfile,
  WarehouseRow,
} from "../../../../lib/api-types";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function SalesQuotesPage({
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

  const [quotes, orders, customers, items, warehouses, branches, profile, session] = await Promise.all([
    fetchApi<readonly QuotationRow[]>("sales/quotations?limit=200"),
    fetchApi<readonly SalesOrderRow[]>("sales/sales-orders?limit=200"),
    fetchApi<readonly PartnerRow[]>("partners?limit=500"),
    fetchApi<readonly ItemRow[]>("inventory/items?limit=500"),
    fetchApi<readonly WarehouseRow[]>("inventory/warehouses"),
    fetchApi<readonly BranchRow[]>("tenancy/branches"),
    fetchApi<TenantProfile>("tenancy/profile"),
    fetchApi<CurrentSession>("identity/sessions/current"),
  ]);
  if ((!quotes.ok && quotes.status === 401) || (!session.ok && session.status === 401)) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!quotes.ok) {
    const forbidden = quotes.status === 403 || quotes.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden
            ? d.errorsForbidden
            : localizedApiError(d, quotes.error, quotes.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    const permissions = session.ok ? session.data.permissions : [];
    content = (
      <SalesQuotes
        locale={localeValue}
        initialQuotes={quotes.data}
        initialOrders={orders.ok ? orders.data : []}
        customers={customers.ok ? customers.data : []}
        items={items.ok ? items.data : []}
        warehouses={warehouses.ok ? warehouses.data : []}
        branches={branches.ok ? branches.data : []}
        baseCurrency={profile.ok ? profile.data.baseCurrency : ""}
        canCreateQuotes={permissions.includes("sales.quotations.create")}
        canSendQuotes={permissions.includes("sales.quotations.approve")}
        canConvertQuotes={permissions.includes("sales.quotations.convert")}
        canCreateOrders={permissions.includes("sales.orders.create")}
        canApproveOrders={permissions.includes("sales.orders.approve")}
      />
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="sales/quotes" title={d.salesQuotesTitle}>
      {content}
    </AppShell>
  );
}
