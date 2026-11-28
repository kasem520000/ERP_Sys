"use client";

/**
 * PHASE-052 (W-48 — T-12's fourth bound surface) THE DRAWBACK CLAIMS
 * BOARD — the 051 engine's own register (the claims ladder DRAFT →
 * SUBMITTED → UNDER_REVIEW → APPROVED | REJECTED → PAID — BR-108's
 * evidence gate at the submission) rendered for the workflow plane:
 * the engine's docDetailPath law points the assignee at
 * /trade/drawbacks?doc=…, and the chain view (the timeline Card)
 * renders for the linked claim. The board is the W-39 trade-board
 * pattern verbatim: the data-slot pane switch, the typed-refusal
 * panels with FULL payloads, the mono cells, every figure an ENGINE
 * OUTPUT rendered VERBATIM.
 *
 * THE HONEST SCOPE NOTE (disclosed at the wave's README): the 051 web
 * plane (W-39) delivered the LC/customs/shipments screens with the
 * drawback claims engine-only; this board is the workflow plane's own
 * need (the fourth bound detail surface), not a 051 rework.
 */
import { useState } from "react";
import type { JSX } from "react";

import {
  Button,
  DataTable,
  Dialog,
  Input,
  useToast,
  type DataTableColumn,
} from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type { ApiErrorBody, TradeDrawbackClaimRow } from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { formatDateTime, localizedTradeError, tradeDrawbackStatusLabel } from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice, SuccessNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";
import { TypedRefusalPanel } from "./typed-refusal-panel";
import { WorkflowTimeline } from "./workflow-timeline";

type ChipTone = "success" | "danger" | "warning" | "info" | "neutral";
const CHIP_TONE_CLASSES: Record<ChipTone, string> = {
  success: "border-success-border bg-success-bg text-success-text",
  danger: "border-danger-border bg-danger-bg text-danger-text",
  warning: "border-warning-border bg-warning-bg text-warning-text",
  info: "border-info-border bg-info-bg text-info-text",
  neutral: "border-subtle bg-gray-100 text-gray-600",
};

function Chip({ tone, children }: { tone: ChipTone; children: string }): JSX.Element {
  return (
    <span
      className={`inline-flex w-fit items-center rounded-sm border px-1.5 py-0.5 text-xs leading-4 ${CHIP_TONE_CLASSES[tone]}`}
    >
      {children}
    </span>
  );
}

function statusTone(status: string): ChipTone {
  switch (status) {
    case "APPROVED":
    case "PAID":
      return "success";
    case "REJECTED":
      return "danger";
    case "SUBMITTED":
    case "UNDER_REVIEW":
      return "warning";
    default:
      return "neutral";
  }
}

function monoCell(value: string, title?: string): JSX.Element {
  return (
    <span className="font-mono tabular-nums" dir="ltr" title={title ?? value}>
      {value}
    </span>
  );
}

const CURRENCY_RE = /^[A-Z]{3}$/;
const MONEY_RE = /^\d+(\.\d{1,4})?$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type DrawbackAct = "submit" | "review" | "approve" | "reject" | "pay" | "evidence";

export function TradeDrawbacksBoard({
  locale,
  initialClaims,
  claimsError,
  canManage,
  initialChainDocId,
}: {
  locale: Locale;
  initialClaims: readonly TradeDrawbackClaimRow[] | null;
  claimsError: ApiErrorBody | null;
  canManage: boolean;
  initialChainDocId?: string | null;
}): JSX.Element {
  const d = getDictionary(locale);
  const { toast } = useToast();

  // -- the pane switch (the data-slot shape — never the Tabs primitive) ----
  const [pane, setPane] = useState<"register" | "create">("register");

  // -- the shared feedback ---------------------------------------------------
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // -- the register pane -------------------------------------------------------
  const [claims, setClaims] = useState<readonly TradeDrawbackClaimRow[] | null>(initialClaims);
  const [claimsRefusal, setClaimsRefusal] = useState<ApiErrorBody | null>(claimsError);
  const [listLoading, setListLoading] = useState(false);

  // -- the chain view (the timeline Card — the ?doc= landing or the rowAction)
  const [chainDocId, setChainDocId] = useState<string | null>(initialChainDocId ?? null);

  // -- the create form -----------------------------------------------------------
  const [claimedAmount, setClaimedAmount] = useState("");
  const [currency, setCurrency] = useState("SAR");
  const [exportDeclarationId, setExportDeclarationId] = useState("");
  const [exportBillOfLadingId, setExportBillOfLadingId] = useState("");
  const [note, setNote] = useState("");

  // -- the act forms ------------------------------------------------------------
  const [act, setAct] = useState<{ kind: DrawbackAct; claim: TradeDrawbackClaimRow } | null>(null);
  const [evidenceDeclaration, setEvidenceDeclaration] = useState("");
  const [evidenceBl, setEvidenceBl] = useState("");

  const createReady =
    MONEY_RE.test(claimedAmount) &&
    CURRENCY_RE.test(currency) &&
    (exportDeclarationId.trim() === "" || UUID_RE.test(exportDeclarationId.trim())) &&
    (exportBillOfLadingId.trim() === "" || UUID_RE.test(exportBillOfLadingId.trim())) &&
    (exportDeclarationId.trim() !== "" || exportBillOfLadingId.trim() !== "" || note.trim().length > 0);

  async function loadClaims(): Promise<void> {
    setListLoading(true);
    const result = await bffFetch<readonly TradeDrawbackClaimRow[]>("trade/drawback/claims");
    setListLoading(false);
    if (!result.ok) {
      setClaimsRefusal(result.error);
      setClaims(null);
      return;
    }
    setClaimsRefusal(null);
    setClaims(result.data);
  }

  async function submitCreate(): Promise<void> {
    setBusy(true);
    setError(null);
    const result = await bffFetch<TradeDrawbackClaimRow>("trade/drawback/claims", {
      method: "POST",
      body: {
        claimedAmount,
        currency,
        exportDeclarationId: exportDeclarationId.trim() === "" ? null : exportDeclarationId.trim(),
        exportBillOfLadingId: exportBillOfLadingId.trim() === "" ? null : exportBillOfLadingId.trim(),
        note: note.trim() === "" ? null : note.trim(),
      },
    });
    setBusy(false);
    if (!result.ok) {
      setError(localizedTradeError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setNotice(d.tradeDrawbackCreatedToast);
    toast({ tone: "success", title: d.tradeDrawbackCreatedToast });
    setPane("register");
    setClaimedAmount("");
    setNote("");
    setExportDeclarationId("");
    setExportBillOfLadingId("");
    await loadClaims();
  }

  async function submitAct(): Promise<void> {
    if (act === null) {
      return;
    }
    setBusy(true);
    setError(null);
    const path =
      act.kind === "evidence"
        ? `trade/drawback/claims/${act.claim.id}/evidence`
        : `trade/drawback/claims/${act.claim.id}/${act.kind}`;
    const body =
      act.kind === "evidence"
        ? {
            exportDeclarationId: evidenceDeclaration.trim() === "" ? null : evidenceDeclaration.trim(),
            exportBillOfLadingId: evidenceBl.trim() === "" ? null : evidenceBl.trim(),
          }
        : {};
    const result = await bffFetch<TradeDrawbackClaimRow>(path, { method: "POST", body });
    setBusy(false);
    if (!result.ok) {
      setError(localizedTradeError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setAct(null);
    setNotice(d.tradeDrawbackDoneToast);
    toast({ tone: "success", title: d.tradeDrawbackDoneToast });
    await loadClaims();
  }

  const columns: DataTableColumn<TradeDrawbackClaimRow>[] = [
    {
      id: "no",
      header: activeLocaleHeader(d.tradeDrawbackColNo),
      accessor: (row) => row.claimNo,
      mono: true,
      render: (row) => monoCell(row.claimNo),
    },
    {
      id: "amount",
      header: activeLocaleHeader(d.tradeDrawbackColAmount),
      accessor: (row) => row.claimedAmount,
      numeric: true,
      render: (row) => (
        <div className="flex flex-col">
          {monoCell(row.claimedAmount)}
          <span className="text-xs text-gray-500" dir="ltr">
            {row.currency}
          </span>
        </div>
      ),
    },
    {
      id: "status",
      header: activeLocaleHeader(d.tradeDrawbackColStatus),
      accessor: (row) => row.status,
      render: (row) => <Chip tone={statusTone(row.status)}>{tradeDrawbackStatusLabel(d, row.status)}</Chip>,
    },
    {
      id: "submittedAt",
      header: activeLocaleHeader(d.tradeDrawbackColSubmittedAt),
      accessor: (row) => row.submittedAt ?? "",
      render: (row) =>
        row.submittedAt === null ? (
          <span className="text-xs text-gray-500">—</span>
        ) : (
          <span className="text-xs" dir="ltr">
            {formatDateTime(row.submittedAt, locale)}
          </span>
        ),
    },
    {
      id: "decidedAt",
      header: activeLocaleHeader(d.tradeDrawbackColDecidedAt),
      accessor: (row) => row.decidedAt ?? "",
      render: (row) =>
        row.decidedAt === null ? (
          <span className="text-xs text-gray-500">—</span>
        ) : (
          <span className="text-xs" dir="ltr">
            {formatDateTime(row.decidedAt, locale)}
          </span>
        ),
    },
  ];

  function actAvailable(kind: DrawbackAct, status: string): boolean {
    switch (kind) {
      case "evidence":
        return status === "DRAFT";
      case "submit":
        return status === "DRAFT";
      case "review":
        return status === "SUBMITTED";
      case "approve":
      case "reject":
        return status === "UNDER_REVIEW";
      case "pay":
        return status === "APPROVED";
      default:
        return false;
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label={d.tradeDrawbackTitle}>
        <Button
          variant={pane === "register" ? "primary" : "secondary"}
          size="sm"
          aria-current={pane === "register"}
          onClick={() => setPane("register")}
        >
          {d.workflowEditorPaneRegister}
        </Button>
        {canManage ? (
          <Button
            variant={pane === "create" ? "primary" : "secondary"}
            size="sm"
            aria-current={pane === "create"}
            onClick={() => setPane("create")}
          >
            {d.tradeDrawbackCreateTitle}
          </Button>
        ) : null}
      </div>

      {error !== null ? <ErrorNotice>{error}</ErrorNotice> : null}
      {notice !== null ? <SuccessNotice>{notice}</SuccessNotice> : null}

      {pane === "register" ? (
        <>
          <Card
            title={d.tradeDrawbackTitle}
            description={d.tradeDrawbackSubtitle}
            actions={
              <Button variant="secondary" size="sm" loading={listLoading} onClick={() => void loadClaims()}>
                {d.workflowRefresh}
              </Button>
            }
          >
            {listLoading ? <p className="text-sm text-gray-600">{d.workflowTimelineLoading}</p> : null}
            {claimsRefusal !== null ? (
              <TypedRefusalPanel
                error={claimsRefusal}
                title={d.workflowRefusalTitle}
                detailsLabel={d.workflowRefusalDetails}
              />
            ) : null}
            {claims !== null && claimsRefusal === null ? (
              claims.length === 0 ? (
                <p className="text-sm text-gray-600">{d.workflowEmpty}</p>
              ) : (
                <DataTable
                  columns={columns}
                  rows={[...claims]}
                  rowKey={(row) => row.id}
                  rowActions={[
                    ...(canManage
                      ? ([
                          "evidence",
                          "submit",
                          "review",
                          "approve",
                          "reject",
                          "pay",
                        ] as const).map((kind) => ({
                          id: kind,
                          label: actLabelOf(d, kind),
                          onSelect: (row: TradeDrawbackClaimRow) => {
                            if (!actAvailable(kind, row.status)) return;
                            setEvidenceDeclaration(row.exportDeclarationId ?? "");
                            setEvidenceBl(row.exportBillOfLadingId ?? "");
                            setAct({ kind, claim: row });
                          },
                        }))
                      : []),
                    {
                      id: "chain",
                      label: d.workflowTimelineTitle,
                      onSelect: (row: TradeDrawbackClaimRow) => {
                        setChainDocId(row.id);
                      },
                    },
                  ]}
                />
              )
            ) : null}
          </Card>

          {/* PHASE-052 (W-48 — T-12, PP-17): the drawback claim's chain view
           * (the fourth bound surface — the read gates on
           * workflow.history.view at the API). */}
          {chainDocId !== null ? (
            <WorkflowTimeline locale={locale} triggerEntity="duty_drawback_claim" documentId={chainDocId} />
          ) : null}
        </>
      ) : (
        <Card title={d.tradeDrawbackCreateTitle}>
          <div className="flex flex-col gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label={d.tradeDrawbackClaimedAmount} value={claimedAmount} onValueChange={setClaimedAmount} />
              <Input label={d.tradeDrawbackCurrency} value={currency} onValueChange={setCurrency} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label={d.tradeDrawbackExportDeclaration} value={exportDeclarationId} onValueChange={setExportDeclarationId} />
              <Input label={d.tradeDrawbackExportBl} value={exportBillOfLadingId} onValueChange={setExportBillOfLadingId} />
            </div>
            <Input label={d.tradeDrawbackNote} value={note} onValueChange={setNote} />
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="primary" loading={busy} disabled={!createReady} onClick={() => void submitCreate()}>
                {d.tradeDrawbackCreateTitle}
              </Button>
              <Button variant="ghost" onClick={() => setPane("register")}>
                {d.workflowActCancel}
              </Button>
            </div>
          </div>
        </Card>
      )}

      {act !== null ? (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) {
              setAct(null);
            }
          }}
          title={actLabelOf(d, act.kind)}
        >
          <div className="flex flex-col gap-3">
            <p className="text-sm">
              {act.claim.claimNo} · {tradeDrawbackStatusLabel(d, act.claim.status)}
            </p>
            {act.kind === "evidence" ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <Input label={d.tradeDrawbackExportDeclaration} value={evidenceDeclaration} onValueChange={setEvidenceDeclaration} />
                <Input label={d.tradeDrawbackExportBl} value={evidenceBl} onValueChange={setEvidenceBl} />
              </div>
            ) : null}
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="primary" loading={busy} onClick={() => void submitAct()}>
                {actLabelOf(d, act.kind)}
              </Button>
              <Button variant="ghost" onClick={() => setAct(null)}>
                {d.workflowActCancel}
              </Button>
            </div>
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}

function actLabelOf(
  d: ReturnType<typeof getDictionary>,
  kind: DrawbackAct,
): string {
  switch (kind) {
    case "submit":
      return d.tradeDrawbackActSubmit;
    case "review":
      return d.tradeDrawbackActReview;
    case "approve":
      return d.tradeDrawbackActApprove;
    case "reject":
      return d.tradeDrawbackActReject;
    case "pay":
      return d.tradeDrawbackActPay;
    case "evidence":
      return d.tradeDrawbackActEvidence;
    default:
      return kind;
  }
}
