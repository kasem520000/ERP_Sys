"use client";

/**
 * PHASE-035 (T-02) — the batch/expiry registry (List+Search archetype §2; audit
 * EVAL-F-1): the tenant batch list (item, batch no, expiry, source, ACTIVE /
 * WRITTEN_OFF state) with the expired-only filter and search, plus register
 * (POST /inventory/batches) and the expiry write-off flow (POST
 * /inventory/batches/:id/write-off — one EXPIRED manual-issue journal; the
 * phase-010 discipline). Both mutations sit under inventory.tracking.manage.
 */
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { JSX } from "react";

import {
  Badge,
  Button,
  DataTable,
  DatePicker,
  DocumentStatusBadge,
  Input,
  SearchInput,
  Select,
} from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type { BatchRow, ItemRow, WarehouseRow } from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { localizedInventoryError, localizedName } from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice, SuccessNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";

function isExpired(expiryDate: string | null): boolean {
  if (expiryDate === null) return false;
  return expiryDate < new Date().toISOString().slice(0, 10);
}

function batchBadgeStatus(status: string): "POSTED" | "CANCELLED" {
  return status === "ACTIVE" ? "POSTED" : "CANCELLED";
}

export function InventoryBatches({
  locale,
  initialRows,
  items,
  warehouses,
  canManage,
}: {
  locale: Locale;
  initialRows: readonly BatchRow[];
  items: readonly ItemRow[];
  warehouses: readonly WarehouseRow[];
  canManage: boolean;
}): JSX.Element {
  const d = getDictionary(locale);
  const router = useRouter();
  const [rows, setRows] = useState<readonly BatchRow[]>(initialRows);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Filters.
  const [expiredOnly, setExpiredOnly] = useState("");
  const [query, setQuery] = useState("");

  // Register form state.
  const [itemId, setItemId] = useState("");
  const [batchNo, setBatchNo] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [sourceRef, setSourceRef] = useState("");

  // Write-off state (the selected batch + its form).
  const [writeOffId, setWriteOffId] = useState<string | null>(null);
  const [writeOffWarehouse, setWriteOffWarehouse] = useState("");
  const [writeOffDate, setWriteOffDate] = useState("");

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (expiredOnly === "true" && !isExpired(row.expiryDate)) return false;
      if (needle === "") return true;
      return (
        row.sku.toLowerCase().includes(needle) ||
        row.batchNo.toLowerCase().includes(needle) ||
        (row.sourceRef ?? "").toLowerCase().includes(needle)
      );
    });
  }, [rows, expiredOnly, query]);

  const writeOffRow = rows.find((row) => row.id === writeOffId);
  const formReady = itemId !== "" && batchNo.trim().length >= 1;
  const writeOffReady =
    writeOffWarehouse !== "" && writeOffDate !== "" && writeOffRow !== undefined;

  async function registerBatch(): Promise<void> {
    setError(null);
    setNotice(null);
    setBusy("create");
    const created = await bffFetch<BatchRow>("inventory/batches", {
      method: "POST",
      body: {
        itemId,
        batchNo: batchNo.trim(),
        expiryDate: expiryDate === "" ? null : expiryDate,
        sourceRef: sourceRef.trim() === "" ? null : sourceRef.trim(),
      },
    });
    setBusy(null);
    if (!created.ok) {
      setError(localizedInventoryError(d, created.error, created.retryAfterSeconds));
      return;
    }
    setRows((current) => [created.data, ...current]);
    setBatchNo("");
    setExpiryDate("");
    setSourceRef("");
    setNotice(d.batchesCreatedToast);
    router.refresh();
  }

  async function writeOffBatch(): Promise<void> {
    if (writeOffRow === undefined) return;
    setError(null);
    setNotice(null);
    setBusy(writeOffRow.id);
    const result = await bffFetch<{ batchNo: string; qty: string }>(
      `inventory/batches/${writeOffRow.id}/write-off`,
      {
        method: "POST",
        body: { warehouseId: writeOffWarehouse, valueDate: writeOffDate },
      },
    );
    setBusy(null);
    if (!result.ok) {
      setError(localizedInventoryError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setRows((current) =>
      current.map((row) =>
        row.id === writeOffRow.id ? { ...row, status: "WRITTEN_OFF" } : row,
      ),
    );
    setWriteOffId(null);
    setWriteOffWarehouse("");
    setWriteOffDate("");
    setNotice(d.batchesWrittenOffToast);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
      {notice !== null && <SuccessNotice>{notice}</SuccessNotice>}

      <Card title={d.batchesTitle}>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
          <Select
            label={d.batchesFilterExpired}
            value={expiredOnly}
            onValueChange={setExpiredOnly}
            placeholder="—"
            options={[
              { value: "true", label: d.batchesExpiredOnly },
            ]}
            className="lg:w-48"
          />
          <SearchInput
            label={d.batchesSearchLabel}
            value={query}
            onValueChange={setQuery}
            className="lg:max-w-xs"
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
              id: "batchNo",
              header: activeLocaleHeader(d.batchesColNo),
              accessor: (row) => row.batchNo,
              mono: true,
              sortable: true,
              render: (row) => <span className="font-mono text-sm" dir="ltr">{row.batchNo}</span>,
            },
            {
              id: "expiry",
              header: activeLocaleHeader(d.batchesColExpiry),
              accessor: (row) => row.expiryDate ?? "",
              mono: true,
              sortable: true,
              render: (row) =>
                row.expiryDate === null ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  <span className="font-mono text-sm" dir="ltr">
                    {row.expiryDate}
                    {isExpired(row.expiryDate) && row.status === "ACTIVE" && (
                      <Badge mono className="ms-2">
                        {d.batchesExpiredBadge}
                      </Badge>
                    )}
                  </span>
                ),
            },
            {
              id: "sourceRef",
              header: activeLocaleHeader(d.batchesColSource),
              accessor: (row) => row.sourceRef ?? "",
              render: (row) =>
                row.sourceRef === null ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  <span className="font-mono text-sm" dir="ltr">{row.sourceRef}</span>
                ),
            },
            {
              id: "status",
              header: activeLocaleHeader(d.accountingColStatus),
              accessor: (row) => row.status,
              render: (row) => (
                <DocumentStatusBadge
                  status={batchBadgeStatus(row.status)}
                  label={row.status === "ACTIVE" ? d.batchesStatusActive : d.batchesStatusWrittenOff}
                />
              ),
            },
          ]}
          rows={[...filtered]}
          rowKey={(row) => row.id}
          rowActions={
            canManage
              ? [
                  {
                    id: "write-off",
                    label: d.batchesWriteOff,
                    onSelect: (row: BatchRow) => {
                      setWriteOffId(row.id);
                      setWriteOffWarehouse("");
                      setWriteOffDate("");
                    },
                  },
                ]
              : undefined
          }
          empty={{ title: d.batchesEmpty }}
        />
      </Card>

      {canManage && (
        <Card title={d.batchesNewTitle}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Select
              label={d.batchesItemLabel}
              value={itemId}
              onValueChange={setItemId}
              placeholder="—"
              options={items.map((item) => ({
                value: item.id,
                label: `${item.sku} · ${localizedName(item.name, item.nameAr, locale)}`,
              }))}
            />
            <Input
              label={d.batchesNoLabel}
              value={batchNo}
              onValueChange={setBatchNo}
              mono
              bidiIsolate
            />
            <DatePicker
              locale={locale}
              label={d.batchesExpiryLabel}
              value={expiryDate}
              onSelect={setExpiryDate}
            />
            <Input
              label={d.batchesSourceLabel}
              value={sourceRef}
              onValueChange={setSourceRef}
              mono
              bidiIsolate
            />
          </div>
          <div className="mt-3">
            <Button disabled={!formReady || busy === "create"} onClick={() => void registerBatch()}>
              {d.batchesCreate}
            </Button>
          </div>
        </Card>
      )}

      {canManage && writeOffRow !== undefined && (
        <Card title={`${d.batchesWriteOffTitle} · ${writeOffRow.batchNo}`}>
          <p className="text-xs text-muted-foreground">{d.batchesWriteOffHint}</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Select
              label={d.stockFilterWarehouse}
              value={writeOffWarehouse}
              onValueChange={setWriteOffWarehouse}
              placeholder="—"
              options={warehouses.map((warehouse) => ({
                value: warehouse.id,
                label: `${warehouse.code} · ${warehouse.name}`,
              }))}
            />
            <DatePicker
              locale={locale}
              label={d.batchesWriteOffDate}
              value={writeOffDate}
              onSelect={setWriteOffDate}
              required
            />
          </div>
          <div className="mt-3 flex gap-2">
            <Button
              variant="danger"
              disabled={!writeOffReady || busy === writeOffRow.id}
              onClick={() => void writeOffBatch()}
            >
              {d.batchesWriteOffConfirm}
            </Button>
            <Button variant="ghost" onClick={() => setWriteOffId(null)}>
              {d.batchesWriteOffCancel}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
