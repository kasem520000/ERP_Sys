"use client";

/**
 * PHASE-044 (T-15/PP-11) — the bin-scan helper embedded in the count
 * screen: scan a bin barcode and its LIVE contents appear beside the
 * counting sheet (the counter sees exactly what sits in the slot without
 * walking back to a terminal). Read-only — the counted qty lands through
 * the count document's own lines.
 */
import { useState } from "react";
import type { JSX } from "react";

import { Button, DataTable, Input } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type { WmsBinContentRow, WmsBinRow } from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { localizedInventoryError } from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice, SuccessNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";

export function WmsBinScan({ locale }: { locale: Locale }): JSX.Element {
  const d = getDictionary(locale);
  const [barcode, setBarcode] = useState("");
  const [bin, setBin] = useState<WmsBinRow | null>(null);
  const [contents, setContents] = useState<readonly WmsBinContentRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function scan(): Promise<void> {
    if (barcode.trim() === "") {
      setError(d.errorsValidation);
      return;
    }
    setBusy("scan");
    setError(null);
    setNotice(null);
    const found = await bffFetch<WmsBinRow>(
      `inventory/wms/bins/barcode/${encodeURIComponent(barcode.trim())}`,
    );
    if (!found.ok) {
      setBusy(null);
      setError(localizedInventoryError(d, found.error, found.retryAfterSeconds));
      return;
    }
    const rows = await bffFetch<readonly WmsBinContentRow[]>(
      `inventory/wms/bin-contents?binId=${found.data.id}&limit=200`,
    );
    setBusy(null);
    if (!rows.ok) {
      setError(localizedInventoryError(d, rows.error, rows.retryAfterSeconds));
      return;
    }
    setBin(found.data);
    setContents(rows.data);
    setNotice(d.wmsCountScanLoaded);
  }

  const statusLabel = (status: string): string =>
    status === "AVAILABLE" ? d.wmsStatusAvailable :
    status === "QUARANTINE" ? d.wmsStatusQuarantine : d.wmsStatusHold;

  return (
    <Card title={d.wmsCountScanBin}>
      <div className="flex flex-col gap-4">
        {error !== null && <ErrorNotice>{error}</ErrorNotice>}
        {notice !== null && <SuccessNotice>{notice}</SuccessNotice>}

        <p className="text-sm text-muted-foreground">{d.wmsCountScanBinHint}</p>
        <div className="grid gap-3 sm:grid-cols-[2fr_auto]">
          <Input
            label={d.wmsScanLabel}
            value={barcode}
            onValueChange={setBarcode}
            hint={d.wmsScanPlaceholder}
            mono
            bidiIsolate
            required
          />
          <Button variant="primary" className="self-end" loading={busy === "scan"} onClick={() => void scan()}>
            {d.wmsScanSubmit}
          </Button>
        </div>

        {bin !== null && (
          <div data-testid="wms-bin-scan-contents">
            <p className="mb-2 text-sm font-medium">
              <span className="font-mono" dir="ltr">{bin.code}</span> · {bin.name}
            </p>
            <DataTable
              columns={[
                {
                  id: "item",
                  header: activeLocaleHeader(d.wmsLocationsContentsColItem),
                  accessor: (row) => row.itemSku ?? row.itemId,
                  mono: true,
                },
                {
                  id: "batch",
                  header: activeLocaleHeader(d.wmsLocationsContentsColBatch),
                  accessor: (row) => row.batchNo ?? "",
                  render: (row) => row.batchNo ?? "—",
                },
                {
                  id: "qty",
                  header: activeLocaleHeader(d.wmsLocationsContentsColQty),
                  accessor: (row) => row.qty,
                  mono: true,
                  render: (row) => (
                    <span className="font-mono text-sm" dir="ltr">{row.qty}</span>
                  ),
                },
                {
                  id: "status",
                  header: activeLocaleHeader(d.wmsLocationsContentsColStatus),
                  accessor: (row) => row.status,
                  render: (row) => statusLabel(row.status),
                },
                {
                  id: "lpn",
                  header: activeLocaleHeader(d.wmsLocationsContentsColLpn),
                  accessor: (row) => row.lpnCode ?? "",
                  render: (row) => row.lpnCode ?? "—",
                },
              ]}
              rows={[...contents]}
              rowKey={(row) => row.id}
              empty={{ title: d.wmsLocationsContentsEmpty }}
            />
          </div>
        )}
      </div>
    </Card>
  );
}
