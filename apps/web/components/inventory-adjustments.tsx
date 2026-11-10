"use client";

/**
 * PHASE-035 (T-04) — the stock-adjustments register (List+Search archetype
 * §2; audit EVAL-F-2): a dedicated READ surface over the existing adjustment
 * journal flow (G-13/G-14 — previously reachable only through the stock-count
 * wizard's variance review). Posting stays where it is by design: no create /
 * post / cancel path here (the phase document records the intent; the muted
 * note says so in-product).
 */
import { useMemo, useState } from "react";
import type { JSX } from "react";

import { DataTable, DocumentStatusBadge, SearchInput, Select } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type { StockAdjustmentRow, WarehouseRow } from "../lib/api-types";
import { localizedMoveReason } from "../lib/messages";
import { Card } from "./card";
import { activeLocaleHeader } from "./table-header";

export function InventoryAdjustments({
  locale,
  initialRows,
  warehouses,
}: {
  locale: Locale;
  initialRows: readonly StockAdjustmentRow[];
  warehouses: readonly WarehouseRow[];
}): JSX.Element {
  const d = getDictionary(locale);
  const [rows] = useState<readonly StockAdjustmentRow[]>(initialRows);
  const [warehouseId, setWarehouseId] = useState("");
  const [status, setStatus] = useState("");
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (warehouseId !== "" && row.warehouseId !== warehouseId) return false;
      if (status !== "" && row.status !== status) return false;
      if (needle === "") return true;
      return (
        row.sku.toLowerCase().includes(needle) ||
        row.itemName.toLowerCase().includes(needle) ||
        (row.adjustmentNo ?? "").toLowerCase().includes(needle) ||
        (row.note ?? "").toLowerCase().includes(needle) ||
        (row.noteAr ?? "").toLowerCase().includes(needle)
      );
    });
  }, [rows, warehouseId, status, query]);

  return (
    <div className="flex flex-col gap-4">
      <Card title={d.adjustmentsTitle}>
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
            label={d.adjustmentsFilterStatus}
            value={status}
            onValueChange={setStatus}
            placeholder="—"
            options={[
              { value: "DRAFT", label: d.adjustmentsStatusDraft },
              { value: "POSTED", label: d.adjustmentsStatusPosted },
              { value: "CANCELLED", label: d.adjustmentsStatusCancelled },
            ]}
            className="lg:w-44"
          />
          <SearchInput
            label={d.adjustmentsSearchLabel}
            value={query}
            onValueChange={setQuery}
            className="lg:max-w-xs"
          />
        </div>
        <DataTable
          columns={[
            {
              id: "adjustmentNo",
              header: activeLocaleHeader(d.adjustmentsColNo),
              accessor: (row) => row.adjustmentNo ?? "",
              mono: true,
              sortable: true,
              render: (row) =>
                row.adjustmentNo === null ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  <span className="font-mono text-sm" dir="ltr">{row.adjustmentNo}</span>
                ),
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
              id: "item",
              header: activeLocaleHeader(d.adjustmentsColItem),
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
              id: "reason",
              header: activeLocaleHeader(d.movesColReason),
              accessor: (row) => row.reason,
              render: (row) => localizedMoveReason(d, row.reason),
            },
            {
              id: "deltaQty",
              header: activeLocaleHeader(d.adjustmentsColDelta),
              accessor: (row) => row.deltaQty,
              numeric: true,
              sortable: true,
              render: (row) => (
                <span className="font-mono tabular-nums" dir="ltr">
                  {Number(row.deltaQty) > 0 ? `+${row.deltaQty}` : row.deltaQty}
                </span>
              ),
            },
            {
              id: "status",
              header: activeLocaleHeader(d.accountingColStatus),
              accessor: (row) => row.status,
              render: (row) => (
                <DocumentStatusBadge
                  status={row.status}
                  label={
                    row.status === "DRAFT"
                      ? d.adjustmentsStatusDraft
                      : row.status === "POSTED"
                        ? d.adjustmentsStatusPosted
                        : d.adjustmentsStatusCancelled
                  }
                />
              ),
            },
            {
              id: "postingDate",
              header: activeLocaleHeader(d.adjustmentsColPostingDate),
              accessor: (row) => row.postingDate ?? "",
              mono: true,
              sortable: true,
              render: (row) =>
                row.postingDate === null ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  <span className="font-mono text-sm" dir="ltr">{row.postingDate.slice(0, 10)}</span>
                ),
            },
            {
              id: "note",
              header: activeLocaleHeader(d.adjustmentsColNote),
              accessor: (row) => row.note ?? "",
              render: (row) =>
                row.note === null && row.noteAr === null ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  (locale === "ar" ? row.noteAr ?? row.note : row.note ?? row.noteAr) ?? "—"
                ),
            },
          ]}
          rows={[...filtered]}
          rowKey={(row) => row.id}
          empty={{ title: d.adjustmentsEmpty }}
        />
      </Card>
      <p className="text-xs text-muted-foreground">{d.adjustmentsReadNote}</p>
    </div>
  );
}
