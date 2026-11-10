"use client";

/**
 * PHASE-035 (T-03) — the serial/IMEI registry (List+Search archetype §2; audit
 * EVAL-F-1): the tenant serial ledger (item, serial no, IMEI, in_stock / sold
 * / returned state, sold-at/returned-at stamps) with the status filter and
 * search, plus register (POST /inventory/serials) and the sold-at view (GET
 * /inventory/serials/:id/sale — the original issue's cost/date/warehouse).
 * Register sits under inventory.tracking.manage.
 */
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { JSX } from "react";

import {
  Button,
  DataTable,
  DocumentStatusBadge,
  Input,
  SearchInput,
  Select,
  formatMoneyDisplay,
} from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type { ItemRow, SerialRow } from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { localizedInventoryError, localizedName } from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice, SuccessNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";

/** The GET /inventory/serials/:id/sale envelope (the sold-at view). */
interface SerialSaleView {
  serial: SerialRow;
  originalIssue: {
    unitCost: string;
    movedAt: string;
    warehouseId: string;
  } | null;
}

function serialBadgeStatus(status: string): "POSTED" | "DRAFT" | "CANCELLED" {
  if (status === "in_stock") return "POSTED";
  if (status === "sold") return "DRAFT";
  return "CANCELLED";
}

export function InventorySerials({
  locale,
  initialRows,
  items,
  canManage,
}: {
  locale: Locale;
  initialRows: readonly SerialRow[];
  items: readonly ItemRow[];
  canManage: boolean;
}): JSX.Element {
  const d = getDictionary(locale);
  const router = useRouter();
  const [rows] = useState<readonly SerialRow[]>(initialRows);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Filters.
  const [status, setStatus] = useState("");
  const [query, setQuery] = useState("");

  // Register form state.
  const [itemId, setItemId] = useState("");
  const [serialNo, setSerialNo] = useState("");
  const [imei, setImei] = useState("");

  // Sold-at view state.
  const [saleViewId, setSaleViewId] = useState<string | null>(null);
  const [saleView, setSaleView] = useState<SerialSaleView | null>(null);
  const [saleViewLoading, setSaleViewLoading] = useState(false);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (status !== "" && row.status !== status) return false;
      if (needle === "") return true;
      return (
        row.sku.toLowerCase().includes(needle) ||
        row.serialNo.toLowerCase().includes(needle) ||
        (row.imei ?? "").toLowerCase().includes(needle)
      );
    });
  }, [rows, status, query]);

  const formReady = itemId !== "" && serialNo.trim().length >= 1;

  useEffect(() => {
    if (saleViewId === null) {
      setSaleView(null);
      return;
    }
    let cancelled = false;
    setSaleViewLoading(true);
    setSaleView(null);
    void bffFetch<SerialSaleView>(`inventory/serials/${saleViewId}/sale`).then((result) => {
      if (cancelled) return;
      setSaleViewLoading(false);
      if (result.ok) {
        setSaleView(result.data);
      } else {
        setError(localizedInventoryError(d, result.error, result.retryAfterSeconds));
        setSaleViewId(null);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [saleViewId, d]);

  async function registerSerial(): Promise<void> {
    setError(null);
    setNotice(null);
    setBusy("create");
    const created = await bffFetch<SerialRow>("inventory/serials", {
      method: "POST",
      body: {
        itemId,
        serialNo: serialNo.trim(),
        imei: imei.trim() === "" ? null : imei.trim(),
      },
    });
    setBusy(null);
    if (!created.ok) {
      setError(localizedInventoryError(d, created.error, created.retryAfterSeconds));
      return;
    }
    setSerialNo("");
    setImei("");
    setNotice(d.serialsCreatedToast);
    router.refresh();
  }

  const saleViewRow = rows.find((row) => row.id === saleViewId);

  return (
    <div className="flex flex-col gap-4">
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
      {notice !== null && <SuccessNotice>{notice}</SuccessNotice>}

      <Card title={d.serialsTitle}>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
          <Select
            label={d.serialsFilterStatus}
            value={status}
            onValueChange={setStatus}
            placeholder="—"
            options={[
              { value: "in_stock", label: d.serialsStatusInStock },
              { value: "sold", label: d.serialsStatusSold },
              { value: "returned", label: d.serialsStatusReturned },
            ]}
            className="lg:w-48"
          />
          <SearchInput
            label={d.serialsSearchLabel}
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
              id: "serialNo",
              header: activeLocaleHeader(d.serialsColNo),
              accessor: (row) => row.serialNo,
              mono: true,
              sortable: true,
              render: (row) => <span className="font-mono text-sm" dir="ltr">{row.serialNo}</span>,
            },
            {
              id: "imei",
              header: activeLocaleHeader(d.serialsColImei),
              accessor: (row) => row.imei ?? "",
              render: (row) =>
                row.imei === null ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  <span className="font-mono text-sm" dir="ltr">{row.imei}</span>
                ),
            },
            {
              id: "status",
              header: activeLocaleHeader(d.accountingColStatus),
              accessor: (row) => row.status,
              render: (row) => (
                <DocumentStatusBadge
                  status={serialBadgeStatus(row.status)}
                  label={
                    row.status === "in_stock"
                      ? d.serialsStatusInStock
                      : row.status === "sold"
                        ? d.serialsStatusSold
                        : d.serialsStatusReturned
                  }
                />
              ),
            },
            {
              id: "soldAt",
              header: activeLocaleHeader(d.serialsColSoldAt),
              accessor: (row) => row.soldAt ?? "",
              mono: true,
              render: (row) =>
                row.soldAt === null ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  <span className="font-mono text-sm" dir="ltr">{row.soldAt.slice(0, 10)}</span>
                ),
            },
            {
              id: "returnedAt",
              header: activeLocaleHeader(d.serialsColReturnedAt),
              accessor: (row) => row.returnedAt ?? "",
              mono: true,
              render: (row) =>
                row.returnedAt === null ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  <span className="font-mono text-sm" dir="ltr">{row.returnedAt.slice(0, 10)}</span>
                ),
            },
          ]}
          rows={[...filtered]}
          rowKey={(row) => row.id}
          rowActions={[
            {
              id: "sale-view",
              label: d.serialsSaleView,
              onSelect: (row: SerialRow) => setSaleViewId(row.id),
            },
          ]}
          empty={{ title: d.serialsEmpty }}
        />
      </Card>

      {canManage && (
        <Card title={d.serialsNewTitle}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Select
              label={d.serialsItemLabel}
              value={itemId}
              onValueChange={setItemId}
              placeholder="—"
              options={items.map((item) => ({
                value: item.id,
                label: `${item.sku} · ${localizedName(item.name, item.nameAr, locale)}`,
              }))}
            />
            <Input
              label={d.serialsNoLabel}
              value={serialNo}
              onValueChange={setSerialNo}
              mono
              bidiIsolate
            />
            <Input
              label={d.serialsImeiLabel}
              value={imei}
              onValueChange={setImei}
              mono
              bidiIsolate
              hint={d.serialsImeiHint}
            />
          </div>
          <div className="mt-3">
            <Button disabled={!formReady || busy === "create"} onClick={() => void registerSerial()}>
              {d.serialsCreate}
            </Button>
          </div>
        </Card>
      )}

      {saleViewRow !== undefined && (
        <Card
          title={`${d.serialsSaleTitle} · ${saleViewRow.serialNo}`}
          actions={
            <Button variant="ghost" onClick={() => setSaleViewId(null)}>
              {d.serialsSaleClose}
            </Button>
          }
        >
          {saleViewLoading ? (
            <p className="text-sm text-muted-foreground">{d.serialsSaleLoading}</p>
          ) : saleView === null ? (
            <p className="text-sm text-muted-foreground">{d.serialsSaleNone}</p>
          ) : saleView.originalIssue === null ? (
            <p className="text-sm text-muted-foreground">{d.serialsSaleNone}</p>
          ) : (
            <div className="flex flex-col gap-1 text-sm">
              <span>
                {d.serialsSaleUnitCost}:{" "}
                <span className="font-mono tabular-nums" dir="ltr">
                  {formatMoneyDisplay(saleView.originalIssue.unitCost, 6)}
                </span>
              </span>
              <span>
                {d.serialsSaleMovedAt}:{" "}
                <span className="font-mono text-sm" dir="ltr">
                  {saleView.originalIssue.movedAt}
                </span>
              </span>
              <span>
                {d.serialsSaleWarehouse}:{" "}
                <span className="font-mono text-sm" dir="ltr">
                  {saleView.originalIssue.warehouseId.slice(0, 8)}
                </span>
              </span>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
