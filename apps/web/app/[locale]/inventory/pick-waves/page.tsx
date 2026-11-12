/**
 * /{locale}/inventory/pick-waves — the directed-picking board (PHASE-044
 * T-14): waves with their lifecycle, the task list with the PP-11 scan
 * confirmation, and the warehouse strategy card. Requires
 * inventory.wms.picking (the 0071 matrix row — the wave board's own key).
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import { RetryButton } from "../../../../components/retry-button";
import { InventoryPickWaves } from "../../../../components/inventory-pick-waves";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type {
  CurrentSession,
  WarehouseRow,
  WmsPickStrategyRow,
  WmsPickWaveRow,
} from "../../../../lib/api-types";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function InventoryPickWavesPage({
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

  const [waves, warehouses, session] = await Promise.all([
    fetchApi<readonly WmsPickWaveRow[]>("inventory/wms/pick-waves?limit=100"),
    fetchApi<readonly WarehouseRow[]>("inventory/warehouses"),
    fetchApi<CurrentSession>("identity/sessions/current"),
  ]);
  if (
    (!waves.ok && waves.status === 401) ||
    (!warehouses.ok && warehouses.status === 401) ||
    (!session.ok && session.status === 401)
  ) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!waves.ok) {
    const forbidden = waves.status === 403 || waves.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden
            ? d.errorsForbidden
            : localizedApiError(d, waves.error, waves.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    const permissions = session.ok ? session.data.permissions : [];
    const firstWarehouse = warehouses.ok
      ? (warehouses.data.find((w) => w.isActive) ?? warehouses.data[0] ?? null)
      : null;
    const strategy = firstWarehouse
      ? await fetchApi<WmsPickStrategyRow>(
          `inventory/wms/pick-strategy/${firstWarehouse.id}`,
        )
      : null;
    content = (
      <InventoryPickWaves
        locale={localeValue}
        warehouses={warehouses.ok ? warehouses.data : []}
        initialWaves={waves.data}
        initialStrategy={strategy !== null && strategy.ok ? strategy.data : null}
        canPick={permissions.includes("inventory.wms.picking")}
      />
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="inventory/pick-waves" title={d.wmsWavesTitle}>
      {content}
    </AppShell>
  );
}
