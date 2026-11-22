/**
 * /{locale}/assets/maintenance — the maintenance board (PHASE-049 W-20,
 * T-13): the work-order board + the plans admin + the checklist entry
 * (assets.maintenance.view is the board's read key; assets.maintenance.plan
 * gates the plans pane — the two-primary screen: a pane that refuses
 * renders its own typed-refusal state; a full 403 on BOTH renders the
 * forbidden state). The supporting pools degrade to [] on their own 403s
 * (the job-cards rule): the asset register, the employees (the technician
 * select + the LABOR lines — the PII-masked payroll read), the STOCK
 * items + warehouses (the PARTS lines), the supplier partners (the
 * EXTERNAL lines), and the meters (the METER plans' pool).
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import { AssetsMaintenanceBoard } from "../../../../components/assets-maintenance-board";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type {
  AssetMeterRow,
  EmployeeListRow,
  FixedAssetRow,
  ItemRow,
  MaintenancePlanRow,
  MaintenanceWorkOrderRow,
  PartnerRow,
  WarehouseRow,
} from "../../../../lib/api-types";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function AssetsMaintenancePage({
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

  const [orders, plans, assets, employees, items, warehouses, partners, meters] = await Promise.all([
    fetchApi<readonly MaintenanceWorkOrderRow[]>("assets/maintenance/orders"),
    fetchApi<readonly MaintenancePlanRow[]>("assets/plans"),
    fetchApi<readonly FixedAssetRow[]>("fixed-assets/assets?limit=200"),
    fetchApi<readonly EmployeeListRow[]>("payroll/employees"),
    fetchApi<readonly ItemRow[]>("items/items?limit=100"),
    fetchApi<readonly WarehouseRow[]>("inventory/warehouses"),
    fetchApi<readonly PartnerRow[]>("partners/partners?kind=SUPPLIER&limit=100"),
    fetchApi<readonly AssetMeterRow[]>("assets/meters"),
  ]);
  if ((!orders.ok && orders.status === 401) || (!plans.ok && plans.status === 401)) {
    redirect(`/${locale}/login`);
  }

  const ordersForbidden =
    !orders.ok && (orders.status === 403 || orders.error.code === "FORBIDDEN");
  const plansForbidden =
    !plans.ok && (plans.status === 403 || plans.error.code === "FORBIDDEN");

  let content: JSX.Element;
  if (ordersForbidden && plansForbidden) {
    content = <ErrorState title={d.errorsForbidden} />;
  } else {
    content = (
      <AssetsMaintenanceBoard
        locale={localeValue}
        initialOrders={orders.ok ? orders.data : null}
        ordersError={orders.ok ? null : orders.error}
        initialPlans={plans.ok ? plans.data : null}
        plansError={plans.ok ? null : plans.error}
        assets={assets.ok ? assets.data : []}
        employees={employees.ok ? employees.data : []}
        items={items.ok ? items.data : []}
        warehouses={warehouses.ok ? warehouses.data : []}
        partners={partners.ok ? partners.data : []}
        meters={meters.ok ? meters.data : []}
      />
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="assets/maintenance" title={d.assetsMaintenanceTitle}>
      {content}
    </AppShell>
  );
}
