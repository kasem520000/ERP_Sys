"use client";

/**
 * PHASE-044 (T-15) — the LPN move-by-scan card embedded in the transfer
 * screen: pick the plate, scan the target bin's barcode, the whole plate
 * (every qty>0 row, each KEEPING ITS OWN STATUS — a QUARANTINE pallet
 * stays quarantined) moves in one structural transaction. item_stock
 * never moves (INV-029 folds all slots).
 */
import { useState } from "react";
import type { JSX } from "react";

import { Button, DataTable, Input, Select } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type { WmsLpnRow } from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { localizedInventoryError } from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice, SuccessNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";

export function WmsLpnMover({ locale, lpns }: { locale: Locale; lpns: readonly WmsLpnRow[] }): JSX.Element {
  const d = getDictionary(locale);
  const rows = lpns;
  const [lpnId, setLpnId] = useState("");
  const [barcode, setBarcode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function move(): Promise<void> {
    if (lpnId === "" || barcode.trim() === "") {
      setError(d.errorsValidation);
      return;
    }
    setBusy("move");
    setError(null);
    setNotice(null);
    // The scan resolves to the bin first (the typed 404 on an unknown
    // barcode is honest), then the plate moves into it.
    const bin = await bffFetch<{ id: string }>(
      `inventory/wms/bins/barcode/${encodeURIComponent(barcode.trim())}`,
    );
    if (!bin.ok) {
      setBusy(null);
      setError(localizedInventoryError(d, bin.error, bin.retryAfterSeconds));
      return;
    }
    const moved = await bffFetch(`inventory/wms/lpns/${lpnId}/move`, {
      method: "POST",
      body: { toBinId: bin.data.id, note: null },
    });
    setBusy(null);
    if (!moved.ok) {
      setError(localizedInventoryError(d, moved.error, moved.retryAfterSeconds));
      return;
    }
    setBarcode("");
    setNotice(d.wmsLpnMovedToast);
  }

  return (
    <Card title={d.wmsLpnMoveTitle}>
      <div className="flex flex-col gap-4">
        {error !== null && <ErrorNotice>{error}</ErrorNotice>}
        {notice !== null && <SuccessNotice>{notice}</SuccessNotice>}

        <DataTable
          columns={[
            {
              id: "code",
              header: activeLocaleHeader(d.wmsLpnColCode),
              accessor: (row) => row.lpnCode,
              mono: true,
              render: (row) => (
                <span className="font-mono text-sm" dir="ltr">{row.lpnCode}</span>
              ),
            },
            {
              id: "status",
              header: activeLocaleHeader(d.wmsLpnColStatus),
              accessor: (row) => row.status,
              render: (row) => (row.status === "ACTIVE" ? d.wmsLpnActive : d.wmsLpnClosed),
            },
          ]}
          rows={[...rows]}
          rowKey={(row) => row.id}
          rowActions={[
            {
              id: "select",
              label: d.wmsLpnMoveBtn,
              onSelect: (row: WmsLpnRow) => {
                if (row.status !== "ACTIVE") return;
                setLpnId(row.id);
              },
            },
          ]}
          empty={{ title: d.wmsLpnEmpty }}
        />

        <div className="grid gap-3 sm:grid-cols-3">
          <Select
            label={d.wmsLpnTitle}
            value={lpnId}
            onValueChange={setLpnId}
            placeholder="—"
            options={rows
              .filter((row) => row.status === "ACTIVE")
              .map((row) => ({ value: row.id, label: row.lpnCode }))}
            required
          />
          <Input
            label={d.wmsLpnMoveTargetLabel}
            value={barcode}
            onValueChange={setBarcode}
            hint={d.wmsScanPlaceholder}
            mono
            bidiIsolate
            required
          />
          <Button variant="primary" className="self-end" loading={busy === "move"} onClick={() => void move()}>
            {d.wmsLpnMoveBtn}
          </Button>
        </div>
      </div>
    </Card>
  );
}
