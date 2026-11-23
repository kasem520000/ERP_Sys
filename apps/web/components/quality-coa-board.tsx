"use client";

/**
 * PHASE-050 (W-29 — T-15) — the COA board (the /quality/coa screen body):
 * the certificates register + the generate act (BR-104's gate door with the
 * full-coverage parameters) + per-certificate the print preview — cloned
 * from the W-21 meters-board pattern and the W-13 projects-contracting
 * preview precedent (Dialog + <iframe srcDoc> + Print-now through
 * printHtmlDocument — ADR-0011: screen preview = paper).
 *
 * THE ENGINE-OUTPUT LAW: the frozen parameters snapshot renders VERBATIM —
 * the print payload builder (lib/coa-print.ts) reads the stored snapshot,
 * never the live specs and never a recomputed verdict. The board never
 * recomputes a figure either.
 */
import { useMemo, useState } from "react";
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
  CoaDocumentRow,
  ItemRow,
  QualitySpecRow,
} from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { localizedQualityError, localizedName } from "../lib/messages";
import { buildCoaDocumentHtml } from "../lib/coa-print";
import { printHtmlDocument } from "../lib/print-frame";
import { Card } from "./card";
import { ErrorNotice, SuccessNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";
import { TypedRefusalPanel } from "./typed-refusal-panel";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Values ≤ 6dp (the engine's own floor — the measured values). */
const VALUE_RE = /^-?\d+(\.\d{1,6})?$/;

const COA_DOC_TYPES = ["COA", "COC"] as const;
type CoaDocType = (typeof COA_DOC_TYPES)[number];

function shortId(id: string): string {
  return id.slice(0, 8);
}

function monoCell(value: string, title?: string): JSX.Element {
  return (
    <span className="font-mono tabular-nums" dir="ltr" title={title ?? value}>
      {value}
    </span>
  );
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
function Chip({ tone, children }: { tone: ChipTone; children: string }): JSX.Element {
  return (
    <span
      className={`inline-flex w-fit items-center rounded-sm border px-1.5 py-0.5 text-xs leading-4 ${CHIP_TONE_CLASSES[tone]}`}
    >
      {children}
    </span>
  );
}

export function QualityCoaBoard({
  locale,
  initialCertificates,
  certificatesError,
  items,
}: {
  locale: Locale;
  initialCertificates: readonly CoaDocumentRow[] | null;
  certificatesError: ApiErrorBody | null;
  items: readonly ItemRow[];
}): JSX.Element {
  const d = getDictionary(locale);
  const { toast } = useToast();

  // -- the pane switch (the data-slot shape — never the Tabs primitive) ------
  const [pane, setPane] = useState<"certificates" | "generate">("certificates");

  // -- the shared feedback ---------------------------------------------------
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // -- the certificates pane ---------------------------------------------------
  const [certificates, setCertificates] = useState<readonly CoaDocumentRow[] | null>(
    initialCertificates,
  );
  const [certificatesRefusal, setCertificatesRefusal] = useState<ApiErrorBody | null>(
    certificatesError,
  );
  const [listLoading, setListLoading] = useState(false);
  // The print preview — the SAME html the paper prints (ADR-0011).
  const [printHtml, setPrintHtml] = useState<string | null>(null);

  // -- the generate pane ---------------------------------------------------------
  const [docType, setDocType] = useState<CoaDocType>("COA");
  const [itemId, setItemId] = useState("");
  const [batchId, setBatchId] = useState("");
  const [inspectionId, setInspectionId] = useState("");
  const [specs, setSpecs] = useState<readonly QualitySpecRow[]>([]);
  const [specsLoading, setSpecsLoading] = useState(false);
  const [specsRefusal, setSpecsRefusal] = useState<ApiErrorBody | null>(null);
  const [valuesBySpec, setValuesBySpec] = useState<Record<string, string>>({});

  const itemLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of items) {
      map.set(item.id, `${item.sku} · ${localizedName(item.name, item.nameAr, locale)}`);
    }
    return map;
  }, [items, locale]);

  // BR-104's coverage law at the form's own floor: every ACTIVE spec of the
  // item measured exactly once (a missing value never posts).
  const generateReady =
    itemId !== "" &&
    specs.length > 0 &&
    specs.every((spec) => VALUE_RE.test(valuesBySpec[spec.id] ?? "")) &&
    (batchId === "" || UUID_RE.test(batchId.trim())) &&
    (inspectionId === "" || UUID_RE.test(inspectionId.trim()));

  // -- the certificates list ------------------------------------------------------

  async function loadCertificates(): Promise<void> {
    setListLoading(true);
    const result = await bffFetch<readonly CoaDocumentRow[]>("quality/coa");
    setListLoading(false);
    if (!result.ok) {
      setCertificatesRefusal(result.error);
      setCertificates(null);
      return;
    }
    setCertificatesRefusal(null);
    setCertificates(result.data);
  }

  /** The picked item's ACTIVE specs (the coverage law's own register read). */
  async function pickItem(value: string): Promise<void> {
    setItemId(value);
    setValuesBySpec({});
    setSpecs([]);
    setSpecsRefusal(null);
    if (value === "") {
      return;
    }
    setSpecsLoading(true);
    const result = await bffFetch<readonly QualitySpecRow[]>(
      `quality/specifications?itemId=${encodeURIComponent(value)}&activeOnly=true`,
    );
    setSpecsLoading(false);
    if (!result.ok) {
      setSpecsRefusal(result.error);
      setSpecs([]);
      return;
    }
    setSpecs(result.data);
  }

  /** THE GENERATE ACT — BR-104's own door (the gate's refusals name the
   * parameter and both figures; the frozen snapshot lands verbatim). */
  async function generateCertificate(): Promise<void> {
    if (!generateReady) {
      setError(d.errorsValidation);
      return;
    }
    setBusy("generate");
    setError(null);
    const result = await bffFetch<CoaDocumentRow>("quality/coa", {
      method: "POST",
      body: {
        docType,
        itemId,
        ...(batchId.trim() !== "" ? { batchId: batchId.trim() } : {}),
        ...(inspectionId.trim() !== "" ? { inspectionId: inspectionId.trim() } : {}),
        parameters: specs.map((spec) => ({ specId: spec.id, value: valuesBySpec[spec.id] ?? "" })),
      },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedQualityError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setNotice(d.qualityCoaGeneratedToast);
    toast({ tone: "success", title: d.qualityCoaGeneratedToast });
    // The register refetches (the new certificate's own place is the engine's).
    await loadCertificates();
    setPane("certificates");
  }

  /** The print preview — the payload builder's own html (the frozen snapshot
   * VERBATIM; the docNo/docDate the certificate row's own strings). */
  function openPrintPreview(certificate: CoaDocumentRow): void {
    setPrintHtml(buildCoaDocumentHtml({ certificate, locale }));
  }

  // -- the certificates table -------------------------------------------------------

  const certificateColumns: DataTableColumn<CoaDocumentRow>[] = [
    {
      id: "docNo",
      header: activeLocaleHeader(d.qualityCoaColNo),
      accessor: (row) => row.docNo,
      render: (row) => monoCell(row.docNo),
    },
    {
      id: "docType",
      header: activeLocaleHeader(d.qualityCoaColType),
      accessor: (row) => row.docType,
      render: (row) => <Chip tone="info">{row.docType}</Chip>,
    },
    {
      id: "item",
      header: activeLocaleHeader(d.qualityCoaColItem),
      accessor: (row) => itemLabelById.get(row.itemId) ?? shortId(row.itemId),
    },
    {
      id: "batch",
      header: activeLocaleHeader(d.qualityCoaColBatch),
      accessor: (row) => row.batchId ?? "—",
      render: (row) =>
        row.batchId === null ? (
          <span className="text-xs text-gray-500">—</span>
        ) : (
          monoCell(shortId(row.batchId), row.batchId)
        ),
    },
    {
      id: "issuedAt",
      header: activeLocaleHeader(d.qualityCoaColIssuedAt),
      accessor: (row) => row.issuedAt,
      render: (row) => monoCell(row.issuedAt),
    },
    {
      id: "actions",
      header: activeLocaleHeader(d.qualityCoaPrintAct),
      accessor: () => d.qualityCoaPrintAct,
      render: (row) => (
        <Button variant="secondary" size="sm" onClick={() => openPrintPreview(row)}>
          {d.qualityCoaPrintAct}
        </Button>
      ),
    },
  ];

  // -- the render -----------------------------------------------------------------

  return (
    <div className="flex flex-col gap-4">
      {/* the pane switch — the data-slot shape (no Tabs primitive) */}
      <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label={d.qualityCoaTitle}>
        <Button
          variant={pane === "certificates" ? "primary" : "secondary"}
          size="sm"
          aria-current={pane === "certificates"}
          onClick={() => setPane("certificates")}
        >
          {d.qualityCoaPaneCertificates}
        </Button>
        <Button
          variant={pane === "generate" ? "primary" : "secondary"}
          size="sm"
          aria-current={pane === "generate"}
          onClick={() => setPane("generate")}
        >
          {d.qualityCoaPaneGenerate}
        </Button>
      </div>

      {error !== null ? <ErrorNotice>{error}</ErrorNotice> : null}
      {notice !== null ? <SuccessNotice>{notice}</SuccessNotice> : null}

      {pane === "certificates" ? (
        <>
          <Card
            title={d.qualityCoaPaneCertificates}
            description={d.qualityCoaSubtitle}
            actions={
              <Button
                variant="secondary"
                size="sm"
                loading={listLoading}
                onClick={() => void loadCertificates()}
              >
                {d.qualityRefresh}
              </Button>
            }
          >
            <p className="text-sm text-gray-600">{d.qualityCoaSubtitle}</p>
          </Card>

          {listLoading ? <p className="text-sm text-gray-600">…</p> : null}

          {certificatesRefusal !== null ? (
            <TypedRefusalPanel
              error={certificatesRefusal}
              title={d.qualityRefusalTitle}
              detailsLabel={d.qualityRefusalDetails}
            />
          ) : null}

          {certificatesRefusal === null && certificates !== null ? (
            certificates.length === 0 ? (
              <p className="text-sm text-gray-600">{d.qualityCoaEmpty}</p>
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
        <Card title={d.qualityCoaGenerateTitle} description={d.qualityCoaSubtitle}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Select
              label={d.qualityCoaGenerateDocType}
              value={docType}
              onValueChange={(value) => setDocType(value as CoaDocType)}
              placeholder="COA"
              options={COA_DOC_TYPES.map((type) => ({
                value: type,
                label: type === "COA" ? d.qualityCoaDocTypeCoa : d.qualityCoaDocTypeCoc,
              }))}
            />
            <Select
              label={d.qualityCoaColItem}
              value={itemId}
              onValueChange={(value) => void pickItem(value)}
              placeholder="—"
              options={items.map((item) => ({
                value: item.id,
                label: itemLabelById.get(item.id) ?? item.sku,
              }))}
              required
            />
            <Input
              label={d.qualityCoaColBatch}
              value={batchId}
              onValueChange={setBatchId}
              mono
              bidiIsolate
            />
            <Input
              label={d.qualityCoaGenerateInspection}
              value={inspectionId}
              onValueChange={setInspectionId}
              mono
              bidiIsolate
            />
          </div>

          {/* THE PARAMETERS — the coverage law's own form (every ACTIVE spec
              of the item measured exactly once). */}
          <div className="mt-4 flex flex-col gap-2">
            <h3 className="text-sm font-semibold">{d.qualityCoaGenerateParameters}</h3>
            {specsLoading ? <p className="text-sm text-gray-600">…</p> : null}
            {specsRefusal !== null ? (
              <TypedRefusalPanel
                error={specsRefusal}
                title={d.qualityRefusalTitle}
                detailsLabel={d.qualityRefusalDetails}
              />
            ) : null}
            {specsRefusal === null && !specsLoading && specs.length === 0 ? (
              <p className="text-sm text-gray-600">{d.qualityCoaGenerateNoSpecs}</p>
            ) : null}
            {specs.map((spec) => (
              <div key={spec.id} className="grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col justify-end">
                  <span className="text-sm text-gray-700">
                    {localizedName(spec.parameter, spec.parameterAr, locale)}
                    {spec.unit !== null ? (
                      <span className="ms-1 text-xs text-gray-500">({spec.unit})</span>
                    ) : null}
                  </span>
                </div>
                <Input
                  label={d.qualityCoaGenerateValue}
                  value={valuesBySpec[spec.id] ?? ""}
                  onValueChange={(value) =>
                    setValuesBySpec((prev) => ({ ...prev, [spec.id]: value }))
                  }
                  inputMode="decimal"
                  mono
                  required
                />
              </div>
            ))}
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <Button
              variant="primary"
              loading={busy === "generate"}
              disabled={!generateReady}
              onClick={() => void generateCertificate()}
            >
              {d.qualityCoaGenerateAct}
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
        title={d.qualityCoaPrintTitle}
        size="lg"
      >
        {printHtml !== null ? (
          <div className="flex flex-col gap-3">
            <div className="flex justify-end">
              <Button variant="primary" size="sm" onClick={() => printHtmlDocument(printHtml)}>
                {d.qualityCoaPrintNow}
              </Button>
            </div>
            <iframe
              srcDoc={printHtml}
              title={d.qualityCoaPrintTitle}
              className="h-[70vh] w-full rounded-md border border-subtle bg-white"
            />
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}
