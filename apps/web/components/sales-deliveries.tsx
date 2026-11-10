"use client";

/**
 * T13-UI (PHASE-012) — delivery-note workspace (transaction-entry
 * archetype): create a goods-out note against an ISSUED sales order (or
 * order-less) and post it — stock leaves + COGS lands (G-03, no AR leg)
 * server-side through the PHASE-010 movement core; convert-to-invoice
 * happens on the invoices screen (BR-007 flow B).
 */
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { JSX } from "react";

import { Button, DataTable, DatePicker, Input, Select } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type {
  BranchRow,
  DeliveryNoteRow,
  ItemRow,
  PartnerRow,
  SalesOrderRow,
  WarehouseRow,
} from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { localizedName, localizedSalesError, salesStatusLabel } from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice, SuccessNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const QTY_RE = /^\d+(\.\d{1,6})?$/;
const PRICE_RE = /^\d+(\.\d{1,6})?$/;

interface DraftLine {
  itemId: string;
  qty: string;
  unitPrice: string;
}

const EMPTY_LINE: DraftLine = { itemId: "", qty: "", unitPrice: "" };

export function SalesDeliveries({
  locale,
  initialDeliveries,
  orders,
  customers,
  items,
  warehouses,
  branches,
  baseCurrency,
  canCreate,
}: {
  locale: Locale;
  initialDeliveries: readonly DeliveryNoteRow[];
  orders: readonly SalesOrderRow[];
  customers: readonly PartnerRow[];
  items: readonly ItemRow[];
  warehouses: readonly WarehouseRow[];
  branches: readonly BranchRow[];
  baseCurrency: string;
  canCreate: boolean;
}): JSX.Element {
  const d = getDictionary(locale);
  const router = useRouter();
  const [deliveries, setDeliveries] = useState<readonly DeliveryNoteRow[]>(initialDeliveries);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [branchId, setBranchId] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [orderId, setOrderId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [deliveryDate, setDeliveryDate] = useState(new Date().toISOString().slice(0, 10));
  const [lines, setLines] = useState<DraftLine[]>([{ ...EMPTY_LINE }]);

  // Inline cancel-with-reason prompt.
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState("");

  const customerNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const customer of customers) {
      map.set(customer.id, localizedName(customer.name, customer.nameAr, locale));
    }
    return map;
  }, [customers, locale]);

  const customersOnly = useMemo(
    () => customers.filter((p) => p.kind === "CUSTOMER" || p.kind === "BOTH"),
    [customers],
  );
  const issuedOrders = useMemo(() => orders.filter((o) => o.status === "ISSUED"), [orders]);
  const activeBranches = useMemo(() => branches.filter((b) => b.isActive), [branches]);
  const activeWarehouses = useMemo(() => warehouses.filter((w) => w.isActive), [warehouses]);

  async function call<T>(
    key: string,
    fn: () => Promise<{ ok: boolean; data?: T; error?: { code: string; message: string }; retryAfterSeconds?: number }>,
  ): Promise<T | undefined> {
    setBusy(key);
    setError(null);
    setNotice(null);
    const result = await fn();
    setBusy(null);
    if (!result.ok) {
      setError(localizedSalesError(d, result.error ?? { code: "NETWORK_ERROR", message: "" }, result.retryAfterSeconds));
      return undefined;
    }
    router.refresh();
    return result.data;
  }

  async function create(): Promise<void> {
    if (
      branchId === "" ||
      customerId === "" ||
      warehouseId === "" ||
      !DATE_RE.test(deliveryDate) ||
      lines.length === 0 ||
      lines.some((l) => l.itemId === "" || !QTY_RE.test(l.qty) || (l.unitPrice !== "" && !PRICE_RE.test(l.unitPrice)))
    ) {
      setError(d.errorsValidation);
      return;
    }
    const created = await call<DeliveryNoteRow>("create", () =>
      bffFetch<DeliveryNoteRow>("sales/delivery-notes", {
        method: "POST",
        body: {
          branchId,
          customerId,
          orderId: orderId === "" ? null : orderId,
          warehouseId,
          deliveryDate,
          currencyCode: baseCurrency === "" ? "SAR" : baseCurrency,
          lines: lines.map((l) => ({
            itemId: l.itemId,
            qty: l.qty,
            unitPrice: l.unitPrice === "" ? null : l.unitPrice,
          })),
        },
      }),
    );
    if (created !== undefined) {
      setDeliveries((rows) => [created, ...rows]);
      setNotice(d.salesNoticeCreated);
      setLines([{ ...EMPTY_LINE }]);
    }
  }

  async function post(id: string): Promise<void> {
    const updated = await call<DeliveryNoteRow>(`post-${id}`, () =>
      bffFetch<DeliveryNoteRow>(`sales/delivery-notes/${id}/post`, {
        method: "POST",
        body: {},
      }),
    );
    if (updated !== undefined) {
      setDeliveries((rows) => rows.map((row) => (row.id === id ? updated : row)));
      setNotice(d.salesNoticePosted);
    }
  }

  async function confirmCancel(): Promise<void> {
    if (cancelId === null || cancelReason.trim() === "") {
      setError(d.errorsValidation);
      return;
    }
    const id = cancelId;
    const reason = cancelReason.trim();
    setCancelId(null);
    setCancelReason("");
    const updated = await call<DeliveryNoteRow>(`cancel-${id}`, () =>
      bffFetch<DeliveryNoteRow>(`sales/delivery-notes/${id}/cancel`, {
        method: "POST",
        body: { reason },
      }),
    );
    if (updated !== undefined) {
      setDeliveries((rows) => rows.map((row) => (row.id === id ? updated : row)));
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
      {notice !== null && <SuccessNotice>{notice}</SuccessNotice>}

      {canCreate && (
        <Card title={d.salesNewDelivery}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Select
              label={d.salesBranch}
              value={branchId}
              onValueChange={setBranchId}
              options={[
                { value: "", label: d.salesSelectBranch },
                ...activeBranches.map((b) => ({ value: b.id, label: localizedName(b.name, b.nameAr, locale) })),
              ]}
            />
            <Select
              label={d.salesCustomer}
              value={customerId}
              onValueChange={setCustomerId}
              options={[
                { value: "", label: d.salesSelectCustomer },
                ...customersOnly.map((c) => ({ value: c.id, label: customerNameById.get(c.id) ?? c.code })),
              ]}
            />
            <Select
              label={d.salesSalesOrder}
              value={orderId}
              onValueChange={setOrderId}
              options={[
                { value: "", label: d.salesNoOrder },
                ...issuedOrders.map((o) => ({
                  value: o.id,
                  label: `${o.orderNo ?? o.id.slice(0, 8)} · ${customerNameById.get(o.customerId) ?? ""}`,
                })),
              ]}
            />
            <Select
              label={d.salesWarehouse}
              value={warehouseId}
              onValueChange={setWarehouseId}
              options={[
                { value: "", label: d.salesSelectWarehouse },
                ...activeWarehouses.map((w) => ({ value: w.id, label: localizedName(w.name, w.nameAr, locale) })),
              ]}
            />
            <DatePicker
              label={d.salesDeliveryDate}
              value={deliveryDate}
              onSelect={setDeliveryDate}
              locale={locale}
            />
          </div>
          <div className="mt-4 space-y-3">
            {lines.map((line, index) => (
              <div key={index} className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr_auto]">
                <Select
                  label={index === 0 ? d.salesItem : undefined}
                  value={line.itemId}
                  onValueChange={(value) =>
                    setLines((rows) => rows.map((r, i) => (i === index ? { ...r, itemId: value } : r)))
                  }
                  options={[
                    { value: "", label: d.salesItem },
                    ...items.map((item) => ({ value: item.id, label: item.sku })),
                  ]}
                />
                <Input
                  label={index === 0 ? d.salesQty : undefined}
                  value={line.qty}
                  onValueChange={(value) => setLines((rows) => rows.map((r, i) => (i === index ? { ...r, qty: value } : r)))}
                  inputMode="decimal"
                />
                <Input
                  label={index === 0 ? d.salesUnitPrice : undefined}
                  value={line.unitPrice}
                  onValueChange={(value) =>
                    setLines((rows) => rows.map((r, i) => (i === index ? { ...r, unitPrice: value } : r)))
                  }
                  inputMode="decimal"
                />
                <div className="flex items-end">
                  {lines.length > 1 && (
                    <Button
                      variant="secondary"
                      onClick={() => setLines((rows) => rows.filter((_, i) => i !== index))}
                    >
                      {d.salesRemoveLine}
                    </Button>
                  )}
                </div>
              </div>
            ))}
            <Button variant="secondary" onClick={() => setLines((rows) => [...rows, { ...EMPTY_LINE }])}>
              {d.salesAddLine}
            </Button>
          </div>
          <div className="mt-4">
            <Button disabled={busy !== null} onClick={() => void create()}>
              {busy === "create" ? d.loading : d.commonSave}
            </Button>
          </div>
        </Card>
      )}

      <Card title={d.salesDeliveriesTitle}>
        <DataTable
          columns={[
            {
              id: "no",
              header: activeLocaleHeader(d.salesDeliveryNo),
              accessor: (row: DeliveryNoteRow) => row.deliveryNo ?? "—",
              mono: true,
              render: (row: DeliveryNoteRow) => (
                <span className="font-mono text-sm" dir="ltr">{row.deliveryNo ?? "—"}</span>
              ),
            },
            {
              id: "customer",
              header: activeLocaleHeader(d.salesCustomer),
              accessor: (row: DeliveryNoteRow) => customerNameById.get(row.customerId) ?? row.customerId,
            },
            {
              id: "date",
              header: activeLocaleHeader(d.salesDeliveryDate),
              accessor: (row: DeliveryNoteRow) => row.deliveryDate,
            },
            {
              id: "gross",
              header: activeLocaleHeader(d.salesTotalGross),
              accessor: (row: DeliveryNoteRow) => row.totalGross,
              render: (row: DeliveryNoteRow) => (
                <span className="font-mono text-sm" dir="ltr">{row.totalGross}</span>
              ),
            },
            {
              id: "cogs",
              header: activeLocaleHeader(d.salesCogsValue),
              accessor: (row: DeliveryNoteRow) =>
                row.status === "POSTED" ? row.cogsValue : "—",
              render: (row: DeliveryNoteRow) => (
                <span className="font-mono text-sm" dir="ltr">
                  {row.status === "POSTED" ? row.cogsValue : "—"}
                </span>
              ),
            },
            {
              id: "status",
              header: activeLocaleHeader(d.salesStatus),
              accessor: (row: DeliveryNoteRow) => row.status,
              render: (row: DeliveryNoteRow) => salesStatusLabel(d, row.status),
            },
          ]}
          rows={[...deliveries]}
          rowKey={(row) => row.id}
          rowActions={
            canCreate
              ? [
                  {
                    id: "post",
                    label: d.salesPost,
                    onSelect: (row: DeliveryNoteRow) => {
                      if (row.status !== "DRAFT") return;
                      void post(row.id);
                    },
                  },
                  {
                    id: "cancel",
                    label: d.salesCancel,
                    onSelect: (row: DeliveryNoteRow) => {
                      if (row.status !== "DRAFT") return;
                      setError(null);
                      setNotice(null);
                      setCancelReason("");
                      setCancelId(row.id);
                    },
                  },
                ]
              : []
          }
          empty={{ title: d.salesEmpty }}
        />
      </Card>

      {cancelId !== null && (
        <Card title={d.salesCancelReason}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label={d.salesCancelReason} value={cancelReason} onValueChange={setCancelReason} />
          </div>
          <div className="mt-4 flex gap-2">
            <Button
              disabled={busy !== null || cancelReason.trim() === ""}
              onClick={() => void confirmCancel()}
            >
              {busy !== null ? d.loading : d.salesCancel}
            </Button>
            <Button
              variant="secondary"
              disabled={busy !== null}
              onClick={() => {
                setCancelId(null);
                setCancelReason("");
              }}
            >
              {d.commonCancel}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
