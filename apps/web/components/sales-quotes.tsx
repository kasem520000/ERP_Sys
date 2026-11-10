"use client";

/**
 * T13-UI (PHASE-012) — quotations + sales orders workspace
 * (transaction-entry archetype §4): quote list (DRAFT → SENT →
 * ACCEPTED/REJECTED/EXPIRED, BR-006 — no ledger effect) with the
 * accept/convert inline warehouse prompt, plus the order list
 * (DRAFT → PENDING_APPROVAL → APPROVED → ISSUED → CLOSED) with a
 * multi-line create form (customer, warehouse, dates, reserve policy).
 * Lifecycle permissions mirror the sales controller's RequirePermissions
 * keys exactly; the credit/stock rules are enforced server-side.
 */
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { JSX } from "react";

import { Button, Checkbox, DataTable, DatePicker, Input, Select } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type {
  BranchRow,
  ItemRow,
  PartnerRow,
  QuotationRow,
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
const MONEY_RE = /^\d+(\.\d{1,4})?$/;
const RATE_RE = /^\d+(\.\d{1,8})?$/;

interface DraftLine {
  itemId: string;
  qty: string;
  unitPrice: string;
  discount: string;
}

const EMPTY_LINE: DraftLine = { itemId: "", qty: "", unitPrice: "", discount: "" };

function lineValid(line: DraftLine): boolean {
  return (
    line.itemId !== "" &&
    QTY_RE.test(line.qty) &&
    (line.unitPrice === "" || PRICE_RE.test(line.unitPrice)) &&
    (line.discount === "" || MONEY_RE.test(line.discount))
  );
}

export function SalesQuotes({
  locale,
  initialQuotes,
  initialOrders,
  customers,
  items,
  warehouses,
  branches,
  baseCurrency,
  canCreateQuotes,
  canSendQuotes,
  canConvertQuotes,
  canCreateOrders,
  canApproveOrders,
}: {
  locale: Locale;
  initialQuotes: readonly QuotationRow[];
  initialOrders: readonly SalesOrderRow[];
  customers: readonly PartnerRow[];
  items: readonly ItemRow[];
  warehouses: readonly WarehouseRow[];
  branches: readonly BranchRow[];
  baseCurrency: string;
  canCreateQuotes: boolean;
  canSendQuotes: boolean;
  canConvertQuotes: boolean;
  canCreateOrders: boolean;
  canApproveOrders: boolean;
}): JSX.Element {
  const d = getDictionary(locale);
  const router = useRouter();
  const [quotes, setQuotes] = useState<readonly QuotationRow[]>(initialQuotes);
  const [orders, setOrders] = useState<readonly SalesOrderRow[]>(initialOrders);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [mode, setMode] = useState<"quote" | "order">("quote");

  // Shared create-form state.
  const [branchId, setBranchId] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [quoteDate, setQuoteDate] = useState(new Date().toISOString().slice(0, 10));
  const [validUntil, setValidUntil] = useState("");
  const [orderDate, setOrderDate] = useState(new Date().toISOString().slice(0, 10));
  const [expectedDate, setExpectedDate] = useState("");
  const [currencyCode, setCurrencyCode] = useState(baseCurrency === "" ? "SAR" : baseCurrency);
  const [exchangeRate, setExchangeRate] = useState("");
  const [reserve, setReserve] = useState(false);
  const [lines, setLines] = useState<DraftLine[]>([{ ...EMPTY_LINE }]);

  // Inline prompts: quote accept/convert (warehouseId) + cancel-with-reason.
  const [acceptQuoteId, setAcceptQuoteId] = useState<string | null>(null);
  const [acceptWarehouseId, setAcceptWarehouseId] = useState("");
  const [cancelTarget, setCancelTarget] = useState<{ kind: "quote" | "order"; id: string } | null>(null);
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

  const activeBranches = useMemo(() => branches.filter((b) => b.isActive), [branches]);
  const activeWarehouses = useMemo(() => warehouses.filter((w) => w.isActive), [warehouses]);

  const effectiveCurrency = currencyCode.trim().toUpperCase();

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

  function formReady(): boolean {
    const headerReady =
      branchId !== "" &&
      customerId !== "" &&
      effectiveCurrency.length === 3 &&
      (effectiveCurrency === baseCurrency || (exchangeRate !== "" && RATE_RE.test(exchangeRate)));
    if (!headerReady) return false;
    if (mode === "quote") {
      return DATE_RE.test(quoteDate) && (validUntil === "" || DATE_RE.test(validUntil)) && lines.every(lineValid);
    }
    return (
      warehouseId !== "" &&
      DATE_RE.test(orderDate) &&
      (expectedDate === "" || DATE_RE.test(expectedDate)) &&
      lines.every(lineValid)
    );
  }

  async function submitQuote(): Promise<void> {
    if (!formReady() || lines.length === 0) {
      setError(d.errorsValidation);
      return;
    }
    const created = await call<QuotationRow>("create", () =>
      bffFetch<QuotationRow>("sales/quotations", {
        method: "POST",
        body: {
          branchId,
          customerId,
          quoteDate,
          validUntil: validUntil === "" ? null : validUntil,
          currencyCode: effectiveCurrency,
          exchangeRate: exchangeRate === "" ? null : exchangeRate,
          lines: lines.map((l) => ({
            itemId: l.itemId,
            qty: l.qty,
            unitPrice: l.unitPrice === "" ? null : l.unitPrice,
            discountAmount: l.discount === "" ? null : l.discount,
          })),
        },
      }),
    );
    if (created !== undefined) {
      setQuotes((rows) => [created, ...rows]);
      setNotice(d.salesNoticeCreated);
      setLines([{ ...EMPTY_LINE }]);
    }
  }

  async function submitOrder(): Promise<void> {
    if (!formReady() || lines.length === 0) {
      setError(d.errorsValidation);
      return;
    }
    const created = await call<SalesOrderRow>("create", () =>
      bffFetch<SalesOrderRow>("sales/sales-orders", {
        method: "POST",
        body: {
          branchId,
          customerId,
          warehouseId,
          orderDate,
          expectedDate: expectedDate === "" ? null : expectedDate,
          currencyCode: effectiveCurrency,
          exchangeRate: exchangeRate === "" ? null : exchangeRate,
          reserve,
          lines: lines.map((l) => ({
            itemId: l.itemId,
            qty: l.qty,
            unitPrice: l.unitPrice === "" ? null : l.unitPrice,
            discountAmount: l.discount === "" ? null : l.discount,
          })),
        },
      }),
    );
    if (created !== undefined) {
      setOrders((rows) => [created, ...rows]);
      setNotice(d.salesNoticeCreated);
      setLines([{ ...EMPTY_LINE }]);
    }
  }

  async function quoteAction(
    id: string,
    action: "send" | "reject" | "cancel",
    reason: string | null,
  ): Promise<void> {
    const updated = await call<QuotationRow>(`${action}-${id}`, () =>
      bffFetch<QuotationRow>(`sales/quotations/${id}/${action}`, {
        method: "POST",
        body: action === "cancel" ? { reason: reason ?? "UI cancel" } : {},
      }),
    );
    if (updated !== undefined) {
      setQuotes((rows) => rows.map((row) => (row.id === id ? updated : row)));
    }
  }

  async function confirmCancel(): Promise<void> {
    if (cancelTarget === null || cancelReason.trim() === "") {
      setError(d.errorsValidation);
      return;
    }
    const { kind, id } = cancelTarget;
    const reason = cancelReason.trim();
    setCancelTarget(null);
    setCancelReason("");
    if (kind === "quote") {
      await quoteAction(id, "cancel", reason);
    } else {
      await orderAction(id, "cancel", reason);
    }
  }

  async function acceptQuote(id: string, conversionWarehouseId: string): Promise<void> {
    const updated = await call<SalesOrderRow>(`accept-${id}`, () =>
      bffFetch<SalesOrderRow>(`sales/quotations/${id}/accept`, {
        method: "POST",
        body: { warehouseId: conversionWarehouseId },
      }),
    );
    if (updated !== undefined) {
      setOrders((rows) => [updated, ...rows]);
      // The quote flips to ACCEPTED with the converted order linked (BR-006).
      setQuotes((rows) =>
        rows.map((row) =>
          row.id === id ? { ...row, status: "ACCEPTED", convertedOrderId: updated.id } : row,
        ),
      );
      setAcceptQuoteId(null);
      setAcceptWarehouseId("");
    }
  }

  async function orderAction(
    id: string,
    action: "submit" | "approve" | "issue" | "close" | "cancel",
    reason: string | null,
  ): Promise<void> {
    const updated = await call<SalesOrderRow>(`${action}-${id}`, () =>
      bffFetch<SalesOrderRow>(`sales/sales-orders/${id}/${action}`, {
        method: "POST",
        body: action === "cancel" ? { reason: reason ?? "UI cancel" } : {},
      }),
    );
    if (updated !== undefined) {
      setOrders((rows) => rows.map((row) => (row.id === id ? updated : row)));
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
      {notice !== null && <SuccessNotice>{notice}</SuccessNotice>}

      {(canCreateQuotes || canCreateOrders) && (
        <Card title={mode === "quote" ? d.salesNewQuote : d.salesNewOrder}>
          <div className="mb-4 flex gap-2">
            {canCreateQuotes && (
              <Button variant={mode === "quote" ? "primary" : "secondary"} onClick={() => setMode("quote")}>
                {d.salesQuotesSection}
              </Button>
            )}
            {canCreateOrders && (
              <Button variant={mode === "order" ? "primary" : "secondary"} onClick={() => setMode("order")}>
                {d.salesOrdersSection}
              </Button>
            )}
          </div>
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
            {mode === "order" && (
              <Select
                label={d.salesWarehouse}
                value={warehouseId}
                onValueChange={setWarehouseId}
                options={[
                  { value: "", label: d.salesSelectWarehouse },
                  ...activeWarehouses.map((w) => ({ value: w.id, label: localizedName(w.name, w.nameAr, locale) })),
                ]}
              />
            )}
            {mode === "quote" ? (
              <>
                <DatePicker label={d.salesQuoteDate} value={quoteDate} onSelect={setQuoteDate} locale={locale} />
                <DatePicker label={d.salesValidUntil} value={validUntil} onSelect={setValidUntil} locale={locale} />
              </>
            ) : (
              <>
                <DatePicker label={d.salesOrderDate} value={orderDate} onSelect={setOrderDate} locale={locale} />
                <DatePicker
                  label={d.salesExpectedDate}
                  value={expectedDate}
                  onSelect={setExpectedDate}
                  locale={locale}
                />
              </>
            )}
            <Input
              label={d.salesCurrency}
              value={currencyCode}
              onValueChange={setCurrencyCode}
              hint={baseCurrency === "" ? undefined : `${d.salesCurrency}: ${baseCurrency}`}
              mono
              bidiIsolate
            />
            {effectiveCurrency !== baseCurrency && (
              <Input
                label={d.salesExchangeRate}
                value={exchangeRate}
                onValueChange={setExchangeRate}
                inputMode="decimal"
                mono
                bidiIsolate
              />
            )}
            {mode === "order" && (
              <div className="flex items-end pb-1">
                <Checkbox
                  label={d.salesReserve}
                  checked={reserve}
                  onCheckedChange={(checked) => setReserve(checked === true)}
                />
              </div>
            )}
          </div>
          <div className="mt-4 space-y-3">
            {lines.map((line, index) => (
              <div key={index} className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr_1fr_auto]">
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
                <Input
                  label={index === 0 ? d.salesDiscount : undefined}
                  value={line.discount}
                  onValueChange={(value) =>
                    setLines((rows) => rows.map((r, i) => (i === index ? { ...r, discount: value } : r)))
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
            <Button
              disabled={busy !== null}
              onClick={() => (mode === "quote" ? void submitQuote() : void submitOrder())}
            >
              {busy === "create" ? d.loading : d.commonSave}
            </Button>
          </div>
        </Card>
      )}

      <Card title={d.salesQuotesSection}>
        <DataTable
          columns={[
            {
              id: "no",
              header: activeLocaleHeader(d.salesQuoteNo),
              accessor: (row: QuotationRow) => row.quoteNo ?? "—",
              mono: true,
              render: (row: QuotationRow) => (
                <span className="font-mono text-sm" dir="ltr">{row.quoteNo ?? "—"}</span>
              ),
            },
            {
              id: "customer",
              header: activeLocaleHeader(d.salesCustomer),
              accessor: (row: QuotationRow) => customerNameById.get(row.customerId) ?? row.customerId,
            },
            {
              id: "date",
              header: activeLocaleHeader(d.salesQuoteDate),
              accessor: (row: QuotationRow) => row.quoteDate,
            },
            {
              id: "valid",
              header: activeLocaleHeader(d.salesValidUntil),
              accessor: (row: QuotationRow) => row.validUntil,
            },
            {
              id: "gross",
              header: activeLocaleHeader(d.salesTotalGross),
              accessor: (row: QuotationRow) => row.totalGross,
              render: (row: QuotationRow) => (
                <span className="font-mono text-sm" dir="ltr">{row.totalGross}</span>
              ),
            },
            {
              id: "status",
              header: activeLocaleHeader(d.salesStatus),
              accessor: (row: QuotationRow) => row.status,
              render: (row: QuotationRow) => salesStatusLabel(d, row.status),
            },
          ]}
          rows={[...quotes]}
          rowKey={(row) => row.id}
          rowActions={[
            ...(canSendQuotes
              ? [
                  {
                    id: "send",
                    label: d.salesSend,
                    onSelect: (row: QuotationRow) => {
                      if (row.status !== "DRAFT") return;
                      void quoteAction(row.id, "send", null);
                    },
                  },
                  {
                    id: "reject",
                    label: d.salesReject,
                    onSelect: (row: QuotationRow) => {
                      if (row.status !== "SENT") return;
                      void quoteAction(row.id, "reject", null);
                    },
                  },
                ]
              : []),
            ...(canConvertQuotes
              ? [
                  {
                    id: "accept",
                    label: d.salesAccept,
                    onSelect: (row: QuotationRow) => {
                      if (row.status !== "SENT") return;
                      setError(null);
                      setNotice(null);
                      setAcceptQuoteId(row.id);
                      setAcceptWarehouseId("");
                    },
                  },
                ]
              : []),
            ...(canCreateQuotes
              ? [
                  {
                    id: "cancel",
                    label: d.salesCancel,
                    onSelect: (row: QuotationRow) => {
                      if (row.status !== "DRAFT") return;
                      setError(null);
                      setNotice(null);
                      setAcceptQuoteId(null);
                      setCancelReason("");
                      setCancelTarget({ kind: "quote", id: row.id });
                    },
                  },
                ]
              : []),
          ]}
          empty={{ title: d.salesEmpty }}
        />
      </Card>

      <Card title={d.salesOrdersSection}>
        <DataTable
          columns={[
            {
              id: "no",
              header: activeLocaleHeader(d.salesOrderNo),
              accessor: (row: SalesOrderRow) => row.orderNo ?? "—",
              mono: true,
              render: (row: SalesOrderRow) => (
                <span className="font-mono text-sm" dir="ltr">{row.orderNo ?? "—"}</span>
              ),
            },
            {
              id: "customer",
              header: activeLocaleHeader(d.salesCustomer),
              accessor: (row: SalesOrderRow) => customerNameById.get(row.customerId) ?? row.customerId,
            },
            {
              id: "date",
              header: activeLocaleHeader(d.salesOrderDate),
              accessor: (row: SalesOrderRow) => row.orderDate,
            },
            {
              id: "expected",
              header: activeLocaleHeader(d.salesExpectedDate),
              accessor: (row: SalesOrderRow) => row.expectedDate ?? "—",
            },
            {
              id: "gross",
              header: activeLocaleHeader(d.salesTotalGross),
              accessor: (row: SalesOrderRow) => row.totalGross,
              render: (row: SalesOrderRow) => (
                <span className="font-mono text-sm" dir="ltr">{row.totalGross}</span>
              ),
            },
            {
              id: "status",
              header: activeLocaleHeader(d.salesStatus),
              accessor: (row: SalesOrderRow) => row.status,
              render: (row: SalesOrderRow) => salesStatusLabel(d, row.status),
            },
          ]}
          rows={[...orders]}
          rowKey={(row) => row.id}
          rowActions={[
            ...(canCreateOrders
              ? [
                  {
                    id: "submit",
                    label: d.salesSubmit,
                    onSelect: (row: SalesOrderRow) => {
                      if (row.status !== "DRAFT") return;
                      void orderAction(row.id, "submit", null);
                    },
                  },
                  {
                    id: "cancel",
                    label: d.salesCancel,
                    onSelect: (row: SalesOrderRow) => {
                      if (row.status !== "DRAFT") return;
                      setError(null);
                      setNotice(null);
                      setAcceptQuoteId(null);
                      setCancelReason("");
                      setCancelTarget({ kind: "order", id: row.id });
                    },
                  },
                ]
              : []),
            ...(canApproveOrders
              ? [
                  {
                    id: "approve",
                    label: d.salesApprove,
                    onSelect: (row: SalesOrderRow) => {
                      if (row.status !== "PENDING_APPROVAL") return;
                      void orderAction(row.id, "approve", null);
                    },
                  },
                  {
                    id: "issue",
                    label: d.salesIssue,
                    onSelect: (row: SalesOrderRow) => {
                      if (row.status !== "APPROVED") return;
                      void orderAction(row.id, "issue", null);
                    },
                  },
                  {
                    id: "close",
                    label: d.salesClose,
                    onSelect: (row: SalesOrderRow) => {
                      if (row.status !== "ISSUED") return;
                      void orderAction(row.id, "close", null);
                    },
                  },
                ]
              : []),
          ]}
          empty={{ title: d.salesEmpty }}
        />
      </Card>

      {acceptQuoteId !== null && (
        <Card title={`${d.salesAccept} · ${quotes.find((q) => q.id === acceptQuoteId)?.quoteNo ?? acceptQuoteId.slice(0, 8)}`}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Select
              label={d.salesAcceptWarehouse}
              value={acceptWarehouseId}
              onValueChange={setAcceptWarehouseId}
              options={[
                { value: "", label: d.salesSelectWarehouse },
                ...activeWarehouses.map((w) => ({ value: w.id, label: localizedName(w.name, w.nameAr, locale) })),
              ]}
            />
          </div>
          <div className="mt-4 flex gap-2">
            <Button
              disabled={busy !== null || acceptWarehouseId === ""}
              onClick={() => void acceptQuote(acceptQuoteId, acceptWarehouseId)}
            >
              {busy === `accept-${acceptQuoteId}` ? d.loading : d.salesAccept}
            </Button>
            <Button
              variant="secondary"
              disabled={busy !== null}
              onClick={() => {
                setAcceptQuoteId(null);
                setAcceptWarehouseId("");
              }}
            >
              {d.commonCancel}
            </Button>
          </div>
        </Card>
      )}

      {cancelTarget !== null && (
        <Card title={d.salesCancelReason}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label={d.salesCancelReason}
              value={cancelReason}
              onValueChange={setCancelReason}
            />
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
                setCancelTarget(null);
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
