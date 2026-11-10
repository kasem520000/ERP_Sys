"use client";

/**
 * P6-T11b — item barcodes section (detail page): tenant-wide scan-unique
 * codes bound to (item, uom). Adding POSTs `items/barcodes` — a taken code
 * (BARCODE_TAKEN) surfaces the localized error inline.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { FormEvent, JSX } from "react";

import { Button, DataTable, Input, Select, useToast } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type { BarcodeRow, UomRow } from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { localizedMasterDataError, localizedName } from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";

export function ItemBarcodes({
  locale,
  itemId,
  defaultUomId,
  uoms,
  rows,
}: {
  locale: Locale;
  itemId: string;
  defaultUomId: string;
  uoms: readonly UomRow[];
  rows: readonly BarcodeRow[];
}): JSX.Element {
  const d = getDictionary(locale);
  const router = useRouter();
  const { toast } = useToast();
  const [code, setCode] = useState("");
  const [uomId, setUomId] = useState(defaultUomId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    if (code.trim() === "" || uomId === "") {
      setError(d.errorsValidation);
      return;
    }
    setBusy(true);
    const result = await bffFetch<BarcodeRow>("items/barcodes", {
      method: "POST",
      body: { itemId, uomId, code: code.trim() },
    });
    setBusy(false);
    if (!result.ok) {
      setError(localizedMasterDataError(d, result.error, result.retryAfterSeconds));
      return;
    }
    toast({ tone: "success", title: d.itemSavedToast });
    setCode("");
    router.refresh();
  }

  return (
    <Card title={d.barcodesTitle} ariaLabel={d.barcodesTitle}>
      <DataTable
        columns={[
          {
            id: "code",
            header: activeLocaleHeader(d.barcodeCodeLabel),
            accessor: (row) => row.code,
            mono: true,
          },
          {
            id: "uom",
            header: activeLocaleHeader(d.itemUomLabel),
            accessor: (row) => {
              const uom = uoms.find((entry) => entry.id === row.uomId);
              return uom === undefined ? "" : localizedName(uom.name, uom.nameAr, locale);
            },
            render: (row) => {
              const uom = uoms.find((entry) => entry.id === row.uomId);
              return uom === undefined ? (
                <span className="text-gray-500">—</span>
              ) : (
                `${localizedName(uom.name, uom.nameAr, locale)} (${uom.code})`
              );
            },
          },
        ]}
        rows={[...rows]}
        rowKey={(row) => row.id}
        empty={{ title: d.barcodesEmpty }}
      />
      <form onSubmit={onSubmit} noValidate className="mt-4 grid gap-3 sm:grid-cols-2">
        <Input
          id="barcode-code"
          label={d.barcodeCodeLabel}
          value={code}
          onValueChange={setCode}
          mono
          bidiIsolate
          required
        />
        <Select
          id="barcode-uom"
          label={d.itemUomLabel}
          value={uomId}
          onValueChange={setUomId}
          options={uoms.map((uom) => ({
            value: uom.id,
            label: `${localizedName(uom.name, uom.nameAr, locale)} (${uom.code})`,
          }))}
          required
        />
        <div className="sm:col-span-2 flex items-center justify-end">
          <Button type="submit" variant="primary" loading={busy}>
            {d.barcodeAdd}
          </Button>
        </div>
      </form>
      {error !== null && <ErrorNotice className="mt-3">{error}</ErrorNotice>}
    </Card>
  );
}
