"use client";

/**
 * T13-UI (PHASE-011) — goods-receipt workspace (transaction-entry archetype):
 * create a GRN against an ISSUED purchase order (or PO-less with the
 * explicit BR-012 reason) and post it — stock arrives + the GRNI accrual
 * lands (G-07) server-side through the PHASE-010 movement core.
 */
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { JSX } from "react";

import { Button, DataTable, DatePicker, Input, Select } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type {
  GoodsReceiptRow,
  ItemRow,
  PartnerRow,
  PurchaseOrderRow,
  WarehouseRow,
} from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { localizedName, localizedPurchasingError, purchasingStatusLabel } from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice, SuccessNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const QTY_RE = /^\d+(\.\d{1,6})?$/;
const COST_RE = /^\d+(\.\d{1,6})?$/;

export function PurchasingReceipts({
  locale,
  initialReceipts,
  orders,
  suppliers,
  items,
  warehouses,
  canCreate,
  canPost,
}: {
  locale: Locale;
  initialReceipts: readonly GoodsReceiptRow[];
  orders: readonly PurchaseOrderRow[];
  suppliers: readonly PartnerRow[];
  items: readonly ItemRow[];
  warehouses: readonly WarehouseRow[];
  canCreate: boolean;
  canPost: boolean;
}): JSX.Element {
  const d = getDictionary(locale);
  const router = useRouter();
  const [receipts, setReceipts] = useState<readonly GoodsReceiptRow[]>(initialReceipts);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [poId, setPoId] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [receiptDate, setReceiptDate] = useState(new Date().toISOString().slice(0, 10));
  const [poLessReason, setPoLessReason] = useState("");
  const [lines, setLines] = useState([{ itemId: "", qty: "", unitCost: "" }]);

  const supplierNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const supplier of suppliers) {
      map.set(supplier.id, localizedName(supplier.name, supplier.nameAr, locale));
    }
    return map;
  }, [suppliers, locale]);

  const issuedOrders = useMemo(() => orders.filter((o) => o.status === "ISSUED"), [orders]);

  async function create(): Promise<void> {
    if (
      warehouseId === "" ||
      !DATE_RE.test(receiptDate) ||
      (poId === "" && (supplierId === "" || poLessReason.trim() === "")) ||
      lines.length === 0 ||
      lines.some((l) => l.itemId === "" || !QTY_RE.test(l.qty) || !COST_RE.test(l.unitCost))
    ) {
      setError(d.errorsValidation);
      return;
    }
    setBusy("create");
    setError(null);
    setNotice(null);
    const result = await bffFetch<GoodsReceiptRow>("purchasing/goods-receipts", {
      method: "POST",
      body: {
        poId: poId === "" ? null : poId,
        supplierId: poId === "" ? supplierId : undefined,
        warehouseId,
        receiptDate,
        poLessReason: poId === "" ? poLessReason.trim() : null,
        note: null,
        lines: lines.map((l) => ({ itemId: l.itemId, qty: l.qty, unitCost: l.unitCost })),
      },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedPurchasingError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setReceipts((rows) => [result.data, ...rows]);
    setNotice(d.purchasingNoticeCreated);
    setLines([{ itemId: "", qty: "", unitCost: "" }]);
    router.refresh();
  }

  async function post(id: string): Promise<void> {
    setBusy(`post-${id}`);
    setError(null);
    setNotice(null);
    const result = await bffFetch<GoodsReceiptRow>(`purchasing/goods-receipts/${id}/post`, {
      method: "POST",
      body: {},
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedPurchasingError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setNotice(d.purchasingNoticePosted);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
      {notice !== null && <SuccessNotice>{notice}</SuccessNotice>}

      {canCreate && (
        <Card title={d.purchasingNewReceipt}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Select
              label={d.purchasingPo}
              value={poId}
              onValueChange={setPoId}
              options={[
                { value: "", label: d.purchasingNoPo },
                ...issuedOrders.map((o) => ({
                  value: o.id,
                  label: `${o.orderNo ?? o.id.slice(0, 8)} · ${supplierNameById.get(o.supplierId) ?? ""}`,
                })),
              ]}
            />
            {poId === "" && (
              <>
                <Select
                  label={d.purchasingSupplier}
                  value={supplierId}
                  onValueChange={setSupplierId}
                  options={[
                    { value: "", label: d.purchasingSelectSupplier },
                    ...suppliers
                      .filter((p) => p.kind === "SUPPLIER" || p.kind === "BOTH")
                      .map((s) => ({ value: s.id, label: supplierNameById.get(s.id) ?? s.code })),
                  ]}
                />
                <Input
                  label={d.purchasingPoLessReason}
                  value={poLessReason}
                  onValueChange={setPoLessReason}
                />
              </>
            )}
            <Select
              label={d.purchasingWarehouse}
              value={warehouseId}
              onValueChange={setWarehouseId}
              options={[
                { value: "", label: d.purchasingSelectWarehouse },
                ...warehouses
                  .filter((w) => w.isActive)
                  .map((w) => ({ value: w.id, label: localizedName(w.name, w.nameAr, locale) })),
              ]}
            />
            <DatePicker
              label={d.purchasingReceiptDate}
              value={receiptDate}
              onSelect={setReceiptDate}
              locale={locale}
              />
          </div>
          <div className="mt-4 space-y-3">
            {lines.map((line, index) => (
              <div key={index} className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr_auto]">
                <Select
                  label={index === 0 ? d.purchasingItem : undefined}
                  value={line.itemId}
                  onValueChange={(value) =>
                    setLines((rows) => rows.map((r, i) => (i === index ? { ...r, itemId: value } : r)))
                  }
                  options={[
                    { value: "", label: d.purchasingItem },
                    ...items.map((item) => ({ value: item.id, label: item.sku })),
                  ]}
                />
                <Input
                  label={index === 0 ? d.purchasingQty : undefined}
                  value={line.qty}
                  onValueChange={(value) =>
                    setLines((rows) => rows.map((r, i) => (i === index ? { ...r, qty: value } : r)))
                  }
                  inputMode="decimal"
                />
                <Input
                  label={index === 0 ? d.purchasingUnitCost : undefined}
                  value={line.unitCost}
                  onValueChange={(value) =>
                    setLines((rows) => rows.map((r, i) => (i === index ? { ...r, unitCost: value } : r)))
                  }
                  inputMode="decimal"
                />
                <div className="flex items-end">
                  {lines.length > 1 && (
                    <Button variant="secondary" onClick={() => setLines((rows) => rows.filter((_, i) => i !== index))}>
                      {d.purchasingRemoveLine}
                    </Button>
                  )}
                </div>
              </div>
            ))}
            <Button variant="secondary" onClick={() => setLines((rows) => [...rows, { itemId: "", qty: "", unitCost: "" }])}>
              {d.purchasingAddLine}
            </Button>
          </div>
          <div className="mt-4">
            <Button disabled={busy !== null} onClick={() => void create()}>
              {busy === "create" ? d.loading : d.commonSave}
            </Button>
          </div>
        </Card>
      )}

      <Card title={d.purchasingReceiptsTitle}>
        <DataTable
          columns={[
            {
              id: "no",
              header: activeLocaleHeader(d.purchasingReceiptNo),
              accessor: (row: GoodsReceiptRow) => row.receiptNo ?? "—",
              mono: true,
            },
            {
              id: "date",
              header: activeLocaleHeader(d.purchasingReceiptDate),
              accessor: (row: GoodsReceiptRow) => row.receiptDate,
            },
            {
              id: "supplier",
              header: activeLocaleHeader(d.purchasingSupplier),
              accessor: (row: GoodsReceiptRow) => supplierNameById.get(row.supplierId) ?? row.supplierId,
            },
            {
              id: "value",
              header: activeLocaleHeader(d.purchasingTotalGross),
              accessor: (row: GoodsReceiptRow) => row.totalValue,
              render: (row: GoodsReceiptRow) => (
                <span className="font-mono text-sm" dir="ltr">{row.totalValue}</span>
              ),
            },
            {
              id: "status",
              header: activeLocaleHeader(d.purchasingStatus),
              accessor: (row: GoodsReceiptRow) => row.status,
              render: (row: GoodsReceiptRow) => purchasingStatusLabel(d, row.status),
            },
          ]}
          rows={[...receipts]}
          rowKey={(row) => row.id}
          rowActions={
            canPost
              ? [
                  {
                    id: "post",
                    label: d.purchasingPost,
                    onSelect: (row: GoodsReceiptRow) => {
                      if (row.status !== "DRAFT") return;
                      void post(row.id);
                    },
                  },
                ]
              : []
          }
          empty={{ title: d.purchasingEmpty }}
        />
      </Card>
    </div>
  );
}
