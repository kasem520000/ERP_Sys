"use client";

/**
 * T14-UI (PHASE-010) — the movement ledger (List+Search archetype §2): the
 * append-only stock_moves trail (INV-010 substrate — direction, kind, qty,
 * unit cost, value, batch/serial when tracked, provenance source) with
 * direction/kind/warehouse filters. Read-only: the module exposes no
 * UPDATE/DELETE path and neither does this screen.
 */
import { useMemo, useState } from "react";
import type { JSX } from "react";

import { DataTable, DocumentStatusBadge, SearchInput, Select, formatMoneyDisplay } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type { StockMoveRow, WarehouseRow } from "../lib/api-types";
import {
  localizedMoveDirection,
  localizedMoveKind,
  localizedMoveReason,
} from "../lib/messages";
import { Card } from "./card";
import { activeLocaleHeader } from "./table-header";

export function InventoryMoves({
  locale,
  initialRows,
  warehouses,
}: {
  locale: Locale;
  initialRows: readonly StockMoveRow[];
  warehouses: readonly WarehouseRow[];
}): JSX.Element {
  const d = getDictionary(locale);
  const [rows] = useState<readonly StockMoveRow[]>(initialRows);
  const [warehouseId, setWarehouseId] = useState("");
  const [direction, setDirection] = useState("");
  const [moveKind, setMoveKind] = useState("");
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (warehouseId !== "" && row.warehouseId !== warehouseId) return false;
      if (direction !== "" && row.direction !== direction) return false;
      if (moveKind !== "" && row.moveKind !== moveKind) return false;
      if (needle === "") return true;
      return (
        row.sku.toLowerCase().includes(needle) ||
        row.itemName.toLowerCase().includes(needle) ||
        (row.batchNo ?? "").toLowerCase().includes(needle) ||
        (row.serialNo ?? "").toLowerCase().includes(needle)
      );
    });
  }, [rows, warehouseId, direction, moveKind, query]);

  return (
    <div className="flex flex-col gap-4">
      <Card title={d.movesTitle}>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
          <Select
            label={d.stockFilterWarehouse}
            value={warehouseId}
            onValueChange={setWarehouseId}
            placeholder="—"
            options={warehouses.map((warehouse) => ({
              value: warehouse.id,
              label: `${warehouse.code} · ${warehouse.name}`,
            }))}
            className="lg:w-56"
          />
          <Select
            label={d.movesFilterDirection}
            value={direction}
            onValueChange={setDirection}
            placeholder="—"
            options={[
              { value: "IN", label: d.movesDirectionIn },
              { value: "OUT", label: d.movesDirectionOut },
            ]}
            className="lg:w-44"
          />
          <Select
            label={d.movesFilterKind}
            value={moveKind}
            onValueChange={setMoveKind}
            placeholder="—"
            options={[
              { value: "receipt", label: d.movesKindReceipt },
              { value: "issue", label: d.movesKindIssue },
              { value: "transfer_in", label: d.movesKindTransferIn },
              { value: "transfer_out", label: d.movesKindTransferOut },
              { value: "adjust", label: d.movesKindAdjust },
            ]}
            className="lg:w-48"
          />
          <SearchInput
            label={d.countingPickSearchPlaceholder}
            value={query}
            onValueChange={setQuery}
            className="lg:max-w-xs"
          />
        </div>
        <DataTable
          columns={[
            {
              id: "date",
              header: activeLocaleHeader(d.movesColDate),
              accessor: (row) => row.movedAt,
              mono: true,
              sortable: true,
              render: (row) => <span className="font-mono text-sm" dir="ltr">{row.movedAt}</span>,
            },
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
              id: "warehouse",
              header: activeLocaleHeader(d.stockColWarehouse),
              accessor: (row) => row.warehouseCode,
              mono: true,
              sortable: true,
              render: (row) => <span className="font-mono text-sm" dir="ltr">{row.warehouseCode}</span>,
            },
            {
              id: "direction",
              header: activeLocaleHeader(d.movesColDirection),
              accessor: (row) => row.direction,
              render: (row) => (
                <DocumentStatusBadge
                  status={row.direction === "IN" ? "POSTED" : "DRAFT"}
                  label={localizedMoveDirection(d, row.direction)}
                  showIcon={false}
                />
              ),
            },
            {
              id: "kind",
              header: activeLocaleHeader(d.movesColKind),
              accessor: (row) => row.moveKind,
              render: (row) => localizedMoveKind(d, row.moveKind),
            },
            {
              id: "qty",
              header: activeLocaleHeader(d.stockColQty),
              accessor: (row) => row.qty,
              numeric: true,
              sortable: true,
              render: (row) => <span className="font-mono tabular-nums" dir="ltr">{row.qty}</span>,
            },
            {
              id: "unitCost",
              header: activeLocaleHeader(d.movesColUnitCost),
              accessor: (row) => row.unitCost,
              numeric: true,
              render: (row) => (
                <span className="font-mono tabular-nums" dir="ltr">
                  {formatMoneyDisplay(row.unitCost, 6)}
                </span>
              ),
            },
            {
              id: "value",
              header: activeLocaleHeader(d.movesColValue),
              accessor: (row) => row.valueAmount,
              numeric: true,
              sortable: true,
              render: (row) => (
                <span className="font-mono tabular-nums" dir="ltr">
                  {formatMoneyDisplay(row.valueAmount, 2)}
                </span>
              ),
            },
            {
              id: "batch",
              header: activeLocaleHeader(d.movesColBatch),
              accessor: (row) => row.batchNo ?? "",
              render: (row) =>
                row.batchNo === null ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  <span className="font-mono text-sm" dir="ltr">{row.batchNo}</span>
                ),
            },
            {
              id: "serial",
              header: activeLocaleHeader(d.movesColSerial),
              accessor: (row) => row.serialNo ?? "",
              render: (row) =>
                row.serialNo === null ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  <span className="font-mono text-sm" dir="ltr">{row.serialNo}</span>
                ),
            },
            {
              id: "reason",
              header: activeLocaleHeader(d.movesColReason),
              accessor: (row) => row.reason ?? "",
              render: (row) =>
                row.reason === null ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  localizedMoveReason(d, row.reason)
                ),
            },
          ]}
          rows={[...filtered]}
          rowKey={(row) => row.id}
          empty={{ title: d.movesEmpty }}
        />
      </Card>
    </div>
  );
}
