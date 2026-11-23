/**
 * /{locale}/inventory/batches — the batch & expiry registry (PHASE-035 T-02;
 * List+Search §2): requires inventory.moves.view; register + expiry
 * write-off under inventory.tracking.manage. Items and warehouses load
 * best-effort for the register form and the write-off picker.
 *
 * PHASE-050 (W-29 — T-15): the ACTIVE quality holds read ONCE (GET
 * quality/holds?status=ACTIVE&limit=200) feeds the board's hold banner —
 * ADDITIVE: a tenant without the quality entitlement (a 403 on that read)
 * degrades to no banners, never a typed refusal on this host surface.
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import { InventoryBatches } from "../../../../components/inventory-batches";
import { RetryButton } from "../../../../components/retry-button";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type {
  CurrentSession,
  ItemRow,
  WarehouseRow,
  BatchRow,
  BatchQualityHoldRow,
} from "../../../../lib/api-types";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function InventoryBatchesPage({
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

  const [batches, warehouses, items, session, holds] = await Promise.all([
    fetchApi<readonly BatchRow[]>("inventory/batches?limit=500"),
    fetchApi<readonly WarehouseRow[]>("inventory/warehouses"),
    fetchApi<readonly ItemRow[]>("items/items?limit=500"),
    fetchApi<CurrentSession>("identity/sessions/current"),
    fetchApi<readonly BatchQualityHoldRow[]>("quality/holds?status=ACTIVE&limit=200"),
  ]);
  if (
    (!batches.ok && batches.status === 401) ||
    (!session.ok && session.status === 401)
  ) {
    redirect(`/${locale}/login`);
  }

  // The hold banners' own pool — additive: any refusal (a tenant without
  // the quality entitlement included) degrades to no banners.
  const holdsByBatch = new Map<string, BatchQualityHoldRow>();
  if (holds.ok) {
    for (const hold of holds.data) {
      holdsByBatch.set(hold.batchId, hold);
    }
  }

  let content: JSX.Element;
  if (!batches.ok) {
    const forbidden = batches.status === 403 || batches.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden
            ? d.errorsForbidden
            : localizedApiError(d, batches.error, batches.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    const permissions = session.ok ? session.data.permissions : [];
    content = (
      <InventoryBatches
        locale={localeValue}
        initialRows={batches.data}
        warehouses={warehouses.ok ? warehouses.data : []}
        items={items.ok ? items.data : []}
        canManage={permissions.includes("inventory.tracking.manage")}
        holdsByBatch={holdsByBatch}
      />
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="inventory/batches" title={d.batchesTitle}>
      {content}
    </AppShell>
  );
}
