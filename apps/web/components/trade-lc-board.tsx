"use client";

/**
 * PHASE-051 (W-39 — T-14, D-17) — the LC board (the /trade/lc screen
 * body): the register + the create act + the detail chain (the find's
 * own amendments + documents checklist) + the lifecycle acts (issue ·
 * amend · document · fee · retire · cancel) — the 048/049/050 board
 * patterns: the data-slot pane switch (never the Tabs primitive), the
 * typed-refusal panels with FULL payloads, the mono cells, every
 * figure an ENGINE OUTPUT rendered VERBATIM (zero parallel
 * computation — the amounts, the ladder and the journal links ride
 * the row's own strings).
 */
import { useState } from "react";
import type { JSX } from "react";

import {
  Button,
  DataTable,
  Dialog,
  Input,
  Select,
  useToast,
  type DataTableColumn,
} from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type {
  ApiErrorBody,
  TradeLcAmendmentRow,
  TradeLcDocumentRow,
  TradeLcRow,
} from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { localizedTradeError, tradeLcStatusLabel } from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice, SuccessNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";
import { TypedRefusalPanel } from "./typed-refusal-panel";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CURRENCY_RE = /^[A-Z]{3}$/;
const MONEY_RE = /^\d+(\.\d{1,4})?$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type LcDetail = {
  lc: TradeLcRow;
  amendments: readonly TradeLcAmendmentRow[];
  documents: readonly TradeLcDocumentRow[];
};

type LcAct = "issue" | "amend" | "document" | "fee" | "retire" | "cancel";

function monoCell(value: string, title?: string): JSX.Element {
  return (
    <span className="font-mono tabular-nums" dir="ltr" title={title ?? value}>
      {value}
    </span>
  );
}

function dashIfNull(value: string | null, title?: string): JSX.Element {
  if (value === null) {
    return <span className="text-xs text-gray-500">—</span>;
  }
  return monoCell(value, title);
}

/** The semantic-tone chip (the meters-board precedent). */
type ChipTone = "success" | "danger" | "warning" | "info" | "neutral";
const CHIP_TONE_CLASSES: Record<ChipTone, string> = {
  success: "border-success-border bg-success-bg text-success-text",
  danger: "border-danger-border bg-danger-bg text-danger-text",
  warning: "border-warning-border bg-warning-bg text-warning-text",
  info: "border-info-border bg-info-bg text-info-text",
  neutral: "border-subtle bg-gray-100 text-gray-600",
};
function statusTone(status: string): ChipTone {
  switch (status) {
    case "ISSUED":
      return "info";
    case "SETTLED":
    case "RETIRED":
      return "success";
    case "CANCELLED":
      return "neutral";
    case "EXPIRED":
      return "warning";
    default:
      return "neutral";
  }
}
function Chip({ tone, children }: { tone: ChipTone; children: string }): JSX.Element {
  return (
    <span
      className={`inline-flex w-fit items-center rounded-sm border px-1.5 py-0.5 text-xs leading-4 ${CHIP_TONE_CLASSES[tone]}`}
    >
      {children}
    </span>
  );
}

export function TradeLcBoard({
  locale,
  initialLcs,
  lcsError,
  canManage,
}: {
  locale: Locale;
  initialLcs: readonly TradeLcRow[] | null;
  lcsError: ApiErrorBody | null;
  canManage: boolean;
}): JSX.Element {
  const d = getDictionary(locale);
  const { toast } = useToast();

  // -- the pane switch (the data-slot shape — never the Tabs primitive) ----
  const [pane, setPane] = useState<"register" | "create">("register");

  // -- the shared feedback ---------------------------------------------------
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // -- the register pane -------------------------------------------------------
  const [lcs, setLcs] = useState<readonly TradeLcRow[] | null>(initialLcs);
  const [lcsRefusal, setLcsRefusal] = useState<ApiErrorBody | null>(lcsError);
  const [listLoading, setListLoading] = useState(false);

  // -- the detail chain (the find's own output) --------------------------------
  const [detail, setDetail] = useState<LcDetail | null>(null);
  const [detailRefusal, setDetailRefusal] = useState<ApiErrorBody | null>(null);
  const [act, setAct] = useState<LcAct | null>(null);

  // -- the create form -----------------------------------------------------------
  const [currency, setCurrency] = useState("SAR");
  const [amount, setAmount] = useState("");
  const [marginAmount, setMarginAmount] = useState("");
  const [issuingBank, setIssuingBank] = useState("");
  const [beneficiaryName, setBeneficiaryName] = useState("");
  const [applicantName, setApplicantName] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [purchaseOrderId, setPurchaseOrderId] = useState("");

  const createReady =
    CURRENCY_RE.test(currency) &&
    MONEY_RE.test(amount) &&
    (marginAmount === "" || MONEY_RE.test(marginAmount)) &&
    issuingBank.trim().length > 0 &&
    beneficiaryName.trim().length > 0 &&
    applicantName.trim().length > 0 &&
    DATE_RE.test(expiryDate) &&
    (purchaseOrderId.trim() === "" || UUID_RE.test(purchaseOrderId.trim()));

  // -- the act forms' state (one dialog at a time) -------------------------------
  const [issueMargin, setIssueMargin] = useState("");
  const [bankAccountId, setBankAccountId] = useState("");
  const [amendType, setAmendType] = useState<"VALUE" | "VALIDITY" | "DOCUMENTS" | "OTHER">("VALUE");
  const [amendValueFrom, setAmendValueFrom] = useState("");
  const [amendValueTo, setAmendValueTo] = useState("");
  const [amendExpiryFrom, setAmendExpiryFrom] = useState("");
  const [amendExpiryTo, setAmendExpiryTo] = useState("");
  const [amendDocumentsNote, setAmendDocumentsNote] = useState("");
  const [amendSummary, setAmendSummary] = useState("");
  const [docType, setDocType] = useState("");
  const [docPresented, setDocPresented] = useState(false);
  const [docVerified, setDocVerified] = useState(false);
  const [docDiscrepancy, setDocDiscrepancy] = useState("");
  const [feeAmount, setFeeAmount] = useState("");
  const [feeMemo, setFeeMemo] = useState("");

  // -- the register read -----------------------------------------------------------
  async function loadLcs(): Promise<void> {
    setListLoading(true);
    const result = await bffFetch<readonly TradeLcRow[]>("trade/lc");
    setListLoading(false);
    if (!result.ok) {
      setLcsRefusal(result.error);
      setLcs(null);
      return;
    }
    setLcsRefusal(null);
    setLcs(result.data);
  }

  // -- the find (the detail chain) ----------------------------------------------------
  async function openLc(id: string): Promise<void> {
    setBusy(`open-${id}`);
    setError(null);
    const result = await bffFetch<LcDetail>(`trade/lc/${id}`);
    setBusy(null);
    if (!result.ok) {
      setDetailRefusal(result.error);
      setDetail(null);
      return;
    }
    setDetailRefusal(null);
    setDetail(result.data);
  }

  // -- the create act -----------------------------------------------------------------
  async function createLc(): Promise<void> {
    if (!createReady) {
      setError(d.errorsValidation);
      return;
    }
    setBusy("create");
    setError(null);
    const result = await bffFetch<TradeLcRow>("trade/lc", {
      method: "POST",
      body: {
        currency,
        amount,
        ...(marginAmount !== "" ? { marginAmount } : {}),
        issuingBank,
        beneficiaryName,
        applicantName,
        expiryDate,
        ...(purchaseOrderId.trim() !== "" ? { purchaseOrderId: purchaseOrderId.trim() } : {}),
      },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedTradeError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setNotice(d.tradeLcCreatedToast);
    toast({ tone: "success", title: d.tradeLcCreatedToast });
    await loadLcs();
    setPane("register");
  }

  // -- the lifecycle acts (the dialog forms) ----------------------------------------------
  async function runAct(target: LcDetail, kind: LcAct, body: unknown): Promise<void> {
    setBusy(`${kind}-${target.lc.id}`);
    setError(null);
    const result = await bffFetch<unknown>(`trade/lc/${target.lc.id}/${kind}`, {
      method: "POST",
      body,
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedTradeError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setNotice(d.qualityRefresh);
    toast({ tone: "success", title: d.tradeRefresh });
    setAct(null);
    await openLc(target.lc.id);
    await loadLcs();
  }

  function submitAct(): void {
    if (detail === null || act === null) {
      return;
    }
    if (act === "issue") {
      if (bankAccountId.trim() === "" || !UUID_RE.test(bankAccountId.trim())) {
        setError(d.errorsValidation);
        return;
      }
      void runAct(detail, "issue", {
        bankAccountId: bankAccountId.trim(),
        ...(issueMargin !== "" ? { marginAmount: issueMargin } : {}),
      });
      return;
    }
    if (act === "amend") {
      const body: Record<string, unknown> = { changeType: amendType };
      if (amendType === "VALUE") {
        if (!MONEY_RE.test(amendValueFrom) || !MONEY_RE.test(amendValueTo)) {
          setError(d.errorsValidation);
          return;
        }
        body.valueFrom = amendValueFrom;
        body.valueTo = amendValueTo;
      } else if (amendType === "VALIDITY") {
        if (!DATE_RE.test(amendExpiryFrom) || !DATE_RE.test(amendExpiryTo)) {
          setError(d.errorsValidation);
          return;
        }
        body.expiryFrom = amendExpiryFrom;
        body.expiryTo = amendExpiryTo;
      } else if (amendType === "DOCUMENTS") {
        if (amendDocumentsNote.trim() === "") {
          setError(d.errorsValidation);
          return;
        }
        body.documentsNote = amendDocumentsNote;
      } else {
        if (amendSummary.trim() === "") {
          setError(d.errorsValidation);
          return;
        }
        body.summary = amendSummary;
      }
      void runAct(detail, "amend", body);
      return;
    }
    if (act === "document") {
      if (docType.trim().length < 2) {
        setError(d.errorsValidation);
        return;
      }
      void runAct(detail, "document", {
        docType: docType.trim(),
        presented: docPresented,
        verified: docVerified,
        ...(docDiscrepancy.trim() !== "" ? { discrepancyNotes: docDiscrepancy.trim() } : {}),
      });
      return;
    }
    if (act === "fee") {
      if (!MONEY_RE.test(feeAmount) || bankAccountId.trim() === "" || !UUID_RE.test(bankAccountId.trim())) {
        setError(d.errorsValidation);
        return;
      }
      void runAct(detail, "fee", {
        amount: feeAmount,
        bankAccountId: bankAccountId.trim(),
        ...(feeMemo.trim() !== "" ? { memo: feeMemo.trim() } : {}),
      });
      return;
    }
    if (act === "retire") {
      void runAct(detail, "retire", {});
      return;
    }
    void runAct(detail, "cancel", {});
  }

  // -- the register table -----------------------------------------------------------------
  const lcColumns: DataTableColumn<TradeLcRow>[] = [
    {
      id: "lcNo",
      header: activeLocaleHeader(d.tradeLcColNo),
      accessor: (row) => row.lcNo ?? "—",
      render: (row) => dashIfNull(row.lcNo),
    },
    {
      id: "status",
      header: activeLocaleHeader(d.tradeLcColStatus),
      accessor: (row) => row.status,
      render: (row) => <Chip tone={statusTone(row.status)}>{tradeLcStatusLabel(d, row.status)}</Chip>,
    },
    {
      id: "currency",
      header: activeLocaleHeader(d.tradeLcColCurrency),
      accessor: (row) => row.currency,
      render: (row) => monoCell(row.currency),
    },
    {
      id: "amount",
      header: activeLocaleHeader(d.tradeLcColAmount),
      accessor: (row) => row.amount,
      numeric: true,
      render: (row) => monoCell(row.amount),
    },
    {
      id: "margin",
      header: activeLocaleHeader(d.tradeLcColMargin),
      accessor: (row) => row.marginAmount,
      numeric: true,
      render: (row) => monoCell(row.marginAmount),
    },
    {
      id: "bank",
      header: activeLocaleHeader(d.tradeLcColBank),
      accessor: (row) => row.issuingBank,
    },
    {
      id: "beneficiary",
      header: activeLocaleHeader(d.tradeLcColBeneficiary),
      accessor: (row) => row.beneficiaryName,
    },
    {
      id: "expiry",
      header: activeLocaleHeader(d.tradeLcColExpiry),
      accessor: (row) => row.expiryDate,
      render: (row) => monoCell(row.expiryDate),
    },
  ];

  // -- the render -------------------------------------------------------------------------

  return (
    <div className="flex flex-col gap-4">
      {/* the pane switch — the data-slot shape (no Tabs primitive) */}
      <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label={d.tradeLcTitle}>
        <Button
          variant={pane === "register" ? "primary" : "secondary"}
          size="sm"
          aria-current={pane === "register"}
          onClick={() => setPane("register")}
        >
          {d.tradePaneRegister}
        </Button>
        {canManage ? (
          <Button
            variant={pane === "create" ? "primary" : "secondary"}
            size="sm"
            aria-current={pane === "create"}
            onClick={() => setPane("create")}
          >
            {d.tradePaneCreate}
          </Button>
        ) : null}
      </div>

      {error !== null ? <ErrorNotice>{error}</ErrorNotice> : null}
      {notice !== null ? <SuccessNotice>{notice}</SuccessNotice> : null}

      {pane === "register" ? (
        <>
          <Card
            title={d.tradeLcTitle}
            description={d.tradeLcSubtitle}
            actions={
              <Button
                variant="secondary"
                size="sm"
                loading={listLoading}
                onClick={() => void loadLcs()}
              >
                {d.tradeRefresh}
              </Button>
            }
          >
            <p className="text-sm text-gray-600">{d.tradeLcSubtitle}</p>
          </Card>

          {lcsRefusal !== null ? (
            <TypedRefusalPanel
              error={lcsRefusal}
              title={d.tradeRefusalTitle}
              detailsLabel={d.tradeRefusalDetails}
            />
          ) : null}

          {lcsRefusal === null && lcs !== null ? (
            lcs.length === 0 ? (
              <p className="text-sm text-gray-600">{d.tradeEmpty}</p>
            ) : (
              <DataTable
                columns={lcColumns}
                rows={[...lcs]}
                rowKey={(row) => row.id}
                rowActions={[
                  {
                    id: "open",
                    label: d.commonOpen,
                    onSelect: (row: TradeLcRow) => void openLc(row.id),
                  },
                ]}
              />
            )
          ) : null}
        </>
      ) : (
        <Card title={d.tradeLcCreateTitle} description={d.tradeLcSubtitle}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label={d.tradeLcCreateCurrency} value={currency} onValueChange={(v) => setCurrency(v.toUpperCase())} mono bidiIsolate required />
            <Input label={d.tradeLcCreateAmount} value={amount} onValueChange={setAmount} inputMode="decimal" mono required />
            <Input label={d.tradeLcCreateMargin} value={marginAmount} onValueChange={setMarginAmount} inputMode="decimal" mono />
            <Input label={d.tradeLcCreateBank} value={issuingBank} onValueChange={setIssuingBank} required />
            <Input label={d.tradeLcCreateBeneficiary} value={beneficiaryName} onValueChange={setBeneficiaryName} required />
            <Input label={d.tradeLcCreateApplicant} value={applicantName} onValueChange={setApplicantName} required />
            <Input label={d.tradeLcCreateExpiry} value={expiryDate} onValueChange={setExpiryDate} mono bidiIsolate required />
            <Input label={d.tradeLcCreatePo} value={purchaseOrderId} onValueChange={setPurchaseOrderId} mono bidiIsolate />
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button
              variant="primary"
              loading={busy === "create"}
              disabled={!createReady}
              onClick={() => void createLc()}
            >
              {d.tradePaneCreate}
            </Button>
          </div>
        </Card>
      )}

      {/* the detail chain — the find's own output (amendments + documents) */}
      {detailRefusal !== null ? (
        <TypedRefusalPanel
          error={detailRefusal}
          title={d.tradeRefusalTitle}
          detailsLabel={d.tradeRefusalDetails}
        />
      ) : null}

      {detail !== null ? (
        <>
          <Card
            title={`${detail.lc.lcNo ?? detail.lc.id.slice(0, 8)} · ${tradeLcStatusLabel(d, detail.lc.status)}`}
            description={d.tradePaneDetail}
            actions={
              canManage ? (
                <div className="flex flex-wrap gap-2">
                  {detail.lc.status === "DRAFT" ? (
                    <Button variant="secondary" size="sm" onClick={() => setAct("issue")}>
                      {d.tradeLcActIssue}
                    </Button>
                  ) : null}
                  {detail.lc.status === "ISSUED" ? (
                    <>
                      <Button variant="secondary" size="sm" onClick={() => setAct("amend")}>
                        {d.tradeLcActAmend}
                      </Button>
                      <Button variant="secondary" size="sm" onClick={() => setAct("document")}>
                        {d.tradeLcActDocuments}
                      </Button>
                      <Button variant="secondary" size="sm" onClick={() => setAct("fee")}>
                        {d.tradeLcActFees}
                      </Button>
                      <Button variant="secondary" size="sm" onClick={() => setAct("retire")}>
                        {d.tradeLcActRetire}
                      </Button>
                    </>
                  ) : null}
                  {detail.lc.status === "DRAFT" || detail.lc.status === "ISSUED" ? (
                    <Button variant="secondary" size="sm" onClick={() => setAct("cancel")}>
                      {d.tradeLcActCancel}
                    </Button>
                  ) : null}
                </div>
              ) : undefined
            }
          >
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="flex flex-col gap-1">
                <dt className="text-xs text-muted-foreground">{d.tradeLcColAmount}</dt>
                <dd className="font-mono tabular-nums" dir="ltr">{`${detail.lc.currency} ${detail.lc.amount}`}</dd>
              </div>
              <div className="flex flex-col gap-1">
                <dt className="text-xs text-muted-foreground">{d.tradeLcColMargin}</dt>
                <dd className="font-mono tabular-nums" dir="ltr">{detail.lc.marginAmount}</dd>
              </div>
              <div className="flex flex-col gap-1">
                <dt className="text-xs text-muted-foreground">{d.tradeLcColIssuedAt}</dt>
                <dd className="font-mono tabular-nums" dir="ltr">{detail.lc.issuedAt}</dd>
              </div>
              <div className="flex flex-col gap-1">
                <dt className="text-xs text-muted-foreground">{d.tradeLcColExpiry}</dt>
                <dd className="font-mono tabular-nums" dir="ltr">{detail.lc.expiryDate}</dd>
              </div>
            </dl>
          </Card>

          {/* the amendments register (the find's own chain) */}
          <Card title={d.tradeLcDetailAmendments}>
            {detail.amendments.length === 0 ? (
              <p className="text-sm text-gray-600">{d.tradeEmpty}</p>
            ) : (
              <DataTable
                columns={[
                  {
                    id: "no",
                    header: activeLocaleHeader(d.tradeLcAmendmentColNo),
                    accessor: (row) => String(row.amendmentNo),
                    render: (row) => monoCell(String(row.amendmentNo)),
                  },
                  {
                    id: "type",
                    header: activeLocaleHeader(d.tradeLcAmendmentColType),
                    accessor: (row) => row.changeType,
                    render: (row) => <Chip tone="info">{row.changeType}</Chip>,
                  },
                  {
                    id: "effective",
                    header: activeLocaleHeader(d.tradeLcAmendmentColEffective),
                    accessor: (row) => row.effectiveAt,
                    render: (row) => monoCell(row.effectiveAt),
                  },
                ]}
                rows={[...detail.amendments]}
                rowKey={(row) => row.id}
              />
            )}
          </Card>

          {/* the documents checklist (the discrepancy notes ride each row) */}
          <Card title={d.tradeLcDetailDocuments}>
            {detail.documents.length === 0 ? (
              <p className="text-sm text-gray-600">{d.tradeEmpty}</p>
            ) : (
              <DataTable
                columns={[
                  {
                    id: "docType",
                    header: activeLocaleHeader(d.tradeLcDocColType),
                    accessor: (row) => row.docType,
                    render: (row) => monoCell(row.docType),
                  },
                  {
                    id: "presented",
                    header: activeLocaleHeader(d.tradeLcDocColPresented),
                    accessor: (row) => (row.presented ? d.tradeLcYes : d.tradeLcNo),
                  },
                  {
                    id: "verified",
                    header: activeLocaleHeader(d.tradeLcDocColVerified),
                    accessor: (row) => (row.verified ? d.tradeLcYes : d.tradeLcNo),
                  },
                  {
                    id: "discrepancy",
                    header: activeLocaleHeader(d.tradeLcDocColDiscrepancy),
                    accessor: (row) => row.discrepancyNotes ?? "—",
                    render: (row) => dashIfNull(row.discrepancyNotes),
                  },
                ]}
                rows={[...detail.documents]}
                rowKey={(row) => row.id}
              />
            )}
          </Card>
        </>
      ) : null}

      {/* the act dialogs (one at a time — the lifecycle's own forms) */}
      <Dialog
        open={act !== null}
        onOpenChange={(open) => {
          if (!open) setAct(null);
        }}
        title={
          act === "issue"
            ? d.tradeLcActIssue
            : act === "amend"
              ? d.tradeLcAmendTitle
              : act === "document"
                ? d.tradeLcActDocuments
                : act === "fee"
                  ? d.tradeLcActFees
                  : act === "retire"
                    ? d.tradeLcActRetire
                    : d.tradeLcActCancel
        }
      >
        {act === "issue" ? (
          <div className="flex flex-col gap-3">
            <Input label={d.tradeLcIssueMargin} value={issueMargin} onValueChange={setIssueMargin} inputMode="decimal" mono />
            <Input label={d.tradeLcIssueBankAccount} value={bankAccountId} onValueChange={setBankAccountId} mono bidiIsolate required />
          </div>
        ) : null}
        {act === "amend" ? (
          <div className="flex flex-col gap-3">
            <Select
              label={d.tradeLcAmendType}
              value={amendType}
              onValueChange={(value) => setAmendType(value as typeof amendType)}
              options={[
                { value: "VALUE", label: "VALUE" },
                { value: "VALIDITY", label: "VALIDITY" },
                { value: "DOCUMENTS", label: "DOCUMENTS" },
                { value: "OTHER", label: "OTHER" },
              ]}
            />
            {amendType === "VALUE" ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <Input label={d.tradeLcAmendValueFrom} value={amendValueFrom} onValueChange={setAmendValueFrom} inputMode="decimal" mono required />
                <Input label={d.tradeLcAmendValueTo} value={amendValueTo} onValueChange={setAmendValueTo} inputMode="decimal" mono required />
              </div>
            ) : null}
            {amendType === "VALIDITY" ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <Input label={d.tradeLcAmendExpiryFrom} value={amendExpiryFrom} onValueChange={setAmendExpiryFrom} mono bidiIsolate required />
                <Input label={d.tradeLcAmendExpiryTo} value={amendExpiryTo} onValueChange={setAmendExpiryTo} mono bidiIsolate required />
              </div>
            ) : null}
            {amendType === "DOCUMENTS" ? (
              <Input label={d.tradeLcAmendDocumentsNote} value={amendDocumentsNote} onValueChange={setAmendDocumentsNote} required />
            ) : null}
            {amendType === "OTHER" ? (
              <Input label={d.tradeLcAmendSummary} value={amendSummary} onValueChange={setAmendSummary} required />
            ) : null}
          </div>
        ) : null}
        {act === "document" ? (
          <div className="flex flex-col gap-3">
            <Input label={d.tradeLcDocDocType} value={docType} onValueChange={setDocType} mono bidiIsolate required />
            <Select
              label={d.tradeLcDocPresented}
              value={docPresented ? "yes" : "no"}
              onValueChange={(value) => setDocPresented(value === "yes")}
              options={[
                { value: "no", label: d.tradeLcNo },
                { value: "yes", label: d.tradeLcYes },
              ]}
            />
            <Select
              label={d.tradeLcDocVerified}
              value={docVerified ? "yes" : "no"}
              onValueChange={(value) => setDocVerified(value === "yes")}
              options={[
                { value: "no", label: d.tradeLcNo },
                { value: "yes", label: d.tradeLcYes },
              ]}
            />
            <Input label={d.tradeLcDocDiscrepancy} value={docDiscrepancy} onValueChange={setDocDiscrepancy} />
          </div>
        ) : null}
        {act === "fee" ? (
          <div className="flex flex-col gap-3">
            <Input label={d.tradeLcFeeAmount} value={feeAmount} onValueChange={setFeeAmount} inputMode="decimal" mono required />
            <Input label={d.tradeLcFeeBankAccount} value={bankAccountId} onValueChange={setBankAccountId} mono bidiIsolate required />
            <Input label={d.tradeLcFeeMemo} value={feeMemo} onValueChange={setFeeMemo} />
          </div>
        ) : null}
        {act === "retire" || act === "cancel" ? (
          <p className="text-sm text-gray-600">{d.tradePaneDetail}</p>
        ) : null}
        {act !== null && detail !== null ? (
          <div className="mt-4 flex justify-end gap-2">
            <Button
              variant="primary"
              loading={busy === `${act}-${detail.lc.id}`}
              onClick={() => submitAct()}
            >
              {d.commonConfirm}
            </Button>
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}
