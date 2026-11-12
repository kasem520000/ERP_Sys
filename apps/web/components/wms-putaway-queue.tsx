"use client";

/**
 * PHASE-044 (T-15/PP-12) — the directed-putaway queue embedded in the
 * goods-receipt screen: the open PUTAWAY tasks with their directed bins,
 * the scan confirmation (the scanned barcode MUST resolve to the task's
 * target bin — a wrong-bin scan is the typed rejection with zero
 * residue), and the immediate bin-label print (PP-12's fixed
 * BIN-LABEL-V1). Structural moves only — item_stock never moves here
 * (the movement core owns the economic write inside the SAME
 * transaction).
 */
import { useState } from "react";
import type { JSX } from "react";

import { Button, DataTable, Input, Select } from "@erp/ui";
import { renderReceipt58, type ReceiptPayload } from "@erp/ui/print";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type { WmsBinLabelPayload, WmsPutawayConfirmResult, WmsTaskRow } from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { localizedInventoryError } from "../lib/messages";
import { printHtmlDocument } from "../lib/print-frame";
import { Card } from "./card";
import { ErrorNotice, SuccessNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";

/**
 * PP-12's fixed label body (BIN-LABEL-V1) rendered through the sanctioned
 * receipt-58 roll template (the 58mm sticker medium; the template designer
 * arrives with PHASE-062 — the payload contract never moves). The label's
 * headline is the ITEM, the doc line is the BIN, and the data rows carry
 * qty/batch/LPN + the scan-stable barcode.
 */
function binLabelHtml(label: WmsBinLabelPayload, locale: Locale): string {
  const payload: ReceiptPayload = {
    template: "receipt-58",
    locale,
    merchantName: `${label.item.sku ?? ""} ${label.item.name ?? ""}`.trim(),
    docNo: label.bin.code,
    items: [
      {
        name: label.bin.barcode,
        qty: label.qty,
        price: "1",
        total: label.qty,
      },
      ...(label.batch.batchNo !== null
        ? [
            {
              name: `BATCH ${label.batch.batchNo}${label.batch.expiryDate !== null ? ` · EXP ${label.batch.expiryDate}` : ""}`,
              qty: "—",
              price: "—",
              total: "—",
            },
          ]
        : []),
      ...(label.lpn.lpnCode !== null
        ? [{ name: `LPN ${label.lpn.lpnCode}`, qty: "—", price: "—", total: "—" }]
        : []),
    ],
    totals: [{ label: label.labelFormat, amount: label.bin.barcode }],
    paymentMethod: label.generatedAt,
    condensed: true,
  };
  return renderReceipt58(payload);
}

export function WmsPutawayQueue({
  locale,
  initialTasks,
  canConfirm,
}: {
  locale: Locale;
  initialTasks: readonly WmsTaskRow[];
  canConfirm: boolean;
}): JSX.Element {
  const d = getDictionary(locale);
  const [tasks, setTasks] = useState<readonly WmsTaskRow[]>(initialTasks);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [taskId, setTaskId] = useState("");
  const [barcode, setBarcode] = useState("");

  async function confirm(): Promise<void> {
    if (taskId === "" || barcode.trim() === "") {
      setError(d.errorsValidation);
      return;
    }
    setBusy("confirm");
    setError(null);
    setNotice(null);
    const result = await bffFetch<WmsPutawayConfirmResult>(
      `inventory/wms/putaway/tasks/${taskId}/confirm`,
      {
        method: "POST",
        body: { scannedBarcode: barcode.trim() },
      },
    );
    setBusy(null);
    if (!result.ok) {
      setError(localizedInventoryError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setTasks((rows) => rows.map((row) => (row.id === taskId ? result.data.task : row)));
    setBarcode("");
    setNotice(d.wmsPutawayConfirmedToast);
    // PP-12: the label prints immediately after the receipt-side confirm.
    printHtmlDocument(binLabelHtml(result.data.label, locale));
  }

  async function printLabel(row: WmsTaskRow): Promise<void> {
    setBusy(`label-${row.id}`);
    setError(null);
    const result = await bffFetch<WmsBinLabelPayload>(`inventory/wms/putaway/tasks/${row.id}/label`);
    setBusy(null);
    if (!result.ok) {
      setError(localizedInventoryError(d, result.error, result.retryAfterSeconds));
      return;
    }
    printHtmlDocument(binLabelHtml(result.data, locale));
  }

  const openTasks = tasks.filter((row) => row.status !== "COMPLETED" && row.status !== "CANCELLED");

  return (
    <Card title={d.wmsPutawayQueueTitle}>
      <div className="flex flex-col gap-4">
        {error !== null && <ErrorNotice>{error}</ErrorNotice>}
        {notice !== null && <SuccessNotice>{notice}</SuccessNotice>}

        <DataTable
          columns={[
            {
              id: "item",
              header: activeLocaleHeader(d.wmsWavesColItem),
              accessor: (row) => row.itemSku ?? row.itemId,
              mono: true,
            },
            {
              id: "qty",
              header: activeLocaleHeader(d.wmsWavesColQty),
              accessor: (row) => row.qty,
              mono: true,
              render: (row) => (
                <span className="font-mono text-sm" dir="ltr">{row.qty}</span>
              ),
            },
            {
              id: "from",
              header: activeLocaleHeader(d.wmsWavesColFromBin),
              accessor: (row) => row.fromBinCode ?? "",
              mono: true,
              render: (row) => (
                <span className="font-mono text-sm" dir="ltr">{row.fromBinCode ?? "—"}</span>
              ),
            },
            {
              id: "to",
              header: activeLocaleHeader(d.wmsPutawayColTarget),
              accessor: (row) => row.toBinCode ?? "",
              mono: true,
              render: (row) => (
                <span className="font-mono text-sm" dir="ltr">{row.toBinCode ?? "—"}</span>
              ),
            },
            {
              id: "status",
              header: activeLocaleHeader(d.wmsWavesColStatus),
              accessor: (row) => row.status,
              render: (row) =>
                row.status === "COMPLETED" ? d.wmsTaskStatusCompleted :
                row.status === "CANCELLED" ? d.wmsTaskStatusCancelled :
                row.status === "IN_PROGRESS" ? d.wmsTaskStatusInProgress :
                row.status === "ASSIGNED" ? d.wmsTaskStatusAssigned : d.wmsTaskStatusPending,
            },
          ]}
          rows={[...tasks]}
          rowKey={(row) => row.id}
          rowActions={
            canConfirm
              ? [
                  {
                    id: "label",
                    label: d.wmsPutawayPrintLabel,
                    onSelect: (row: WmsTaskRow) => {
                      void printLabel(row);
                    },
                  },
                  {
                    id: "select",
                    label: d.wmsPutawayConfirmBtn,
                    onSelect: (row: WmsTaskRow) => {
                      setTaskId(row.id);
                    },
                  },
                ]
              : []
          }
          empty={{ title: d.wmsPutawayQueueEmpty }}
        />

        {canConfirm && openTasks.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-3">
            <Select
              label={d.wmsWavesColTask}
              value={taskId}
              onValueChange={setTaskId}
              placeholder="—"
              options={openTasks.map((row) => ({
                value: row.id,
                label: `${row.itemSku ?? ""} → ${row.toBinCode ?? ""}`,
              }))}
              required
            />
            <Input
              label={d.wmsScanLabel}
              value={barcode}
              onValueChange={setBarcode}
              hint={d.wmsScanPlaceholder}
              mono
              bidiIsolate
              required
            />
            <Button variant="primary" className="self-end" loading={busy === "confirm"} onClick={() => void confirm()}>
              {d.wmsPutawayConfirmBtn}
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}
