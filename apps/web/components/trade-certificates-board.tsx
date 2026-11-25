"use client";

/**
 * PHASE-051 (W-39 — T-14, D-13/D-17) — the certificates board (the
 * /trade/certificates screen body): the register + THE ISSUE ACT (the
 * frozen snapshot's own door — the goods lines with their origins, the
 * exporter/consignee, the linked B/L + declaration whose own figures
 * freeze at issuance) + the per-certificate print preview (the frozen
 * snapshot rendered VERBATIM through the buildTradeCertificateHtml
 * builder — ADR-0011: screen preview = paper) — the 050 COA board
 * pattern: the Dialog + <iframe srcDoc> + Print-now through
 * printHtmlDocument.
 *
 * THE ENGINE-OUTPUT LAW: the frozen snapshot renders VERBATIM — the
 * print payload builder reads the stored snapshot, never the live
 * declaration, never the live B/L, never a recomputed figure. The
 * board never recomputes a figure either.
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
import type { ApiErrorBody, TradeCertificateRow } from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { localizedTradeError } from "../lib/messages";
import { buildTradeCertificateHtml } from "../lib/trade-certificate-print";
import { printHtmlDocument } from "../lib/print-frame";
import { Card } from "./card";
import { ErrorNotice, SuccessNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";
import { TypedRefusalPanel } from "./typed-refusal-panel";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HS_RE = /^[0-9]{2,10}$/;
const ORIGIN_RE = /^[A-Z]{2}$/;
const QTY_RE = /^\d+(\.\d{1,6})?$/;

const CERT_TYPES = ["ORIGIN", "CONFORMITY"] as const;
type CertType = (typeof CERT_TYPES)[number];

interface GoodDraftLine {
  description: string;
  originCountry: string;
  hsCode: string;
  quantity: string;
  uom: string;
}

const EMPTY_GOOD: GoodDraftLine = {
  description: "",
  originCountry: "",
  hsCode: "",
  quantity: "",
  uom: "",
};

function goodValid(line: GoodDraftLine): boolean {
  return (
    line.description.trim().length > 0 &&
    ORIGIN_RE.test(line.originCountry) &&
    (line.hsCode === "" || HS_RE.test(line.hsCode)) &&
    (line.quantity === "" || QTY_RE.test(line.quantity))
  );
}

function monoCell(value: string, title?: string): JSX.Element {
  return (
    <span className="font-mono tabular-nums" dir="ltr" title={title ?? value}>
      {value}
    </span>
  );
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

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

export function TradeCertificatesBoard({
  locale,
  initialCertificates,
  certificatesError,
  canManage,
}: {
  locale: Locale;
  initialCertificates: readonly TradeCertificateRow[] | null;
  certificatesError: ApiErrorBody | null;
  canManage: boolean;
}): JSX.Element {
  const d = getDictionary(locale);
  const { toast } = useToast();

  // -- the pane switch (the data-slot shape — never the Tabs primitive) ----
  const [pane, setPane] = useState<"register" | "issue">("register");

  // -- the shared feedback ---------------------------------------------------
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // -- the register pane -------------------------------------------------------
  const [certificates, setCertificates] = useState<readonly TradeCertificateRow[] | null>(
    initialCertificates,
  );
  const [certificatesRefusal, setCertificatesRefusal] = useState<ApiErrorBody | null>(
    certificatesError,
  );
  const [listLoading, setListLoading] = useState(false);
  // The print preview — the SAME html the paper prints (ADR-0011).
  const [printHtml, setPrintHtml] = useState<string | null>(null);

  // -- the issue form -----------------------------------------------------------
  const [certType, setCertType] = useState<CertType>("ORIGIN");
  const [exporterName, setExporterName] = useState("");
  const [consigneeName, setConsigneeName] = useState("");
  const [billOfLadingId, setBillOfLadingId] = useState("");
  const [declarationId, setDeclarationId] = useState("");
  const [goods, setGoods] = useState<GoodDraftLine[]>([{ ...EMPTY_GOOD }]);

  const issueReady =
    exporterName.trim().length > 0 &&
    consigneeName.trim().length > 0 &&
    goods.length > 0 &&
    goods.every(goodValid) &&
    (billOfLadingId.trim() === "" || UUID_RE.test(billOfLadingId.trim())) &&
    (declarationId.trim() === "" || UUID_RE.test(declarationId.trim()));

  // -- the register read ----------------------------------------------------------
  async function loadCertificates(): Promise<void> {
    setListLoading(true);
    const result = await bffFetch<readonly TradeCertificateRow[]>("trade/certificates");
    setListLoading(false);
    if (!result.ok) {
      setCertificatesRefusal(result.error);
      setCertificates(null);
      return;
    }
    setCertificatesRefusal(null);
    setCertificates(result.data);
  }

  // -- THE ISSUE ACT (the frozen snapshot's own door — D-13's anchor) ---------------
  async function issueCertificate(): Promise<void> {
    if (!issueReady) {
      setError(d.errorsValidation);
      return;
    }
    setBusy("issue");
    setError(null);
    const result = await bffFetch<TradeCertificateRow>("trade/certificates", {
      method: "POST",
      body: {
        certType,
        exporterName,
        consigneeName,
        ...(billOfLadingId.trim() !== "" ? { billOfLadingId: billOfLadingId.trim() } : {}),
        ...(declarationId.trim() !== "" ? { declarationId: declarationId.trim() } : {}),
        goods: goods.map((line) => ({
          description: line.description,
          originCountry: line.originCountry,
          ...(line.hsCode !== "" ? { hsCode: line.hsCode } : {}),
          ...(line.quantity !== "" ? { quantity: line.quantity } : {}),
          ...(line.uom !== "" ? { uom: line.uom } : {}),
        })),
      },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedTradeError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setNotice(d.tradeCertificateIssuedToast);
    toast({ tone: "success", title: d.tradeCertificateIssuedToast });
    setGoods([{ ...EMPTY_GOOD }]);
    await loadCertificates();
    setPane("register");
  }

  /** The print preview — the payload builder's own html (the frozen snapshot
   * VERBATIM; docNo/docDate the certificate row's own strings). */
  function openPrintPreview(certificate: TradeCertificateRow): void {
    setPrintHtml(buildTradeCertificateHtml({ certificate, locale }));
  }

  // -- the register table ------------------------------------------------------------
  const certificateColumns: DataTableColumn<TradeCertificateRow>[] = [
    {
      id: "certificateNo",
      header: activeLocaleHeader(d.tradeCertificateColNo),
      accessor: (row) => row.certificateNo,
      render: (row) => monoCell(row.certificateNo),
    },
    {
      id: "certType",
      header: activeLocaleHeader(d.tradeCertificateColType),
      accessor: (row) => row.certType,
      render: (row) => (
        <Chip tone="info">
          {row.certType === "CONFORMITY"
            ? d.tradeCertificateTypeConformity
            : d.tradeCertificateTypeOrigin}
        </Chip>
      ),
    },
    {
      id: "issuedAt",
      header: activeLocaleHeader(d.tradeCertificateColIssuedAt),
      accessor: (row) => row.issuedAt,
      render: (row) => monoCell(row.issuedAt),
    },
    {
      id: "bl",
      header: activeLocaleHeader(d.tradeCertificateColBl),
      accessor: (row) => row.billOfLadingId ?? "—",
      render: (row) =>
        row.billOfLadingId === null ? (
          <span className="text-xs text-gray-500">—</span>
        ) : (
          monoCell(shortId(row.billOfLadingId), row.billOfLadingId)
        ),
    },
    {
      id: "declaration",
      header: activeLocaleHeader(d.tradeCertificateColDeclaration),
      accessor: (row) => row.declarationId ?? "—",
      render: (row) =>
        row.declarationId === null ? (
          <span className="text-xs text-gray-500">—</span>
        ) : (
          monoCell(shortId(row.declarationId), row.declarationId)
        ),
    },
    {
      id: "actions",
      header: activeLocaleHeader(d.tradeCertificatePrintAct),
      accessor: () => d.tradeCertificatePrintAct,
      render: (row) => (
        <Button variant="secondary" size="sm" onClick={() => openPrintPreview(row)}>
          {d.tradeCertificatePrintAct}
        </Button>
      ),
    },
  ];

  // -- the render -----------------------------------------------------------------------

  return (
    <div className="flex flex-col gap-4">
      {/* the pane switch — the data-slot shape (no Tabs primitive) */}
      <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label={d.tradeCertificatesTitle}>
        <Button
          variant={pane === "register" ? "primary" : "secondary"}
          size="sm"
          aria-current={pane === "register"}
          onClick={() => setPane("register")}
        >
          {d.tradeCertificatesPaneRegister}
        </Button>
        {canManage ? (
          <Button
            variant={pane === "issue" ? "primary" : "secondary"}
            size="sm"
            aria-current={pane === "issue"}
            onClick={() => setPane("issue")}
          >
            {d.tradeCertificatesPaneIssue}
          </Button>
        ) : null}
      </div>

      {error !== null ? <ErrorNotice>{error}</ErrorNotice> : null}
      {notice !== null ? <SuccessNotice>{notice}</SuccessNotice> : null}

      {pane === "register" ? (
        <>
          <Card
            title={d.tradeCertificatesTitle}
            description={d.tradeCertificatesSubtitle}
            actions={
              <Button
                variant="secondary"
                size="sm"
                loading={listLoading}
                onClick={() => void loadCertificates()}
              >
                {d.tradeRefresh}
              </Button>
            }
          >
            <p className="text-sm text-gray-600">{d.tradeCertificatesSubtitle}</p>
          </Card>

          {certificatesRefusal !== null ? (
            <TypedRefusalPanel
              error={certificatesRefusal}
              title={d.tradeRefusalTitle}
              detailsLabel={d.tradeRefusalDetails}
            />
          ) : null}

          {certificatesRefusal === null && certificates !== null ? (
            certificates.length === 0 ? (
              <p className="text-sm text-gray-600">{d.tradeEmpty}</p>
            ) : (
              <DataTable
                columns={certificateColumns}
                rows={[...certificates]}
                rowKey={(row) => row.id}
              />
            )
          ) : null}
        </>
      ) : (
        <Card title={d.tradeCertificateIssueTitle} description={d.tradeCertificatesSubtitle}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Select
              label={d.tradeCertificateIssueType}
              value={certType}
              onValueChange={(value) => setCertType(value as CertType)}
              options={CERT_TYPES.map((type) => ({
                value: type,
                label:
                  type === "ORIGIN"
                    ? d.tradeCertificateTypeOrigin
                    : d.tradeCertificateTypeConformity,
              }))}
            />
            <div />
            <Input label={d.tradeCertificateIssueExporter} value={exporterName} onValueChange={setExporterName} required />
            <Input label={d.tradeCertificateIssueConsignee} value={consigneeName} onValueChange={setConsigneeName} required />
            <Input label={d.tradeCertificateIssueBl} value={billOfLadingId} onValueChange={setBillOfLadingId} mono bidiIsolate />
            <Input label={d.tradeCertificateIssueDeclaration} value={declarationId} onValueChange={setDeclarationId} mono bidiIsolate />
          </div>

          {/* THE GOODS LINES — the chamber certificate's own declaration of
              origin (each line's origin rides the frozen snapshot). */}
          <div className="mt-4 flex flex-col gap-2">
            <h3 className="text-sm font-semibold">{d.tradeCertificateGoodsTitle}</h3>
            {goods.map((line, index) => (
              <div key={index} className="grid gap-2 rounded-md border border-subtle p-3 sm:grid-cols-5">
                <Input
                  label={d.tradeCertificateGoodsDesc}
                  value={line.description}
                  onValueChange={(value) =>
                    setGoods((prev) => prev.map((l, i) => (i === index ? { ...l, description: value } : l)))
                  }
                  required
                />
                <Input
                  label={d.tradeCertificateGoodsOrigin}
                  value={line.originCountry}
                  onValueChange={(value) =>
                    setGoods((prev) =>
                      prev.map((l, i) => (i === index ? { ...l, originCountry: value.toUpperCase() } : l)),
                    )
                  }
                  mono
                  bidiIsolate
                  required
                />
                <Input
                  label={d.tradeCertificateGoodsHs}
                  value={line.hsCode}
                  onValueChange={(value) =>
                    setGoods((prev) => prev.map((l, i) => (i === index ? { ...l, hsCode: value } : l)))
                  }
                  mono
                  bidiIsolate
                />
                <Input
                  label={d.tradeCertificateGoodsQty}
                  value={line.quantity}
                  onValueChange={(value) =>
                    setGoods((prev) => prev.map((l, i) => (i === index ? { ...l, quantity: value } : l)))
                  }
                  inputMode="decimal"
                  mono
                />
                <Input
                  label={d.tradeCertificateGoodsUom}
                  value={line.uom}
                  onValueChange={(value) =>
                    setGoods((prev) => prev.map((l, i) => (i === index ? { ...l, uom: value } : l)))
                  }
                />
                {goods.length > 1 ? (
                  <div className="flex items-end">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setGoods((prev) => prev.filter((_, i) => i !== index))}
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
                onClick={() => setGoods((prev) => [...prev, { ...EMPTY_GOOD }])}
              >
                {d.tradeCertificateAddGood}
              </Button>
            </div>
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <Button
              variant="primary"
              loading={busy === "issue"}
              disabled={!issueReady}
              onClick={() => void issueCertificate()}
            >
              {d.tradePaneIssue}
            </Button>
          </div>
        </Card>
      )}

      {/* the print preview — the SAME html the paper prints (ADR-0011:
          screen preview and paper cannot diverge). */}
      <Dialog
        open={printHtml !== null}
        onOpenChange={(open) => {
          if (!open) setPrintHtml(null);
        }}
        title={d.tradeCertificatePrintTitle}
        size="lg"
      >
        {printHtml !== null ? (
          <div className="flex flex-col gap-3">
            <div className="flex justify-end">
              <Button variant="primary" size="sm" onClick={() => printHtmlDocument(printHtml)}>
                {d.tradeCertificatePrintNow}
              </Button>
            </div>
            <iframe
              srcDoc={printHtml}
              title={d.tradeCertificatePrintTitle}
              className="h-[70vh] w-full rounded-md border border-subtle bg-white"
            />
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}
