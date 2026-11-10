"use client";

/**
 * T13-UI (PHASE-011) — debit-note workspace: AP corrections mirroring
 * supplier invoices (G-09), always referencing a POSTED invoice.
 */
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { JSX } from "react";

import { Button, DataTable, DatePicker, Input, Select } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type { DebitNoteRow, ItemRow, PartnerRow, SupplierInvoiceRow } from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { localizedName, localizedPurchasingError, purchasingStatusLabel } from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice, SuccessNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const QTY_RE = /^\d+(\.\d{1,6})?$/;
const PRICE_RE = /^\d+(\.\d{1,6})?$/;

export function PurchasingDebitNotes({
  locale,
  initialNotes,
  postedInvoices,
  suppliers,
  items,
  canCreate,
  canApprove,
  canPost,
}: {
  locale: Locale;
  initialNotes: readonly DebitNoteRow[];
  postedInvoices: readonly SupplierInvoiceRow[];
  suppliers: readonly PartnerRow[];
  items: readonly ItemRow[];
  canCreate: boolean;
  canApprove: boolean;
  canPost: boolean;
}): JSX.Element {
  const d = getDictionary(locale);
  const router = useRouter();
  const [notes, setNotes] = useState<readonly DebitNoteRow[]>(initialNotes);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [refInvoiceId, setRefInvoiceId] = useState("");
  const [noteDate, setNoteDate] = useState(new Date().toISOString().slice(0, 10));
  const [lines, setLines] = useState([{ itemId: "", qty: "", unitPrice: "" }]);

  const supplierNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const supplier of suppliers) {
      map.set(supplier.id, localizedName(supplier.name, supplier.nameAr, locale));
    }
    return map;
  }, [suppliers, locale]);

  const refInvoice = useMemo(
    () => postedInvoices.find((invoice) => invoice.id === refInvoiceId),
    [postedInvoices, refInvoiceId],
  );

  async function create(): Promise<void> {
    if (
      refInvoice === undefined ||
      !DATE_RE.test(noteDate) ||
      lines.length === 0 ||
      lines.some((l) => l.itemId === "" || !QTY_RE.test(l.qty) || !PRICE_RE.test(l.unitPrice))
    ) {
      setError(d.errorsValidation);
      return;
    }
    setBusy("create");
    setError(null);
    setNotice(null);
    const result = await bffFetch<DebitNoteRow>("purchasing/debit-notes", {
      method: "POST",
      body: {
        supplierId: refInvoice.supplierId,
        refInvoiceId: refInvoice.id,
        noteDate,
        currencyCode: refInvoice.currencyCode,
        lines: lines.map((l) => ({ itemId: l.itemId, qty: l.qty, unitPrice: l.unitPrice })),
      },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedPurchasingError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setNotes((rows) => [result.data, ...rows]);
    setNotice(d.purchasingNoticeCreated);
    setLines([{ itemId: "", qty: "", unitPrice: "" }]);
    router.refresh();
  }

  async function action(id: string, act: "submit" | "approve" | "post"): Promise<void> {
    setBusy(`${act}-${id}`);
    setError(null);
    setNotice(null);
    const result = await bffFetch<DebitNoteRow>(`purchasing/debit-notes/${id}/${act}`, {
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
        <Card title={d.purchasingNewDebitNote}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Select
              label={d.purchasingRefInvoice}
              value={refInvoiceId}
              onValueChange={setRefInvoiceId}
              options={[
                { value: "", label: d.purchasingSelectSupplier },
                ...postedInvoices.map((invoice) => ({
                  value: invoice.id,
                  label: `${invoice.invoiceNo} · ${supplierNameById.get(invoice.supplierId) ?? ""} · ${invoice.totalGross}`,
                })),
              ]}
            />
            <DatePicker
              label={d.purchasingNoteDate}
              value={noteDate}
              onSelect={setNoteDate}
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
                  label={index === 0 ? d.purchasingUnitPrice : undefined}
                  value={line.unitPrice}
                  onValueChange={(value) =>
                    setLines((rows) => rows.map((r, i) => (i === index ? { ...r, unitPrice: value } : r)))
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
            <Button variant="secondary" onClick={() => setLines((rows) => [...rows, { itemId: "", qty: "", unitPrice: "" }])}>
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

      <Card title={d.purchasingDebitNotesTitle}>
        <DataTable
          columns={[
            {
              id: "no",
              header: activeLocaleHeader(d.purchasingNoteNo),
              accessor: (row: DebitNoteRow) => row.noteNo ?? "—",
              mono: true,
            },
            {
              id: "date",
              header: activeLocaleHeader(d.purchasingNoteDate),
              accessor: (row: DebitNoteRow) => row.noteDate,
            },
            {
              id: "supplier",
              header: activeLocaleHeader(d.purchasingSupplier),
              accessor: (row: DebitNoteRow) => supplierNameById.get(row.supplierId) ?? row.supplierId,
            },
            {
              id: "gross",
              header: activeLocaleHeader(d.purchasingTotalGross),
              accessor: (row: DebitNoteRow) => row.totalGross,
              render: (row: DebitNoteRow) => (
                <span className="font-mono text-sm" dir="ltr">{row.totalGross}</span>
              ),
            },
            {
              id: "status",
              header: activeLocaleHeader(d.purchasingStatus),
              accessor: (row: DebitNoteRow) => row.status,
              render: (row: DebitNoteRow) => purchasingStatusLabel(d, row.status),
            },
          ]}
          rows={[...notes]}
          rowKey={(row) => row.id}
          rowActions={[
            ...(canCreate
              ? [
                  {
                    id: "submit",
                    label: d.purchasingSubmit,
                    onSelect: (row: DebitNoteRow) => {
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
                    onSelect: (row: DebitNoteRow) => {
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
                    onSelect: (row: DebitNoteRow) => {
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
    </div>
  );
}
