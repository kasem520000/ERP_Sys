"use client";

/**
 * WEB-039 (PHASE-039) — the customer returns workspace (/sales/returns;
 * transaction-entry archetype, matrix §3.2): two tabs over the 0055/0059
 * sales returns routes —
 *
 * 1. RMAs: the return-authorization registry with the create dialog
 *    (invoice picker → per-line qty inputs over the invoice's lines, the
 *    six-code reason vocabulary) and the lifecycle REQUESTED → approve →
 *    receive → inspect (disposition RESTOCK/SCRAP/REFUND) → complete (the
 *    cash-account leg required on REFUND, G-37) with cancel off the live
 *    states. The detail dialog carries the header + lines.
 * 2. Warranties (S-15): the managed-warranty register with the create
 *    dialog (partner/item/serial/start/duration/coverage/basis/mileage)
 *    and void on ACTIVE rows.
 *
 * Writes gate in-screen on sales.rma.manage / sales.rma.approve /
 * sales.warranties.manage (session-derived flags the page passes); every
 * API failure renders localized through the returns error family.
 */
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { JSX } from "react";

import {
  Badge,
  Button,
  DataTable,
  DatePicker,
  Dialog,
  Input,
  NumberInput,
  Select,
  Tabs,
  useToast,
} from "@erp/ui";

import { getDictionary, type Dictionary, type Locale } from "../i18n/dictionaries";
import type {
  ApiErrorBody,
  ApiResult,
  BranchRow,
  CashAccountRow,
  ItemRow,
  PartnerRow,
  RmaDisposition,
  RmaReasonCode,
  RmaRow,
  RmaWithLines,
  SalesInvoiceRow,
  SalesInvoiceWithLines,
  WarrantyRow,
  WarrantyTerms,
} from "../lib/api-types";
import { isRecord } from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { formatDateTime, formatMessage, localizedApiError, localizedName } from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice, InfoNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";

type WorkspaceTab = "rmas" | "warranties";

/** RMA lifecycle tones (the neutral/primary Badge vocabulary). */
const RMA_TONES: Record<RmaRow["status"], "primary" | "neutral"> = {
  REQUESTED: "neutral",
  APPROVED: "primary",
  RECEIVED: "primary",
  INSPECTED: "primary",
  RESTOCKED: "neutral",
  SCRAPPED: "neutral",
  REFUNDED: "neutral",
  CANCELLED: "neutral",
};

const WARRANTY_TONES: Record<WarrantyRow["status"], "primary" | "neutral"> = {
  ACTIVE: "primary",
  EXPIRED: "neutral",
  VOID: "neutral",
};

const QTY_RE = /^\d+(\.\d{1,6})?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const CUSTOMER_REASONS: readonly RmaReasonCode[] = [
  "DAMAGED",
  "DEFECTIVE",
  "WRONG_ITEM",
  "LATE_DELIVERY",
  "CUSTOMER_REMORSE",
  "OTHER",
];

const DISPOSITIONS: readonly RmaDisposition[] = ["RESTOCK", "SCRAP", "REFUND"];

/** The create-RMA draft (all inputs are strings; the lines ride the map). */
interface RmaDraft {
  branchId: string;
  invoiceId: string;
  reasonCode: RmaReasonCode;
  reason: string;
  reasonAr: string;
  note: string;
  /** invoiceLineId → qty ("" = skip the line). */
  qtys: Record<string, string>;
}

/** The create-warranty draft. */
interface WarrantyDraft {
  partnerId: string;
  itemId: string;
  serialNo: string;
  invoiceId: string;
  startDate: string;
  durationMonths: string;
  coverage: WarrantyTerms["coverage"];
  basis: WarrantyTerms["basis"];
  mileageLimitKm: string;
}

function emptyRmaDraft(): RmaDraft {
  return {
    branchId: "",
    invoiceId: "",
    reasonCode: "DAMAGED",
    reason: "",
    reasonAr: "",
    note: "",
    qtys: {},
  };
}

function emptyWarrantyDraft(today: string): WarrantyDraft {
  return {
    partnerId: "",
    itemId: "",
    serialNo: "",
    invoiceId: "",
    startDate: today,
    durationMonths: "12",
    coverage: "REPAIR",
    basis: "INVOICE_DATE",
    mileageLimitKm: "",
  };
}

/**
 * Stable returns error family → honest messages (localizedApiError covers
 * the generic families; the *_NOT_FOUND not-founds render identically —
 * no existence disclosure).
 */
function returnsError(
  d: Dictionary,
  failure: { error: ApiErrorBody; retryAfterSeconds?: number },
): string {
  switch (failure.error.code) {
    case "RMA_NOT_FOUND":
    case "WARRANTY_NOT_FOUND":
      return d.errorsNotFound;
    case "RMA_STATE_INVALID":
    case "SALES_DOCUMENT_STATE":
    case "RETURN_WINDOW_EXCEEDED":
    case "INVOICE_LINE_INVALID":
    case "PARTNER_NOT_CUSTOMER":
      return d.returnsErrState;
    case "RMA_QTY_EXCEEDS_INVOICED":
      return d.returnsErrQtyExceeds;
    case "RMA_DISPOSITION_REQUIRED":
      return d.returnsErrDisposition;
    case "SCRAP_LOSS_ACCOUNT_UNMAPPED":
      return d.returnsErrScrapUnmapped;
    case "WARRANTY_TERMS_INVALID":
      return d.returnsErrWarrantyTerms;
    default:
      return localizedApiError(d, failure.error, failure.retryAfterSeconds);
  }
}

function rmaStatusLabel(d: Dictionary, status: RmaRow["status"]): string {
  const map: Record<RmaRow["status"], string> = {
    REQUESTED: d.returnsStatusRequested,
    APPROVED: d.returnsStatusApproved,
    RECEIVED: d.returnsStatusReceived,
    INSPECTED: d.returnsStatusInspected,
    RESTOCKED: d.returnsStatusRestocked,
    SCRAPPED: d.returnsStatusScrapped,
    REFUNDED: d.returnsStatusRefunded,
    CANCELLED: d.returnsStatusCancelled,
  };
  return map[status];
}

function dispositionLabel(d: Dictionary, disposition: RmaDisposition | null): string {
  if (disposition === null) {
    return d.returnsDispositionNone;
  }
  const map: Record<RmaDisposition, string> = {
    RESTOCK: d.returnsDispositionRestock,
    SCRAP: d.returnsDispositionScrap,
    REFUND: d.returnsDispositionRefund,
  };
  return map[disposition];
}

function reasonLabel(d: Dictionary, reasonCode: RmaRow["reasonCode"]): string {
  const map: Record<RmaRow["reasonCode"], string> = {
    DAMAGED: d.returnsReasonDamaged,
    DEFECTIVE: d.returnsReasonDefective,
    WRONG_ITEM: d.returnsReasonWrongItem,
    LATE_DELIVERY: d.returnsReasonLateDelivery,
    CUSTOMER_REMORSE: d.returnsReasonCustomerRemorse,
    OTHER: d.returnsReasonOther,
  };
  return map[reasonCode];
}

function warrantyStatusLabel(d: Dictionary, status: WarrantyRow["status"]): string {
  const map: Record<WarrantyRow["status"], string> = {
    ACTIVE: d.returnsWarrantyActive,
    EXPIRED: d.returnsWarrantyExpired,
    VOID: d.returnsWarrantyVoid,
  };
  return map[status];
}

function coverageLabel(d: Dictionary, coverage: string): string {
  const map: Record<string, string> = {
    REPAIR: d.returnsCoverageRepair,
    REPLACE: d.returnsCoverageReplace,
    REFUND: d.returnsCoverageRefund,
    LABOR_ONLY: d.returnsCoverageLaborOnly,
    PARTS_ONLY: d.returnsCoveragePartsOnly,
  };
  return map[coverage] ?? coverage;
}

function basisLabel(d: Dictionary, basis: string): string {
  return basis === "INVOICE_DATE" ? d.returnsBasisInvoiceDate : d.returnsBasisDeliveryDate;
}

/** Narrows the JSONB terms defensively (the matrix is evidence, not trust). */
function warrantyTermsOf(row: WarrantyRow): WarrantyTerms | null {
  if (!isRecord(row.terms)) {
    return null;
  }
  return row.terms as unknown as WarrantyTerms;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function ReturnsWorkspace({
  locale,
  initialRmas,
  initialWarranties,
  partners,
  items,
  invoices,
  branches,
  cashAccounts,
  canManage,
  canApprove,
  canWarranties,
}: {
  locale: Locale;
  initialRmas: readonly RmaRow[];
  initialWarranties: readonly WarrantyRow[];
  partners: readonly PartnerRow[];
  items: readonly ItemRow[];
  invoices: readonly SalesInvoiceRow[];
  branches: readonly BranchRow[];
  cashAccounts: readonly CashAccountRow[];
  canManage: boolean;
  canApprove: boolean;
  canWarranties: boolean;
}): JSX.Element {
  const d = getDictionary(locale);
  const router = useRouter();
  const { toast } = useToast();

  const [tab, setTab] = useState<WorkspaceTab>("rmas");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [rmas, setRmas] = useState<readonly RmaRow[]>(initialRmas);
  const [warranties, setWarranties] = useState<readonly WarrantyRow[]>(initialWarranties);

  // -- rmas tab: create / detail / lifecycle dialogs ---------------------------
  const [createOpen, setCreateOpen] = useState(false);
  const [createDraft, setCreateDraft] = useState<RmaDraft>(emptyRmaDraft);
  /** The picked invoice's detail (drives the per-line qty inputs). */
  const [pickedInvoice, setPickedInvoice] = useState<SalesInvoiceWithLines | null>(null);
  const [detail, setDetail] = useState<RmaWithLines | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [inspectTarget, setInspectTarget] = useState<RmaRow | null>(null);
  const [inspectDisposition, setInspectDisposition] = useState<RmaDisposition>("RESTOCK");
  const [inspectNote, setInspectNote] = useState("");
  const [completeTarget, setCompleteTarget] = useState<RmaRow | null>(null);
  const [refundCashAccountId, setRefundCashAccountId] = useState("");
  const [cancelTarget, setCancelTarget] = useState<RmaRow | null>(null);
  const [cancelReason, setCancelReason] = useState("");

  // -- warranties tab -----------------------------------------------------------
  const [warrantyOpen, setWarrantyOpen] = useState(false);
  const [warrantyDraft, setWarrantyDraft] = useState<WarrantyDraft>(() =>
    emptyWarrantyDraft(todayIso()),
  );

  const partnerNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const partner of partners) {
      map.set(partner.id, localizedName(partner.name, partner.nameAr, locale));
    }
    return map;
  }, [partners, locale]);

  const itemNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of items) {
      map.set(item.id, `${item.sku} — ${localizedName(item.name, item.nameAr, locale)}`);
    }
    return map;
  }, [items, locale]);

  const invoiceLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const invoice of invoices) {
      const partner = partnerNameById.get(invoice.customerId) ?? invoice.customerId.slice(0, 8);
      map.set(
        invoice.id,
        `${invoice.invoiceNo ?? invoice.id.slice(0, 8)} — ${partner} · ${invoice.invoiceDate}`,
      );
    }
    return map;
  }, [invoices, partnerNameById]);

  const branchOptions = useMemo(() => {
    const options = branches
      .filter((branch) => branch.isActive)
      .map((branch) => ({
        value: branch.id,
        label: localizedName(branch.name, branch.nameAr, locale),
      }));
    // Rows referencing unreadable branches stay selectable with the honest
    // raw id (the zatca-devices fallback).
    for (const rma of rmas) {
      if (options.some((option) => option.value === rma.branchId)) {
        continue;
      }
      options.push({ value: rma.branchId, label: rma.branchId });
    }
    return options;
  }, [branches, rmas, locale]);

  const cashAccountOptions = useMemo(
    () =>
      cashAccounts
        .filter((account) => account.status === "ACTIVE")
        .map((account) => ({
          value: account.id,
          label: localizedName(account.name, account.nameAr, locale),
        })),
    [cashAccounts, locale],
  );

  function partnerLabel(partnerId: string): string {
    return partnerNameById.get(partnerId) ?? partnerId;
  }

  function invoiceLabel(invoiceId: string): string {
    return invoiceLabelById.get(invoiceId) ?? invoiceId.slice(0, 8);
  }

  async function call<T>(key: string, fn: () => Promise<ApiResult<T>>): Promise<T | undefined> {
    setBusy(key);
    setError(null);
    const result = await fn();
    setBusy(null);
    if (!result.ok) {
      setError(returnsError(d, result));
      return undefined;
    }
    return result.data;
  }

  // -- rmas tab actions -------------------------------------------------------------

  /** Loads the picked invoice's lines for the per-line qty inputs. */
  async function pickInvoice(invoiceId: string): Promise<void> {
    setCreateDraft((draft) => ({ ...draft, invoiceId, qtys: {} }));
    setPickedInvoice(null);
    if (invoiceId === "") {
      return;
    }
    const loaded = await bffFetch<SalesInvoiceWithLines>(`sales/sales-invoices/${invoiceId}`);
    if (!loaded.ok) {
      setError(returnsError(d, loaded));
      return;
    }
    setPickedInvoice(loaded.data);
  }

  function createReady(): boolean {
    // Empty qty = skip the line; a typed-but-invalid qty blocks the submit
    // (no silent line drops — the sourcing every-line discipline).
    const entries = Object.entries(createDraft.qtys).filter(([lineId]) => lineId !== "");
    const anyInvalid = entries.some(([qty]) => qty.trim() !== "" && !QTY_RE.test(qty.trim()));
    const filled = entries.filter(([, qty]) => QTY_RE.test(qty.trim()));
    return (
      createDraft.branchId !== "" &&
      createDraft.invoiceId !== "" &&
      pickedInvoice !== null &&
      !anyInvalid &&
      filled.length > 0
    );
  }

  async function createRma(): Promise<void> {
    if (!createReady()) {
      setError(d.errorsValidation);
      return;
    }
    const trimOrNull = (value: string): string | null => {
      const trimmed = value.trim();
      return trimmed === "" ? null : trimmed;
    };
    const lines = Object.entries(createDraft.qtys)
      .filter(([lineId, qty]) => lineId !== "" && QTY_RE.test(qty.trim()))
      .map(([invoiceLineId, qty]) => ({ invoiceLineId, qty: qty.trim(), note: null }));
    const created = await call<RmaRow>("rma-create", () =>
      bffFetch<RmaRow>("sales/returns", {
        method: "POST",
        body: {
          branchId: createDraft.branchId,
          invoiceId: createDraft.invoiceId,
          reasonCode: createDraft.reasonCode,
          reason: trimOrNull(createDraft.reason),
          reasonAr: trimOrNull(createDraft.reasonAr),
          note: trimOrNull(createDraft.note),
          lines,
        },
      }),
    );
    if (created !== undefined) {
      setCreateOpen(false);
      setCreateDraft(emptyRmaDraft());
      setPickedInvoice(null);
      setRmas((rows) => [created, ...rows]);
      toast({ tone: "success", title: d.returnsToastCreated });
      router.refresh();
    }
  }

  async function openDetail(row: RmaRow): Promise<void> {
    setDetailOpen(true);
    setDetail(null);
    const loaded = await bffFetch<RmaWithLines>(`sales/returns/${row.id}`);
    if (!loaded.ok) {
      setDetailOpen(false);
      setError(returnsError(d, loaded));
      return;
    }
    setDetail(loaded.data);
  }

  async function rmaAction(row: RmaRow, action: "approve" | "receive"): Promise<void> {
    const updated = await call<RmaRow>(`${action}-${row.id}`, () =>
      bffFetch<RmaRow>(`sales/returns/${row.id}/${action}`, { method: "POST", body: {} }),
    );
    if (updated !== undefined) {
      setRmas((rows) => rows.map((r) => (r.id === updated.id ? updated : r)));
      toast({ tone: "success", title: d.returnsToastDone });
      router.refresh();
    }
  }

  async function submitInspect(): Promise<void> {
    if (inspectTarget === null) {
      return;
    }
    const updated = await call<RmaRow>(`inspect-${inspectTarget.id}`, () =>
      bffFetch<RmaRow>(`sales/returns/${inspectTarget.id}/inspect`, {
        method: "POST",
        body: {
          disposition: inspectDisposition,
          inspectionNote: inspectNote.trim() === "" ? null : inspectNote.trim(),
        },
      }),
    );
    if (updated !== undefined) {
      setInspectTarget(null);
      setInspectNote("");
      setRmas((rows) => rows.map((r) => (r.id === updated.id ? updated : r)));
      toast({ tone: "success", title: d.returnsToastDone });
      router.refresh();
    }
  }

  async function submitComplete(): Promise<void> {
    if (completeTarget === null) {
      return;
    }
    if (completeTarget.disposition === "REFUND" && refundCashAccountId === "") {
      setError(d.errorsValidation);
      return;
    }
    const updated = await call<RmaRow>(`complete-${completeTarget.id}`, () =>
      bffFetch<RmaRow>(`sales/returns/${completeTarget.id}/complete`, {
        method: "POST",
        body:
          completeTarget.disposition === "REFUND"
            ? { refundCashAccountId }
            : {},
      }),
    );
    if (updated !== undefined) {
      setCompleteTarget(null);
      setRefundCashAccountId("");
      setRmas((rows) => rows.map((r) => (r.id === updated.id ? updated : r)));
      toast({ tone: "success", title: d.returnsToastDone });
      router.refresh();
    }
  }

  async function submitCancel(): Promise<void> {
    // The API's cancelSchema requires a 3–500 char reason — validate the
    // typed draft (not the row's own create reason) before the wire.
    const reason = cancelReason.trim();
    if (cancelTarget === null || reason.length < 3) {
      setError(d.errorsValidation);
      return;
    }
    const id = cancelTarget.id;
    const updated = await call<RmaRow>(`cancel-${id}`, () =>
      bffFetch<RmaRow>(`sales/returns/${id}/cancel`, {
        method: "POST",
        body: { reason },
      }),
    );
    if (updated !== undefined) {
      setCancelTarget(null);
      setCancelReason("");
      setRmas((rows) => rows.map((r) => (r.id === updated.id ? updated : r)));
      toast({ tone: "success", title: d.returnsToastDone });
      router.refresh();
    }
  }

  // -- warranties tab actions ---------------------------------------------------------

  function warrantyReady(): boolean {
    const months = Number(warrantyDraft.durationMonths);
    return (
      warrantyDraft.partnerId !== "" &&
      warrantyDraft.itemId !== "" &&
      DATE_RE.test(warrantyDraft.startDate) &&
      Number.isInteger(months) &&
      months >= 1 &&
      months <= 120 &&
      (warrantyDraft.mileageLimitKm.trim() === "" ||
        /^\d+$/.test(warrantyDraft.mileageLimitKm.trim()))
    );
  }

  async function createWarranty(): Promise<void> {
    if (!warrantyReady()) {
      setError(d.errorsValidation);
      return;
    }
    const created = await call<WarrantyRow>("warranty-create", () =>
      bffFetch<WarrantyRow>("sales/warranties", {
        method: "POST",
        body: {
          partnerId: warrantyDraft.partnerId,
          itemId: warrantyDraft.itemId,
          serialNo: warrantyDraft.serialNo.trim() === "" ? null : warrantyDraft.serialNo.trim(),
          invoiceId: warrantyDraft.invoiceId === "" ? null : warrantyDraft.invoiceId,
          startDate: warrantyDraft.startDate,
          terms: {
            durationMonths: Number(warrantyDraft.durationMonths),
            coverage: warrantyDraft.coverage,
            basis: warrantyDraft.basis,
            mileageLimitKm:
              warrantyDraft.mileageLimitKm.trim() === ""
                ? null
                : Number(warrantyDraft.mileageLimitKm.trim()),
          },
        },
      }),
    );
    if (created !== undefined) {
      setWarrantyOpen(false);
      setWarrantyDraft(emptyWarrantyDraft(todayIso()));
      setWarranties((rows) => [created, ...rows]);
      toast({ tone: "success", title: d.returnsToastCreated });
      router.refresh();
    }
  }

  async function voidWarranty(row: WarrantyRow): Promise<void> {
    const updated = await call<WarrantyRow>(`void-${row.id}`, () =>
      bffFetch<WarrantyRow>(`sales/warranties/${row.id}/void`, { method: "POST", body: {} }),
    );
    if (updated !== undefined) {
      setWarranties((rows) => rows.map((r) => (r.id === updated.id ? updated : r)));
      toast({ tone: "success", title: d.returnsToastDone });
      router.refresh();
    }
  }

  // -- render -----------------------------------------------------------------------

  return (
    <div className="flex flex-col gap-4">
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}

      <Tabs
        items={[
          { value: "rmas", label: d.returnsTabRmas },
          // The warranties register rides its own manage key — the tab only
          // renders for holders (the dunning agencies rule; a 403 register
          // would otherwise masquerade as an honest empty list).
          ...(canWarranties ? [{ value: "warranties", label: d.returnsTabWarranties }] : []),
        ]}
        value={tab}
        onValueChange={(value) => setTab(value as WorkspaceTab)}
      >
        {tab === "rmas" && (
          <div className="flex flex-col gap-4">
            {canManage && (
              <div className="flex justify-end">
                <Button
                  variant="primary"
                  onClick={() => {
                    setCreateDraft(emptyRmaDraft());
                    setPickedInvoice(null);
                    setCreateOpen(true);
                  }}
                >
                  {d.returnsActionCreate}
                </Button>
              </div>
            )}
            <Card title={d.returnsTabRmas}>
              <DataTable
                columns={[
                  {
                    id: "rmaNo",
                    header: activeLocaleHeader(d.returnsColRmaNo),
                    accessor: (row: RmaRow) => row.rmaNo ?? "—",
                    mono: true,
                    render: (row: RmaRow) => (
                      <span className="font-mono text-sm" dir="ltr">
                        {row.rmaNo ?? "—"}
                      </span>
                    ),
                  },
                  {
                    id: "partner",
                    header: activeLocaleHeader(d.returnsColPartner),
                    accessor: (row: RmaRow) => partnerLabel(row.partnerId),
                  },
                  {
                    id: "invoice",
                    header: activeLocaleHeader(d.returnsColInvoice),
                    accessor: (row: RmaRow) => invoiceLabel(row.invoiceId),
                    render: (row: RmaRow) => (
                      <span className="font-mono text-xs" dir="ltr">
                        {invoiceLabel(row.invoiceId)}
                      </span>
                    ),
                  },
                  {
                    id: "status",
                    header: activeLocaleHeader(d.returnsColStatus),
                    accessor: (row: RmaRow) => row.status,
                    render: (row: RmaRow) => (
                      <Badge tone={RMA_TONES[row.status]}>{rmaStatusLabel(d, row.status)}</Badge>
                    ),
                  },
                  {
                    id: "disposition",
                    header: activeLocaleHeader(d.returnsColDisposition),
                    accessor: (row: RmaRow) => row.disposition ?? "",
                    render: (row: RmaRow) => dispositionLabel(d, row.disposition),
                  },
                  {
                    id: "total",
                    header: activeLocaleHeader(d.returnsColTotal),
                    accessor: (row: RmaRow) => row.totalGross,
                    numeric: true,
                    render: (row: RmaRow) => (
                      <span className="font-mono tabular-nums" dir="ltr">
                        {row.totalGross} {row.currencyCode}
                      </span>
                    ),
                  },
                  {
                    id: "requestedAt",
                    header: activeLocaleHeader(d.returnsColRequested),
                    accessor: (row: RmaRow) => row.requestedAt,
                    sortable: true,
                    render: (row: RmaRow) => (
                      <span className="font-mono text-xs" dir="ltr">
                        {formatDateTime(row.requestedAt, locale)}
                      </span>
                    ),
                  },
                  {
                    id: "completedAt",
                    header: activeLocaleHeader(d.returnsColCompleted),
                    accessor: (row: RmaRow) => row.completedAt ?? "",
                    sortable: true,
                    render: (row: RmaRow) =>
                      row.completedAt === null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <span className="font-mono text-xs" dir="ltr">
                          {formatDateTime(row.completedAt, locale)}
                        </span>
                      ),
                  },
                ]}
                rows={[...rmas]}
                rowKey={(row) => row.id}
                rowActions={[
                  {
                    id: "view",
                    label: d.returnsActionView,
                    onSelect: (row: RmaRow) => {
                      void openDetail(row);
                    },
                  },
                  ...(canApprove
                    ? [
                        {
                          id: "approve",
                          label: d.returnsActionApprove,
                          onSelect: (row: RmaRow) => {
                            if (row.status !== "REQUESTED") {
                              return;
                            }
                            if (window.confirm(d.returnsConfirmApprove)) {
                              void rmaAction(row, "approve");
                            }
                          },
                        },
                      ]
                    : []),
                  ...(canManage
                    ? [
                        {
                          id: "receive",
                          label: d.returnsActionReceive,
                          onSelect: (row: RmaRow) => {
                            if (row.status !== "APPROVED") {
                              return;
                            }
                            if (window.confirm(d.returnsConfirmReceive)) {
                              void rmaAction(row, "receive");
                            }
                          },
                        },
                        {
                          id: "inspect",
                          label: d.returnsActionInspect,
                          onSelect: (row: RmaRow) => {
                            if (row.status !== "RECEIVED") {
                              return;
                            }
                            setError(null);
                            setInspectDisposition(row.disposition ?? "RESTOCK");
                            setInspectNote("");
                            setInspectTarget(row);
                          },
                        },
                        {
                          id: "complete",
                          label: d.returnsActionComplete,
                          onSelect: (row: RmaRow) => {
                            if (row.status !== "INSPECTED") {
                              return;
                            }
                            setError(null);
                            setRefundCashAccountId("");
                            setCompleteTarget(row);
                          },
                        },
                        {
                          id: "cancel",
                          label: d.returnsActionCancel,
                          onSelect: (row: RmaRow) => {
                            if (row.status !== "REQUESTED" && row.status !== "APPROVED") {
                              return;
                            }
                            setError(null);
                            setCancelReason("");
                            setCancelTarget(row);
                          },
                        },
                      ]
                    : []),
                ]}
                empty={{ title: d.returnsRmasEmpty }}
              />
            </Card>
          </div>
        )}

        {tab === "warranties" && canWarranties && (
          <div className="flex flex-col gap-4">
            <div className="flex justify-end">
              <Button
                variant="primary"
                onClick={() => {
                  setWarrantyDraft(emptyWarrantyDraft(todayIso()));
                  setWarrantyOpen(true);
                }}
              >
                {d.returnsWarrantyCreateTitle}
              </Button>
            </div>
            <Card title={d.returnsTabWarranties}>
              <DataTable
                columns={[
                  {
                    id: "partner",
                    header: activeLocaleHeader(d.returnsColPartner),
                    accessor: (row: WarrantyRow) => partnerLabel(row.partnerId),
                  },
                  {
                    id: "item",
                    header: activeLocaleHeader(d.returnsColItem),
                    accessor: (row: WarrantyRow) => itemNameById.get(row.itemId) ?? row.itemId,
                  },
                  {
                    id: "serialNo",
                    header: activeLocaleHeader(d.returnsColSerial),
                    accessor: (row: WarrantyRow) => row.serialNo ?? "—",
                    mono: true,
                    render: (row: WarrantyRow) => (
                      <span className="font-mono text-sm" dir="ltr">
                        {row.serialNo ?? "—"}
                      </span>
                    ),
                  },
                  {
                    id: "status",
                    header: activeLocaleHeader(d.returnsColStatus),
                    accessor: (row: WarrantyRow) => row.status,
                    render: (row: WarrantyRow) => (
                      <Badge tone={WARRANTY_TONES[row.status]}>
                        {warrantyStatusLabel(d, row.status)}
                      </Badge>
                    ),
                  },
                  {
                    id: "coverage",
                    header: activeLocaleHeader(d.returnsColCoverage),
                    accessor: (row: WarrantyRow) => {
                      const terms = warrantyTermsOf(row);
                      return terms === null ? "" : coverageLabel(d, terms.coverage);
                    },
                    render: (row: WarrantyRow) => {
                      const terms = warrantyTermsOf(row);
                      if (terms === null) {
                        return <span className="text-muted-foreground">—</span>;
                      }
                      return (
                        <span>
                          {coverageLabel(d, terms.coverage)}
                          <span className="text-muted-foreground"> · {basisLabel(d, terms.basis)}</span>
                        </span>
                      );
                    },
                  },
                  {
                    id: "duration",
                    header: activeLocaleHeader(d.returnsColDuration),
                    accessor: (row: WarrantyRow) => {
                      const terms = warrantyTermsOf(row);
                      return terms === null ? "" : String(terms.durationMonths);
                    },
                    numeric: true,
                    render: (row: WarrantyRow) => {
                      const terms = warrantyTermsOf(row);
                      return (
                        <span className="font-mono tabular-nums" dir="ltr">
                          {terms === null
                            ? "—"
                            : formatMessage(d.returnsDurationMonths, {
                                months: terms.durationMonths,
                              })}
                        </span>
                      );
                    },
                  },
                  {
                    id: "mileage",
                    header: activeLocaleHeader(d.returnsColMileage),
                    accessor: (row: WarrantyRow) => {
                      const terms = warrantyTermsOf(row);
                      return terms?.mileageLimitKm == null ? "" : String(terms.mileageLimitKm);
                    },
                    numeric: true,
                    render: (row: WarrantyRow) => {
                      const terms = warrantyTermsOf(row);
                      const km = terms?.mileageLimitKm;
                      return (
                        <span className="font-mono tabular-nums" dir="ltr">
                          {km == null ? "—" : formatMessage(d.returnsMileageKm, { km })}
                        </span>
                      );
                    },
                  },
                  {
                    id: "start",
                    header: activeLocaleHeader(d.returnsColStart),
                    accessor: (row: WarrantyRow) => row.startDate,
                    sortable: true,
                    render: (row: WarrantyRow) => (
                      <span className="font-mono text-xs" dir="ltr">
                        {row.startDate}
                      </span>
                    ),
                  },
                  {
                    id: "end",
                    header: activeLocaleHeader(d.returnsColEnd),
                    accessor: (row: WarrantyRow) => row.endDate,
                    sortable: true,
                    render: (row: WarrantyRow) => (
                      <span className="font-mono text-xs" dir="ltr">
                        {row.endDate}
                      </span>
                    ),
                  },
                ]}
                rows={[...warranties]}
                rowKey={(row) => row.id}
                rowActions={
                  canWarranties
                    ? [
                        {
                          id: "void",
                          label: d.returnsActionVoid,
                          danger: true,
                          onSelect: (row: WarrantyRow) => {
                            if (row.status !== "ACTIVE") {
                              return;
                            }
                            if (window.confirm(d.returnsConfirmVoid)) {
                              void voidWarranty(row);
                            }
                          },
                        },
                      ]
                    : undefined
                }
                empty={{ title: d.returnsWarrantiesEmpty }}
              />
            </Card>
          </div>
        )}
      </Tabs>

      <Dialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        title={d.returnsCreateTitle}
        size="lg"
      >
        <div className="flex flex-col gap-4">
          <InfoNotice>{d.returnsInvoiceHint}</InfoNotice>
          <div className="grid gap-3 sm:grid-cols-2">
            <Select
              label={d.sourcingFormBranch}
              value={createDraft.branchId}
              onValueChange={(value) => setCreateDraft({ ...createDraft, branchId: value })}
              options={[{ value: "", label: d.salesSelectBranch }, ...branchOptions]}
              required
            />
            <Select
              label={d.returnsFormInvoice}
              value={createDraft.invoiceId}
              onValueChange={(value) => void pickInvoice(value)}
              options={[
                { value: "", label: d.returnsFormPickInvoice },
                ...invoices.map((invoice) => ({
                  value: invoice.id,
                  label: invoiceLabelById.get(invoice.id) ?? invoice.id,
                })),
              ]}
              required
            />
            <Select
              label={d.returnsFormReasonCode}
              value={createDraft.reasonCode}
              onValueChange={(value) =>
                setCreateDraft({ ...createDraft, reasonCode: value as RmaReasonCode })
              }
              options={CUSTOMER_REASONS.map((code) => ({
                value: code,
                label: reasonLabel(d, code),
              }))}
            />
            <Input
              label={`${d.returnsFormReason} (${d.sourcingFormOptional})`}
              value={createDraft.reason}
              onValueChange={(value) => setCreateDraft({ ...createDraft, reason: value })}
            />
            <Input
              label={`${d.returnsFormReasonAr} (${d.sourcingFormOptional})`}
              value={createDraft.reasonAr}
              onValueChange={(value) => setCreateDraft({ ...createDraft, reasonAr: value })}
            />
            <Input
              label={`${d.returnsFormNote} (${d.sourcingFormOptional})`}
              value={createDraft.note}
              onValueChange={(value) => setCreateDraft({ ...createDraft, note: value })}
            />
          </div>
          {pickedInvoice !== null && (
            <div className="space-y-2">
              {pickedInvoice.lines.length === 0 ? (
                <p className="text-sm text-gray-600">{d.returnsInvoiceLinesEmpty}</p>
              ) : (
                pickedInvoice.lines.map((line) => (
                  <div
                    key={line.id}
                    className="grid items-end gap-3 rounded-md border border-subtle px-3 py-2 sm:grid-cols-[2fr_1fr]"
                  >
                    <div className="text-sm">
                      <p className="font-medium text-gray-900">
                        {d.returnsColLine} {line.lineNo} —{" "}
                        {line.itemId !== null
                          ? (itemNameById.get(line.itemId) ?? line.itemId)
                          : (localizedName(line.description ?? "", line.descriptionAr, locale) ||
                            line.description ||
                            line.id.slice(0, 8))}
                      </p>
                      <p className="font-mono text-xs text-gray-600" dir="ltr">
                        {d.returnsColQty}: {line.qty} · {d.returnsColUnitPrice}: {line.unitPrice}
                      </p>
                    </div>
                    <Input
                      label={d.returnsFormInvoiceLine}
                      value={createDraft.qtys[line.id] ?? ""}
                      onValueChange={(value) =>
                        setCreateDraft({
                          ...createDraft,
                          qtys: { ...createDraft.qtys, [line.id]: value },
                        })
                      }
                      inputMode="decimal"
                    />
                  </div>
                ))
              )}
            </div>
          )}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setCreateOpen(false)}>
            {d.commonCancel}
          </Button>
          <Button variant="primary" loading={busy === "rma-create"} onClick={() => void createRma()}>
            {d.commonSave}
          </Button>
        </div>
      </Dialog>

      <Dialog
        open={detailOpen}
        onOpenChange={(open) => {
          if (!open) {
            setDetailOpen(false);
            setDetail(null);
          }
        }}
        title={`${d.returnsDetailTitle} — ${detail?.rmaNo ?? ""}`}
        size="lg"
      >
        {detail === null ? (
          <p className="text-sm text-gray-600">{d.loading}</p>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
              <span className="font-semibold text-gray-900">
                {partnerLabel(detail.partnerId)}
              </span>
              <span className="font-mono text-xs" dir="ltr">
                {d.returnsColInvoice}: {invoiceLabel(detail.invoiceId)}
              </span>
              <span>
                {d.returnsFormReasonCode}: {reasonLabel(d, detail.reasonCode)}
              </span>
              <span>
                {d.returnsColDisposition}: {dispositionLabel(d, detail.disposition)}
              </span>
              <span className="font-mono tabular-nums" dir="ltr">
                {d.returnsColTotal}: {detail.totalGross} {detail.currencyCode}
              </span>
              {detail.inspectionNote !== null && (
                <span className="text-gray-600">{detail.inspectionNote}</span>
              )}
              {detail.cancelReason !== null && (
                <span className="text-gray-600">
                  {d.returnsCancelReasonLabel}: {detail.cancelReason}
                </span>
              )}
            </div>
            <DataTable
              columns={[
                {
                  id: "lineNo",
                  header: activeLocaleHeader(d.returnsColLine),
                  accessor: (row: RmaWithLines["lines"][number]) => String(row.lineNo),
                  numeric: true,
                },
                {
                  id: "item",
                  header: activeLocaleHeader(d.returnsColItem),
                  accessor: (row: RmaWithLines["lines"][number]) =>
                    row.itemId !== null ? (itemNameById.get(row.itemId) ?? row.itemId) : "—",
                },
                {
                  id: "qty",
                  header: activeLocaleHeader(d.returnsColQty),
                  accessor: (row: RmaWithLines["lines"][number]) => row.qty,
                  numeric: true,
                  render: (row: RmaWithLines["lines"][number]) => (
                    <span className="font-mono tabular-nums" dir="ltr">
                      {row.qty}
                    </span>
                  ),
                },
                {
                  id: "unitPrice",
                  header: activeLocaleHeader(d.returnsColUnitPrice),
                  accessor: (row: RmaWithLines["lines"][number]) => row.unitPrice,
                  numeric: true,
                  render: (row: RmaWithLines["lines"][number]) => (
                    <span className="font-mono tabular-nums" dir="ltr">
                      {row.unitPrice}
                    </span>
                  ),
                },
                {
                  id: "net",
                  header: activeLocaleHeader(d.returnsColNet),
                  accessor: (row: RmaWithLines["lines"][number]) => row.netAmount,
                  numeric: true,
                  render: (row: RmaWithLines["lines"][number]) => (
                    <span className="font-mono tabular-nums" dir="ltr">
                      {row.netAmount}
                    </span>
                  ),
                },
                {
                  id: "tax",
                  header: activeLocaleHeader(d.returnsColTax),
                  accessor: (row: RmaWithLines["lines"][number]) => row.taxAmount,
                  numeric: true,
                  render: (row: RmaWithLines["lines"][number]) => (
                    <span className="font-mono tabular-nums" dir="ltr">
                      {row.taxAmount}
                    </span>
                  ),
                },
                {
                  id: "note",
                  header: activeLocaleHeader(d.returnsColNote),
                  accessor: (row: RmaWithLines["lines"][number]) => row.note ?? "—",
                },
              ]}
              rows={[...detail.lines]}
              rowKey={(row) => row.id}
              empty={{ title: d.returnsInvoiceLinesEmpty }}
            />
          </div>
        )}
      </Dialog>

      <Dialog
        open={inspectTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setInspectTarget(null);
          }
        }}
        title={d.returnsInspectTitle}
        size="md"
      >
        <div className="flex flex-col gap-4">
          <Select
            label={d.returnsColDisposition}
            value={inspectDisposition}
            onValueChange={(value) => setInspectDisposition(value as RmaDisposition)}
            options={DISPOSITIONS.map((disposition) => ({
              value: disposition,
              label: dispositionLabel(d, disposition),
            }))}
            required
          />
          <Input
            label={`${d.returnsFormNote} (${d.sourcingFormOptional})`}
            value={inspectNote}
            onValueChange={setInspectNote}
          />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setInspectTarget(null)}>
            {d.commonCancel}
          </Button>
          <Button
            variant="primary"
            loading={busy === `inspect-${inspectTarget?.id ?? ""}`}
            onClick={() => void submitInspect()}
          >
            {d.returnsActionInspect}
          </Button>
        </div>
      </Dialog>

      <Dialog
        open={completeTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setCompleteTarget(null);
          }
        }}
        title={`${d.returnsCompleteTitle} — ${completeTarget?.rmaNo ?? ""}`}
        size="md"
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-gray-600">{d.returnsConfirmComplete}</p>
          {completeTarget?.disposition === "REFUND" && (
            <>
              <InfoNotice>{d.returnsRefundHint}</InfoNotice>
              <Select
                label={d.returnsCashAccountLabel}
                value={refundCashAccountId}
                onValueChange={setRefundCashAccountId}
                options={[
                  { value: "", label: d.returnsCashAccountLabel },
                  ...cashAccountOptions,
                ]}
                required
              />
            </>
          )}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setCompleteTarget(null)}>
            {d.commonCancel}
          </Button>
          <Button
            variant="primary"
            loading={busy === `complete-${completeTarget?.id ?? ""}`}
            onClick={() => void submitComplete()}
          >
            {d.returnsActionComplete}
          </Button>
        </div>
      </Dialog>

      <Dialog
        open={cancelTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setCancelTarget(null);
          }
        }}
        title={d.returnsActionCancel}
        size="sm"
      >
        <Input
          label={d.returnsCancelReasonLabel}
          value={cancelReason}
          onValueChange={setCancelReason}
          required
        />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setCancelTarget(null)}>
            {d.commonCancel}
          </Button>
          <Button
            variant="primary"
            loading={busy === `cancel-${cancelTarget?.id ?? ""}`}
            onClick={() => void submitCancel()}
          >
            {d.returnsActionCancel}
          </Button>
        </div>
      </Dialog>

      <Dialog
        open={warrantyOpen}
        onOpenChange={setWarrantyOpen}
        title={d.returnsWarrantyCreateTitle}
        size="lg"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label={d.salesCustomer}
            value={warrantyDraft.partnerId}
            onValueChange={(value) => setWarrantyDraft({ ...warrantyDraft, partnerId: value })}
            options={[
              { value: "", label: d.salesCustomer },
              ...partners
                .filter((p) => p.kind === "CUSTOMER" || p.kind === "BOTH")
                .map((p) => ({ value: p.id, label: partnerLabel(p.id) })),
            ]}
            required
          />
          <Select
            label={d.purchasingItem}
            value={warrantyDraft.itemId}
            onValueChange={(value) => setWarrantyDraft({ ...warrantyDraft, itemId: value })}
            options={[
              { value: "", label: d.purchasingItem },
              ...items.map((item) => ({
                value: item.id,
                label: itemNameById.get(item.id) ?? item.sku,
              })),
            ]}
            required
          />
          <Input
            label={`${d.returnsFormSerial} (${d.sourcingFormOptional})`}
            value={warrantyDraft.serialNo}
            onValueChange={(value) => setWarrantyDraft({ ...warrantyDraft, serialNo: value })}
            mono
            bidiIsolate
          />
          <Select
            label={`${d.returnsFormInvoiceOptional} (${d.sourcingFormOptional})`}
            value={warrantyDraft.invoiceId}
            onValueChange={(value) => setWarrantyDraft({ ...warrantyDraft, invoiceId: value })}
            options={[
              { value: "", label: d.returnsFormInvoiceOptional },
              ...invoices.map((invoice) => ({
                value: invoice.id,
                label: invoiceLabelById.get(invoice.id) ?? invoice.id,
              })),
            ]}
          />
          <DatePicker
            label={d.returnsFormStart}
            value={warrantyDraft.startDate}
            onSelect={(iso) => setWarrantyDraft({ ...warrantyDraft, startDate: iso })}
            locale={locale}
            required
          />
          <NumberInput
            label={d.returnsFormDuration}
            value={warrantyDraft.durationMonths}
            onValueChange={(value) => setWarrantyDraft({ ...warrantyDraft, durationMonths: value })}
            min={1}
            max={120}
            step={1}
            required
          />
          <Select
            label={d.returnsFormCoverage}
            value={warrantyDraft.coverage}
            onValueChange={(value) =>
              setWarrantyDraft({
                ...warrantyDraft,
                coverage: value as WarrantyTerms["coverage"],
              })
            }
            options={(["REPAIR", "REPLACE", "REFUND", "LABOR_ONLY", "PARTS_ONLY"] as const).map(
              (coverage) => ({ value: coverage, label: coverageLabel(d, coverage) }),
            )}
          />
          <Select
            label={d.returnsFormBasis}
            value={warrantyDraft.basis}
            onValueChange={(value) =>
              setWarrantyDraft({ ...warrantyDraft, basis: value as WarrantyTerms["basis"] })
            }
            options={[
              { value: "INVOICE_DATE", label: d.returnsBasisInvoiceDate },
              { value: "DELIVERY_DATE", label: d.returnsBasisDeliveryDate },
            ]}
          />
          <NumberInput
            label={`${d.returnsFormMileageOptional} (${d.sourcingFormOptional})`}
            value={warrantyDraft.mileageLimitKm}
            onValueChange={(value) => setWarrantyDraft({ ...warrantyDraft, mileageLimitKm: value })}
            min={1}
            step={1}
          />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setWarrantyOpen(false)}>
            {d.commonCancel}
          </Button>
          <Button
            variant="primary"
            loading={busy === "warranty-create"}
            onClick={() => void createWarranty()}
          >
            {d.commonSave}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
