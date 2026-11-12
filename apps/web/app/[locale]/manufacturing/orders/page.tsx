/**
 * /{locale}/manufacturing/orders — the production-order workspace
 * (PHASE-018 T41, MASTER-PLAN §14): the order list + create dialog
 * (DRAFT), and the selected order's detail — header, the release-frozen
 * plan lines, lifecycle actions (release → start → consume/scrap/complete
 * / cancel) and the consumptions/scraps tables. Every posting mutation
 * rides the real journal surfaces (WIP, production scrap, FG receipt);
 * quantities/money stay canonical decimal strings. Orders are the primary
 * resource — 403 renders the forbidden state; items/warehouses/branches
 * (and the BOM pool for the explicit-version select) degrade to empty.
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import { ManufacturingOrders } from "../../../../components/manufacturing-orders";
import { RetryButton } from "../../../../components/retry-button";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type {
  BomRow,
  BranchRow,
  ItemRow,
  ProductionOrderRow,
  ReworkOrderRow,
  RoutingRow,
  WarehouseRow,
  WorkCenterRow,
} from "../../../../lib/api-types";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function ManufacturingOrdersPage({
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

  const [orders, items, warehouses, branches, boms, routings, reworks, workCenters] = await Promise.all([
    fetchApi<readonly ProductionOrderRow[]>("manufacturing/production-orders?limit=200"),
    fetchApi<readonly ItemRow[]>("items/items?limit=100"),
    fetchApi<readonly WarehouseRow[]>("inventory/warehouses"),
    fetchApi<readonly BranchRow[]>("tenancy/branches"),
    // Supporting pool for the optional explicit-BOM select (client-filtered
    // by the chosen FG item); the screen works without it (the ACTIVE
    // default needs no list).
    fetchApi<readonly BomRow[]>("manufacturing/boms?limit=200"),
    // PHASE-042 (T-12): the routing pool (the ops tab's binding display +
    // the rework dialog's routing select — any version of the item).
    fetchApi<readonly RoutingRow[]>("manufacturing/routings?limit=200"),
    // PHASE-042 (T-12): the rework pool for the ops tab's rework list
    // (rides rework_orders.manage — degrades to empty without it).
    fetchApi<readonly ReworkOrderRow[]>("manufacturing/rework-orders?limit=200"),
    // PHASE-042 (T-12): the work-center labels for the ops table.
    fetchApi<readonly WorkCenterRow[]>("manufacturing/work-centers?limit=200"),
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
      <ManufacturingOrders
        locale={localeValue}
        initialRows={orders.data}
        items={(items.ok ? items.data : []).filter((item) => item.kind === "STOCK")}
        warehouses={(warehouses.ok ? warehouses.data : []).filter((warehouse) => warehouse.isActive)}
        branches={(branches.ok ? branches.data : []).filter((branch) => branch.isActive)}
        boms={boms.ok ? boms.data : []}
        routings={routings.ok ? routings.data : []}
        reworks={reworks.ok ? reworks.data : []}
        workCenters={workCenters.ok ? workCenters.data : []}
        today={new Date().toISOString().slice(0, 10)}
      />
    );
  }

  return (
    <AppShell
      locale={localeValue}
      pagePath="manufacturing/orders"
      title={d.mfgOrdersTitle}
    >
      {content}
    </AppShell>
  );
}
