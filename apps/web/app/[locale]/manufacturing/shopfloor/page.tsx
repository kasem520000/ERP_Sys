/**
 * /{locale}/manufacturing/shopfloor — THE TOUCH-FIRST TERMINAL
 * (PHASE-042 T-11/M-17, matrix §3.20): the scan-first barcode input
 * (OP:<orderId>:<seq>:<action> — client-parsed, posted to the idempotent
 * scan endpoint), the live order view (operations with status chips + the
 * start/pause/resume/complete/skip transitions — the skip dialog requires
 * a distinct approver, the SoD floor), and the downtime quick-log (reason
 * select + minutes + optional order link). The order list rides
 * production_orders.view — 403 renders the forbidden state; the
 * work-centers/users pools degrade to empty (the terminal still scans).
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import { ManufacturingShopfloorTerminal } from "../../../../components/manufacturing-shopfloor-terminal";
import { RetryButton } from "../../../../components/retry-button";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type {
  ItemRow,
  ProductionOrderRow,
  TenantUserRow,
  WorkCenterRow,
} from "../../../../lib/api-types";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function ManufacturingShopfloorPage({
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

  const [orders, items, workCenters, users] = await Promise.all([
    fetchApi<readonly ProductionOrderRow[]>("manufacturing/production-orders?limit=200"),
    fetchApi<readonly ItemRow[]>("items/items?limit=100"),
    fetchApi<readonly WorkCenterRow[]>("manufacturing/work-centers?limit=200"),
    // The skip-approver pool (a distinct ACTIVE user — BR-034 SoD).
    fetchApi<readonly TenantUserRow[]>("identity/users"),
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
      <ManufacturingShopfloorTerminal
        locale={localeValue}
        initialOrders={orders.data}
        items={items.ok ? items.data : []}
        workCenters={workCenters.ok ? workCenters.data : []}
        users={(users.ok ? users.data : []).filter((user) => user.status === "ACTIVE")}
      />
    );
  }

  return (
    <AppShell
      locale={localeValue}
      pagePath="manufacturing/shopfloor"
      title={d.mfgShopfloorTitle}
    >
      {content}
    </AppShell>
  );
}
