/**
 * /{locale}/inventory/adjustments — the stock-adjustments register
 * (PHASE-035 T-04; List+Search §2): a dedicated READ surface over the
 * existing adjustment journal flow (G-13/G-14), previously reachable only
 * through the stock-count wizard. Requires inventory.stock.view; no
 * posting path by design (the phase document records the intent — posting
 * stays in the count wizard).
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import { InventoryAdjustments } from "../../../../components/inventory-adjustments";
import { RetryButton } from "../../../../components/retry-button";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type { CurrentSession, StockAdjustmentRow, WarehouseRow } from "../../../../lib/api-types";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function InventoryAdjustmentsPage({
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

  const [adjustments, warehouses, session] = await Promise.all([
    fetchApi<readonly StockAdjustmentRow[]>("inventory/adjustments?limit=500"),
    fetchApi<readonly WarehouseRow[]>("inventory/warehouses"),
    fetchApi<CurrentSession>("identity/sessions/current"),
  ]);
  if (
    (!adjustments.ok && adjustments.status === 401) ||
    (!session.ok && session.status === 401)
  ) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!adjustments.ok) {
    const forbidden = adjustments.status === 403 || adjustments.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden
            ? d.errorsForbidden
            : localizedApiError(d, adjustments.error, adjustments.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    content = (
      <InventoryAdjustments
        locale={localeValue}
        initialRows={adjustments.data}
        warehouses={warehouses.ok ? warehouses.data : []}
      />
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="inventory/adjustments" title={d.adjustmentsTitle}>
      {content}
    </AppShell>
  );
}
