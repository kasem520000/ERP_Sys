/**
 * /{locale}/manufacturing/mps — the master production schedule (PHASE-043
 * T-14, matrix §3.20; archetype list-search): the weekly bucket-grid editor
 * (planned/firmed production quantities per (warehouse, item, bucket) — the
 * demand override inside the frozen fence, BR-078) and the data-readiness
 * panel (scope items + the without-lead-time warning list). The warehouse
 * must resolve before the entries read (the slot upsert is
 * warehouse-scoped), so warehouses fetch first and the default warehouse's
 * entries + readiness ride the second parallel batch. Entries are the
 * primary resource — 403 renders the forbidden state; items/uoms degrade
 * to empty.
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import { ManufacturingMps } from "../../../../components/manufacturing-mps";
import { RetryButton } from "../../../../components/retry-button";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type {
  ItemRow,
  MpsEntryRow,
  MpsReadinessResult,
  UomRow,
  WarehouseRow,
} from "../../../../lib/api-types";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function ManufacturingMpsPage({
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

  // The warehouse select (supporting read — degrades to empty; without a
  // default warehouse the grid renders its empty state, nothing is fetched).
  const warehouses = await fetchApi<readonly WarehouseRow[]>("inventory/warehouses?limit=100");
  const activeWarehouses = warehouses.ok
    ? warehouses.data.filter((warehouse) => warehouse.isActive)
    : [];
  const defaultWarehouseId = activeWarehouses[0]?.id;

  const [entries, readiness, items, uoms] = await Promise.all([
    // Without a default warehouse the entries read still exercises the
    // primary permission (403/401 state) — its rows are discarded (a grid
    // without a warehouse cannot scope its slot upserts).
    fetchApi<readonly MpsEntryRow[]>(
      defaultWarehouseId === undefined
        ? "manufacturing/mps/entries?limit=500"
        : `manufacturing/mps/entries?limit=500&warehouseId=${defaultWarehouseId}`,
    ),
    fetchApi<MpsReadinessResult>(
      defaultWarehouseId === undefined
        ? "manufacturing/mps/readiness"
        : `manufacturing/mps/readiness?warehouseId=${defaultWarehouseId}`,
    ),
    // Supporting reads: the item rows + the base-uom labels degrade to empty.
    fetchApi<readonly ItemRow[]>("items/items?limit=200"),
    fetchApi<readonly UomRow[]>("items/uoms"),
  ]);
  if (
    (!entries.ok && entries.status === 401) ||
    (!readiness.ok && readiness.status === 401)
  ) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!entries.ok) {
    const forbidden = entries.status === 403 || entries.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden
            ? d.errorsForbidden
            : localizedApiError(d, entries.error, entries.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    content = (
      <ManufacturingMps
        locale={localeValue}
        warehouseId={defaultWarehouseId ?? ""}
        warehouses={activeWarehouses}
        items={(items.ok ? items.data : []).filter((item) => item.kind === "STOCK")}
        uoms={uoms.ok ? uoms.data : []}
        initialEntries={defaultWarehouseId === undefined ? [] : entries.data}
        initialReadiness={defaultWarehouseId === undefined ? null : readiness.ok ? readiness.data : null}
      />
    );
  }

  return (
    <AppShell
      locale={localeValue}
      pagePath="manufacturing/mps"
      title={d.mfgMpsTitle}
    >
      {content}
    </AppShell>
  );
}
