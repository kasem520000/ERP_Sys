/**
 * /{locale}/crm/service-orders — the job-card workspace generalization
 * (PHASE-019 T50, MASTER-PLAN §14): the SO- list, the create dialog
 * (SERVICE/PARTS lines editor), and the detail workspace with the
 * lifecycle bar (DRAFT: edit + approve + cancel; IN_PROGRESS: log-hours +
 * complete + cancel; COMPLETED: invoice; terminal read-only). Service
 * orders are the primary resource (crm.service_orders.manage +
 * crm.service_orders) — 403 renders the forbidden state; the
 * partners/contracts/branches/warehouses/items pools degrade to empty.
 * The parts issue policy is an approve-time choice (reserve default |
 * issue_immediate — the COGS journal at approval).
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import { CrmServiceOrders } from "../../../../components/crm-service-orders";
import { RetryButton } from "../../../../components/retry-button";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type {
  BranchRow,
  ItemRow,
  PartnerRow,
  ServiceContractReadRow,
  ServiceOrderRow,
  WarehouseRow,
} from "../../../../lib/api-types";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function CrmServiceOrdersPage({
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

  const [orders, partners, contracts, branches, warehouses, items] = await Promise.all([
    fetchApi<readonly ServiceOrderRow[]>("crm/service-orders?limit=200"),
    // Supporting reads (all degrade to empty): the partner select, the
    // optional contract link, the branch + parts warehouse selects and the
    // SERVICE/STOCK item pools for the lines editor.
    fetchApi<readonly PartnerRow[]>("partners/partners?limit=100"),
    fetchApi<readonly ServiceContractReadRow[]>("crm/contracts?limit=200"),
    fetchApi<readonly BranchRow[]>("tenancy/branches"),
    fetchApi<readonly WarehouseRow[]>("inventory/warehouses"),
    fetchApi<readonly ItemRow[]>("items/items?limit=100"),
  ]);
  if (!orders.ok && orders.status === 401) {
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
    content = (
      <CrmServiceOrders
        locale={localeValue}
        initialRows={orders.data}
        partners={partners.ok ? partners.data : []}
        contracts={contracts.ok ? contracts.data : []}
        branches={branches.ok ? branches.data : []}
        warehouses={warehouses.ok ? warehouses.data : []}
        items={items.ok ? items.data : []}
      />
    );
  }

  return (
    <AppShell
      locale={localeValue}
      pagePath="crm/service-orders"
      title={d.crmServiceOrdersTitle}
    >
      {content}
    </AppShell>
  );
}
