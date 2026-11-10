"use client";

/**
 * T13-UI (PHASE-012) — sales-invoice workspace (transaction-entry archetype):
 * create CASH/CREDIT invoices (item or account lines, per-line tax code),
 * submit → approve (the BR-001 credit decision rides the row's creditCheck
 * jsonb — BLOCK shows the override checkbox, gated by
 * sales.credit_check.override server-side) → post (G-01/G-02 + G-03 when
 * with-goods). Print stays honestly disabled until PHASE-013 (§7).
 */
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { JSX } from "react";

import { Badge, Button, Checkbox, DataTable, DatePicker, Input, Select } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type {
  AccountRow,
  BranchRow,
  CashAccountRow,
  ItemRow,
  PartnerRow,
  SalesInvoiceRow,
  TaxCodeRow,
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
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface DraftLine {
  itemId: string;
  accountId: string;
  qty: string;
  unitPrice: string;
  discount: string;
  taxCodeId: string;
}

const EMPTY_LINE: DraftLine = { itemId: "", accountId: "", qty: "", unitPrice: "", discount: "", taxCodeId: "" };

/** BR-001 decision chip (ALLOW/WARN/BLOCK) — semantic tokens per posture. */
function CreditDecisionChip({
  decision,
  allowLabel,
  warnLabel,
  blockLabel,
}: {
  decision: string;
  allowLabel: string;
  warnLabel: string;
  blockLabel: string;
}): JSX.Element {
  const style =
    decision === "BLOCK"
      ? "border-danger-border bg-danger-bg text-danger-text"
      : decision === "WARN"
        ? "border-warning-border bg-warning-bg text-warning-text"
        : "border-success-border bg-success-bg text-success-text";
  const label = decision === "BLOCK" ? blockLabel : decision === "WARN" ? warnLabel : allowLabel;
  return (
    <span className={`inline-flex w-fit items-center gap-1 rounded-sm border px-1.5 py-0.5 text-xs leading-4 ${style}`}>
      {label}
    </span>
  );
}

export function SalesInvoices({
  locale,
  initialInvoices,
  customers,
  items,
  revenueAccounts,
  taxCodes,
  cashAccounts,
  branches,
  baseCurrency,
  canCreate,
  canApprove,
  canOverrideCredit,
  canPost,
}: {
  locale: Locale;
  initialInvoices: readonly SalesInvoiceRow[];
  customers: readonly PartnerRow[];
  items: readonly ItemRow[];
  revenueAccounts: readonly AccountRow[];
  taxCodes: readonly TaxCodeRow[];
  cashAccounts: readonly CashAccountRow[];
  branches: readonly BranchRow[];
  baseCurrency: string;
  canCreate: boolean;
  canApprove: boolean;
  canOverrideCredit: boolean;
  canPost: boolean;
}): JSX.Element {
  const d = getDictionary(locale);
  const router = useRouter();
  const [invoices, setInvoices] = useState<readonly SalesInvoiceRow[]>(initialInvoices);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [branchId, setBranchId] = useState("");
  const [kind, setKind] = useState<"CASH" | "CREDIT">("CREDIT");
  const [customerId, setCustomerId] = useState("");
  const [cashAccountId, setCashAccountId] = useState("");
  const [deliveryId, setDeliveryId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState("");
  const [currencyCode, setCurrencyCode] = useState(baseCurrency === "" ? "SAR" : baseCurrency);
  const [exchangeRate, setExchangeRate] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([{ ...EMPTY_LINE }]);

  // Inline prompts: approve (credit-override checkbox) + cancel-with-reason.
  const [approveId, setApproveId] = useState<string | null>(null);
  const [overrideCredit, setOverrideCredit] = useState(false);
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
  const activeBranches = useMemo(() => branches.filter((b) => b.isActive), [branches]);
  const activeCashAccounts = useMemo(
    () => cashAccounts.filter((a) => a.status === "ACTIVE"),
    [cashAccounts],
  );

  const effectiveCurrency = currencyCode.trim().toUpperCase();
  const isForeign = effectiveCurrency !== baseCurrency;

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
    const headerReady =
      branchId !== "" &&
      customerId !== "" &&
      DATE_RE.test(invoiceDate) &&
      (dueDate === "" || DATE_RE.test(dueDate)) &&
      effectiveCurrency.length === 3 &&
      (!isForeign || (exchangeRate !== "" && RATE_RE.test(exchangeRate))) &&
      (kind !== "CASH" || cashAccountId !== "");
    const flowOptionalOk =
      (deliveryId.trim() === "" || UUID_RE.test(deliveryId.trim())) &&
      (warehouseId.trim() === "" || UUID_RE.test(warehouseId.trim()));
    if (
      !headerReady ||
      !flowOptionalOk ||
      lines.length === 0 ||
      lines.some(
        (l) =>
          (l.itemId === "") === (l.accountId === "") ||
          !QTY_RE.test(l.qty) ||
          !PRICE_RE.test(l.unitPrice) ||
          (l.discount !== "" && !MONEY_RE.test(l.discount)),
      )
    ) {
      setError(d.errorsValidation);
      return;
    }
    const created = await call<SalesInvoiceRow>("create", () =>
      bffFetch<SalesInvoiceRow>("sales/sales-invoices", {
        method: "POST",
        body: {
          branchId,
          kind,
          customerId,
          invoiceDate,
          dueDate: dueDate === "" ? null : dueDate,
          currencyCode: effectiveCurrency,
          exchangeRate: exchangeRate === "" ? null : exchangeRate,
          deliveryId: deliveryId.trim() === "" ? null : deliveryId.trim(),
          warehouseId: warehouseId.trim() === "" ? null : warehouseId.trim(),
          cashAccountId: kind === "CASH" ? cashAccountId : null,
          lines: lines.map((l) => ({
            itemId: l.itemId === "" ? null : l.itemId,
            accountId: l.accountId === "" ? null : l.accountId,
            qty: l.qty,
            unitPrice: l.unitPrice,
            discountAmount: l.discount === "" ? null : l.discount,
            taxCodeId: l.taxCodeId === "" ? null : l.taxCodeId,
          })),
        },
      }),
    );
    if (created !== undefined) {
      setInvoices((rows) => [created, ...rows]);
      setNotice(d.salesNoticeCreated);
      setLines([{ ...EMPTY_LINE }]);
    }
  }

  async function action(id: string, act: "submit" | "post"): Promise<void> {
    const updated = await call<SalesInvoiceRow>(`${act}-${id}`, () =>
      bffFetch<SalesInvoiceRow>(`sales/sales-invoices/${id}/${act}`, {
        method: "POST",
        body: {},
      }),
    );
    if (updated !== undefined) {
      setInvoices((rows) => rows.map((row) => (row.id === id ? updated : row)));
      if (act === "post") {
        setNotice(d.salesNoticePosted);
      }
    }
  }

  async function approve(id: string, override: boolean): Promise<void> {
    const updated = await call<SalesInvoiceRow>(`approve-${id}`, () =>
      bffFetch<SalesInvoiceRow>(`sales/sales-invoices/${id}/approve`, {
        method: "POST",
        body: override ? { override: true } : {},
      }),
    );
    if (updated !== undefined) {
      setInvoices((rows) => rows.map((row) => (row.id === id ? updated : row)));
      setApproveId(null);
      setOverrideCredit(false);
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
    const updated = await call<SalesInvoiceRow>(`cancel-${id}`, () =>
      bffFetch<SalesInvoiceRow>(`sales/sales-invoices/${id}/cancel`, {
        method: "POST",
        body: { reason },
      }),
    );
    if (updated !== undefined) {
      setInvoices((rows) => rows.map((row) => (row.id === id ? updated : row)));
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
      {notice !== null && <SuccessNotice>{notice}</SuccessNotice>}

      {canCreate && (
        <Card title={d.salesNewInvoice}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Select
              label={d.salesKind}
              value={kind}
              onValueChange={(value) => setKind(value === "CASH" ? "CASH" : "CREDIT")}
              options={[
                { value: "CASH", label: d.salesKindCash },
                { value: "CREDIT", label: d.salesKindCredit },
              ]}
            />
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
            {kind === "CASH" && (
              <Select
                label={d.salesCashAccount}
                value={cashAccountId}
                onValueChange={setCashAccountId}
                options={[
                  { value: "", label: d.salesSelectCashAccount },
                  ...activeCashAccounts.map((a) => ({
                    value: a.id,
                    label: `${localizedName(a.name, a.nameAr, locale)} · ${a.currencyCode}`,
                  })),
                ]}
              />
            )}
            <DatePicker
              label={d.salesInvoiceDate}
              value={invoiceDate}
              onSelect={setInvoiceDate}
              locale={locale}
            />
            <DatePicker label={d.salesDueDate} value={dueDate} onSelect={setDueDate} locale={locale} />
            <Input
              label={d.salesCurrency}
              value={currencyCode}
              onValueChange={setCurrencyCode}
              hint={baseCurrency === "" ? undefined : `${d.salesCurrency}: ${baseCurrency}`}
              mono
              bidiIsolate
            />
            {isForeign && (
              <Input
                label={d.salesExchangeRate}
                value={exchangeRate}
                onValueChange={setExchangeRate}
                inputMode="decimal"
                mono
                bidiIsolate
              />
            )}
            <Input
              label={d.salesDelivery}
              value={deliveryId}
              onValueChange={setDeliveryId}
              mono
              bidiIsolate
            />
            <Input
              label={d.salesWarehouse}
              value={warehouseId}
              onValueChange={setWarehouseId}
              mono
              bidiIsolate
            />
          </div>
          <div className="mt-4 space-y-3">
            {lines.map((line, index) => (
              <div key={index} className="grid gap-3 sm:grid-cols-[1.5fr_1.5fr_1fr_1fr_1fr_1fr_auto]">
                <Select
                  label={index === 0 ? d.salesItem : undefined}
                  value={line.itemId}
                  onValueChange={(value) =>
                    setLines((rows) => rows.map((r, i) => (i === index ? { ...r, itemId: value, accountId: "" } : r)))
                  }
                  options={[
                    { value: "", label: d.salesItem },
                    ...items.map((item) => ({ value: item.id, label: item.sku })),
                  ]}
                />
                <Select
                  label={index === 0 ? d.salesAccount : undefined}
                  value={line.accountId}
                  onValueChange={(value) =>
                    setLines((rows) => rows.map((r, i) => (i === index ? { ...r, accountId: value, itemId: "" } : r)))
                  }
                  options={[
                    { value: "", label: "—" },
                    ...revenueAccounts.map((a) => ({ value: a.id, label: `${a.code} · ${localizedName(a.name, a.nameAr, locale)}` })),
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
                <Select
                  label={index === 0 ? d.salesTaxCode : undefined}
                  value={line.taxCodeId}
                  onValueChange={(value) => setLines((rows) => rows.map((r, i) => (i === index ? { ...r, taxCodeId: value } : r)))}
                  options={[
                    { value: "", label: "—" },
                    ...taxCodes.map((code) => ({ value: code.id, label: code.code })),
                  ]}
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

      <Card title={d.salesInvoicesTitle}>
        <DataTable
          columns={[
            {
              id: "no",
              header: activeLocaleHeader(d.salesInvoiceNo),
              accessor: (row: SalesInvoiceRow) => row.invoiceNo ?? "—",
              mono: true,
              render: (row: SalesInvoiceRow) => (
                <span className="font-mono text-sm" dir="ltr">{row.invoiceNo ?? "—"}</span>
              ),
            },
            {
              id: "kind",
              header: activeLocaleHeader(d.salesKind),
              accessor: (row: SalesInvoiceRow) => row.kind,
              render: (row: SalesInvoiceRow) => (
                <Badge tone="primary">{row.kind === "CASH" ? d.salesKindCash : d.salesKindCredit}</Badge>
              ),
            },
            {
              id: "customer",
              header: activeLocaleHeader(d.salesCustomer),
              accessor: (row: SalesInvoiceRow) => customerNameById.get(row.customerId) ?? row.customerId,
            },
            {
              id: "date",
              header: activeLocaleHeader(d.salesInvoiceDate),
              accessor: (row: SalesInvoiceRow) => row.invoiceDate,
            },
            {
              id: "due",
              header: activeLocaleHeader(d.salesDueDate),
              accessor: (row: SalesInvoiceRow) => row.dueDate,
            },
            {
              id: "net",
              header: activeLocaleHeader(d.salesTotalNet),
              accessor: (row: SalesInvoiceRow) => row.totalNet,
              render: (row: SalesInvoiceRow) => (
                <span className="font-mono text-sm" dir="ltr">{row.totalNet}</span>
              ),
            },
            {
              id: "gross",
              header: activeLocaleHeader(d.salesTotalGross),
              accessor: (row: SalesInvoiceRow) => row.totalGross,
              render: (row: SalesInvoiceRow) => (
                <span className="font-mono text-sm" dir="ltr">{row.totalGross}</span>
              ),
            },
            {
              id: "creditCheck",
              header: activeLocaleHeader(d.salesCreditCheck),
              accessor: (row: SalesInvoiceRow) => row.creditCheck?.decision ?? "—",
              render: (row: SalesInvoiceRow) =>
                row.creditCheck?.decision !== undefined && row.creditCheck.decision !== "" ? (
                  <CreditDecisionChip
                    decision={row.creditCheck.decision}
                    allowLabel={d.salesCreditAllow}
                    warnLabel={d.salesCreditWarn}
                    blockLabel={d.salesCreditBlock}
                  />
                ) : (
                  "—"
                ),
            },
            {
              id: "status",
              header: activeLocaleHeader(d.salesStatus),
              accessor: (row: SalesInvoiceRow) => row.status,
              render: (row: SalesInvoiceRow) => salesStatusLabel(d, row.status),
            },
          ]}
          rows={[...invoices]}
          rowKey={(row) => row.id}
          rowActions={[
            ...(canCreate
              ? [
                  {
                    id: "submit",
                    label: d.salesSubmit,
                    onSelect: (row: SalesInvoiceRow) => {
                      if (row.status !== "DRAFT") return;
                      void action(row.id, "submit");
                    },
                  },
                  {
                    id: "cancel",
                    label: d.salesCancel,
                    onSelect: (row: SalesInvoiceRow) => {
                      if (row.status === "POSTED" || row.status === "CANCELLED") return;
                      setError(null);
                      setNotice(null);
                      setApproveId(null);
                      setCancelReason("");
                      setCancelId(row.id);
                    },
                  },
                ]
              : []),
            ...(canApprove
              ? [
                  {
                    id: "approve",
                    label: d.salesApprove,
                    onSelect: (row: SalesInvoiceRow) => {
                      if (row.status !== "PENDING_APPROVAL") return;
                      setError(null);
                      setNotice(null);
                      setCancelId(null);
                      setOverrideCredit(false);
                      setApproveId(row.id);
                    },
                  },
                ]
              : []),
            ...(canPost
              ? [
                  {
                    id: "post",
                    label: d.salesPost,
                    onSelect: (row: SalesInvoiceRow) => {
                      if (row.status !== "APPROVED") return;
                      void action(row.id, "post");
                    },
                  },
                ]
              : []),
          ]}
          empty={{ title: d.salesEmpty }}
        />
        {/* §7 constraint: print/PDF arrives with PHASE-013 — honest disabled
            state, never a dead button that pretends. */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button variant="secondary" disabled>
            {d.salesPrint}
          </Button>
          <p className="text-xs text-muted-foreground">{d.salesPrintDisabled}</p>
        </div>
      </Card>

      {approveId !== null && (
        <Card title={`${d.salesApprove} · ${invoices.find((i) => i.id === approveId)?.invoiceNo ?? approveId.slice(0, 8)}`}>
          {canOverrideCredit && (
            <Checkbox
              label={d.salesOverrideCredit}
              checked={overrideCredit}
              onCheckedChange={(checked) => setOverrideCredit(checked === true)}
            />
          )}
          <div className="mt-4 flex gap-2">
            <Button
              disabled={busy !== null}
              onClick={() => void approve(approveId, overrideCredit && canOverrideCredit)}
            >
              {busy === `approve-${approveId}` ? d.loading : d.salesApprove}
            </Button>
            <Button
              variant="secondary"
              disabled={busy !== null}
              onClick={() => {
                setApproveId(null);
                setOverrideCredit(false);
              }}
            >
              {d.commonCancel}
            </Button>
          </div>
        </Card>
      )}

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
