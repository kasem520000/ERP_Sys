"use client";

/**
 * T14-UI (PHASE-010) — the transfer wizard (Wizard archetype §9 flattened to
 * the document list + create form): DRAFT → dispatch (writes the OUT leg +
 * G-15 journal when the warehouses map distinct inventory accounts) →
 * receive (IN leg, POSTED). IN_TRANSIT stock is visible but never sellable
 * (BR-016) — the badge carries the state. Cancel is draft-only.
 */
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { JSX } from "react";

import { Button, DataTable, DocumentStatusBadge, Input, Select } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type { ItemRow, StockTransferRow, WarehouseRow } from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import {
  localizedDocumentStatus,
  localizedInventoryError,
} from "../lib/messages";
import { isPositiveDecimal } from "../lib/exact-money";
import { Card } from "./card";
import { ErrorNotice, SuccessNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";

interface TransferLineDraft {
  key: number;
  itemId: string;
  qty: string;
}

let lineSeq = 0;

function newLine(): TransferLineDraft {
  lineSeq += 1;
  return { key: lineSeq, itemId: "", qty: "" };
}

export function InventoryTransfers({
  locale,
  initialRows,
  warehouses,
  items,
  canCreate,
  canApprove,
}: {
  locale: Locale;
  initialRows: readonly StockTransferRow[];
  warehouses: readonly WarehouseRow[];
  items: readonly ItemRow[];
  canCreate: boolean;
  canApprove: boolean;
}): JSX.Element {
  const d = getDictionary(locale);
  const router = useRouter();
  const [rows, setRows] = useState<readonly StockTransferRow[]>(initialRows);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Create form state (the wizard's line grid).
  const [fromWarehouseId, setFromWarehouseId] = useState("");
  const [toWarehouseId, setToWarehouseId] = useState("");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<TransferLineDraft[]>([newLine()]);

  const activeWarehouses = useMemo(
    () => warehouses.filter((warehouse) => warehouse.isActive),
    [warehouses],
  );
  const stockItems = useMemo(() => items.filter((item) => item.kind === "STOCK"), [items]);
  const sameWarehouse = fromWarehouseId !== "" && fromWarehouseId === toWarehouseId;
  const linesValid =
    lines.length >= 1 &&
    lines.every((line) => line.itemId !== "" && isPositiveDecimal(line.qty));

  async function act(
    row: StockTransferRow,
    action: "dispatch" | "receive" | "cancel",
  ): Promise<void> {
    setError(null);
    setNotice(null);
    setBusy(row.id);
    const result = await bffFetch<StockTransferRow>(`inventory/transfers/${row.id}/${action}`, {
      method: "POST",
      body: {},
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedInventoryError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setRows((current) => current.map((entry) => (entry.id === row.id ? result.data : entry)));
    if (action === "dispatch") setNotice(d.transfersDispatchedToast);
    else if (action === "receive") setNotice(d.transfersReceivedToast);
    else setNotice(d.transfersCancelledToast);
    router.refresh();
  }

  async function createTransfer(): Promise<void> {
    setError(null);
    setNotice(null);
    setBusy("create");
    const created = await bffFetch<StockTransferRow>("inventory/transfers", {
      method: "POST",
      body: {
        fromWarehouseId,
        toWarehouseId,
        lines: lines.map((line) => ({ itemId: line.itemId, qty: line.qty })),
        note: note.trim() === "" ? null : note.trim(),
      },
    });
    setBusy(null);
    if (!created.ok) {
      setError(localizedInventoryError(d, created.error, created.retryAfterSeconds));
      return;
    }
    setRows((current) => [created.data, ...current]);
    setLines([newLine()]);
    setNote("");
    setNotice(d.transfersCreatedToast);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
      {notice !== null && <SuccessNotice>{notice}</SuccessNotice>}

      <Card title={d.transfersTitle}>
        <DataTable
          columns={[
            {
              id: "no",
              header: activeLocaleHeader(d.transfersColNo),
              accessor: (row) => row.transferNo ?? "",
              mono: true,
              sortable: true,
              render: (row) =>
                row.transferNo === null ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  <span className="font-mono text-sm" dir="ltr">{row.transferNo}</span>
                ),
            },
            {
              id: "from",
              header: activeLocaleHeader(d.transfersColFrom),
              accessor: (row) => row.fromWarehouseCode,
              mono: true,
              render: (row) => <span className="font-mono text-sm" dir="ltr">{row.fromWarehouseCode}</span>,
            },
            {
              id: "to",
              header: activeLocaleHeader(d.transfersColTo),
              accessor: (row) => row.toWarehouseCode,
              mono: true,
              render: (row) => <span className="font-mono text-sm" dir="ltr">{row.toWarehouseCode}</span>,
            },
            {
              id: "lines",
              header: activeLocaleHeader(d.transfersColLines),
              accessor: (row) => String(row.lineCount),
              numeric: true,
            },
            {
              id: "dispatchDate",
              header: activeLocaleHeader(d.transfersColDispatchDate),
              accessor: (row) => row.dispatchDate ?? "",
              mono: true,
              render: (row) =>
                row.dispatchDate === null ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  <span className="font-mono text-sm" dir="ltr">{row.dispatchDate}</span>
                ),
            },
            {
              id: "receiveDate",
              header: activeLocaleHeader(d.transfersColReceiveDate),
              accessor: (row) => row.receiveDate ?? "",
              mono: true,
              render: (row) =>
                row.receiveDate === null ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  <span className="font-mono text-sm" dir="ltr">{row.receiveDate}</span>
                ),
            },
            {
              id: "status",
              header: activeLocaleHeader(d.accountingColStatus),
              accessor: (row) => row.status,
              render: (row) => (
                <DocumentStatusBadge
                  status={
                    row.status === "IN_TRANSIT"
                      ? "PENDING_APPROVAL"
                      : (row.status as "DRAFT" | "POSTED" | "CANCELLED")
                  }
                  label={
                    row.status === "IN_TRANSIT"
                      ? d.transfersStatusInTransit
                      : localizedDocumentStatus(d, row.status)
                  }
                />
              ),
            },
          ]}
          rows={[...rows]}
          rowKey={(row) => row.id}
          rowActions={[
            ...(canCreate
              ? [
                  {
                    id: "dispatch",
                    label: d.transfersDispatch,
                    onSelect: (row: StockTransferRow) => {
                      if (row.status !== "DRAFT") return;
                      void act(row, "dispatch");
                    },
                  },
                  {
                    id: "cancel",
                    label: d.transfersCancel,
                    danger: true,
                    onSelect: (row: StockTransferRow) => {
                      if (row.status !== "DRAFT") return;
                      void act(row, "cancel");
                    },
                  },
                ]
              : []),
            ...(canApprove
              ? [
                  {
                    id: "receive",
                    label: d.transfersReceive,
                    onSelect: (row: StockTransferRow) => {
                      if (row.status !== "IN_TRANSIT") return;
                      void act(row, "receive");
                    },
                  },
                ]
              : []),
          ]}
          empty={{ title: d.transfersEmpty }}
        />
      </Card>

      {canCreate && (
        <Card title={d.transfersNewTitle}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Select
              label={d.transfersFromLabel}
              value={fromWarehouseId}
              onValueChange={setFromWarehouseId}
              placeholder="—"
              options={activeWarehouses.map((warehouse) => ({
                value: warehouse.id,
                label: `${warehouse.code} · ${warehouse.name}`,
              }))}
              error={sameWarehouse ? d.transfersSameWarehouseError : undefined}
              required
            />
            <Select
              label={d.transfersToLabel}
              value={toWarehouseId}
              onValueChange={setToWarehouseId}
              placeholder="—"
              options={activeWarehouses.map((warehouse) => ({
                value: warehouse.id,
                label: `${warehouse.code} · ${warehouse.name}`,
              }))}
              error={sameWarehouse ? d.transfersSameWarehouseError : undefined}
              required
            />
            <Input label={d.transfersNoteLabel} value={note} onValueChange={setNote} />
          </div>

          <div className="mt-4 flex flex-col gap-3">
            <h3 className="text-sm font-medium">{d.transfersLinesTitle}</h3>
            {lines.map((line, index) => (
              <div key={line.key} className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Select
                  label={index === 0 ? d.transfersLineItemLabel : undefined}
                  value={line.itemId}
                  onValueChange={(value) =>
                    setLines((current) =>
                      current.map((entry) => (entry.key === line.key ? { ...entry, itemId: value } : entry)),
                    )
                  }
                  placeholder="—"
                  options={stockItems.map((item) => ({
                    value: item.id,
                    label: `${item.sku} · ${item.name}`,
                  }))}
                  className="sm:flex-1"
                  required
                />
                <Input
                  label={index === 0 ? d.transfersLineQtyLabel : undefined}
                  value={line.qty}
                  onValueChange={(value) =>
                    setLines((current) =>
                      current.map((entry) => (entry.key === line.key ? { ...entry, qty: value } : entry)),
                    )
                  }
                  inputMode="decimal"
                  mono
                  bidiIsolate
                  className="sm:w-36"
                  required
                />
                <Button
                  variant="ghost"
                  disabled={lines.length === 1}
                  onClick={() =>
                    setLines((current) => current.filter((entry) => entry.key !== line.key))
                  }
                  className="sm:mt-4"
                >
                  {d.transfersRemoveLine}
                </Button>
              </div>
            ))}
            {!linesValid && lines.length > 0 && lines.some((line) => line.itemId !== "" || line.qty !== "") && (
              <p className="text-xs text-muted-foreground">{d.transfersLineMissingError}</p>
            )}
            <div className="flex gap-2 self-start">
              <Button variant="secondary" onClick={() => setLines((current) => [...current, newLine()])}>
                {d.transfersAddLine}
              </Button>
              <Button
                variant="primary"
                loading={busy === "create"}
                disabled={
                  fromWarehouseId === "" ||
                  toWarehouseId === "" ||
                  sameWarehouse ||
                  !linesValid
                }
                onClick={() => void createTransfer()}
              >
                {d.commonCreate}
              </Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
