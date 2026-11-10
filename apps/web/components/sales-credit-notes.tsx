"use client";

/**
 * T13-UI (PHASE-012) — credit-note workspace (transaction-entry archetype):
 * returns/corrections referencing POSTED invoices (BR-004 window enforced
 * server-side), lines keyed by invoiceLineId with the return-to-stock
 * policy, then submit → approve → post (G-04: SALES_RETURNS + VAT + AR and
 * the W-3 re-entry at ORIGINAL issue cost).
 */
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { JSX } from "react";

import { Button, Checkbox, DataTable, DatePicker, Input, Select } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type { BranchRow, CreditNoteRow, PartnerRow } from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { localizedName, localizedSalesError, salesStatusLabel } from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice, SuccessNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const QTY_RE = /^\d+(\.\d{1,6})?$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface DraftLine {
  invoiceLineId: string;
  qty: string;
  returnToStock: boolean;
}

const EMPTY_LINE: DraftLine = { invoiceLineId: "", qty: "", returnToStock: false };

export function SalesCreditNotes({
  locale,
  initialNotes,
  customers,
  branches,
  canCreate,
  canApprove,
  canPost,
}: {
  locale: Locale;
  initialNotes: readonly CreditNoteRow[];
  customers: readonly PartnerRow[];
  branches: readonly BranchRow[];
  canCreate: boolean;
  canApprove: boolean;
  canPost: boolean;
}): JSX.Element {
  const d = getDictionary(locale);
  const router = useRouter();
  const [notes, setNotes] = useState<readonly CreditNoteRow[]>(initialNotes);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [branchId, setBranchId] = useState("");
  const [invoiceId, setInvoiceId] = useState("");
  const [noteDate, setNoteDate] = useState(new Date().toISOString().slice(0, 10));
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

  const activeBranches = useMemo(() => branches.filter((b) => b.isActive), [branches]);

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
      !UUID_RE.test(invoiceId.trim()) ||
      !DATE_RE.test(noteDate) ||
      lines.length === 0 ||
      lines.some((l) => !UUID_RE.test(l.invoiceLineId.trim()) || !QTY_RE.test(l.qty))
    ) {
      setError(d.errorsValidation);
      return;
    }
    const created = await call<CreditNoteRow>("create", () =>
      bffFetch<CreditNoteRow>("sales/credit-notes", {
        method: "POST",
        body: {
          branchId,
          invoiceId: invoiceId.trim(),
          noteDate,
          lines: lines.map((l) => ({
            invoiceLineId: l.invoiceLineId.trim(),
            qty: l.qty,
            returnToStock: l.returnToStock,
          })),
        },
      }),
    );
    if (created !== undefined) {
      setNotes((rows) => [created, ...rows]);
      setNotice(d.salesNoticeCreated);
      setLines([{ ...EMPTY_LINE }]);
    }
  }

  async function action(id: string, act: "submit" | "approve" | "post"): Promise<void> {
    const updated = await call<CreditNoteRow>(`${act}-${id}`, () =>
      bffFetch<CreditNoteRow>(`sales/credit-notes/${id}/${act}`, {
        method: "POST",
        body: {},
      }),
    );
    if (updated !== undefined) {
      setNotes((rows) => rows.map((row) => (row.id === id ? updated : row)));
      if (act === "post") {
        setNotice(d.salesNoticePosted);
      }
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
    const updated = await call<CreditNoteRow>(`cancel-${id}`, () =>
      bffFetch<CreditNoteRow>(`sales/credit-notes/${id}/cancel`, {
        method: "POST",
        body: { reason },
      }),
    );
    if (updated !== undefined) {
      setNotes((rows) => rows.map((row) => (row.id === id ? updated : row)));
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
      {notice !== null && <SuccessNotice>{notice}</SuccessNotice>}

      {canCreate && (
        <Card title={d.salesNewCreditNote}>
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
            <Input
              label={d.salesRefInvoice}
              value={invoiceId}
              onValueChange={setInvoiceId}
              mono
              bidiIsolate
            />
            <DatePicker label={d.salesNoteDate} value={noteDate} onSelect={setNoteDate} locale={locale} />
          </div>
          <div className="mt-4 space-y-3">
            {lines.map((line, index) => (
              <div key={index} className="grid gap-3 sm:grid-cols-[2fr_1fr_auto_auto]">
                <Input
                  label={index === 0 ? d.salesInvoiceLineId : undefined}
                  value={line.invoiceLineId}
                  onValueChange={(value) =>
                    setLines((rows) => rows.map((r, i) => (i === index ? { ...r, invoiceLineId: value } : r)))
                  }
                  mono
                  bidiIsolate
                />
                <Input
                  label={index === 0 ? d.salesQty : undefined}
                  value={line.qty}
                  onValueChange={(value) => setLines((rows) => rows.map((r, i) => (i === index ? { ...r, qty: value } : r)))}
                  inputMode="decimal"
                />
                <div className="flex items-end pb-1">
                  <Checkbox
                    label={d.salesReturnToStock}
                    checked={line.returnToStock}
                    onCheckedChange={(checked) =>
                      setLines((rows) =>
                        rows.map((r, i) => (i === index ? { ...r, returnToStock: checked === true } : r)),
                      )
                    }
                  />
                </div>
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

      <Card title={d.salesCreditNotesTitle}>
        <DataTable
          columns={[
            {
              id: "no",
              header: activeLocaleHeader(d.salesNoteNo),
              accessor: (row: CreditNoteRow) => row.noteNo ?? "—",
              mono: true,
              render: (row: CreditNoteRow) => (
                <span className="font-mono text-sm" dir="ltr">{row.noteNo ?? "—"}</span>
              ),
            },
            {
              id: "customer",
              header: activeLocaleHeader(d.salesCustomer),
              accessor: (row: CreditNoteRow) => customerNameById.get(row.customerId) ?? row.customerId,
            },
            {
              id: "date",
              header: activeLocaleHeader(d.salesNoteDate),
              accessor: (row: CreditNoteRow) => row.noteDate,
            },
            {
              id: "gross",
              header: activeLocaleHeader(d.salesTotalGross),
              accessor: (row: CreditNoteRow) => row.totalGross,
              render: (row: CreditNoteRow) => (
                <span className="font-mono text-sm" dir="ltr">{row.totalGross}</span>
              ),
            },
            {
              id: "reentry",
              header: activeLocaleHeader(d.salesReturnToStock),
              accessor: (row: CreditNoteRow) => row.reentryValue,
              render: (row: CreditNoteRow) => (
                <span className="font-mono text-sm" dir="ltr">{row.reentryValue}</span>
              ),
            },
            {
              id: "status",
              header: activeLocaleHeader(d.salesStatus),
              accessor: (row: CreditNoteRow) => row.status,
              render: (row: CreditNoteRow) => salesStatusLabel(d, row.status),
            },
          ]}
          rows={[...notes]}
          rowKey={(row) => row.id}
          rowActions={[
            ...(canCreate
              ? [
                  {
                    id: "submit",
                    label: d.salesSubmit,
                    onSelect: (row: CreditNoteRow) => {
                      if (row.status !== "DRAFT") return;
                      void action(row.id, "submit");
                    },
                  },
                  {
                    id: "cancel",
                    label: d.salesCancel,
                    onSelect: (row: CreditNoteRow) => {
                      if (row.status === "POSTED" || row.status === "CANCELLED") return;
                      setError(null);
                      setNotice(null);
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
                    onSelect: (row: CreditNoteRow) => {
                      if (row.status !== "PENDING_APPROVAL") return;
                      void action(row.id, "approve");
                    },
                  },
                ]
              : []),
            ...(canPost
              ? [
                  {
                    id: "post",
                    label: d.salesPost,
                    onSelect: (row: CreditNoteRow) => {
                      if (row.status !== "APPROVED") return;
                      void action(row.id, "post");
                    },
                  },
                ]
              : []),
          ]}
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
