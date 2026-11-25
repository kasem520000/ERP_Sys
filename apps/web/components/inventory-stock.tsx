"use client";

/**
 * T14-UI (PHASE-010) — stock on hand (List+Search archetype §2 with
 * FilterBar): the transactionally-maintained item_stock read model per
 * item-warehouse (qty at 6-decimal internal precision, avg cost, negative
 * flag per BR-013) with a warehouse filter and the availability drill
 * (on-hand − reserved − in-transit, BR-016) for the selected row.
 */
import { useMemo, useState } from "react";
import type { JSX } from "react";

import { Badge, Button, DataTable, SearchInput, Select, formatMoneyDisplay } from "@erp/ui";
import { getDictionary, type Locale } from "../i18n/dictionaries";
import type {
  StockAvailabilityRow,
  StockOnHandRow,
  TradeBondedMoveRow,
  WarehouseRow,
} from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { localizedInventoryError } from "../lib/messages";
import { DutySuspendedBanner, DutySuspendedChip } from "./duty-suspended-banner";
import { Card } from "./card";
import { ErrorNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";

export function InventoryStock({
  locale,
  initialRows,
  warehouses,
  suspendedMoves,
}: {
  locale: Locale;
  initialRows: readonly StockOnHandRow[];
  warehouses: readonly WarehouseRow[];
  /** PHASE-051 (W-39 — T-14, D-17): the bonded register's EXECUTED
   * IN_BOND moves (the host page's one read; the item-keyed map feeds
   * the chips + the banner — the move's own figures VERBATIM, never a
   * recomputed suspended balance). */
  suspendedMoves: readonly TradeBondedMoveRow[];
}): JSX.Element {
  const d = getDictionary(locale);
  const [rows] = useState<readonly StockOnHandRow[]>(initialRows);
  const [warehouseId, setWarehouseId] = useState("");
  const [query, setQuery] = useState("");
  const [availability, setAvailability] = useState<StockAvailabilityRow | null>(null);
  const [availabilityError, setAvailabilityError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (warehouseId !== "" && row.warehouseId !== warehouseId) return false;
      if (needle === "") return true;
      return (
        row.sku.toLowerCase().includes(needle) ||
        row.itemName.toLowerCase().includes(needle) ||
        (row.itemNameAr ?? "").includes(needle)
      );
    });
  }, [rows, warehouseId, query]);

  // The item-keyed suspension map (the register's own rows — one move
  // per item at the map's floor; the chip + the banner render the move's
  // own figures VERBATIM).
  const suspendedByItem = useMemo(() => {
    const map = new Map<string, TradeBondedMoveRow>();
    for (const move of suspendedMoves) {
      for (const line of move.lines) {
        if (!map.has(line.itemId)) {
          map.set(line.itemId, move);
        }
      }
    }
    return map;
  }, [suspendedMoves]);
  const suspendedQtyByItem = useMemo(() => {
    const map = new Map<string, string>();
    for (const move of suspendedMoves) {
      for (const line of move.lines) {
        if (!map.has(line.itemId)) {
          map.set(line.itemId, line.qty);
        }
      }
    }
    return map;
  }, [suspendedMoves]);
  const [suspendedBannerItem, setSuspendedBannerItem] = useState<StockOnHandRow | null>(null);

  async function openAvailability(row: StockOnHandRow): Promise<void> {
    setSuspendedBannerItem(suspendedByItem.has(row.itemId) ? row : null);
    setAvailabilityError(null);
    const result = await bffFetch<StockAvailabilityRow>(
      `inventory/availability?itemId=${encodeURIComponent(row.itemId)}&warehouseId=${encodeURIComponent(row.warehouseId)}`,
    );
    if (!result.ok) {
      setAvailability(null);
      setAvailabilityError(localizedInventoryError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setAvailability(result.data);
  }

  return (
    <div className="flex flex-col gap-4">
      {availabilityError !== null && <ErrorNotice>{availabilityError}</ErrorNotice>}

      <Card title={d.stockTitle}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Select
            label={d.stockFilterWarehouse}
            value={warehouseId}
            onValueChange={setWarehouseId}
            placeholder="—"
            options={warehouses.map((warehouse) => ({
              value: warehouse.id,
              label: `${warehouse.code} · ${warehouse.name}`,
            }))}
            className="sm:w-64"
          />
          <SearchInput
            label={d.countingPickSearchPlaceholder}
            value={query}
            onValueChange={setQuery}
            className="sm:max-w-xs"
          />
        </div>
        <DataTable
          columns={[
            {
              id: "sku",
              header: activeLocaleHeader(d.itemsColSku),
              accessor: (row) => row.sku,
              mono: true,
              sortable: true,
              filterable: true,
              render: (row) => <span className="font-mono text-sm" dir="ltr">{row.sku}</span>,
            },
            {
              id: "item",
              header: activeLocaleHeader(d.stockColItem),
              accessor: (row) => row.itemName,
              render: (row) => row.itemName,
            },
            {
              id: "warehouse",
              header: activeLocaleHeader(d.stockColWarehouse),
              accessor: (row) => row.warehouseCode,
              mono: true,
              sortable: true,
              render: (row) => <span className="font-mono text-sm" dir="ltr">{row.warehouseCode}</span>,
            },
            {
              id: "qty",
              header: activeLocaleHeader(d.stockColQty),
              accessor: (row) => row.qty,
              numeric: true,
              sortable: true,
              render: (row) => (
                <span className="font-mono tabular-nums" dir="ltr">
                  {row.qty}
                  {row.negative && (
                    <Badge mono className="ms-2">
                      {d.stockNegativeBadge}
                    </Badge>
                  )}
                  {suspendedByItem.has(row.itemId) && (
                    <DutySuspendedChip label={d.tradeDutySuspendedChip} />
                  )}
                </span>
              ),
            },
            {
              id: "avgCost",
              header: activeLocaleHeader(d.stockColAvgCost),
              accessor: (row) => row.avgCost,
              numeric: true,
              sortable: true,
              render: (row) => (
                <span className="font-mono tabular-nums" dir="ltr">
                  {formatMoneyDisplay(row.avgCost, 6)}
                </span>
              ),
            },
          ]}
          rows={[...filtered]}
          rowKey={(row) => `${row.itemId}:${row.warehouseId}`}
          rowActions={[
            {
              id: "availability",
              label: d.commonOpen,
              onSelect: (row: StockOnHandRow) => void openAvailability(row),
            },
          ]}
          empty={{ title: d.stockEmpty }}
        />
      </Card>

      {suspendedBannerItem !== null ? (
        <DutySuspendedBanner
          move={suspendedByItem.get(suspendedBannerItem.itemId) ?? null}
          qty={suspendedQtyByItem.get(suspendedBannerItem.itemId) ?? null}
          locale={locale}
          d={d}
        />
      ) : null}

      {availability !== null && (
        <Card title={d.navInventoryStock}>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="flex flex-col gap-1">
              <dt className="text-xs text-muted-foreground">{d.stockColQty}</dt>
              <dd className="font-mono tabular-nums" dir="ltr">{availability.onHandQty}</dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-xs text-muted-foreground">{d.transfersStatusInTransit}</dt>
              <dd className="font-mono tabular-nums" dir="ltr">{availability.inTransitQty}</dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-xs text-muted-foreground">{d.countingColVariance}</dt>
              <dd className="font-mono tabular-nums" dir="ltr">{availability.reservedQty}</dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-xs text-muted-foreground">{d.stockTitle}</dt>
              <dd className="font-mono tabular-nums" dir="ltr">{availability.availableQty}</dd>
            </div>
          </dl>
          <div className="mt-3">
            <Button variant="ghost" onClick={() => setAvailability(null)}>
              {d.countingCloseSession}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
