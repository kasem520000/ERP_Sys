"use client";

/**
 * PHASE-050 (W-29 — T-15) — the calibration board (the /quality/calibration
 * screen body): the instrument-calibration register + the record form + the
 * sweep config's read/write — cloned from the W-21 meters-board pattern
 * (the data-slot shape, two panes on a segmented switch, never the Tabs
 * primitive).
 *
 * THE ENGINE-OUTPUT LAW: every figure is an ENGINE OUTPUT rendered VERBATIM
 * — the record's own calibratedAt/dueDate pair, its own externalCost, and
 * the sweep config's own thresholds ladder ([30,7,0] as the engine's
 * strings; the write only parses the operator's input, never an engine
 * figure). Zero client-side recomputation.
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
  CalibrationRow,
  CalibrationSweepConfigRow,
  FixedAssetRow,
} from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import {
  localizedCalibrationResult,
  localizedQualityError,
  localizedName,
} from "../lib/messages";
import { Card } from "./card";
import { DefList } from "./def-list";
import { ErrorNotice, SuccessNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";
import { TypedRefusalPanel } from "./typed-refusal-panel";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const STAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
/** Money ≤ 4dp (the engine's own floor — the calibration's external cost). */
const AMOUNT_RE = /^\d+(\.\d{1,4})?$/;

const CALIBRATION_RESULTS = ["PASS", "FAIL", "ADJUSTED"] as const;
type CalibrationResultKind = (typeof CALIBRATION_RESULTS)[number];

/** The record draft (the engine's own floor). */
interface CalibrationDraft {
  assetId: string;
  standardUsed: string;
  result: CalibrationResultKind;
  calibratedAt: string;
  dueDate: string;
  providerId: string;
  certificateRef: string;
  externalCost: string;
  note: string;
  noteAr: string;
}

const EMPTY_CALIBRATION: CalibrationDraft = {
  assetId: "",
  standardUsed: "",
  result: "PASS",
  calibratedAt: "",
  dueDate: "",
  providerId: "",
  certificateRef: "",
  externalCost: "",
  note: "",
  noteAr: "",
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

function resultTone(result: string): ChipTone {
  if (result === "PASS") return "success";
  if (result === "FAIL") return "danger";
  return "warning";
}

export function QualityCalibrationBoard({
  locale,
  initialCalibrations,
  calibrationsError,
  initialSweepConfig,
  sweepConfigError,
  assets,
}: {
  locale: Locale;
  initialCalibrations: readonly CalibrationRow[] | null;
  calibrationsError: ApiErrorBody | null;
  initialSweepConfig: CalibrationSweepConfigRow | null;
  sweepConfigError: ApiErrorBody | null;
  assets: readonly FixedAssetRow[];
}): JSX.Element {
  const d = getDictionary(locale);
  const { toast } = useToast();

  // -- the pane switch (the data-slot shape — never the Tabs primitive) ------
  const [pane, setPane] = useState<"register" | "record">("register");

  // -- the shared feedback ---------------------------------------------------
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // -- the register pane -----------------------------------------------------
  const [calibrations, setCalibrations] = useState<readonly CalibrationRow[] | null>(
    initialCalibrations,
  );
  const [calibrationsRefusal, setCalibrationsRefusal] = useState<ApiErrorBody | null>(
    calibrationsError,
  );
  const [listLoading, setListLoading] = useState(false);
  const [assetFilter, setAssetFilter] = useState("");

  // -- the sweep config (the register pane's own second read) ------------------
  const [sweepConfig, setSweepConfig] = useState<CalibrationSweepConfigRow | null>(
    initialSweepConfig,
  );
  const [sweepRefusal, setSweepRefusal] = useState<ApiErrorBody | null>(sweepConfigError);
  const [sweepLoading, setSweepLoading] = useState(false);
  const [thresholdsDraft, setThresholdsDraft] = useState("");

  // -- the record pane ---------------------------------------------------------
  const [draft, setDraft] = useState<CalibrationDraft>({ ...EMPTY_CALIBRATION });

  const assetLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const asset of assets) {
      map.set(asset.id, `${asset.code} · ${localizedName(asset.name, asset.nameAr, locale)}`);
    }
    return map;
  }, [assets, locale]);

  const recordReady =
    draft.assetId !== "" &&
    draft.standardUsed.trim().length >= 1 &&
    STAMP_RE.test(draft.calibratedAt) &&
    DATE_RE.test(draft.dueDate) &&
    (draft.externalCost === "" || AMOUNT_RE.test(draft.externalCost));

  // -- the register list ------------------------------------------------------

  async function loadCalibrations(): Promise<void> {
    setListLoading(true);
    const query = assetFilter === "" ? "" : `?assetId=${encodeURIComponent(assetFilter)}`;
    const result = await bffFetch<readonly CalibrationRow[]>(`quality/calibration${query}`);
    setListLoading(false);
    if (!result.ok) {
      setCalibrationsRefusal(result.error);
      setCalibrations(null);
      return;
    }
    setCalibrationsRefusal(null);
    setCalibrations(result.data);
  }

  async function loadSweepConfig(): Promise<void> {
    setSweepLoading(true);
    const result = await bffFetch<CalibrationSweepConfigRow>("quality/calibration/sweep-config");
    setSweepLoading(false);
    if (!result.ok) {
      setSweepRefusal(result.error);
      setSweepConfig(null);
      return;
    }
    setSweepRefusal(null);
    setSweepConfig(result.data);
    setThresholdsDraft(result.data.thresholds.join(", "));
  }

  /** The audited thresholds write — the operator's own ladder (the input is
   * parsed, never an engine figure recomputed). */
  async function saveThresholds(): Promise<void> {
    const raw = thresholdsDraft.split(",").map((part) => part.trim());
    const thresholds: number[] = [];
    for (const part of raw) {
      if (part === "") {
        continue;
      }
      if (!/^\d+$/.test(part)) {
        setError(d.errorsValidation);
        return;
      }
      thresholds.push(Number(part));
    }
    if (thresholds.length === 0) {
      setError(d.errorsValidation);
      return;
    }
    setBusy("sweep");
    setError(null);
    const result = await bffFetch<CalibrationSweepConfigRow>(
      "quality/calibration/sweep-config",
      { method: "PUT", body: { thresholds } },
    );
    setBusy(null);
    if (!result.ok) {
      setError(localizedQualityError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setNotice(d.qualityCalibrationSweepSavedToast);
    toast({ tone: "success", title: d.qualityCalibrationSweepSavedToast });
    setSweepConfig(result.data);
    setThresholdsDraft(result.data.thresholds.join(", "));
  }

  // -- the record act -----------------------------------------------------------

  async function createCalibration(): Promise<void> {
    if (!recordReady) {
      setError(d.errorsValidation);
      return;
    }
    setBusy("create");
    setError(null);
    const result = await bffFetch<CalibrationRow>("quality/calibration", {
      method: "POST",
      body: {
        assetId: draft.assetId,
        standardUsed: draft.standardUsed.trim(),
        result: draft.result,
        calibratedAt: draft.calibratedAt,
        dueDate: draft.dueDate,
        ...(draft.providerId.trim() !== "" ? { providerId: draft.providerId.trim() } : {}),
        ...(draft.certificateRef.trim() !== ""
          ? { certificateRef: draft.certificateRef.trim() }
          : {}),
        ...(draft.externalCost !== "" ? { externalCost: draft.externalCost } : {}),
        ...(draft.note.trim() !== "" ? { note: draft.note.trim() } : {}),
        ...(draft.noteAr.trim() !== "" ? { noteAr: draft.noteAr.trim() } : {}),
      },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedQualityError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setDraft({ ...EMPTY_CALIBRATION });
    setNotice(d.qualityCalibrationCreatedToast);
    toast({ tone: "success", title: d.qualityCalibrationCreatedToast });
    await loadCalibrations();
  }

  // -- the register table -------------------------------------------------------

  const calibrationColumns: DataTableColumn<CalibrationRow>[] = [
    {
      id: "calibrationNo",
      header: activeLocaleHeader(d.qualityCalibrationColNo),
      accessor: (row) => row.calibrationNo,
      render: (row) => monoCell(row.calibrationNo),
    },
    {
      id: "asset",
      header: activeLocaleHeader(d.qualityCalibrationColAsset),
      accessor: (row) => assetLabelById.get(row.assetId) ?? shortId(row.assetId),
    },
    {
      id: "standard",
      header: activeLocaleHeader(d.qualityCalibrationColStandard),
      accessor: (row) => row.standardUsed,
    },
    {
      id: "result",
      header: activeLocaleHeader(d.qualityCalibrationColResult),
      accessor: (row) => localizedCalibrationResult(d, row.result),
      render: (row) => (
        <Chip tone={resultTone(row.result)}>{localizedCalibrationResult(d, row.result)}</Chip>
      ),
    },
    {
      id: "calibratedAt",
      header: activeLocaleHeader(d.qualityCalibrationColCalibratedAt),
      accessor: (row) => row.calibratedAt,
      render: (row) => monoCell(row.calibratedAt),
    },
    {
      id: "due",
      header: activeLocaleHeader(d.qualityCalibrationColDue),
      accessor: (row) => row.dueDate,
      render: (row) => monoCell(row.dueDate),
    },
    {
      id: "certificate",
      header: activeLocaleHeader(d.qualityCalibrationColCertificate),
      accessor: (row) => row.certificateRef ?? "—",
      render: (row) =>
        row.certificateRef === null ? (
          <span className="text-xs text-gray-500">—</span>
        ) : (
          monoCell(row.certificateRef)
        ),
    },
    {
      id: "cost",
      header: activeLocaleHeader(d.qualityCalibrationColCost),
      accessor: (row) => row.externalCost,
      render: (row) => monoCell(row.externalCost),
    },
  ];

  // -- the render -----------------------------------------------------------------

  return (
    <div className="flex flex-col gap-4">
      {/* the pane switch — the data-slot shape (no Tabs primitive) */}
      <div
        className="flex flex-wrap items-center gap-2"
        role="tablist"
        aria-label={d.qualityCalibrationTitle}
      >
        <Button
          variant={pane === "register" ? "primary" : "secondary"}
          size="sm"
          aria-current={pane === "register"}
          onClick={() => setPane("register")}
        >
          {d.qualityCalibrationPaneRegister}
        </Button>
        <Button
          variant={pane === "record" ? "primary" : "secondary"}
          size="sm"
          aria-current={pane === "record"}
          onClick={() => setPane("record")}
        >
          {d.qualityCalibrationPaneRecord}
        </Button>
      </div>

      {error !== null ? <ErrorNotice>{error}</ErrorNotice> : null}
      {notice !== null ? <SuccessNotice>{notice}</SuccessNotice> : null}

      {pane === "register" ? (
        <>
          <Card
            title={d.qualityCalibrationPaneRegister}
            description={d.qualityCalibrationSubtitle}
            actions={
              <Button
                variant="secondary"
                size="sm"
                loading={listLoading}
                onClick={() => void loadCalibrations()}
              >
                {d.qualityRefresh}
              </Button>
            }
          >
            <div className="flex flex-wrap items-end gap-3">
              <Select
                label={d.qualityCalibrationColAsset}
                value={assetFilter}
                onValueChange={setAssetFilter}
                placeholder="—"
                options={assets.map((asset) => ({
                  value: asset.id,
                  label: assetLabelById.get(asset.id) ?? asset.code,
                }))}
              />
            </div>
          </Card>

          {listLoading ? <p className="text-sm text-gray-600">…</p> : null}

          {calibrationsRefusal !== null ? (
            <TypedRefusalPanel
              error={calibrationsRefusal}
              title={d.qualityRefusalTitle}
              detailsLabel={d.qualityRefusalDetails}
            />
          ) : null}

          {calibrationsRefusal === null && calibrations !== null ? (
            calibrations.length === 0 ? (
              <p className="text-sm text-gray-600">{d.qualityCalibrationEmpty}</p>
            ) : (
              <DataTable
                columns={calibrationColumns}
                rows={[...calibrations]}
                rowKey={(row) => row.id}
              />
            )
          ) : null}

          {/* THE SWEEP CONFIG — the effective ladder displayed VERBATIM (the
              engine's own strings) + the audited write. */}
          <Card
            title={d.qualityCalibrationSweepTitle}
            description={d.qualityCalibrationSweepHint}
            actions={
              <Button
                variant="secondary"
                size="sm"
                loading={sweepLoading}
                onClick={() => void loadSweepConfig()}
              >
                {d.qualityRefresh}
              </Button>
            }
          >
            {sweepLoading ? <p className="text-sm text-gray-600">…</p> : null}
            {sweepRefusal !== null ? (
              <TypedRefusalPanel
                error={sweepRefusal}
                title={d.qualityRefusalTitle}
                detailsLabel={d.qualityRefusalDetails}
              />
            ) : null}
            {sweepRefusal === null && sweepConfig !== null ? (
              <div className="flex flex-col gap-3">
                <DefList
                  items={[
                    {
                      term: d.qualityCalibrationSweepThresholds,
                      // The engine's own ladder, joined for display only.
                      children: monoCell(sweepConfig.thresholds.join(", ")),
                    },
                    {
                      term: d.qualityCalibrationSweepDefault,
                      children: monoCell(sweepConfig.default.join(", ")),
                    },
                    {
                      term: d.qualityCalibrationSweepStored,
                      children: sweepConfig.stored ? "true" : "false",
                    },
                    {
                      term: d.qualityCalibrationSweepLastRun,
                      children:
                        sweepConfig.lastRun === null ? (
                          d.qualityCalibrationSweepNeverRun
                        ) : (
                          monoCell(sweepConfig.lastRun.at)
                        ),
                    },
                  ]}
                />
                <div className="flex flex-wrap items-end gap-3">
                  <div className="w-64">
                    <Input
                      label={d.qualityCalibrationSweepThresholds}
                      value={thresholdsDraft}
                      onValueChange={setThresholdsDraft}
                      mono
                      bidiIsolate
                      hint="30,7,0"
                    />
                  </div>
                  <Button
                    variant="primary"
                    loading={busy === "sweep"}
                    onClick={() => void saveThresholds()}
                  >
                    {d.qualityCalibrationSweepSave}
                  </Button>
                </div>
              </div>
            ) : null}
          </Card>
        </>
      ) : (
        <Card title={d.qualityCalibrationRecordTitle} description={d.qualityCalibrationSubtitle}>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Select
                label={d.qualityCalibrationColAsset}
                value={draft.assetId}
                onValueChange={(value) => setDraft((prev) => ({ ...prev, assetId: value }))}
                placeholder="—"
                options={assets.map((asset) => ({
                  value: asset.id,
                  label: assetLabelById.get(asset.id) ?? asset.code,
                }))}
                required
              />
            </div>
            <Input
              label={d.qualityCalibrationColStandard}
              value={draft.standardUsed}
              onValueChange={(value) => setDraft((prev) => ({ ...prev, standardUsed: value }))}
              required
            />
            <Select
              label={d.qualityCalibrationColResult}
              value={draft.result}
              onValueChange={(value) =>
                setDraft((prev) => ({ ...prev, result: value as CalibrationResultKind }))
              }
              placeholder="PASS"
              options={CALIBRATION_RESULTS.map((result) => ({
                value: result,
                label: localizedCalibrationResult(d, result),
              }))}
            />
            <Input
              label={d.qualityCalibrationColCalibratedAt}
              value={draft.calibratedAt}
              onValueChange={(value) => setDraft((prev) => ({ ...prev, calibratedAt: value }))}
              mono
              bidiIsolate
              hint="YYYY-MM-DDTHH:mm"
              required
            />
            <Input
              label={d.qualityCalibrationColDue}
              value={draft.dueDate}
              onValueChange={(value) => setDraft((prev) => ({ ...prev, dueDate: value }))}
              mono
              bidiIsolate
              hint="YYYY-MM-DD"
              required
            />
            <Input
              label={d.qualityCalibrationRecordProvider}
              value={draft.providerId}
              onValueChange={(value) => setDraft((prev) => ({ ...prev, providerId: value }))}
              mono
              bidiIsolate
            />
            <Input
              label={d.qualityCalibrationColCertificate}
              value={draft.certificateRef}
              onValueChange={(value) => setDraft((prev) => ({ ...prev, certificateRef: value }))}
              mono
              bidiIsolate
            />
            <Input
              label={d.qualityCalibrationRecordCost}
              value={draft.externalCost}
              onValueChange={(value) => setDraft((prev) => ({ ...prev, externalCost: value }))}
              inputMode="decimal"
              mono
            />
            <div className="sm:col-span-2">
              <Input
                label={d.qualityCalibrationRecordNote}
                value={draft.note}
                onValueChange={(value) => setDraft((prev) => ({ ...prev, note: value }))}
              />
            </div>
            <div className="sm:col-span-2">
              <Input
                label={d.qualityCalibrationRecordNoteAr}
                value={draft.noteAr}
                onValueChange={(value) => setDraft((prev) => ({ ...prev, noteAr: value }))}
              />
            </div>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button
              variant="primary"
              loading={busy === "create"}
              disabled={!recordReady}
              onClick={() => void createCalibration()}
            >
              {d.qualityCalibrationCreate}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
