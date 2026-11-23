"use client";

/**
 * PHASE-050 (W-29 — T-15) — the SPC board (the /quality/spc screen body):
 * the specification sample store + the X-bar/R chart read — cloned from the
 * W-21 meters-board pattern (the data-slot shape, two panes on a segmented
 * switch, never the Tabs primitive).
 *
 * THE ZERO-PARALLEL-COMPUTATION LAW (D-12's own core): every chart figure
 * is the PURE module's output rendered VERBATIM — grandMean, R̄, both
 * charts' limits, σ̂, Cp, Cpk, the excluded count, the out-of-control flags.
 * NO client charting library, NO recomputation — the figures are strings
 * rendered as-is (`.num`-style LTR-mono isolation on screen, the W-13 print
 * law's sibling).
 *
 * THE SAMPLES' PROVENANCE: the measurements draw from the specifications'
 * parameters (the spec_id FK is the ONLY parameter source); the sample
 * store carries NO DELETE — corrections are new samples, never rewrites.
 */
import { useMemo, useState } from "react";
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
  QualitySpecRow,
  SpcChartRow,
  SpcMeasurementRow,
} from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import {
  localizedQualityError,
  localizedSpcSource,
  localizedName,
} from "../lib/messages";
import { Card } from "./card";
import { DefList } from "./def-list";
import { ErrorNotice, SuccessNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";
import { TypedRefusalPanel } from "./typed-refusal-panel";

/** Values ≤ 6dp (the 0113 column's own shape; negatives legal). */
const VALUE_RE = /^-?\d+(\.\d{1,6})?$/;
const STAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SPC_SOURCES = ["MANUAL", "PRODUCTION", "INSPECTION"] as const;
type SpcSource = (typeof SPC_SOURCES)[number];

/** The ingest draft (the engine's own floor). */
interface IngestDraft {
  value: string;
  sampledAt: string;
  source: SpcSource;
  batchId: string;
  note: string;
}

const EMPTY_INGEST: IngestDraft = {
  value: "",
  sampledAt: "",
  source: "MANUAL",
  batchId: "",
  note: "",
};

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

export function QualitySpcBoard({
  locale,
  specs,
  initialSpecId,
  initialMeasurements,
  measurementsError,
}: {
  locale: Locale;
  specs: readonly QualitySpecRow[];
  initialSpecId: string | null;
  initialMeasurements: readonly SpcMeasurementRow[] | null;
  measurementsError: ApiErrorBody | null;
}): JSX.Element {
  const d = getDictionary(locale);
  const { toast } = useToast();

  // -- the pane switch (the data-slot shape — never the Tabs primitive) ------
  const [pane, setPane] = useState<"measurements" | "chart">("measurements");

  // -- the shared feedback ---------------------------------------------------
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // -- the spec picker (the paste path carries the screen when the pool
  //    degrades — the genealogy board's own rule) ------------------------------
  const [specId, setSpecId] = useState(initialSpecId ?? "");
  const [pastedSpecId, setPastedSpecId] = useState("");
  const activeSpecId = specId !== "" ? specId : pastedSpecId.trim();
  const activeSpec = useMemo(
    () => specs.find((spec) => spec.id === activeSpecId) ?? null,
    [specs, activeSpecId],
  );

  // -- the measurements pane ---------------------------------------------------
  const [measurements, setMeasurements] = useState<readonly SpcMeasurementRow[] | null>(
    initialMeasurements,
  );
  const [measurementsRefusal, setMeasurementsRefusal] = useState<ApiErrorBody | null>(
    measurementsError,
  );
  const [measurementsLoading, setMeasurementsLoading] = useState(false);
  const [ingest, setIngest] = useState<IngestDraft>({ ...EMPTY_INGEST });

  // -- the chart pane ------------------------------------------------------------
  const [subgroupSize, setSubgroupSize] = useState("5");
  const [chart, setChart] = useState<SpcChartRow | null>(null);
  const [chartRefusal, setChartRefusal] = useState<ApiErrorBody | null>(null);
  const [chartLoading, setChartLoading] = useState(false);

  const ingestReady =
    activeSpecId !== "" &&
    VALUE_RE.test(ingest.value) &&
    STAMP_RE.test(ingest.sampledAt) &&
    (ingest.batchId === "" || UUID_RE.test(ingest.batchId.trim()));

  const specLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const spec of specs) {
      map.set(
        spec.id,
        `${localizedName(spec.parameter, spec.parameterAr, locale)}${
          spec.unit !== null ? ` (${spec.unit})` : ""
        }`,
      );
    }
    return map;
  }, [specs, locale]);

  // -- the measurements read (the spec's own history) ---------------------------

  async function loadMeasurements(targetSpecId: string): Promise<void> {
    setMeasurementsLoading(true);
    const result = await bffFetch<readonly SpcMeasurementRow[]>(
      `quality/spc/measurements?specId=${encodeURIComponent(targetSpecId)}`,
    );
    setMeasurementsLoading(false);
    if (!result.ok) {
      setMeasurementsRefusal(result.error);
      setMeasurements(null);
      return;
    }
    setMeasurementsRefusal(null);
    setMeasurements(result.data);
  }

  function pickSpec(value: string): void {
    setSpecId(value);
    setChart(null);
    setChartRefusal(null);
    if (value !== "") {
      void loadMeasurements(value);
    } else {
      setMeasurements(null);
      setMeasurementsRefusal(null);
    }
  }

  function pickPastedSpec(value: string): void {
    setPastedSpecId(value);
    setChart(null);
    setChartRefusal(null);
    const trimmed = value.trim();
    if (trimmed !== "" && UUID_RE.test(trimmed)) {
      void loadMeasurements(trimmed);
    }
  }

  /** THE SAMPLE INGESTION (the 0113 store's ONLY writer through the API). */
  async function recordMeasurement(): Promise<void> {
    if (!ingestReady) {
      setError(d.errorsValidation);
      return;
    }
    setBusy("ingest");
    setError(null);
    const result = await bffFetch<SpcMeasurementRow>("quality/spc/measurements", {
      method: "POST",
      body: {
        specId: activeSpecId,
        value: ingest.value,
        sampledAt: ingest.sampledAt,
        source: ingest.source,
        ...(ingest.batchId.trim() !== "" ? { batchId: ingest.batchId.trim() } : {}),
        ...(ingest.note.trim() !== "" ? { note: ingest.note.trim() } : {}),
      },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedQualityError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setIngest({ ...EMPTY_INGEST });
    setNotice(d.qualitySpcIngestedToast);
    toast({ tone: "success", title: d.qualitySpcIngestedToast });
    // The sample store's read refetches (the chart's own history).
    if (activeSpecId !== "") {
      await loadMeasurements(activeSpecId);
    }
  }

  /** THE CHART READ: the pure module's output VERBATIM (never recomputed). */
  async function loadChart(): Promise<void> {
    if (activeSpecId === "" || !/^\d+$/.test(subgroupSize)) {
      setError(d.errorsValidation);
      return;
    }
    setChartLoading(true);
    const result = await bffFetch<SpcChartRow>(
      `quality/spc/charts/${encodeURIComponent(activeSpecId)}?subgroupSize=${encodeURIComponent(subgroupSize)}`,
    );
    setChartLoading(false);
    if (!result.ok) {
      setChartRefusal(result.error);
      setChart(null);
      return;
    }
    setChartRefusal(null);
    setChart(result.data);
  }

  // -- the measurements table -----------------------------------------------------

  const measurementColumns: DataTableColumn<SpcMeasurementRow>[] = [
    {
      id: "sampledAt",
      header: activeLocaleHeader(d.qualitySpcColSampledAt),
      accessor: (row) => row.sampledAt,
      render: (row) => monoCell(row.sampledAt),
    },
    {
      id: "value",
      header: activeLocaleHeader(d.qualitySpcColValue),
      accessor: (row) => row.value,
      render: (row) => monoCell(row.value),
    },
    {
      id: "source",
      header: activeLocaleHeader(d.qualitySpcColSource),
      accessor: (row) => localizedSpcSource(d, row.source),
    },
    {
      id: "batch",
      header: activeLocaleHeader(d.qualitySpcColBatch),
      accessor: (row) => row.batchId ?? "—",
      render: (row) =>
        row.batchId === null ? (
          <span className="text-xs text-gray-500">—</span>
        ) : (
          monoCell(shortId(row.batchId), row.batchId)
        ),
    },
    {
      id: "note",
      header: activeLocaleHeader(d.qualitySpcColNote),
      accessor: (row) => row.note ?? "—",
      render: (row) =>
        row.note === null ? <span className="text-xs text-gray-500">—</span> : (
          <span className="text-xs text-gray-600">{row.note}</span>
        ),
    },
  ];

  // -- the render -----------------------------------------------------------------

  return (
    <div className="flex flex-col gap-4">
      {/* the pane switch — the data-slot shape (no Tabs primitive) */}
      <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label={d.qualitySpcTitle}>
        <Button
          variant={pane === "measurements" ? "primary" : "secondary"}
          size="sm"
          aria-current={pane === "measurements"}
          onClick={() => setPane("measurements")}
        >
          {d.qualitySpcPaneMeasurements}
        </Button>
        <Button
          variant={pane === "chart" ? "primary" : "secondary"}
          size="sm"
          aria-current={pane === "chart"}
          onClick={() => setPane("chart")}
        >
          {d.qualitySpcPaneChart}
        </Button>
      </div>

      {error !== null ? <ErrorNotice>{error}</ErrorNotice> : null}
      {notice !== null ? <SuccessNotice>{notice}</SuccessNotice> : null}

      <Card title={d.qualitySpcTitle} description={d.qualitySpcSubtitle}>
        <div className="flex flex-wrap items-end gap-3">
          <Select
            label={d.qualitySpcSpec}
            value={specId}
            onValueChange={pickSpec}
            placeholder="—"
            options={specs.map((spec) => ({
              value: spec.id,
              label: specLabelById.get(spec.id) ?? spec.parameter,
            }))}
          />
          <div className="w-80">
            <Input
              label={d.qualitySpcSpecHint}
              value={pastedSpecId}
              onValueChange={pickPastedSpec}
              mono
              bidiIsolate
            />
          </div>
        </div>
        {activeSpec !== null ? (
          <div className="mt-3">
            <DefList
              items={[
                { term: d.qualitySpcSpecParameter, children: specLabelById.get(activeSpec.id) ?? activeSpec.parameter },
                { term: d.qualitySpcSpecTarget, children: monoCell(activeSpec.targetValue) },
                ...(activeSpec.ucl !== null
                  ? [{ term: d.qualitySpcSpecUcl, children: monoCell(activeSpec.ucl) }]
                  : []),
                ...(activeSpec.lcl !== null
                  ? [{ term: d.qualitySpcSpecLcl, children: monoCell(activeSpec.lcl) }]
                  : []),
              ]}
            />
          </div>
        ) : null}
      </Card>

      {pane === "measurements" ? (
        <>
          {measurementsLoading ? <p className="text-sm text-gray-600">…</p> : null}

          {measurementsRefusal !== null ? (
            <TypedRefusalPanel
              error={measurementsRefusal}
              title={d.qualityRefusalTitle}
              detailsLabel={d.qualityRefusalDetails}
            />
          ) : null}

          {measurementsRefusal === null && measurements !== null ? (
            measurements.length === 0 ? (
              <p className="text-sm text-gray-600">{d.qualitySpcEmpty}</p>
            ) : (
              <DataTable
                columns={measurementColumns}
                rows={[...measurements]}
                rowKey={(row) => row.id}
              />
            )
          ) : null}

          {/* THE SAMPLE INGESTION — the 0113 store's ONLY writer. */}
          <Card title={d.qualitySpcIngestTitle}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                label={d.qualitySpcColValue}
                value={ingest.value}
                onValueChange={(value) => setIngest((prev) => ({ ...prev, value: value }))}
                inputMode="decimal"
                mono
                required
              />
              <Input
                label={d.qualitySpcColSampledAt}
                value={ingest.sampledAt}
                onValueChange={(value) => setIngest((prev) => ({ ...prev, sampledAt: value }))}
                mono
                bidiIsolate
                hint="YYYY-MM-DDTHH:mm"
                required
              />
              <Select
                label={d.qualitySpcColSource}
                value={ingest.source}
                onValueChange={(value) =>
                  setIngest((prev) => ({ ...prev, source: value as SpcSource }))
                }
                placeholder="MANUAL"
                options={SPC_SOURCES.map((source) => ({
                  value: source,
                  label: localizedSpcSource(d, source),
                }))}
              />
              <Input
                label={d.qualitySpcColBatch}
                value={ingest.batchId}
                onValueChange={(value) => setIngest((prev) => ({ ...prev, batchId: value }))}
                mono
                bidiIsolate
              />
              <div className="sm:col-span-2">
                <Input
                  label={d.qualitySpcColNote}
                  value={ingest.note}
                  onValueChange={(value) => setIngest((prev) => ({ ...prev, note: value }))}
                />
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button
                variant="primary"
                loading={busy === "ingest"}
                disabled={!ingestReady}
                onClick={() => void recordMeasurement()}
              >
                {d.qualitySpcIngestAct}
              </Button>
            </div>
          </Card>
        </>
      ) : (
        <>
          <Card title={d.qualitySpcChartTitle}>
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-40">
                <Input
                  label={d.qualitySpcChartSubgroupSize}
                  value={subgroupSize}
                  onValueChange={setSubgroupSize}
                  inputMode="numeric"
                  mono
                  hint="2-10"
                />
              </div>
              <Button
                variant="primary"
                loading={chartLoading}
                disabled={activeSpecId === ""}
                onClick={() => void loadChart()}
              >
                {d.qualitySpcChartLoad}
              </Button>
            </div>
          </Card>

          {chartLoading ? <p className="text-sm text-gray-600">…</p> : null}

          {chartRefusal !== null ? (
            <TypedRefusalPanel
              error={chartRefusal}
              title={d.qualityRefusalTitle}
              detailsLabel={d.qualityRefusalDetails}
            />
          ) : null}

          {chartRefusal === null && chart !== null ? (
            <>
              {/* THE CHART FIGURES — the pure module's own strings, VERBATIM
                  (no charting library, no recomputation). */}
              <Card title={d.qualitySpcChartTitle}>
                <div className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    {chart.chart.outOfControl ? (
                      <Chip tone="danger">{d.qualitySpcOutOfControl}</Chip>
                    ) : (
                      <Chip tone="success">{d.qualitySpcInControl}</Chip>
                    )}
                    <span className="text-sm text-gray-600">
                      {d.qualitySpcChartSampleCount}: {monoCell(String(chart.sampleCount))}
                    </span>
                    <span className="text-sm text-gray-600">
                      {d.qualitySpcChartSubgroupSize}: {monoCell(String(chart.chart.subgroupSize))}
                    </span>
                  </div>
                  <DefList
                    items={[
                      { term: d.qualitySpcGrandMean, children: monoCell(chart.chart.grandMean) },
                      { term: d.qualitySpcRBar, children: monoCell(chart.chart.rBar) },
                      { term: d.qualitySpcXUcl, children: monoCell(chart.chart.xChart.ucl) },
                      { term: d.qualitySpcXLcl, children: monoCell(chart.chart.xChart.lcl) },
                      { term: d.qualitySpcRUcl, children: monoCell(chart.chart.rChart.ucl) },
                      { term: d.qualitySpcRLcl, children: monoCell(chart.chart.rChart.lcl) },
                      {
                        term: d.qualitySpcSigmaHat,
                        children:
                          chart.chart.sigmaHat === null ? (
                            <span className="text-xs text-gray-500">—</span>
                          ) : (
                            monoCell(chart.chart.sigmaHat)
                          ),
                      },
                      {
                        term: d.qualitySpcCp,
                        children:
                          chart.chart.cp === null ? (
                            <span className="text-xs text-gray-500">—</span>
                          ) : (
                            monoCell(chart.chart.cp)
                          ),
                      },
                      {
                        term: d.qualitySpcCpk,
                        children:
                          chart.chart.cpk === null ? (
                            <span className="text-xs text-gray-500">—</span>
                          ) : (
                            monoCell(chart.chart.cpk)
                          ),
                      },
                      {
                        term: d.qualitySpcExcluded,
                        children: monoCell(String(chart.chart.excludedCount)),
                      },
                    ]}
                  />
                </div>
              </Card>

              {/* THE SUBGROUPS — the pure module's own rows, verbatim. */}
              <Card title={d.qualitySpcSubgroupsTitle}>
                <div className="overflow-x-auto">
                  <table aria-label={d.qualitySpcSubgroupsTitle} className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-subtle">
                        <th className="px-2 py-1.5 text-start font-medium">
                          {d.qualitySpcSubgroupColValues}
                        </th>
                        <th className="px-2 py-1.5 text-start font-medium">
                          {d.qualitySpcSubgroupColMean}
                        </th>
                        <th className="px-2 py-1.5 text-start font-medium">
                          {d.qualitySpcSubgroupColRange}
                        </th>
                        <th className="px-2 py-1.5 text-start font-medium">
                          {d.qualitySpcSubgroupColX}
                        </th>
                        <th className="px-2 py-1.5 text-start font-medium">
                          {d.qualitySpcSubgroupColR}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {chart.chart.subgroups.map((subgroup, index) => (
                        <tr key={`${subgroup.mean}:${index}`} className="border-b border-subtle/60">
                          <td className="px-2 py-1.5 font-mono tabular-nums" dir="ltr">
                            {subgroup.values.join(", ")}
                          </td>
                          <td className="px-2 py-1.5">{monoCell(subgroup.mean)}</td>
                          <td className="px-2 py-1.5">{monoCell(subgroup.range)}</td>
                          <td className="px-2 py-1.5">
                            {subgroup.xOutOfControl ? (
                              <Chip tone="danger">{d.qualitySpcOutOfControl}</Chip>
                            ) : (
                              <Chip tone="success">{d.qualitySpcInControl}</Chip>
                            )}
                          </td>
                          <td className="px-2 py-1.5">
                            {subgroup.rOutOfControl ? (
                              <Chip tone="danger">{d.qualitySpcOutOfControl}</Chip>
                            ) : (
                              <Chip tone="success">{d.qualitySpcInControl}</Chip>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </>
          ) : null}
        </>
      )}
    </div>
  );
}
