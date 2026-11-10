"use client";

/**
 * T13-UI (PHASE-011) — supplier-invoice workspace (transaction-entry §4 +
 * document detail §5): create the invoice (supplier's own number, lines
 * with tax stamps), preview/record the THREE-WAY MATCH with the per-line
 * PO/GRN/invoice triple + variance highlighting + dispositions (BR-009),
 * then approve + post (G-08: GRNI clears, AP opens).
 */
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { JSX } from "react";

import { Button, DataTable, DatePicker, Input, Select } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type {
  AccountRow,
  ItemRow,
  MatchResultRow,
  PartnerRow,
  SupplierInvoiceRow,
  TaxCodeRow,
} from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { localizedName, localizedPurchasingError, matchStatusLabel, purchasingStatusLabel } from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice, SuccessNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const QTY_RE = /^\d+(\.\d{1,6})?$/;
const PRICE_RE = /^\d+(\.\d{1,6})?$/;

interface DraftLine {
  itemId: string;
  accountId: string;
  qty: string;
  unitPrice: string;
  taxCodeId: string;
}

export function PurchasingInvoices({
  locale,
  initialInvoices,
  suppliers,
  items,
  expenseAccounts,
  taxCodes,
  canCreate,
  canApprove,
  canPost,
}: {
  locale: Locale;
  initialInvoices: readonly SupplierInvoiceRow[];
  suppliers: readonly PartnerRow[];
  items: readonly ItemRow[];
  expenseAccounts: readonly AccountRow[];
  taxCodes: readonly TaxCodeRow[];
  canCreate: boolean;
  canApprove: boolean;
  canPost: boolean;
}): JSX.Element {
  const d = getDictionary(locale);
  const router = useRouter();
  const [invoices, setInvoices] = useState<readonly SupplierInvoiceRow[]>(initialInvoices);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [match, setMatch] = useState<MatchResultRow | null>(null);
  const [matchInvoiceId, setMatchInvoiceId] = useState<string | null>(null);
  const [dispositionReason, setDispositionReason] = useState("");

  const [supplierId, setSupplierId] = useState("");
  const [invoiceNo, setInvoiceNo] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().slice(0, 10));
  const [lines, setLines] = useState<DraftLine[]>([{ itemId: "", accountId: "", qty: "", unitPrice: "", taxCodeId: "" }]);

  const supplierNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const supplier of suppliers) {
      map.set(supplier.id, localizedName(supplier.name, supplier.nameAr, locale));
    }
    return map;
  }, [suppliers, locale]);

  async function create(): Promise<void> {
    if (
      supplierId === "" ||
      invoiceNo.trim() === "" ||
      !DATE_RE.test(invoiceDate) ||
      lines.length === 0 ||
      lines.some(
        (l) =>
          (l.itemId === "") === (l.accountId === "") ||
          !QTY_RE.test(l.qty) ||
          !PRICE_RE.test(l.unitPrice),
      )
    ) {
      setError(d.errorsValidation);
      return;
    }
    setBusy("create");
    setError(null);
    setNotice(null);
    const result = await bffFetch<SupplierInvoiceRow>("purchasing/supplier-invoices", {
      method: "POST",
      body: {
        supplierId,
        invoiceNo: invoiceNo.trim(),
        invoiceDate,
        dueDate: null,
        currencyCode: "SAR",
        lines: lines.map((l) => ({
          itemId: l.itemId === "" ? null : l.itemId,
          accountId: l.accountId === "" ? null : l.accountId,
          qty: l.qty,
          unitPrice: l.unitPrice,
          taxCodeId: l.taxCodeId === "" ? null : l.taxCodeId,
          description: l.itemId === "" ? "expense line" : null,
        })),
      },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedPurchasingError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setInvoices((rows) => [result.data, ...rows]);
    setNotice(d.purchasingNoticeCreated);
    setInvoiceNo("");
    setLines([{ itemId: "", accountId: "", qty: "", unitPrice: "", taxCodeId: "" }]);
    router.refresh();
  }

  async function previewMatch(id: string): Promise<void> {
    setBusy(`match-${id}`);
    setError(null);
    const result = await bffFetch<MatchResultRow>(`purchasing/supplier-invoices/${id}/match`, { method: "GET" });
    setBusy(null);
    if (!result.ok) {
      setError(localizedPurchasingError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setMatch(result.data);
    setMatchInvoiceId(id);
  }

  async function recordMatch(id: string, withDispositions: boolean): Promise<void> {
    setBusy(`record-${id}`);
    setError(null);
    setNotice(null);
    const result = await bffFetch<MatchResultRow>(`purchasing/supplier-invoices/${id}/match`, {
      method: "POST",
      body: withDispositions
        ? {
            dispositions: (match?.lines ?? [])
              .filter((line) => line.outcome !== "MATCHED" && line.outcome !== "PRICE_VARIANCE_WITHIN_TOLERANCE" && line.outcome !== "QTY_VARIANCE_WITHIN_TOLERANCE")
              .map((line) => ({
                invoiceLineNo: line.invoiceLineNo,
                type: "ACCEPT_WITH_REASON",
                reason: dispositionReason.trim() === "" ? "accepted via workspace" : dispositionReason.trim(),
              })),
          }
        : {},
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedPurchasingError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setMatch(result.data);
    setNotice(d.purchasingNoticeUpdated);
    router.refresh();
  }

  async function action(id: string, act: "submit" | "approve" | "post"): Promise<void> {
    setBusy(`${act}-${id}`);
    setError(null);
    setNotice(null);
    const result = await bffFetch<SupplierInvoiceRow>(`purchasing/supplier-invoices/${id}/${act}`, {
      method: "POST",
      body: {},
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedPurchasingError(d, result.error, result.retryAfterSeconds));
      return;
    }
    if (act === "post") {
      setNotice(d.purchasingNoticePosted);
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
      {notice !== null && <SuccessNotice>{notice}</SuccessNotice>}

      {canCreate && (
        <Card title={d.purchasingNewInvoice}>
          <div className="grid gap-3 sm:grid-cols-3">
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
              label={d.purchasingInvoiceNo}
              value={invoiceNo}
              onValueChange={setInvoiceNo}
            />
            <DatePicker
              label={d.purchasingInvoiceDate}
              value={invoiceDate}
              onSelect={setInvoiceDate}
              locale={locale}
              />
          </div>
          <div className="mt-4 space-y-3">
            {lines.map((line, index) => (
              <div key={index} className="grid gap-3 sm:grid-cols-[1.5fr_1.5fr_1fr_1fr_1fr_auto]">
                <Select
                  label={index === 0 ? d.purchasingItem : undefined}
                  value={line.itemId}
                  onValueChange={(value) =>
                    setLines((rows) =>
                      rows.map((r, i) => (i === index ? { ...r, itemId: value, accountId: "" } : r)),
                    )
                  }
                  options={[
                    { value: "", label: d.purchasingItem },
                    ...items.map((item) => ({ value: item.id, label: item.sku })),
                  ]}
                />
                <Select
                  label={index === 0 ? d.expensesColAccount : undefined}
                  value={line.accountId}
                  onValueChange={(value) =>
                    setLines((rows) =>
                      rows.map((r, i) => (i === index ? { ...r, accountId: value, itemId: "" } : r)),
                    )
                  }
                  options={[
                    { value: "", label: "—" },
                    ...expenseAccounts.map((a) => ({ value: a.id, label: `${a.code} · ${a.name}` })),
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
                  label={index === 0 ? d.purchasingUnitPrice : undefined}
                  value={line.unitPrice}
                  onValueChange={(value) =>
                    setLines((rows) => rows.map((r, i) => (i === index ? { ...r, unitPrice: value } : r)))
                  }
                  inputMode="decimal"
                />
                <Select
                  label={index === 0 ? d.purchasingTaxCode : undefined}
                  value={line.taxCodeId}
                  onValueChange={(value) => setLines((rows) => rows.map((r, i) => (i === index ? { ...r, taxCodeId: value} : r)))
                  }
                  options={[
                    { value: "", label: "—" },
                    ...taxCodes.map((code) => ({ value: code.id, label: code.code })),
                  ]}
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
            <Button variant="secondary" onClick={() => setLines((rows) => [...rows, { itemId: "", accountId: "", qty: "", unitPrice: "", taxCodeId: "" }])}>
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

      <Card title={d.purchasingInvoicesTitle}>
        <DataTable
          columns={[
            {
              id: "no",
              header: activeLocaleHeader(d.purchasingInvoiceNo),
              accessor: (row: SupplierInvoiceRow) => row.invoiceNo,
              mono: true,
            },
            {
              id: "internal",
              header: activeLocaleHeader(d.purchasingInternalNo),
              accessor: (row: SupplierInvoiceRow) => row.internalNo ?? "—",
              mono: true,
            },
            {
              id: "supplier",
              header: activeLocaleHeader(d.purchasingSupplier),
              accessor: (row: SupplierInvoiceRow) => supplierNameById.get(row.supplierId) ?? row.supplierId,
            },
            {
              id: "date",
              header: activeLocaleHeader(d.purchasingInvoiceDate),
              accessor: (row: SupplierInvoiceRow) => row.invoiceDate,
            },
            {
              id: "due",
              header: activeLocaleHeader(d.purchasingDueDate),
              accessor: (row: SupplierInvoiceRow) => row.dueDate,
            },
            {
              id: "gross",
              header: activeLocaleHeader(d.purchasingTotalGross),
              accessor: (row: SupplierInvoiceRow) => row.totalGross,
              render: (row: SupplierInvoiceRow) => (
                <span className="font-mono text-sm" dir="ltr">{row.totalGross}</span>
              ),
            },
            {
              id: "match",
              header: activeLocaleHeader(d.purchasingMatchStatus),
              accessor: (row: SupplierInvoiceRow) => row.matchStatus,
              render: (row: SupplierInvoiceRow) => matchStatusLabel(d, row.matchStatus),
            },
            {
              id: "status",
              header: activeLocaleHeader(d.purchasingStatus),
              accessor: (row: SupplierInvoiceRow) => row.status,
              render: (row: SupplierInvoiceRow) => purchasingStatusLabel(d, row.status),
            },
          ]}
          rows={[...invoices]}
          rowKey={(row) => row.id}
          rowActions={[
            {
              id: "match",
              label: d.purchasingMatchPreview,
              onSelect: (row: SupplierInvoiceRow) => {
                if (row.status === "POSTED" || row.status === "CANCELLED") return;
                void previewMatch(row.id);
              },
            },
            ...(canCreate
              ? [
                  {
                    id: "submit",
                    label: d.purchasingSubmit,
                    onSelect: (row: SupplierInvoiceRow) => {
                      if (row.status !== "DRAFT") return;
                      void action(row.id, "submit");
                    },
                  },
                ]
              : []),
            ...(canApprove
              ? [
                  {
                    id: "approve",
                    label: d.purchasingApprove,
                    onSelect: (row: SupplierInvoiceRow) => {
                      if (row.status !== "PENDING_APPROVAL" && row.status !== "DRAFT") return;
                      void action(row.id, "approve");
                    },
                  },
                ]
              : []),
            ...(canPost
              ? [
                  {
                    id: "post",
                    label: d.purchasingPost,
                    onSelect: (row: SupplierInvoiceRow) => {
                      if (row.status !== "APPROVED") return;
                      void action(row.id, "post");
                    },
                  },
                ]
              : []),
          ]}
          empty={{ title: d.purchasingEmpty }}
        />
      </Card>

      {match !== null && matchInvoiceId !== null && (
        <Card title={d.purchasingMatchPreview}>
          <DataTable
            columns={[
              {
                id: "line",
                header: activeLocaleHeader("#"),
                accessor: (row: MatchResultRow["lines"][number]) => String(row.invoiceLineNo),
              },
              {
                id: "grn",
                header: activeLocaleHeader(d.purchasingQty),
                accessor: (row: MatchResultRow["lines"][number]) =>
                  `${row.invoiceQty} / ${row.grnQty ?? "—"}`,
                render: (row: MatchResultRow["lines"][number]) => (
                  <span className="font-mono text-sm" dir="ltr">
                    {row.invoiceQty} / {row.grnQty ?? "—"}
                  </span>
                ),
              },
              {
                id: "price",
                header: activeLocaleHeader(d.purchasingUnitPrice),
                accessor: (row: MatchResultRow["lines"][number]) =>
                  `${row.invoiceUnitPrice} / ${row.grnUnitCost ?? "—"}`,
              },
              {
                id: "qtyVar",
                header: activeLocaleHeader(d.purchasingQtyVariance),
                accessor: (row: MatchResultRow["lines"][number]) => row.qtyVariancePct ?? "0",
                render: (row: MatchResultRow["lines"][number]) => (
                  <span
                    className={
                      row.outcome === "QTY_EXCEPTION" || row.outcome === "PRICE_EXCEPTION"
                        ? "font-mono text-sm text-destructive"
                        : "font-mono text-sm"
                    }
                    dir="ltr"
                  >
                    {row.qtyVariancePct ?? "0.0000"}
                  </span>
                ),
              },
              {
                id: "priceVar",
                header: activeLocaleHeader(d.purchasingPriceVariance),
                accessor: (row: MatchResultRow["lines"][number]) => row.priceVariancePct ?? "0",
                render: (row: MatchResultRow["lines"][number]) => (
                  <span
                    className={
                      row.outcome === "QTY_EXCEPTION" || row.outcome === "PRICE_EXCEPTION"
                        ? "font-mono text-sm text-destructive"
                        : "font-mono text-sm"
                    }
                    dir="ltr"
                  >
                    {row.priceVariancePct ?? "0.0000"}
                  </span>
                ),
              },
              {
                id: "outcome",
                header: activeLocaleHeader(d.purchasingStatus),
                accessor: (row: MatchResultRow["lines"][number]) => row.outcome,
                render: (row: MatchResultRow["lines"][number]) =>
                  row.outcome === "QTY_EXCEPTION" || row.outcome === "PRICE_EXCEPTION" || row.outcome === "UNMATCHED"
                    ? matchStatusLabel(d, "EXCEPTION")
                    : matchStatusLabel(d, "MATCHED"),
              },
            ]}
            rows={[...match.lines]}
            rowKey={(row) => String(row.invoiceLineNo)}
            empty={{ title: d.purchasingEmpty }}
          />
          {match.summary.exceptions > 0 && (
            <div className="mt-4 space-y-3">
              <Input
                label={d.purchasingDispositionReason}
                value={dispositionReason}
                onValueChange={setDispositionReason}
              />
              <Button
                disabled={busy !== null}
                onClick={() => void recordMatch(matchInvoiceId, true)}
              >
                {busy === `record-${matchInvoiceId}`
                  ? d.loading
                  : `${d.purchasingDispositionAccept} (${match.summary.undisposed})`}
              </Button>
            </div>
          )}
          <div className="mt-3">
            <Button variant="secondary" disabled={busy !== null} onClick={() => void recordMatch(matchInvoiceId, false)}>
              {d.purchasingRecordMatch}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
