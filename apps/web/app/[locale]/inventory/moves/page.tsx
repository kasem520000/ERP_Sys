/**
 * /{locale}/inventory/moves — the stock movement ledger (List+Search §2):
 * requires inventory.moves.view. The append-only stock_moves trail with
 * direction/kind/warehouse filters (FilterBar); batch/serial columns fill
 * where the item is tracked. Read-only by construction — no update path
 * exists anywhere in the module (INV-018 substrate).
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import { RetryButton } from "../../../../components/retry-button";
import { InventoryMoves } from "../../../../components/inventory-moves";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type { StockMoveRow, WarehouseRow } from "../../../../lib/api-types";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function InventoryMovesPage({
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

  const [moves, warehouses] = await Promise.all([
    fetchApi<readonly StockMoveRow[]>("inventory/moves?limit=300"),
    fetchApi<readonly WarehouseRow[]>("inventory/warehouses"),
  ]);
  if (!moves.ok && moves.status === 401) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!moves.ok) {
    const forbidden = moves.status === 403 || moves.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden
            ? d.errorsForbidden
            : localizedApiError(d, moves.error, moves.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    content = (
      <InventoryMoves
        locale={localeValue}
        initialRows={moves.data}
        warehouses={warehouses.ok ? warehouses.data : []}
      />
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="inventory/moves" title={d.movesTitle}>
      {content}
    </AppShell>
  );
}
