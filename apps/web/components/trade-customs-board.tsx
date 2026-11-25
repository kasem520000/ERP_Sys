"use client";

/**
 * PHASE-051 (W-39 — T-14, D-17) — the customs board (the /trade/customs
 * screen body): the declarations register + the create act with THE
 * LINES EDITOR (the duty/VAT line fold's own form) + the detail chain
 * (the declaration + its lines + the fold's totals rendered from the
 * LINES at every read — never a stored parallel figure) + the ladder
 * acts (submit · accept · THE G-65 COMPLETION · cancel · the
 * DRAFT-only add-line) + the HS registry pane (the tenant additions)
 * — the 048/049/050 board patterns: the data-slot pane switch, the
 * typed-refusal panels with FULL payloads, the mono cells, every
 * figure an ENGINE OUTPUT rendered VERBATIM.
 */
import { useState } from "react";
import type { JSX } from "react";

import {
  Button,
  DataTable,
  Input,
  Select,
  useToast,
  type DataTableColumn,
} from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type {
  ApiErrorBody,
  TradeDeclarationFindResult,
  TradeDeclarationRow,
  TradeHsCodeRow,
} from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { localizedName, localizedTradeError, tradeDeclarationStatusLabel } from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice, SuccessNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";
import { TypedRefusalPanel } from "./typed-refusal-panel";

const CURRENCY_RE = /^[A-Z]{3}$/;
const DECIMAL_RE = /^\d+(\.\d{1,8})?$/;
const QTY_RE = /^\d+(\.\d{1,6})?$/;
const HS_RE = /^[0-9]{2,10}$/;
const ORIGIN_RE = /^[A-Z]{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface DraftLine {
  hsCode: string;
  originCountry: string;
  itemId: string;
  description: string;
  quantity: string;
  uom: string;
  customsValue: string;
  dutyRate: string;
  importVat: string;
}

const EMPTY_LINE: DraftLine = {
  hsCode: "",
  originCountry: "",
  itemId: "",
  description: "",
  quantity: "",
  uom: "",
  customsValue: "",
  dutyRate: "",
  importVat: "",
};

function lineValid(line: DraftLine): boolean {
  return (
    HS_RE.test(line.hsCode) &&
    (line.originCountry === "" || ORIGIN_RE.test(line.originCountry)) &&
    (line.itemId === "" || UUID_RE.test(line.itemId)) &&
    line.description.trim().length > 0 &&
    (line.quantity === "" || QTY_RE.test(line.quantity)) &&
    DECIMAL_RE.test(line.customsValue) &&
    DECIMAL_RE.test(line.dutyRate) &&
    DECIMAL_RE.test(line.importVat)
  );
}

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
    case "COMPLETED":
      return "success";
    case "SUBMITTED":
      return "info";
    case "ACCEPTED":
      return "warning";
    case "CANCELLED":
      return "neutral";
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

export function TradeCustomsBoard({
  locale,
  initialDeclarations,
  declarationsError,
  initialHs,
  hsError,
  canManage,
}: {
  locale: Locale;
  initialDeclarations: readonly TradeDeclarationRow[] | null;
  declarationsError: ApiErrorBody | null;
  initialHs: readonly TradeHsCodeRow[] | null;
  hsError: ApiErrorBody | null;
  canManage: boolean;
}): JSX.Element {
  const d = getDictionary(locale);
  const { toast } = useToast();

  // -- the pane switch (register · create · detail · hs) --------------------
  const [pane, setPane] = useState<"register" | "create" | "hs">("register");

  // -- the shared feedback ---------------------------------------------------
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // -- the declarations register -----------------------------------------------
  const [declarations, setDeclarations] = useState<readonly TradeDeclarationRow[] | null>(
    initialDeclarations,
  );
  const [declarationsRefusal, setDeclarationsRefusal] = useState<ApiErrorBody | null>(
    declarationsError,
  );
  const [listLoading, setListLoading] = useState(false);

  // -- the detail chain (the find's own output) ---------------------------------
  const [detail, setDetail] = useState<TradeDeclarationFindResult | null>(null);
  const [detailRefusal, setDetailRefusal] = useState<ApiErrorBody | null>(null);
  const [addLine, setAddLine] = useState<DraftLine>({ ...EMPTY_LINE });

  // -- the create form -----------------------------------------------------------
  const [declarationType, setDeclarationType] = useState<"IMPORT" | "EXPORT" | "TRANSIT">("IMPORT");
  const [customsOffice, setCustomsOffice] = useState("");
  const [currency, setCurrency] = useState("SAR");
  const [receiptId, setReceiptId] = useState("");
  const [purchaseOrderId, setPurchaseOrderId] = useState("");
  const [billOfLadingId, setBillOfLadingId] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([{ ...EMPTY_LINE }]);

  // -- the HS registry pane --------------------------------------------------------
  const [hs, setHs] = useState<readonly TradeHsCodeRow[] | null>(initialHs);
  const [hsRefusal, setHsRefusal] = useState<ApiErrorBody | null>(hsError);
  const [hsCode, setHsCode] = useState("");
  const [hsName, setHsName] = useState("");
  const [hsNameAr, setHsNameAr] = useState("");

  const createReady =
    customsOffice.trim().length > 0 &&
    CURRENCY_RE.test(currency) &&
    lines.length > 0 &&
    lines.every(lineValid) &&
    (receiptId.trim() === "" || UUID_RE.test(receiptId.trim())) &&
    (purchaseOrderId.trim() === "" || UUID_RE.test(purchaseOrderId.trim())) &&
    (billOfLadingId.trim() === "" || UUID_RE.test(billOfLadingId.trim()));

  // -- the register read -----------------------------------------------------------
  async function loadDeclarations(): Promise<void> {
    setListLoading(true);
    const result = await bffFetch<readonly TradeDeclarationRow[]>("trade/customs/declarations");
    setListLoading(false);
    if (!result.ok) {
      setDeclarationsRefusal(result.error);
      setDeclarations(null);
      return;
    }
    setDeclarationsRefusal(null);
    setDeclarations(result.data);
  }

  // -- the find (the detail chain) ------------------------------------------------------
  async function openDeclaration(id: string): Promise<void> {
    setBusy(`open-${id}`);
    setError(null);
    const result = await bffFetch<TradeDeclarationFindResult>(
      `trade/customs/declarations/${id}`,
    );
    setBusy(null);
    if (!result.ok) {
      setDetailRefusal(result.error);
      setDetail(null);
      return;
    }
    setDetailRefusal(null);
    setDetail(result.data);
  }

  // -- the create act -------------------------------------------------------------------
  async function createDeclaration(): Promise<void> {
    if (!createReady) {
      setError(d.errorsValidation);
      return;
    }
    setBusy("create");
    setError(null);
    const result = await bffFetch<TradeDeclarationRow>("trade/customs/declarations", {
      method: "POST",
      body: {
        declarationType,
        customsOffice,
        currency,
        ...(receiptId.trim() !== "" ? { receiptId: receiptId.trim() } : {}),
        ...(purchaseOrderId.trim() !== "" ? { purchaseOrderId: purchaseOrderId.trim() } : {}),
        ...(billOfLadingId.trim() !== "" ? { billOfLadingId: billOfLadingId.trim() } : {}),
        lines: lines.map((line) => ({
          hsCode: line.hsCode,
          ...(line.originCountry !== "" ? { originCountry: line.originCountry } : {}),
          ...(line.itemId !== "" ? { itemId: line.itemId } : {}),
          description: line.description,
          ...(line.quantity !== "" ? { quantity: line.quantity } : {}),
          ...(line.uom !== "" ? { uom: line.uom } : {}),
          customsValue: line.customsValue,
          dutyRate: line.dutyRate,
          importVat: line.importVat,
        })),
      },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedTradeError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setNotice(d.tradeCustomsCreatedToast);
    toast({ tone: "success", title: d.tradeCustomsCreatedToast });
    await loadDeclarations();
    setPane("register");
  }

  // -- the ladder acts ---------------------------------------------------------------------
  async function runLadderAct(
    id: string,
    kind: "submit" | "accept" | "complete" | "cancel" | "lines",
    body: unknown,
  ): Promise<void> {
    setBusy(`${kind}-${id}`);
    setError(null);
    const path =
      kind === "lines" ? `trade/customs/declarations/${id}/lines` : `trade/customs/declarations/${id}/${kind}`;
    const result = await bffFetch<unknown>(path, { method: "POST", body });
    setBusy(null);
    if (!result.ok) {
      setError(localizedTradeError(d, result.error, result.retryAfterSeconds));
      return;
    }
    toast({ tone: "success", title: d.tradeRefresh });
    await openDeclaration(id);
    await loadDeclarations();
  }

  // -- the HS addition -------------------------------------------------------------------------
  async function createHs(): Promise<void> {
    if (!HS_RE.test(hsCode) || hsName.trim().length < 2 || hsNameAr.trim().length < 2) {
      setError(d.errorsValidation);
      return;
    }
    setBusy("hs");
    setError(null);
    const result = await bffFetch<TradeHsCodeRow>("trade/customs/hs", {
      method: "POST",
      body: { hsCode, name: hsName, nameAr: hsNameAr },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedTradeError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setNotice(d.tradeHsCreatedToast);
    toast({ tone: "success", title: d.tradeHsCreatedToast });
    setHsCode("");
    setHsName("");
    setHsNameAr("");
    const list = await bffFetch<readonly TradeHsCodeRow[]>("trade/customs/hs");
    if (list.ok) {
      setHsRefusal(null);
      setHs(list.data);
    } else {
      setHsRefusal(list.error);
      setHs(null);
    }
  }

  // -- the register table ---------------------------------------------------------------------------
  const declarationColumns: DataTableColumn<TradeDeclarationRow>[] = [
    {
      id: "no",
      header: activeLocaleHeader(d.tradeCustomsColNo),
      accessor: (row) => row.declarationNo,
      render: (row) => monoCell(row.declarationNo),
    },
    {
      id: "type",
      header: activeLocaleHeader(d.tradeCustomsColType),
      accessor: (row) => row.declarationType,
      render: (row) => (
        <Chip tone={row.declarationType === "IMPORT" ? "info" : "neutral"}>
          {row.declarationType === "IMPORT"
            ? d.tradeDeclarationTypeImport
            : row.declarationType === "EXPORT"
              ? d.tradeDeclarationTypeExport
              : d.tradeDeclarationTypeTransit}
        </Chip>
      ),
    },
    {
      id: "office",
      header: activeLocaleHeader(d.tradeCustomsColOffice),
      accessor: (row) => row.customsOffice,
    },
    {
      id: "status",
      header: activeLocaleHeader(d.tradeCustomsColStatus),
      accessor: (row) => row.status,
      render: (row) => (
        <Chip tone={statusTone(row.status)}>{tradeDeclarationStatusLabel(d, row.status)}</Chip>
      ),
    },
    {
      id: "currency",
      header: activeLocaleHeader(d.tradeCustomsColCurrency),
      accessor: (row) => row.currency,
      render: (row) => monoCell(row.currency),
    },
    {
      id: "completed",
      header: activeLocaleHeader(d.tradeCustomsColCompleted),
      accessor: (row) => row.completedAt ?? "—",
      render: (row) => dashIfNull(row.completedAt),
    },
    {
      id: "landedCost",
      header: activeLocaleHeader(d.tradeCustomsColLandedCost),
      accessor: (row) => row.landedCostNo ?? "—",
      render: (row) => dashIfNull(row.landedCostNo),
    },
  ];

  // -- the render ---------------------------------------------------------------------------------

  return (
    <div className="flex flex-col gap-4">
      {/* the pane switch — the data-slot shape (no Tabs primitive) */}
      <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label={d.tradeCustomsTitle}>
        <Button
          variant={pane === "register" ? "primary" : "secondary"}
          size="sm"
          aria-current={pane === "register"}
          onClick={() => setPane("register")}
        >
          {d.tradeCustomsPaneRegister}
        </Button>
        {canManage ? (
          <>
            <Button
              variant={pane === "create" ? "primary" : "secondary"}
              size="sm"
              aria-current={pane === "create"}
              onClick={() => setPane("create")}
            >
              {d.tradeCustomsPaneCreate}
            </Button>
            <Button
              variant={pane === "hs" ? "primary" : "secondary"}
              size="sm"
              aria-current={pane === "hs"}
              onClick={() => setPane("hs")}
            >
              {d.tradeCustomsPaneHs}
            </Button>
          </>
        ) : null}
      </div>

      {error !== null ? <ErrorNotice>{error}</ErrorNotice> : null}
      {notice !== null ? <SuccessNotice>{notice}</SuccessNotice> : null}

      {pane === "register" ? (
        <>
          <Card
            title={d.tradeCustomsTitle}
            description={d.tradeCustomsSubtitle}
            actions={
              <Button
                variant="secondary"
                size="sm"
                loading={listLoading}
                onClick={() => void loadDeclarations()}
              >
                {d.tradeRefresh}
              </Button>
            }
          >
            <p className="text-sm text-gray-600">{d.tradeCustomsSubtitle}</p>
          </Card>

          {declarationsRefusal !== null ? (
            <TypedRefusalPanel
              error={declarationsRefusal}
              title={d.tradeRefusalTitle}
              detailsLabel={d.tradeRefusalDetails}
            />
          ) : null}

          {declarationsRefusal === null && declarations !== null ? (
            declarations.length === 0 ? (
              <p className="text-sm text-gray-600">{d.tradeEmpty}</p>
            ) : (
              <DataTable
                columns={declarationColumns}
                rows={[...declarations]}
                rowKey={(row) => row.id}
                rowActions={[
                  {
                    id: "open",
                    label: d.commonOpen,
                    onSelect: (row: TradeDeclarationRow) => void openDeclaration(row.id),
                  },
                ]}
              />
            )
          ) : null}
        </>
      ) : null}

      {pane === "create" ? (
        <Card title={d.tradeCustomsCreateTitle} description={d.tradeCustomsSubtitle}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Select
              label={d.tradeCustomsCreateType}
              value={declarationType}
              onValueChange={(value) => setDeclarationType(value as typeof declarationType)}
              options={[
                { value: "IMPORT", label: d.tradeDeclarationTypeImport },
                { value: "EXPORT", label: d.tradeDeclarationTypeExport },
                { value: "TRANSIT", label: d.tradeDeclarationTypeTransit },
              ]}
            />
            <Input label={d.tradeCustomsCreateOffice} value={customsOffice} onValueChange={setCustomsOffice} required />
            <Input label={d.tradeCustomsCreateCurrency} value={currency} onValueChange={(v) => setCurrency(v.toUpperCase())} mono bidiIsolate required />
            <Input label={d.tradeCustomsCreateReceipt} value={receiptId} onValueChange={setReceiptId} mono bidiIsolate />
            <Input label={d.tradeCustomsCreatePo} value={purchaseOrderId} onValueChange={setPurchaseOrderId} mono bidiIsolate />
            <Input label={d.tradeCustomsCreateBl} value={billOfLadingId} onValueChange={setBillOfLadingId} mono bidiIsolate />
          </div>

          {/* THE LINES EDITOR — the duty/VAT line fold's own form */}
          <div className="mt-4 flex flex-col gap-3">
            <h3 className="text-sm font-semibold">{d.tradeCustomsLinesTitle}</h3>
            {lines.map((line, index) => (
              <div key={index} className="grid gap-2 rounded-md border border-subtle p-3 sm:grid-cols-3">
                <Input
                  label={d.tradeCustomsLineHs}
                  value={line.hsCode}
                  onValueChange={(value) =>
                    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, hsCode: value } : l)))
                  }
                  mono
                  bidiIsolate
                  required
                />
                <Input
                  label={d.tradeCustomsLineOrigin}
                  value={line.originCountry}
                  onValueChange={(value) =>
                    setLines((prev) =>
                      prev.map((l, i) => (i === index ? { ...l, originCountry: value.toUpperCase() } : l)),
                    )
                  }
                  mono
                  bidiIsolate
                />
                <Input
                  label={d.tradeCustomsLineItem}
                  value={line.itemId}
                  onValueChange={(value) =>
                    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, itemId: value } : l)))
                  }
                  mono
                  bidiIsolate
                />
                <Input
                  label={d.tradeCustomsLineDesc}
                  value={line.description}
                  onValueChange={(value) =>
                    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, description: value } : l)))
                  }
                  required
                />
                <Input
                  label={d.tradeCustomsLineQty}
                  value={line.quantity}
                  onValueChange={(value) =>
                    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, quantity: value } : l)))
                  }
                  inputMode="decimal"
                  mono
                />
                <Input
                  label={d.tradeCustomsLineUom}
                  value={line.uom}
                  onValueChange={(value) =>
                    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, uom: value } : l)))
                  }
                />
                <Input
                  label={d.tradeCustomsLineValue}
                  value={line.customsValue}
                  onValueChange={(value) =>
                    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, customsValue: value } : l)))
                  }
                  inputMode="decimal"
                  mono
                  required
                />
                <Input
                  label={d.tradeCustomsLineDutyRate}
                  value={line.dutyRate}
                  onValueChange={(value) =>
                    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, dutyRate: value } : l)))
                  }
                  inputMode="decimal"
                  mono
                  required
                />
                <Input
                  label={d.tradeCustomsLineVat}
                  value={line.importVat}
                  onValueChange={(value) =>
                    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, importVat: value } : l)))
                  }
                  inputMode="decimal"
                  mono
                  required
                />
                {lines.length > 1 ? (
                  <div className="flex items-end">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setLines((prev) => prev.filter((_, i) => i !== index))}
                    >
                      {d.purchasingRemoveLine}
                    </Button>
                  </div>
                ) : null}
              </div>
            ))}
            <div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setLines((prev) => [...prev, { ...EMPTY_LINE }])}
              >
                {d.tradeCustomsAddLine}
              </Button>
            </div>
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <Button
              variant="primary"
              loading={busy === "create"}
              disabled={!createReady}
              onClick={() => void createDeclaration()}
            >
              {d.tradePaneCreate}
            </Button>
          </div>
        </Card>
      ) : null}

      {pane === "hs" ? (
        <>
          <Card title={d.tradeCustomsPaneHs} description={d.tradeHsDisclaimer}>
            <p className="text-sm text-gray-600">{d.tradeHsDisclaimer}</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <Input label={d.tradeHsCreateCode} value={hsCode} onValueChange={setHsCode} mono bidiIsolate required />
              <Input label={d.tradeHsCreateName} value={hsName} onValueChange={setHsName} required />
              <Input label={d.tradeHsCreateNameAr} value={hsNameAr} onValueChange={setHsNameAr} required />
            </div>
            <div className="mt-3 flex justify-end">
              <Button variant="primary" size="sm" loading={busy === "hs"} onClick={() => void createHs()}>
                {d.tradePaneCreate}
              </Button>
            </div>
          </Card>

          {hsRefusal !== null ? (
            <TypedRefusalPanel
              error={hsRefusal}
              title={d.tradeRefusalTitle}
              detailsLabel={d.tradeRefusalDetails}
            />
          ) : null}

          {hsRefusal === null && hs !== null ? (
            hs.length === 0 ? (
              <p className="text-sm text-gray-600">{d.tradeEmpty}</p>
            ) : (
              <DataTable
                columns={[
                  {
                    id: "code",
                    header: activeLocaleHeader(d.tradeHsColCode),
                    accessor: (row) => row.hsCode,
                    render: (row) => monoCell(row.hsCode),
                  },
                  {
                    id: "name",
                    header: activeLocaleHeader(d.tradeHsColName),
                    accessor: (row) => localizedName(row.name, row.nameAr, locale),
                  },
                  {
                    id: "active",
                    header: activeLocaleHeader(d.tradeHsColActive),
                    accessor: (row) => (row.isActive ? d.tradeLcYes : d.tradeLcNo),
                  },
                ]}
                rows={[...hs]}
                rowKey={(row) => row.id}
              />
            )
          ) : null}
        </>
      ) : null}

      {/* the detail chain — the find's own output (the lines + the fold's totals) */}
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
            title={`${detail.declaration.declarationNo} · ${tradeDeclarationStatusLabel(d, detail.declaration.status)}`}
            description={d.tradeCustomsPaneDetail}
            actions={
              canManage ? (
                <div className="flex flex-wrap gap-2">
                  {detail.declaration.status === "DRAFT" ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={busy === `submit-${detail.declaration.id}`}
                      onClick={() => void runLadderAct(detail.declaration.id, "submit", {})}
                    >
                      {d.tradeCustomsActSubmit}
                    </Button>
                  ) : null}
                  {detail.declaration.status === "SUBMITTED" ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={busy === `accept-${detail.declaration.id}`}
                      onClick={() => void runLadderAct(detail.declaration.id, "accept", {})}
                    >
                      {d.tradeCustomsActAccept}
                    </Button>
                  ) : null}
                  {detail.declaration.status === "ACCEPTED" ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={busy === `complete-${detail.declaration.id}`}
                      onClick={() => void runLadderAct(detail.declaration.id, "complete", {})}
                    >
                      {d.tradeCustomsActComplete}
                    </Button>
                  ) : null}
                  {detail.declaration.status === "DRAFT" || detail.declaration.status === "SUBMITTED" ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={busy === `cancel-${detail.declaration.id}`}
                      onClick={() => void runLadderAct(detail.declaration.id, "cancel", {})}
                    >
                      {d.tradeCustomsActCancel}
                    </Button>
                  ) : null}
                </div>
              ) : undefined
            }
          >
            {/* the fold's totals — from the LINES at every read (the find's own output) */}
            <h3 className="text-sm font-semibold">{d.tradeCustomsTotalsTitle}</h3>
            <dl className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="flex flex-col gap-1">
                <dt className="text-xs text-muted-foreground">{d.tradeCustomsTotalValue}</dt>
                <dd className="font-mono tabular-nums" dir="ltr">{detail.totals.totalCustomsValue}</dd>
              </div>
              <div className="flex flex-col gap-1">
                <dt className="text-xs text-muted-foreground">{d.tradeCustomsTotalDuty}</dt>
                <dd className="font-mono tabular-nums" dir="ltr">{detail.totals.totalDuty}</dd>
              </div>
              <div className="flex flex-col gap-1">
                <dt className="text-xs text-muted-foreground">{d.tradeCustomsTotalVat}</dt>
                <dd className="font-mono tabular-nums" dir="ltr">{detail.totals.totalImportVat}</dd>
              </div>
              <div className="flex flex-col gap-1">
                <dt className="text-xs text-muted-foreground">{d.tradeCustomsTotalLanded}</dt>
                <dd className="font-mono tabular-nums" dir="ltr">{detail.totals.totalLandedAmount}</dd>
              </div>
            </dl>
          </Card>

          {/* the declaration's own lines (the find's own chain) */}
          <Card title={d.tradeCustomsLinesTitle}>
            {detail.lines.length === 0 ? (
              <p className="text-sm text-gray-600">{d.tradeEmpty}</p>
            ) : (
              <DataTable
                columns={[
                  {
                    id: "lineNo",
                    header: activeLocaleHeader(d.mfgBomLineNo),
                    accessor: (row) => String(row.lineNo),
                    render: (row) => monoCell(String(row.lineNo)),
                  },
                  {
                    id: "hs",
                    header: activeLocaleHeader(d.tradeCustomsLineHs),
                    accessor: (row) => row.hsCode,
                    render: (row) => monoCell(row.hsCode),
                  },
                  {
                    id: "origin",
                    header: activeLocaleHeader(d.tradeCustomsLineOrigin),
                    accessor: (row) => row.originCountry ?? "—",
                    render: (row) => dashIfNull(row.originCountry),
                  },
                  {
                    id: "desc",
                    header: activeLocaleHeader(d.tradeCustomsLineDesc),
                    accessor: (row) => row.description ?? "—",
                  },
                  {
                    id: "value",
                    header: activeLocaleHeader(d.tradeCustomsLineValue),
                    accessor: (row) => row.customsValue,
                    numeric: true,
                    render: (row) => monoCell(row.customsValue),
                  },
                  {
                    id: "duty",
                    header: activeLocaleHeader(d.tradeCustomsTotalDuty),
                    accessor: (row) => row.dutyAmount,
                    numeric: true,
                    render: (row) => monoCell(row.dutyAmount),
                  },
                  {
                    id: "vat",
                    header: activeLocaleHeader(d.tradeCustomsLineVat),
                    accessor: (row) => row.importVat,
                    numeric: true,
                    render: (row) => monoCell(row.importVat),
                  },
                ]}
                rows={[...detail.lines]}
                rowKey={(row) => row.id}
              />
            )}

            {/* the DRAFT-only add-line (the lines editor's own door) */}
            {canManage && detail.declaration.status === "DRAFT" ? (
              <div className="mt-4 grid gap-2 rounded-md border border-subtle p-3 sm:grid-cols-3">
                <Input label={d.tradeCustomsLineHs} value={addLine.hsCode} onValueChange={(value) => setAddLine((prev) => ({ ...prev, hsCode: value }))} mono bidiIsolate />
                <Input label={d.tradeCustomsLineOrigin} value={addLine.originCountry} onValueChange={(value) => setAddLine((prev) => ({ ...prev, originCountry: value.toUpperCase() }))} mono bidiIsolate />
                <Input label={d.tradeCustomsLineDesc} value={addLine.description} onValueChange={(value) => setAddLine((prev) => ({ ...prev, description: value }))} />
                <Input label={d.tradeCustomsLineQty} value={addLine.quantity} onValueChange={(value) => setAddLine((prev) => ({ ...prev, quantity: value }))} inputMode="decimal" mono />
                <Input label={d.tradeCustomsLineUom} value={addLine.uom} onValueChange={(value) => setAddLine((prev) => ({ ...prev, uom: value }))} />
                <Input label={d.tradeCustomsLineItem} value={addLine.itemId} onValueChange={(value) => setAddLine((prev) => ({ ...prev, itemId: value }))} mono bidiIsolate />
                <Input label={d.tradeCustomsLineValue} value={addLine.customsValue} onValueChange={(value) => setAddLine((prev) => ({ ...prev, customsValue: value }))} inputMode="decimal" mono />
                <Input label={d.tradeCustomsLineDutyRate} value={addLine.dutyRate} onValueChange={(value) => setAddLine((prev) => ({ ...prev, dutyRate: value }))} inputMode="decimal" mono />
                <Input label={d.tradeCustomsLineVat} value={addLine.importVat} onValueChange={(value) => setAddLine((prev) => ({ ...prev, importVat: value }))} inputMode="decimal" mono />
                <div className="flex items-end sm:col-span-3">
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={busy === `lines-${detail.declaration.id}`}
                    disabled={!lineValid(addLine)}
                    onClick={() => {
                      void runLadderAct(detail.declaration.id, "lines", {
                        line: {
                          hsCode: addLine.hsCode,
                          ...(addLine.originCountry !== "" ? { originCountry: addLine.originCountry } : {}),
                          ...(addLine.itemId !== "" ? { itemId: addLine.itemId } : {}),
                          description: addLine.description,
                          ...(addLine.quantity !== "" ? { quantity: addLine.quantity } : {}),
                          ...(addLine.uom !== "" ? { uom: addLine.uom } : {}),
                          customsValue: addLine.customsValue,
                          dutyRate: addLine.dutyRate,
                          importVat: addLine.importVat,
                        },
                      });
                      setAddLine({ ...EMPTY_LINE });
                    }}
                  >
                    {d.tradeCustomsActAddLine}
                  </Button>
                </div>
              </div>
            ) : null}
          </Card>
        </>
      ) : null}
    </div>
  );
}
