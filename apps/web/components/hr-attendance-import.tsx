"use client";

/**
 * PHASE-045 (T-12) — the device-import wizard + the review surface
 * (PAGE_ARCHETYPES §9, the budget-import-wizard pattern): step 1 picks
 * the CSV (file read as text in-browser, or a paste) + the column
 * mapping (the tenant's stored preference or the system default); the
 * preview POST returns the analysis alone (paired sessions + the typed
 * quarantine — ZERO writes); the commit POST writes the batch + records
 * + quarantine and runs the derivation over the file's span (the
 * fingerprint floor: the same file never commits twice). Below the
 * wizard: the committed-batches log + the anomaly quarantine with the
 * reviewer's two acts — REJECT, or IMPORT-with-corrections riding the
 * same capture laws (the 0086 permission split mirrors the API's).
 */
import { useCallback, useMemo, useRef, useState } from "react";
import type { ChangeEvent, JSX } from "react";

import {
  Badge,
  Button,
  Checkbox,
  DataTable,
  Dialog,
  Input,
  Pagination,
  Select,
  Textarea,
  useToast,
  type DataTableSort,
} from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type {
  AttendanceImportMapping,
  AttendanceImportMappingRead,
  EmployeeListRow,
  ImportAnomaliesPage,
  ImportAnomalyRow,
  ImportBatchesPage,
  ImportBatchRow,
  ImportCommitResult,
  ImportPreviewResult,
} from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import {
  formatMessage,
  localizedName,
  localizedHrAnomalyReason,
  localizedHrAnomalyStatus,
  localizedHrError,
} from "../lib/messages";
import { Card } from "./card";
import { DefList } from "./def-list";
import { ErrorNotice, InfoNotice, SuccessNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";

/** The API's column-index bounds (0–49, the service's law). */
const COLUMN_RE = /^\d{1,2}$/;
const MIN_COLUMN = 0;
const MAX_COLUMN = 49;
/** The reviewer's corrected-session clock face. */
const INSTANT_RE = /^\d{4}-\d{2}-\d{2} ([01]\d|2[0-3]):[0-5]\d$/;
const PAGE_SIZE = 25;

/** The code-level default (the ZKTeco-style layout) — the seed when the
 * tenant has no stored preference and the mapping read degraded. */
const DEFAULT_MAPPING: AttendanceImportMapping = {
  employeeCode: 0,
  timestamp: 1,
  direction: 2,
  deviceRef: 3,
  timestampFormat: "ISO",
  skipHeader: true,
  delimiter: ",",
};

type WizardStep = "upload" | "preview" | "done";

function shortId(id: string): string {
  return id.slice(0, 8);
}

export function HrAttendanceImport({
  locale,
  initialBatches,
  initialAnomalies,
  anomalyError,
  mapping,
  mappingForbidden,
  employees,
}: {
  locale: Locale;
  initialBatches: ImportBatchesPage;
  initialAnomalies: ImportAnomaliesPage | null;
  anomalyError: { message: string } | null;
  mapping: AttendanceImportMappingRead | null;
  mappingForbidden: boolean;
  employees: readonly EmployeeListRow[];
}): JSX.Element {
  const d = getDictionary(locale);
  const { toast } = useToast();

  const seed = mapping?.mapping ?? DEFAULT_MAPPING;

  // -- the wizard ------------------------------------------------------------------
  const [step, setStep] = useState<WizardStep>("upload");
  const [content, setContent] = useState("");
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<ImportPreviewResult | null>(null);
  const [committed, setCommitted] = useState<ImportCommitResult | null>(null);
  const [deviceRef, setDeviceRef] = useState("");
  const [note, setNote] = useState("");
  const [wizardBusy, setWizardBusy] = useState(false);
  const [wizardError, setWizardError] = useState<string | null>(null);

  // The column mapping (index inputs are strings; "" = the null column).
  const [colEmployeeCode, setColEmployeeCode] = useState(String(seed.employeeCode));
  const [colTimestamp, setColTimestamp] = useState(String(seed.timestamp));
  const [colDirection, setColDirection] = useState(
    seed.direction === null ? "" : String(seed.direction),
  );
  const [colDeviceRef, setColDeviceRef] = useState(
    seed.deviceRef === null ? "" : String(seed.deviceRef),
  );
  const [timestampFormat, setTimestampFormat] = useState(seed.timestampFormat);
  const [skipHeader, setSkipHeader] = useState(seed.skipHeader);
  const [delimiter, setDelimiter] = useState(seed.delimiter);
  const [mappingBusy, setMappingBusy] = useState(false);
  const [mappingSaved, setMappingSaved] = useState(false);

  const employeeLabel = useMemo(() => {
    const map = new Map<string, string>();
    for (const employee of employees) {
      map.set(
        employee.id,
        `${employee.code} · ${localizedName(employee.name, employee.nameAr, locale)}`,
      );
    }
    return map;
  }, [employees, locale]);

  /** Parses an index input; undefined = unparseable/out of bounds. */
  function columnIndex(value: string): number | undefined {
    if (!COLUMN_RE.test(value)) {
      return undefined;
    }
    const parsed = Number.parseInt(value, 10);
    if (parsed < MIN_COLUMN || parsed > MAX_COLUMN) {
      return undefined;
    }
    return parsed;
  }

  function currentMapping(): AttendanceImportMapping | null {
    if (colEmployeeCode === "" || colTimestamp === "") {
      return null;
    }
    const employeeCode = columnIndex(colEmployeeCode);
    if (employeeCode === undefined) {
      return null;
    }
    const timestamp = columnIndex(colTimestamp);
    if (timestamp === undefined) {
      return null;
    }
    const direction = colDirection === "" ? null : columnIndex(colDirection);
    if (direction === undefined) {
      return null;
    }
    const device = colDeviceRef === "" ? null : columnIndex(colDeviceRef);
    if (device === undefined) {
      return null;
    }
    return {
      employeeCode,
      timestamp,
      direction,
      deviceRef: device,
      timestampFormat,
      skipHeader,
      delimiter,
    };
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0] ?? null;
    if (file === null) {
      return;
    }
    setFileName(file.name);
    void file.text().then((text) => {
      setContent(text);
    });
  }

  async function runPreview(): Promise<void> {
    setWizardError(null);
    const mappingNow = currentMapping();
    if (content.trim() === "") {
      setWizardError(d.hrImportNoContent);
      return;
    }
    if (mappingNow === null) {
      setWizardError(d.budgetFormInvalid);
      return;
    }
    setWizardBusy(true);
    const result = await bffFetch<ImportPreviewResult>("hr/attendance/import/preview", {
      method: "POST",
      body: { content, mapping: mappingNow },
    });
    setWizardBusy(false);
    if (!result.ok) {
      setWizardError(localizedHrError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setPreview(result.data);
    setStep("preview");
  }

  async function runCommit(): Promise<void> {
    if (preview === null || content === "") {
      return;
    }
    setWizardError(null);
    if (fileName.trim() === "") {
      setWizardError(d.budgetFormInvalid);
      return;
    }
    const mappingNow = currentMapping();
    if (mappingNow === null) {
      setWizardError(d.budgetFormInvalid);
      return;
    }
    setWizardBusy(true);
    const result = await bffFetch<ImportCommitResult>("hr/attendance/import/commit", {
      method: "POST",
      body: {
        content,
        fileName: fileName.trim(),
        mapping: mappingNow,
        ...(deviceRef.trim() === "" ? {} : { deviceRef: deviceRef.trim() }),
        ...(note.trim() === "" ? {} : { note: note.trim() }),
      },
    });
    setWizardBusy(false);
    if (!result.ok) {
      setWizardError(localizedHrError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setCommitted(result.data);
    setStep("done");
    toast({
      tone: "success",
      title: formatMessage(d.hrImportCommitted, {
        imported: result.data.importedCount,
        quarantined: result.data.quarantineCount,
      }),
    });
    await Promise.all([loadBatches(1), loadAnomalies(anomalyStatus, 1)]);
  }

  async function saveMapping(): Promise<void> {
    setWizardError(null);
    const mappingNow = currentMapping();
    if (mappingNow === null) {
      setWizardError(d.budgetFormInvalid);
      return;
    }
    setMappingBusy(true);
    const result = await bffFetch<AttendanceImportMapping>("hr/attendance/import/mapping", {
      method: "PUT",
      body: mappingNow,
    });
    setMappingBusy(false);
    if (!result.ok) {
      setWizardError(localizedHrError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setMappingSaved(true);
    toast({ tone: "success", title: d.hrImportMappingSaved });
  }

  function resetWizard(): void {
    setStep("upload");
    setContent("");
    setFileName("");
    setPreview(null);
    setCommitted(null);
    setDeviceRef("");
    setNote("");
    setWizardError(null);
  }

  // -- the batches log (page/pagination through the BFF) ------------------------------
  const [batchRows, setBatchRows] = useState<readonly ImportBatchRow[]>(
    initialBatches.rows,
  );
  const [batchPage, setBatchPage] = useState(initialBatches.page);
  const [batchTotal, setBatchTotal] = useState(initialBatches.total);
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchError, setBatchError] = useState<string | null>(null);
  const batchRunRef = useRef(0);

  const loadBatches = useCallback(
    async (page: number): Promise<void> => {
      const run = batchRunRef.current + 1;
      batchRunRef.current = run;
      setBatchBusy(true);
      setBatchError(null);
      const result = await bffFetch<ImportBatchesPage>(
        `hr/attendance/import/batches?page=${page}&pageSize=${PAGE_SIZE}`,
      );
      if (run !== batchRunRef.current) {
        return;
      }
      setBatchBusy(false);
      if (!result.ok) {
        setBatchError(localizedHrError(d, result.error, result.retryAfterSeconds));
        return;
      }
      setBatchRows(result.data.rows);
      setBatchPage(result.data.page);
      setBatchTotal(result.data.total);
    },
    [d],
  );

  // -- the anomaly quarantine (status filter + pagination) ------------------------------
  const [anomalyStatus, setAnomalyStatus] = useState("PENDING");
  const [anomalyRows, setAnomalyRows] = useState<readonly ImportAnomalyRow[]>(
    initialAnomalies?.rows ?? [],
  );
  const [anomalyPage, setAnomalyPage] = useState(initialAnomalies?.page ?? 1);
  const [anomalyTotal, setAnomalyTotal] = useState(initialAnomalies?.total ?? 0);
  const [anomalyBusy, setAnomalyBusy] = useState(false);
  const [anomalyNotice, setAnomalyNotice] = useState<string | null>(
    anomalyError === null ? null : anomalyError.message,
  );
  const anomalyRunRef = useRef(0);

  const loadAnomalies = useCallback(
    async (status: string, page: number): Promise<void> => {
      const run = anomalyRunRef.current + 1;
      anomalyRunRef.current = run;
      setAnomalyBusy(true);
      setAnomalyNotice(null);
      const search = new URLSearchParams({
        page: String(page),
        pageSize: String(PAGE_SIZE),
      });
      if (status !== "") {
        search.set("status", status);
      }
      const result = await bffFetch<ImportAnomaliesPage>(
        `hr/attendance/import/anomalies?${search.toString()}`,
      );
      if (run !== anomalyRunRef.current) {
        return;
      }
      setAnomalyBusy(false);
      if (!result.ok) {
        setAnomalyNotice(localizedHrError(d, result.error, result.retryAfterSeconds));
        return;
      }
      setAnomalyRows(result.data.rows);
      setAnomalyPage(result.data.page);
      setAnomalyTotal(result.data.total);
    },
    [d],
  );

  // -- the resolve dialog (REJECT | IMPORT-with-corrections) ---------------------------
  const [resolveTarget, setResolveTarget] = useState<ImportAnomalyRow | null>(null);
  const [resolveMode, setResolveMode] = useState<"REJECT" | "IMPORT">("REJECT");
  const [resolveEmployee, setResolveEmployee] = useState("");
  const [resolveCheckIn, setResolveCheckIn] = useState("");
  const [resolveCheckOut, setResolveCheckOut] = useState("");
  const [resolveNote, setResolveNote] = useState("");
  const [resolveBusy, setResolveBusy] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);

  async function resolve(): Promise<void> {
    if (resolveTarget === null) {
      return;
    }
    setResolveError(null);
    if (resolveMode === "IMPORT") {
      if (
        resolveEmployee === "" ||
        !INSTANT_RE.test(resolveCheckIn) ||
        (resolveCheckOut !== "" && !INSTANT_RE.test(resolveCheckOut))
      ) {
        setResolveError(d.budgetFormInvalid);
        return;
      }
    }
    setResolveBusy(true);
    const result = await bffFetch<ImportAnomalyRow>(
      `hr/attendance/import/anomalies/${resolveTarget.id}/resolve`,
      {
        method: "POST",
        body: {
          action: resolveMode,
          ...(resolveMode === "IMPORT"
            ? {
                employeeId: resolveEmployee,
                checkIn: `${resolveCheckIn}:00`,
                ...(resolveCheckOut === "" ? {} : { checkOut: `${resolveCheckOut}:00` }),
              }
            : {}),
          ...(resolveNote.trim() === "" ? {} : { note: resolveNote.trim() }),
        },
      },
    );
    setResolveBusy(false);
    if (!result.ok) {
      setResolveError(localizedHrError(d, result.error, result.retryAfterSeconds));
      return;
    }
    toast({ tone: "success", title: d.hrImportResolvedToast });
    setResolveTarget(null);
    setResolveEmployee("");
    setResolveCheckIn("");
    setResolveCheckOut("");
    setResolveNote("");
    await loadAnomalies(anomalyStatus, anomalyPage);
  }

  const batchPages =
    batchTotal === 0 ? 1 : ((batchTotal + PAGE_SIZE - 1) / PAGE_SIZE) | 0;
  const anomalyPages =
    anomalyTotal === 0 ? 1 : ((anomalyTotal + PAGE_SIZE - 1) / PAGE_SIZE) | 0;
  const [batchSort, setBatchSort] = useState<DataTableSort[]>([]);
  const [anomalySort, setAnomalySort] = useState<DataTableSort[]>([]);

  const stepLabels: Record<WizardStep, string> = {
    upload: d.hrImportStepUpload,
    preview: d.hrImportStepPreview,
    done: d.hrImportStepCommit,
  };
  const stepNo = step === "upload" ? 1 : 2;

  return (
    <div className="flex flex-col gap-4">
      {mappingForbidden && <InfoNotice>{d.hrImportWizardForbidden}</InfoNotice>}

      {/* -- the wizard (hr.attendance.import) ------------------------------------ */}
      {!mappingForbidden && (
        <Card title={d.hrImportWizard}>
          <div className="flex flex-col gap-4">
            {wizardError !== null && <ErrorNotice>{wizardError}</ErrorNotice>}

            <nav aria-label={d.hrImportWizard} className="flex flex-wrap items-center gap-2">
              {([1, 2] as const).map((entry) =>
                stepNo === entry ? (
                  <span
                    key={entry}
                    aria-current="step"
                    className="rounded-md border border-primary-200 bg-primary-50 px-3 py-1.5 text-sm font-medium text-primary-800"
                  >
                    {formatMessage(d.instWizStepOf, { current: entry, total: 2 })} —{" "}
                    {stepLabels[step]}
                  </span>
                ) : (
                  <span
                    key={entry}
                    className="rounded-md border border-default bg-surface-card px-3 py-1.5 text-sm text-gray-500"
                  >
                    {formatMessage(d.instWizStepOf, { current: entry, total: 2 })} —{" "}
                    {entry === 1 ? d.hrImportStepUpload : d.hrImportStepPreview}
                  </span>
                ),
              )}
            </nav>

            {step === "upload" && (
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1">
                  <label htmlFor="hr-import-file" className="text-sm font-medium text-gray-700">
                    {d.hrImportFileLabel}
                  </label>
                  <input
                    id="hr-import-file"
                    type="file"
                    accept=".csv,.txt"
                    onChange={onFileChange}
                    className="rounded-md border border-default bg-surface-card px-3 py-1.5 text-sm text-gray-800 outline-none hover:border-strong"
                  />
                </div>
                <div className="w-full">
                  <Textarea
                    id="hr-import-paste"
                    label={d.hrImportPasteLabel}
                    value={content}
                    onValueChange={(value) => {
                      setContent(value);
                    }}
                    rows={6}
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <Input
                    id="hr-import-filename"
                    label={d.hrImportFileName}
                    value={fileName}
                    onValueChange={setFileName}
                    mono
                    bidiIsolate
                    required
                  />
                  <Input
                    id="hr-import-device"
                    label={d.hrImportDeviceRef}
                    value={deviceRef}
                    onValueChange={setDeviceRef}
                    mono
                    bidiIsolate
                  />
                  <Input
                    id="hr-import-note"
                    label={d.hrColNote}
                    value={note}
                    onValueChange={setNote}
                  />
                </div>

                <div className="flex flex-col gap-3 rounded-md border border-subtle bg-surface-sunken p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-gray-900">{d.hrImportMappingTitle}</h3>
                    <p className="text-xs text-gray-600">
                      {mappingSaved || mapping?.stored
                        ? d.hrImportMappingStored
                        : d.hrImportMappingDefault}
                    </p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <Input
                      id="hr-map-employee"
                      label={d.hrImportColEmployeeCode}
                      value={colEmployeeCode}
                      onValueChange={setColEmployeeCode}
                      mono
                      bidiIsolate
                      required
                    />
                    <Input
                      id="hr-map-timestamp"
                      label={d.hrImportColTimestamp}
                      value={colTimestamp}
                      onValueChange={setColTimestamp}
                      mono
                      bidiIsolate
                      required
                    />
                    <Input
                      id="hr-map-direction"
                      label={d.hrImportColDirection}
                      value={colDirection}
                      onValueChange={setColDirection}
                      placeholder={d.hrImportColNone}
                      mono
                      bidiIsolate
                    />
                    <Input
                      id="hr-map-device"
                      label={d.hrImportColDeviceRef}
                      value={colDeviceRef}
                      onValueChange={setColDeviceRef}
                      placeholder={d.hrImportColNone}
                      mono
                      bidiIsolate
                    />
                    <Select
                      id="hr-map-format"
                      label={d.hrImportTimestampFormat}
                      value={timestampFormat}
                      onValueChange={(value) => {
                        setTimestampFormat(value as AttendanceImportMapping["timestampFormat"]);
                      }}
                      options={[
                        { value: "ISO", label: "YYYY-MM-DD" },
                        { value: "DMY", label: "DD/MM/YYYY" },
                        { value: "MDY", label: "MM/DD/YYYY" },
                      ]}
                    />
                    <Select
                      id="hr-map-delimiter"
                      label={d.hrImportDelimiter}
                      value={delimiter}
                      onValueChange={(value) => {
                        setDelimiter(value as AttendanceImportMapping["delimiter"]);
                      }}
                      options={[
                        { value: ",", label: d.hrImportDelimiterComma },
                        { value: ";", label: d.hrImportDelimiterSemicolon },
                        { value: "\t", label: d.hrImportDelimiterTab },
                      ]}
                    />
                  </div>
                  <Checkbox
                    label={d.hrImportSkipHeader}
                    checked={skipHeader}
                    onCheckedChange={(checked) => {
                      setSkipHeader(checked === true);
                    }}
                  />
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button variant="secondary" onClick={() => void saveMapping()} loading={mappingBusy}>
                      {d.hrImportMappingSaveBtn}
                    </Button>
                    <Button variant="primary" onClick={() => void runPreview()} loading={wizardBusy}>
                      {d.hrImportPreviewBtn}
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {step === "preview" && preview !== null && (
              <div className="flex flex-col gap-3">
                <DefList
                  items={[
                    { term: d.hrImportPreviewRowCount, children: String(preview.rowCount) },
                    {
                      term: d.hrImportPreviewSessions,
                      children: String(preview.sessions.length),
                    },
                    {
                      term: d.hrImportPreviewAnomalies,
                      children: String(preview.anomalies.length),
                    },
                    {
                      term: d.hrImportPreviewFingerprint,
                      children: (
                        <span className="font-mono text-sm" dir="ltr">
                          {preview.fingerprint.slice(0, 16)}…
                        </span>
                      ),
                    },
                  ]}
                />
                {preview.sessions.length > 0 && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <caption className="text-start text-xs font-medium text-gray-600">
                        {d.hrImportPreviewSessions}
                      </caption>
                      <thead>
                        <tr className="border-b border-subtle">
                          <th scope="col" className="px-2 py-2 text-start font-medium">
                            {d.hrColEmployee}
                          </th>
                          <th scope="col" className="px-2 py-2 text-start font-medium">
                            {d.hrColDate}
                          </th>
                          <th scope="col" className="px-2 py-2 text-start font-medium">
                            {d.hrColCheckIn}
                          </th>
                          <th scope="col" className="px-2 py-2 text-start font-medium">
                            {d.hrColCheckOut}
                          </th>
                          <th scope="col" className="px-2 py-2 text-start font-medium">
                            {d.hrImportSessionsColLines}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.sessions.map((session) => (
                          <tr
                            key={`${session.employeeId}-${session.checkInNaive}-${session.lineIn}`}
                            className="border-b border-subtle"
                          >
                            <td className="px-2 py-2">
                              {employeeLabel.get(session.employeeId) ?? (
                                <span className="font-mono text-sm" dir="ltr">
                                  {shortId(session.employeeId)}
                                </span>
                              )}
                            </td>
                            <td className="px-2 py-2 font-mono tabular-nums" dir="ltr">
                              {session.workDate}
                            </td>
                            <td className="px-2 py-2 font-mono tabular-nums" dir="ltr">
                              {session.checkInNaive}
                            </td>
                            <td className="px-2 py-2 font-mono tabular-nums" dir="ltr">
                              {session.checkOutNaive ?? "—"}
                            </td>
                            <td className="px-2 py-2 font-mono tabular-nums" dir="ltr">
                              {session.lineIn} → {session.lineOut ?? "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {preview.anomalies.length > 0 && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <caption className="text-start text-xs font-medium text-gray-600">
                        {d.hrImportPreviewAnomalies}
                      </caption>
                      <thead>
                        <tr className="border-b border-subtle">
                          <th scope="col" className="px-2 py-2 text-start font-medium">
                            {d.hrImportAnomaliesColLine}
                          </th>
                          <th scope="col" className="px-2 py-2 text-start font-medium">
                            {d.hrImportAnomaliesColReason}
                          </th>
                          <th scope="col" className="px-2 py-2 text-start font-medium">
                            {d.hrImportAnomaliesColDetail}
                          </th>
                          <th scope="col" className="px-2 py-2 text-start font-medium">
                            {d.hrImportAnomaliesColRaw}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.anomalies.map((anomaly) => (
                          <tr
                            key={`${anomaly.lineNo}-${anomaly.reason}-${anomaly.rawLine}`}
                            className="border-b border-subtle"
                          >
                            <td className="px-2 py-2 font-mono tabular-nums" dir="ltr">
                              {anomaly.lineNo}
                            </td>
                            <td className="px-2 py-2 text-danger-700">
                              {localizedHrAnomalyReason(d, anomaly.reason)}
                            </td>
                            <td className="px-2 py-2 text-gray-700">{anomaly.detail ?? "—"}</td>
                            <td className="px-2 py-2 font-mono text-xs" dir="ltr">
                              {anomaly.rawLine}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <div className="flex flex-wrap justify-between gap-2">
                  <Button variant="secondary" onClick={resetWizard} disabled={wizardBusy}>
                    {d.instWizBack}
                  </Button>
                  <Button variant="primary" onClick={() => void runCommit()} loading={wizardBusy}>
                    {d.hrImportCommitBtn}
                  </Button>
                </div>
              </div>
            )}

            {step === "done" && committed !== null && (
              <div className="flex flex-col gap-3">
                <SuccessNotice>
                  {formatMessage(d.hrImportCommitted, {
                    imported: committed.importedCount,
                    quarantined: committed.quarantineCount,
                  })}
                </SuccessNotice>
                <div className="flex flex-wrap justify-end gap-2">
                  <Button variant="secondary" onClick={resetWizard}>
                    {d.hrImportStepUpload}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </Card>
      )}

      {/* -- the batches log (hr.attendance) ---------------------------------------- */}
      <Card title={d.hrImportBatchesLog}>
        <div className="flex flex-col gap-3">
          {batchError !== null && <ErrorNotice>{batchError}</ErrorNotice>}
          <p className="text-xs text-gray-600" dir="ltr">
            {formatMessage(d.hrTotalRows, { count: batchTotal })}
          </p>
          <DataTable
            columns={[
              {
                id: "fileName",
                header: activeLocaleHeader(d.hrImportColFile),
                accessor: (row) => row.fileName,
                sortable: true,
                width: "14rem",
                render: (row) => (
                  <span className="font-mono text-sm" dir="ltr">
                    {row.fileName}
                  </span>
                ),
              },
              {
                id: "createdAt",
                header: activeLocaleHeader(d.hrImportColCreatedAt),
                accessor: (row) => row.createdAt,
                sortable: true,
                render: (row) => (
                  <span className="font-mono text-sm" dir="ltr">
                    {row.createdAt}
                  </span>
                ),
              },
              {
                id: "rowCount",
                header: activeLocaleHeader(d.hrImportColRowCount),
                accessor: (row) => String(row.rowCount),
                numeric: true,
                render: (row) => <span dir="ltr">{row.rowCount}</span>,
              },
              {
                id: "importedCount",
                header: activeLocaleHeader(d.hrImportColImported),
                accessor: (row) => String(row.importedCount),
                numeric: true,
                render: (row) => <span dir="ltr">{row.importedCount}</span>,
              },
              {
                id: "quarantineCount",
                header: activeLocaleHeader(d.hrImportColQuarantined),
                accessor: (row) => String(row.quarantineCount),
                numeric: true,
                render: (row) =>
                  row.quarantineCount > 0 ? (
                    <span className="font-semibold text-danger-700" dir="ltr">
                      {row.quarantineCount}
                    </span>
                  ) : (
                    <span dir="ltr">0</span>
                  ),
              },
              {
                id: "deviceRef",
                header: activeLocaleHeader(d.hrCaptureDeviceRef),
                accessor: (row) => row.deviceRef ?? "—",
                render: (row) => (
                  <span className="font-mono text-sm" dir="ltr">
                    {row.deviceRef ?? "—"}
                  </span>
                ),
              },
              {
                id: "note",
                header: activeLocaleHeader(d.hrColNote),
                accessor: (row) => row.note ?? "—",
                render: (row) => row.note ?? "—",
              },
            ]}
            rows={[...batchRows]}
            rowKey={(row) => row.id}
            sort={batchSort}
            onSortChange={setBatchSort}
            loading={batchBusy && batchRows.length === 0}
            empty={{ title: d.hrImportBatchesEmpty }}
          />
          <Pagination
            page={batchPage}
            pageSize={PAGE_SIZE}
            total={batchTotal}
            onPageChange={(page) => {
              setBatchPage(page);
              void loadBatches(page);
            }}
            announceLabel={formatMessage(d.hrPageOf, {
              current: batchPage,
              total: batchPages,
            })}
          />
        </div>
      </Card>

      {/* -- the anomaly quarantine (hr.attendance) --------------------------------- */}
      <Card title={d.hrImportQuarantine}>
        <div className="flex flex-col gap-3">
          {anomalyNotice !== null && <ErrorNotice>{anomalyNotice}</ErrorNotice>}
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-48">
              <Select
                id="hr-anomaly-status"
                label={d.hrColStatus}
                value={anomalyStatus}
                onValueChange={(value) => {
                  setAnomalyStatus(value);
                  setAnomalyPage(1);
                  void loadAnomalies(value, 1);
                }}
                options={[
                  { value: "", label: d.kindFilterAll },
                  { value: "PENDING", label: d.hrAnomalyPending },
                  { value: "RESOLVED", label: d.hrAnomalyResolved },
                  { value: "REJECTED", label: d.hrAnomalyRejected },
                ]}
              />
            </div>
          </div>
          <p className="text-xs text-gray-600" dir="ltr">
            {formatMessage(d.hrTotalRows, { count: anomalyTotal })}
          </p>
          <DataTable
            columns={[
              {
                id: "lineNo",
                header: activeLocaleHeader(d.hrImportAnomaliesColLine),
                accessor: (row) => String(row.lineNo),
                numeric: true,
                render: (row) => <span dir="ltr">{row.lineNo}</span>,
              },
              {
                id: "status",
                header: activeLocaleHeader(d.hrColStatus),
                accessor: (row) => row.status,
                render: (row) => (
                  <Badge tone={row.status === "PENDING" ? "primary" : "neutral"}>
                    {localizedHrAnomalyStatus(d, row.status)}
                  </Badge>
                ),
              },
              {
                id: "reason",
                header: activeLocaleHeader(d.hrImportAnomaliesColReason),
                accessor: (row) => localizedHrAnomalyReason(d, row.reason),
                render: (row) => localizedHrAnomalyReason(d, row.reason),
              },
              {
                id: "employeeCode",
                header: activeLocaleHeader(d.hrColEmployee),
                accessor: (row) => row.employeeCode ?? "—",
                render: (row) => (
                  <span className="font-mono text-sm" dir="ltr">
                    {row.employeeCode ?? "—"}
                  </span>
                ),
              },
              {
                id: "punchAt",
                header: activeLocaleHeader(d.hrColCheckIn),
                accessor: (row) => row.punchAt ?? "—",
                render: (row) => (
                  <span className="font-mono text-sm" dir="ltr">
                    {row.punchAt ?? "—"}
                  </span>
                ),
              },
              {
                id: "detail",
                header: activeLocaleHeader(d.hrImportAnomaliesColDetail),
                accessor: (row) => row.detail ?? "—",
                render: (row) => <span className="text-gray-700">{row.detail ?? "—"}</span>,
              },
              {
                id: "rawLine",
                header: activeLocaleHeader(d.hrImportAnomaliesColRaw),
                accessor: (row) => row.rawLine,
                render: (row) => (
                  <span className="font-mono text-xs" dir="ltr">
                    {row.rawLine}
                  </span>
                ),
              },
            ]}
            rows={[...anomalyRows]}
            rowKey={(row) => row.id}
            sort={anomalySort}
            onSortChange={setAnomalySort}
            loading={anomalyBusy && anomalyRows.length === 0}
            empty={{ title: d.hrImportAnomaliesEmpty }}
            rowActions={[
              {
                id: "resolve",
                label: d.hrImportRejectBtn,
                onSelect: (row) => {
                  setResolveTarget(row);
                  setResolveMode("REJECT");
                  setResolveEmployee("");
                  setResolveCheckIn("");
                  setResolveCheckOut("");
                  setResolveNote("");
                  setResolveError(null);
                },
              },
              ...(employees.length > 0
                ? [
                    {
                      id: "import",
                      label: d.hrImportImportBtn,
                      onSelect: (row: ImportAnomalyRow) => {
                        setResolveTarget(row);
                        setResolveMode("IMPORT");
                        setResolveEmployee("");
                        setResolveCheckIn("");
                        setResolveCheckOut("");
                        setResolveNote("");
                        setResolveError(null);
                      },
                    },
                  ]
                : []),
            ]}
          />
          <p className="text-xs text-gray-600">{d.hrImportResolveNote}</p>
          <Pagination
            page={anomalyPage}
            pageSize={PAGE_SIZE}
            total={anomalyTotal}
            onPageChange={(page) => {
              setAnomalyPage(page);
              void loadAnomalies(anomalyStatus, page);
            }}
            announceLabel={formatMessage(d.hrPageOf, {
              current: anomalyPage,
              total: anomalyPages,
            })}
          />
        </div>
      </Card>

      {/* The reviewer's explicit act — REJECT or IMPORT-with-corrections. */}
      <Dialog
        open={resolveTarget !== null}
        onOpenChange={(open) => {
          if (!open) setResolveTarget(null);
        }}
        title={
          resolveTarget === null
            ? d.hrImportQuarantine
            : `${d.hrImportQuarantine} — ${d.hrImportAnomaliesColLine} ${resolveTarget.lineNo}`
        }
      >
        <div className="flex flex-col gap-3">
          {resolveError !== null && <ErrorNotice>{resolveError}</ErrorNotice>}
          <div className="flex flex-col gap-2">
            <Select
              id="hr-resolve-action"
              label={d.hrColStatus}
              value={resolveMode}
              onValueChange={(value) => {
                setResolveMode(value === "IMPORT" ? "IMPORT" : "REJECT");
              }}
              options={[
                { value: "REJECT", label: d.hrImportRejectBtn },
                { value: "IMPORT", label: d.hrImportImportBtn },
              ]}
            />
          </div>
          {resolveMode === "IMPORT" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Select
                id="hr-resolve-employee"
                label={d.hrImportResolveEmployee}
                value={resolveEmployee}
                onValueChange={setResolveEmployee}
                options={employees.map((employee) => ({
                  value: employee.id,
                  label: `${employee.code} · ${localizedName(employee.name, employee.nameAr, locale)}`,
                }))}
                required
              />
              <Input
                id="hr-resolve-checkin"
                label={d.hrImportResolveCheckIn}
                value={resolveCheckIn}
                onValueChange={setResolveCheckIn}
                placeholder="2026-06-01 08:05"
                mono
                bidiIsolate
                required
              />
              <Input
                id="hr-resolve-checkout"
                label={d.hrImportResolveCheckOut}
                value={resolveCheckOut}
                onValueChange={setResolveCheckOut}
                placeholder="2026-06-01 17:00"
                mono
                bidiIsolate
              />
            </div>
          )}
          <Input
            id="hr-resolve-note"
            label={d.hrImportResolveNote}
            value={resolveNote}
            onValueChange={setResolveNote}
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setResolveTarget(null)} disabled={resolveBusy}>
              {d.commonCancel}
            </Button>
            <Button variant="primary" onClick={() => void resolve()} loading={resolveBusy}>
              {resolveMode === "IMPORT" ? d.hrImportImportBtn : d.hrImportRejectBtn}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
