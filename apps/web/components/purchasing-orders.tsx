"use client";

/**
 * T13-UI (PHASE-011) — purchase orders workspace (transaction-entry
 * archetype §4): the PR list (approval routing) + the PO list (issue →
 * close lifecycle, linked revisions) with a multi-line create form
 * (supplier, dates, items with qty/price). Lifecycle actions carry the
 * creator-≠-approver SoD (BR-034) and threshold routing (BR-010) — both
 * enforced server-side.
 */
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { JSX } from "react";

import { Button, DataTable, DatePicker, Input, Select } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type { ItemRow, PartnerRow, PurchaseOrderRow, PurchaseRequestRow } from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { localizedName, localizedPurchasingError, purchasingStatusLabel } from "../lib/messages";
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

export function PurchasingOrders({
  locale,
  initialRequests,
  initialOrders,
  suppliers,
  items,
  canCreate,
  canApprove,
}: {
  locale: Locale;
  initialRequests: readonly PurchaseRequestRow[];
  initialOrders: readonly PurchaseOrderRow[];
  suppliers: readonly PartnerRow[];
  items: readonly ItemRow[];
  canCreate: boolean;
  canApprove: boolean;
}): JSX.Element {
  const d = getDictionary(locale);
  const router = useRouter();
  const [requests] = useState<readonly PurchaseRequestRow[]>(initialRequests);
  const [orders, setOrders] = useState<readonly PurchaseOrderRow[]>(initialOrders);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [mode, setMode] = useState<"request" | "order">("order");

  // Shared form state.
  const [supplierId, setSupplierId] = useState("");
  const [orderDate, setOrderDate] = useState(new Date().toISOString().slice(0, 10));
  const [expectedDate, setExpectedDate] = useState("");
  const [neededBy, setNeededBy] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([{ itemId: "", qty: "", unitPrice: "" }]);

  const supplierNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const supplier of suppliers) {
      map.set(supplier.id, localizedName(supplier.name, supplier.nameAr, locale));
    }
    return map;
  }, [suppliers, locale]);

  const suppliersOnly = useMemo(
    () => suppliers.filter((p) => p.kind === "SUPPLIER" || p.kind === "BOTH"),
    [suppliers],
  );

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
      setError(localizedPurchasingError(d, result.error ?? { code: "NETWORK_ERROR", message: "" }, result.retryAfterSeconds));
      return undefined;
    }
    router.refresh();
    return result.data;
  }

  async function submitRequest(): Promise<void> {
    if (!DATE_RE.test(neededBy) || lines.length === 0 || lines.some((l) => l.itemId === "" || !QTY_RE.test(l.qty))) {
      setError(d.errorsValidation);
      return;
    }
    const created = await call<PurchaseRequestRow>("request", () =>
      bffFetch<PurchaseRequestRow>("purchasing/purchase-requests", {
        method: "POST",
        body: {
          neededBy,
          note: null,
          lines: lines.map((l) => ({ itemId: l.itemId, qty: l.qty })),
        },
      }),
    );
    if (created !== undefined) {
      setNotice(d.purchasingNoticeCreated);
      setLines([{ itemId: "", qty: "", unitPrice: "" }]);
    }
  }

  async function submitOrder(): Promise<void> {
    if (
      supplierId === "" ||
      !DATE_RE.test(orderDate) ||
      lines.length === 0 ||
      lines.some((l) => l.itemId === "" || !QTY_RE.test(l.qty) || !PRICE_RE.test(l.unitPrice))
    ) {
      setError(d.errorsValidation);
      return;
    }
    const created = await call<PurchaseOrderRow>("order", () =>
      bffFetch<PurchaseOrderRow>("purchasing/purchase-orders", {
        method: "POST",
        body: {
          supplierId,
          orderDate,
          expectedDate: expectedDate === "" ? null : expectedDate,
          currencyCode: "SAR",
          lines: lines.map((l) => ({ itemId: l.itemId, qty: l.qty, unitPrice: l.unitPrice })),
        },
      }),
    );
    if (created !== undefined) {
      setNotice(d.purchasingNoticeCreated);
      setOrders((rows) => [created, ...rows]);
      setLines([{ itemId: "", qty: "", unitPrice: "" }]);
    }
  }

  async function orderAction(id: string, action: "submit" | "approve" | "issue" | "close" | "cancel"): Promise<void> {
    await call<PurchaseOrderRow>(`${action}-${id}`, () =>
      bffFetch<PurchaseOrderRow>(`purchasing/purchase-orders/${id}/${action}`, {
        method: "POST",
        body: action === "cancel" ? { reason: "UI cancel" } : {},
      }),
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
      {notice !== null && <SuccessNotice>{notice}</SuccessNotice>}

      {canCreate && (
        <Card title={mode === "request" ? d.purchasingNewRequest : d.purchasingNewOrder}>
          <div className="mb-4 flex gap-2">
            <Button variant={mode === "request" ? "primary" : "secondary"} onClick={() => setMode("request")}>
              {d.purchasingRequestsSection}
            </Button>
            <Button variant={mode === "order" ? "primary" : "secondary"} onClick={() => setMode("order")}>
              {d.purchasingOrdersSection}
            </Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {mode === "order" && (
              <Select
                label={d.purchasingSupplier}
                value={supplierId}
                onValueChange={setSupplierId}
                options={[
                  { value: "", label: d.purchasingSelectSupplier },
                  ...suppliersOnly.map((s) => ({ value: s.id, label: supplierNameById.get(s.id) ?? s.code })),
                ]}
              />
            )}
            {mode === "request" ? (
              <DatePicker
                label={d.purchasingNeededBy}
                value={neededBy}
                onSelect={setNeededBy}
                locale={locale}
                />
            ) : (
              <>
                <DatePicker
                  label={d.purchasingOrderDate}
                  value={orderDate}
                  onSelect={setOrderDate}
                  locale={locale}
                  />
                <DatePicker
                  label={d.purchasingExpectedDate}
                  value={expectedDate}
                  onSelect={setExpectedDate}
                  locale={locale}
                  />
              </>
            )}
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
                {mode === "order" && (
                  <Input
                    label={index === 0 ? d.purchasingUnitPrice : undefined}
                    value={line.unitPrice}
                    onValueChange={(value) => setLines((rows) => rows.map((r, i) => (i === index ? { ...r, unitPrice: value} : r)))
                    }
                    inputMode="decimal"
                  />
                )}
                <div className="flex items-end">
                  {lines.length > 1 && (
                    <Button
                      variant="secondary"
                      onClick={() => setLines((rows) => rows.filter((_, i) => i !== index))}
                    >
                      {d.purchasingRemoveLine}
                    </Button>
                  )}
                </div>
              </div>
            ))}
            <Button variant="secondary" onClick={() => setLines((rows) => [...rows, { itemId: "", qty: "", unitPrice: "" }])}>
              {d.purchasingAddLine}
            </Button>
          </div>
          <div className="mt-4">
            <Button
              disabled={busy !== null}
              onClick={() => (mode === "request" ? void submitRequest() : void submitOrder())}
            >
              {busy === mode ? d.loading : d.commonSave}
            </Button>
          </div>
        </Card>
      )}

      <Card title={d.purchasingOrdersSection}>
        <DataTable
          columns={[
            {
              id: "no",
              header: activeLocaleHeader(d.purchasingOrderNo),
              accessor: (row: PurchaseOrderRow) => row.orderNo ?? "—",
              mono: true,
              render: (row: PurchaseOrderRow) => (
                <span className="font-mono text-sm" dir="ltr">{row.orderNo ?? "—"}</span>
              ),
            },
            {
              id: "supplier",
              header: activeLocaleHeader(d.purchasingSupplier),
              accessor: (row: PurchaseOrderRow) => supplierNameById.get(row.supplierId) ?? row.supplierId,
            },
            {
              id: "date",
              header: activeLocaleHeader(d.purchasingOrderDate),
              accessor: (row: PurchaseOrderRow) => row.orderDate,
            },
            {
              id: "gross",
              header: activeLocaleHeader(d.purchasingTotalGross),
              accessor: (row: PurchaseOrderRow) => row.totalGross,
              render: (row: PurchaseOrderRow) => (
                <span className="font-mono text-sm" dir="ltr">{row.totalGross}</span>
              ),
            },
            {
              id: "status",
              header: activeLocaleHeader(d.purchasingStatus),
              accessor: (row: PurchaseOrderRow) => row.status,
              render: (row: PurchaseOrderRow) => purchasingStatusLabel(d, row.status),
            },
          ]}
          rows={[...orders]}
          rowKey={(row) => row.id}
          rowActions={
            canApprove || canCreate
              ? [
                  {
                    id: "submit",
                    label: d.purchasingSubmit,
                    onSelect: (row: PurchaseOrderRow) => {
                      if (row.status !== "DRAFT") return;
                      void orderAction(row.id, "submit");
                    },
                  },
                  {
                    id: "approve",
                    label: d.purchasingApprove,
                    onSelect: (row: PurchaseOrderRow) => {
                      if (row.status !== "PENDING_APPROVAL") return;
                      void orderAction(row.id, "approve");
                    },
                  },
                  {
                    id: "issue",
                    label: d.purchasingIssue,
                    onSelect: (row: PurchaseOrderRow) => {
                      if (row.status !== "APPROVED") return;
                      void orderAction(row.id, "issue");
                    },
                  },
                  {
                    id: "close",
                    label: d.purchasingClose,
                    onSelect: (row: PurchaseOrderRow) => {
                      if (row.status !== "ISSUED") return;
                      void orderAction(row.id, "close");
                    },
                  },
                ]
              : []
          }
          empty={{ title: d.purchasingEmpty }}
        />
      </Card>

      <Card title={d.purchasingRequestsSection}>
        <DataTable
          columns={[
            {
              id: "no",
              header: activeLocaleHeader(d.purchasingRequestNo),
              accessor: (row: PurchaseRequestRow) => row.requestNo ?? "—",
              mono: true,
            },
            {
              id: "needed",
              header: activeLocaleHeader(d.purchasingNeededBy),
              accessor: (row: PurchaseRequestRow) => row.neededBy ?? "—",
            },
            {
              id: "status",
              header: activeLocaleHeader(d.purchasingStatus),
              accessor: (row: PurchaseRequestRow) => row.status,
              render: (row: PurchaseRequestRow) => purchasingStatusLabel(d, row.status),
            },
          ]}
          rows={[...requests]}
          rowKey={(row) => row.id}
          rowActions={
            canApprove
              ? [
                  {
                    id: "req-submit",
                    label: d.purchasingSubmit,
                    onSelect: (row: PurchaseRequestRow) => {
                      if (row.status !== "DRAFT") return;
                      void call<PurchaseRequestRow>(`req-submit-${row.id}`, () =>
                        bffFetch<PurchaseRequestRow>(`purchasing/purchase-requests/${row.id}/submit`, {
                          method: "POST",
                          body: {},
                        }),
                      );
                    },
                  },
                  {
                    id: "req-approve",
                    label: d.purchasingApprove,
                    onSelect: (row: PurchaseRequestRow) => {
                      if (row.status !== "PENDING_APPROVAL") return;
                      void call<PurchaseRequestRow>(`req-approve-${row.id}`, () =>
                        bffFetch<PurchaseRequestRow>(`purchasing/purchase-requests/${row.id}/approve`, {
                          method: "POST",
                          body: {},
                        }),
                      );
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
