"use client";

/**
 * PHASE-040 T-08 — the /settings/imports hub workspace (wizard archetype;
 * PAGE_ARCHETYPES §9): four tabs over the toolkit API surface.
 *
 * - Wizard: kind (bilingual catalog) → file (presigned slot → PUT) →
 *   preview-headers (auto-detected mapping + sample rows) → the mapping
 *   table (manual override per column, save-mapping) → the BR-066 dry-run
 *   (zero writes) → the bilingual report → ack-gated atomic commit
 *   (polling until COMMITTED/FAILED) → the done screen with the
 *   error-report export. BUDGETS rides the PHASE-028 grid (no mapping; a
 *   DRAFT budget is a required option).
 * - Jobs: the history table (kind labels resolved from the catalog).
 * - Mappings: the saved-mapping list (both directions) + delete.
 * - Adapters: the IN-26 registry (QuickBooks/Odoo/Excel-generic) with the
 *   documented-mapping templates as downloadable CSV artifacts.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ChangeEvent, FormEvent, JSX } from "react";

import { Badge, Button, Checkbox, DataTable, Select, Tabs, useToast } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type {
  AttachmentIssuedUpload,
  BudgetListRow,
  DemoSeedSummary,
  ToolkitAdapterInfo,
  ToolkitHeadersPreview,
  ToolkitJobRow,
  ToolkitKindInfo,
  ToolkitMappingRow,
} from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { formatMessage, localizedOnboardingError } from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice, InfoNotice, SuccessNotice } from "./notices";
import { ImportStatusChip } from "./import-report";
import { activeLocaleHeader } from "./table-header";

const MAX_TOOLKIT_BYTES = 32 * 1024 * 1024;
const CSV_MIME = "text/csv";
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const POLL_INTERVAL_MS = 2000;

type HubTab = "wizard" | "jobs" | "mappings" | "adapters";
type WizardPhase = "setup" | "mapping" | "review" | "done" | "failed";

/** The toolkit dry-run report (bilingual per-row issues; export for the rest). */
interface ToolkitReportView {
  kind: string;
  summary: { total: number; valid: number; invalid: number; duplicates: number; warnings: number };
  unmappedColumns: string[];
  issues: { row: number; field: string; en: string; ar: string; duplicate: boolean }[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Tolerant narrowing of the opaque job `report` payload. */
function reportOf(value: unknown): ToolkitReportView | null {
  if (!isRecord(value) || !isRecord(value.summary)) {
    return null;
  }
  const num = (entry: unknown): number => (typeof entry === "number" ? entry : 0);
  const issues: ToolkitReportView["issues"] = [];
  if (Array.isArray(value.issues)) {
    for (const entry of value.issues) {
      if (!isRecord(entry)) continue;
      if (typeof entry.row !== "number" || typeof entry.field !== "string") continue;
      if (typeof entry.en !== "string" || typeof entry.ar !== "string") continue;
      issues.push({
        row: entry.row,
        field: entry.field,
        en: entry.en,
        ar: entry.ar,
        duplicate: entry.duplicate === true,
      });
    }
  }
  const unmapped = Array.isArray(value.unmappedColumns)
    ? value.unmappedColumns.filter((entry): entry is string => typeof entry === "string")
    : [];
  return {
    kind: typeof value.kind === "string" ? value.kind : "",
    summary: {
      total: num(value.summary.total),
      valid: num(value.summary.valid),
      invalid: num(value.summary.invalid),
      duplicates: num(value.summary.duplicates),
      warnings: num(value.summary.warnings),
    },
    unmappedColumns: unmapped,
    issues,
  };
}

function sanitizeFilenameInput(name: string): string {
  return name.trim().replace(/[^A-Za-z0-9._-]+/g, "-");
}

function effectiveContentType(file: File): string | null {
  if (file.type === CSV_MIME || file.type === XLSX_MIME) {
    return file.type;
  }
  if (file.type === "") {
    const lower = file.name.toLowerCase();
    if (lower.endsWith(".csv")) return CSV_MIME;
    if (lower.endsWith(".xlsx")) return XLSX_MIME;
  }
  return null;
}

function randomUploadToken(): string {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function jobStatusLabel(d: ReturnType<typeof getDictionary>, status: ToolkitJobRow["status"]): string {
  switch (status) {
    case "PREVIEWING":
      return d.importStatusPreviewing;
    case "PREVIEW_READY":
      return d.importStatusPreviewReady;
    case "COMMITTING":
      return d.importStatusCommitting;
    case "COMMITTED":
      return d.importStatusCommitted;
    default:
      return d.importStatusFailed;
  }
}

function kindLabelOf(kinds: readonly ToolkitKindInfo[], kind: string, locale: Locale): string {
  const found = kinds.find((entry) => entry.kind === kind);
  return found === undefined ? kind : found.label[locale];
}

export function ImportsToolkitWorkspace({
  locale,
  canManage,
  kinds,
  adapters,
  budgets,
  initialJobs,
  initialMappings,
}: {
  locale: Locale;
  canManage: boolean;
  kinds: readonly ToolkitKindInfo[];
  adapters: readonly ToolkitAdapterInfo[];
  budgets: readonly BudgetListRow[];
  initialJobs: readonly ToolkitJobRow[];
  initialMappings: readonly ToolkitMappingRow[];
}): JSX.Element {
  const d = getDictionary(locale);
  const router = useRouter();
  const { toast } = useToast();

  const [tab, setTab] = useState<HubTab>("wizard");

  // -- wizard state -----------------------------------------------------------------
  const [phase, setPhase] = useState<WizardPhase>("setup");
  const [kind, setKind] = useState<string>(kinds[0]?.kind ?? "COA");
  const [format, setFormat] = useState<string>("CSV");
  const [file, setFile] = useState<File | null>(null);
  const [budgetId, setBudgetId] = useState<string>(budgets[0]?.id ?? "");
  const [savedMappingId, setSavedMappingId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [fileKey, setFileKey] = useState<string>("");
  const [preview, setPreview] = useState<ToolkitHeadersPreview | null>(null);
  const [columnMap, setColumnMap] = useState<Record<string, string>>({});
  const [mappingName, setMappingName] = useState<string>("");

  const [job, setJob] = useState<ToolkitJobRow | null>(null);
  const [report, setReport] = useState<ToolkitReportView | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const pollRef = useRef<number | null>(null);

  // -- tab data ---------------------------------------------------------------------
  const [jobs, setJobs] = useState<readonly ToolkitJobRow[]>(initialJobs);
  const [mappings, setMappings] = useState<readonly ToolkitMappingRow[]>(initialMappings);
  const [jobsBusy, setJobsBusy] = useState(false);
  const [mappingBusyId, setMappingBusyId] = useState<string | null>(null);

  const activeKind = useMemo(
    () => kinds.find((entry) => entry.kind === kind),
    [kinds, kind],
  );
  const isGridKind = activeKind?.gridFormat === true;
  const needsBudget = activeKind?.requiredOptions.includes("budgetId") === true;
  const importMappingsForKind = useMemo(
    () => mappings.filter((entry) => entry.direction === "IMPORT" && entry.kind === kind),
    [mappings, kind],
  );

  useEffect(() => {
    if (activeKind === undefined) return;
    if (!activeKind.formats.includes(format)) {
      setFormat(activeKind.formats[0] ?? "CSV");
    }
  }, [activeKind, format]);

  useEffect(() => {
    return () => {
      if (pollRef.current !== null) {
        window.clearTimeout(pollRef.current);
      }
    };
  }, []);

  function resetWizard(): void {
    if (pollRef.current !== null) {
      window.clearTimeout(pollRef.current);
      pollRef.current = null;
    }
    setPhase("setup");
    setFile(null);
    setError(null);
    setFileKey("");
    setPreview(null);
    setColumnMap({});
    setMappingName("");
    setSavedMappingId("");
    setJob(null);
    setReport(null);
    setAcknowledged(false);
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>): void {
    setFile(event.target.files?.[0] ?? null);
  }

  /** setup → (upload → preview-headers) → mapping | review. */
  async function onStart(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    if (file === null) {
      setError(d.importFileRequired);
      return;
    }
    if (file.size > MAX_TOOLKIT_BYTES) {
      setError(d.importFileTooLarge);
      return;
    }
    const contentType = effectiveContentType(file);
    if (contentType === null) {
      setError(d.importFileTypeInvalid);
      return;
    }
    if (needsBudget && budgetId === "") {
      setError(d.toolkitBudgetRequired);
      return;
    }
    setBusy(true);
    const safeName = sanitizeFilenameInput(file.name);

    // 1) the direct-upload slot (imports/uploads — the files presigned PUT)
    const issued = await bffFetch<AttachmentIssuedUpload>("imports/uploads", {
      method: "POST",
      body: { filename: safeName, contentType, sizeBytes: file.size },
    });
    if (!issued.ok) {
      setBusy(false);
      setError(localizedOnboardingError(d, issued.error, issued.retryAfterSeconds));
      return;
    }

    // 2) PUT the bytes to the presigned URL (direct storage upload)
    try {
      const uploaded = await fetch(issued.data.uploadUrl, {
        method: "PUT",
        body: file,
        headers: { "content-type": contentType },
      });
      if (!uploaded.ok) {
        setBusy(false);
        setError(d.importUploadFailed);
        return;
      }
    } catch {
      setBusy(false);
      setError(d.importUploadFailed);
      return;
    }

    // 3) headers + sample + auto-detect (read-only)
    const headers = await bffFetch<ToolkitHeadersPreview>("imports/preview-headers", {
      method: "POST",
      body: { fileKey: issued.data.key, format: format === "XLSX" ? "XLSX" : "CSV", kind },
    });
    setBusy(false);
    if (!headers.ok) {
      setError(localizedOnboardingError(d, headers.error, headers.retryAfterSeconds));
      return;
    }
    setFileKey(issued.data.key);
    setPreview(headers.data);

    // A saved mapping of this kind pre-fills the column map (acceptance 4).
    const prefill =
      savedMappingId !== ""
        ? (importMappingsForKind.find((entry) => entry.id === savedMappingId)?.columnMap ?? null)
        : null;
    const nextMap: Record<string, string> = {};
    if (isRecord(prefill)) {
      for (const [canonical, header] of Object.entries(prefill)) {
        if (typeof header === "string" && headers.data.headers.includes(header)) {
          nextMap[canonical] = header;
        }
      }
    }
    if (Object.keys(nextMap).length === 0) {
      Object.assign(nextMap, headers.data.mapping);
    }
    setColumnMap(nextMap);
    setPhase(isGridKind ? "review" : "mapping");
  }

  /** mapping → review (or straight to the dry-run for grid kinds). */
  async function runDryRun(): Promise<void> {
    setError(null);
    if (needsBudget && budgetId === "") {
      setError(d.toolkitBudgetRequired);
      return;
    }
    if (!isGridKind) {
      const missingRequired = (activeKind?.columns ?? []).filter(
        (column) => column.required && (columnMap[column.name] ?? "") === "",
      );
      if (missingRequired.length > 0) {
        setError(`${d.toolkitReportUnmapped}: ${missingRequired.map((c) => c.label[locale]).join(", ")}`);
        return;
      }
    }
    setBusy(true);
    const created = await bffFetch<ToolkitJobRow>("imports/jobs", {
      method: "POST",
      body: {
        kind,
        format: format === "XLSX" ? "XLSX" : "CSV",
        uploadToken: randomUploadToken(),
        fileKey,
        fileName: file === null ? null : sanitizeFilenameInput(file.name),
        mappingId: savedMappingId === "" ? null : savedMappingId,
        columnMap: isGridKind ? null : columnMap,
        options: needsBudget ? { budgetId } : null,
      },
    });
    setBusy(false);
    if (!created.ok) {
      setError(localizedOnboardingError(d, created.error, created.retryAfterSeconds));
      return;
    }
    setJob(created.data);
    setReport(reportOf(created.data.report));
    setAcknowledged(false);
    setPhase("review");
    router.refresh();
  }

  /** Save the current mapping for reuse (both directions live server-side). */
  async function saveMapping(): Promise<void> {
    if (mappingName.trim() === "") return;
    setBusy(true);
    const saved = await bffFetch<ToolkitMappingRow>("imports/mappings", {
      method: "POST",
      body: {
        name: mappingName.trim(),
        direction: "IMPORT",
        kind,
        entity: null,
        columnMap,
        options: null,
      },
    });
    setBusy(false);
    if (!saved.ok) {
      setError(localizedOnboardingError(d, saved.error, saved.retryAfterSeconds));
      return;
    }
    setMappings((rows) => [...rows, saved.data]);
    setSavedMappingId(saved.data.id);
    setMappingName("");
    toast({ tone: "success", title: d.toolkitMappingSaveToast });
  }

  function pollJobStatus(jobId: string): void {
    const tick = async (): Promise<void> => {
      const result = await bffFetch<ToolkitJobRow>(`imports/jobs/${jobId}`);
      if (!result.ok) {
        setPhase("failed");
        return;
      }
      setJob(result.data);
      if (result.data.status === "COMMITTED") {
        setPhase("done");
        toast({ tone: "success", title: d.importCommitToast });
        void refreshJobs();
        router.refresh();
        return;
      }
      if (result.data.status === "FAILED") {
        setPhase("failed");
        return;
      }
      pollRef.current = window.setTimeout(() => void tick(), POLL_INTERVAL_MS);
    };
    pollRef.current = window.setTimeout(() => void tick(), POLL_INTERVAL_MS);
  }

  async function onCommit(): Promise<void> {
    if (job === null) return;
    setBusy(true);
    const committed = await bffFetch<ToolkitJobRow>(`imports/jobs/${job.id}/commit`, {
      method: "POST",
      body: { acknowledged },
    });
    setBusy(false);
    if (!committed.ok) {
      setError(localizedOnboardingError(d, committed.error, committed.retryAfterSeconds));
      setPhase("failed");
      return;
    }
    setJob(committed.data);
    if (committed.data.status === "COMMITTED") {
      setPhase("done");
      toast({ tone: "success", title: d.importCommitToast });
      void refreshJobs();
      router.refresh();
      return;
    }
    if (committed.data.status === "FAILED") {
      setPhase("failed");
      return;
    }
    pollJobStatus(committed.data.id);
  }

  async function downloadErrorReport(): Promise<void> {
    if (job === null) return;
    const issued = await bffFetch<{ url: string }>(`imports/jobs/${job.id}/error-report`);
    if (issued.ok && typeof issued.data.url === "string") {
      window.open(issued.data.url, "_blank", "noopener");
    }
  }

  async function refreshJobs(): Promise<void> {
    setJobsBusy(true);
    const result = await bffFetch<readonly ToolkitJobRow[]>("imports/jobs?limit=25");
    setJobsBusy(false);
    if (result.ok) {
      setJobs(result.data);
    }
  }

  async function deleteMapping(id: string): Promise<void> {
    setMappingBusyId(id);
    const result = await bffFetch<{ deleted: boolean }>(`imports/mappings/${id}`, {
      method: "DELETE",
    });
    setMappingBusyId(null);
    if (result.ok) {
      setMappings((rows) => rows.filter((entry) => entry.id !== id));
      if (savedMappingId === id) {
        setSavedMappingId("");
      }
      toast({ tone: "success", title: d.toolkitMappingDeletedToast });
    }
  }

  async function downloadAdapterTemplate(key: string): Promise<void> {
    const result = await bffFetch<{ key: string; url: string }>(`imports/adapters/${key}/template`);
    if (result.ok && typeof result.data.url === "string") {
      window.open(result.data.url, "_blank", "noopener");
    }
  }

  const headerOptions = (preview?.headers ?? []).map((header) => ({
    value: header,
    label: header,
  }));

  return (
    <div className="flex flex-col gap-6">
      <Tabs
        items={[
          { value: "wizard", label: d.toolkitTabWizard },
          { value: "jobs", label: d.toolkitTabJobs },
          { value: "mappings", label: d.toolkitTabMappings },
          { value: "adapters", label: d.toolkitTabAdapters },
        ]}
        value={tab}
        onValueChange={(value) => setTab(value as HubTab)}
      >
        {tab === "wizard" && (
          <div className="flex flex-col gap-4">
            {!canManage && <InfoNotice>{d.errorsForbidden}</InfoNotice>}

            {phase === "setup" && (
              <Card title={d.toolkitStepKindTitle} ariaLabel={d.toolkitStepKindTitle}>
                <p className="mb-4 text-sm text-gray-600">{d.toolkitStepKindHint}</p>
                <form onSubmit={onStart} noValidate className="flex flex-col gap-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Select
                      id="toolkit-kind"
                      label={d.importDataKindLabel}
                      value={kind}
                      onValueChange={setKind}
                      options={kinds.map((entry) => ({
                        value: entry.kind,
                        label: entry.label[locale],
                      }))}
                      required
                    />
                    <Select
                      id="toolkit-format"
                      label={d.importFormatLabel}
                      value={format}
                      onValueChange={setFormat}
                      options={(activeKind?.formats ?? ["CSV"]).map((entry) => ({
                        value: entry,
                        label: entry === "XLSX" ? d.importFormatXlsx : d.importFormatCsv,
                      }))}
                      required
                    />
                  </div>
                  {activeKind !== undefined && (
                    <div className="rounded-md border border-subtle bg-surface-sunken px-3 py-2">
                      <p className="text-sm font-medium text-gray-800">
                        {activeKind.label[locale]}
                      </p>
                      <p className="text-xs text-gray-600">{activeKind.description[locale]}</p>
                      <p className="mt-1 text-xs text-gray-500">
                        {d.toolkitKindFormats}: {activeKind.formats.join(" · ")}
                        {activeKind.columns.some((column) => column.pii) && (
                          <span className="ms-2">
                            <Badge tone="neutral">{d.toolkitPiiNote}</Badge>
                          </span>
                        )}
                      </p>
                    </div>
                  )}
                  {isGridKind && <InfoNotice>{d.toolkitGridKindNote}</InfoNotice>}
                  {needsBudget && (
                    <Select
                      id="toolkit-budget"
                      label={d.toolkitBudgetPick}
                      value={budgetId}
                      onValueChange={setBudgetId}
                      options={budgets.map((entry) => ({
                        value: entry.id,
                        label: `${entry.code} — ${locale === "ar" && entry.nameAr !== null ? entry.nameAr : entry.name}`,
                      }))}
                      required
                    />
                  )}
                  {importMappingsForKind.length > 0 && (
                    <Select
                      id="toolkit-saved-mapping"
                      label={d.toolkitTabMappings}
                      value={savedMappingId}
                      onValueChange={setSavedMappingId}
                      options={[
                        { value: "", label: "—" },
                        ...importMappingsForKind.map((entry) => ({
                          value: entry.id,
                          label: entry.name,
                        })),
                      ]}
                    />
                  )}
                  <div className="flex flex-col gap-1">
                    <label htmlFor="toolkit-file" className="text-sm font-medium text-gray-700">
                      {d.toolkitStepFileTitle} — {d.importFileLabel}
                    </label>
                    <input
                      id="toolkit-file"
                      type="file"
                      accept={format === "XLSX" ? ".xlsx" : ".csv"}
                      onChange={onFileChange}
                      disabled={!canManage}
                      className="rounded-md border border-default bg-surface-card px-3 py-1.5 text-sm text-gray-800 outline-none hover:border-strong"
                    />
                    <p className="text-xs text-gray-600">{d.toolkitFilePick}</p>
                  </div>
                  {error !== null && <ErrorNotice>{error}</ErrorNotice>}
                  <div className="flex items-center justify-end border-t border-subtle pt-3">
                    <Button type="submit" variant="primary" loading={busy} disabled={!canManage}>
                      {d.toolkitUploadAndAnalyze}
                    </Button>
                  </div>
                </form>
              </Card>
            )}

            {phase === "mapping" && preview !== null && activeKind !== undefined && (
              <Card title={d.toolkitStepMapTitle} ariaLabel={d.toolkitStepMapTitle}>
                <p className="mb-4 text-sm text-gray-600">{d.toolkitStepMapHint}</p>
                {Object.keys(preview.mapping).length > 0 && (
                  <InfoNotice>{d.toolkitAutoDetected}</InfoNotice>
                )}
                <DataTable
                  columns={[
                    {
                      id: "canonical",
                      header: activeLocaleHeader(d.toolkitColCanonical),
                      accessor: (column) => column.label[locale],
                      render: (column) => (
                        <span className="text-sm">
                          {column.label[locale]}
                          <span className="ms-1 font-mono text-xs text-gray-500">{column.name}</span>
                        </span>
                      ),
                    },
                    {
                      id: "required",
                      header: activeLocaleHeader(d.colStatus),
                      accessor: (column) => (column.required ? "1" : "0"),
                      render: (column) =>
                        column.required ? (
                          <Badge tone="neutral">{d.toolkitColRequired}</Badge>
                        ) : (
                          <span className="text-xs text-gray-500">{d.toolkitColOptional}</span>
                        ),
                    },
                    {
                      id: "type",
                      header: activeLocaleHeader(d.toolkitColType),
                      accessor: (column) => column.type,
                      mono: true,
                    },
                    {
                      id: "header",
                      header: activeLocaleHeader(d.toolkitColHeader),
                      accessor: (column) => columnMap[column.name] ?? "",
                      render: (column) => (
                        <Select
                          id={`map-${column.name}`}
                          value={columnMap[column.name] ?? ""}
                          onValueChange={(value) => {
                            setColumnMap((current) => {
                              const next = { ...current };
                              if (value === "") {
                                delete next[column.name];
                              } else {
                                next[column.name] = value;
                              }
                              return next;
                            });
                          }}
                          options={[{ value: "", label: "—" }, ...headerOptions]}
                        />
                      ),
                    },
                  ]}
                  rows={[...activeKind.columns]}
                  rowKey={(column) => column.name}
                  empty={{ title: d.toolkitMapEmpty }}
                />
                {preview.sample.length > 0 && (
                  <div className="mt-4">
                    <p className="mb-2 text-sm font-medium text-gray-700">{d.toolkitSampleTitle}</p>
                    <div className="max-h-64 overflow-auto rounded-md border border-subtle">
                      <table className="w-full text-xs">
                        <thead className="bg-surface-sunken">
                          <tr>
                            <th className="px-2 py-1 text-start font-medium text-gray-600">#</th>
                            {preview.headers.map((header) => (
                              <th key={header} className="px-2 py-1 text-start font-medium text-gray-600">
                                {header}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {preview.sample.map((row, index) => (
                            <tr key={index} className="border-t border-subtle">
                              <td className="px-2 py-1 font-mono text-gray-500">{index + 2}</td>
                              {preview.headers.map((header, columnIndex) => (
                                <td key={header} className="max-w-40 truncate px-2 py-1">
                                  {row[columnIndex] ?? ""}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
                <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
                  <div>
                    <label htmlFor="toolkit-mapping-name" className="text-sm font-medium text-gray-700">
                      {d.toolkitSaveMappingName}
                    </label>
                    <input
                      id="toolkit-mapping-name"
                      type="text"
                      value={mappingName}
                      maxLength={100}
                      onChange={(event) => setMappingName(event.target.value)}
                      className="mt-1 w-full rounded-md border border-default bg-surface-card px-3 py-1.5 text-sm text-gray-800 outline-none hover:border-strong"
                    />
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    loading={busy}
                    disabled={mappingName.trim() === "" || !canManage}
                    onClick={() => void saveMapping()}
                  >
                    {d.toolkitSaveMappingBtn}
                  </Button>
                </div>
                {error !== null && <div className="mt-3"><ErrorNotice>{error}</ErrorNotice></div>}
                <div className="mt-4 flex items-center justify-end gap-2 border-t border-subtle pt-3">
                  <Button type="button" variant="ghost" onClick={resetWizard}>
                    {d.importNewJob}
                  </Button>
                  <Button
                    type="button"
                    variant="primary"
                    loading={busy}
                    disabled={!canManage}
                    onClick={() => void runDryRun()}
                  >
                    {d.toolkitRunDryRun}
                  </Button>
                </div>
              </Card>
            )}

            {phase === "review" && job !== null && (
              <Card title={d.toolkitStepReviewTitle} ariaLabel={d.toolkitStepReviewTitle}>
                <div className="flex flex-col gap-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <ImportStatusChip status={job.status}>
                      {jobStatusLabel(d, job.status)}
                    </ImportStatusChip>
                    {busy && <span className="text-sm text-gray-600">{d.toolkitDryRunRunning}</span>}
                  </div>
                  {report !== null && (
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                      {[
                        { term: d.importColTotal, value: report.summary.total },
                        { term: d.importColValid, value: report.summary.valid },
                        { term: d.importColInvalid, value: report.summary.invalid },
                        { term: d.importColDuplicates, value: report.summary.duplicates },
                        { term: d.importColWarnings, value: report.summary.warnings },
                      ].map((entry) => (
                        <div key={entry.term} className="rounded-md border border-subtle px-3 py-2">
                          <p className="text-xs text-gray-500">{entry.term}</p>
                          <p className="font-mono text-sm text-gray-900">{entry.value}</p>
                        </div>
                      ))}
                    </div>
                  )}
                  {report !== null && report.unmappedColumns.length > 0 && (
                    <InfoNotice>
                      {d.toolkitUnmappedHeaders}: {report.unmappedColumns.join(", ")}
                    </InfoNotice>
                  )}
                  {report !== null && report.issues.length > 0 && (
                    <div className="max-h-72 overflow-auto rounded-md border border-subtle">
                      <table className="w-full text-xs">
                        <thead className="bg-surface-sunken">
                          <tr>
                            <th className="px-2 py-1 text-start font-medium text-gray-600">{d.importColRow}</th>
                            <th className="px-2 py-1 text-start font-medium text-gray-600">{d.toolkitColCanonical}</th>
                            <th className="px-2 py-1 text-start font-medium text-gray-600">{d.importColErrors}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {report.issues.map((issue, index) => (
                            <tr key={index} className="border-t border-subtle">
                              <td className="px-2 py-1 font-mono">{issue.row}</td>
                              <td className="px-2 py-1 font-mono">{issue.field}</td>
                              <td className="px-2 py-1">
                                <span>{locale === "ar" ? issue.ar : issue.en}</span>
                                <span dir={locale === "ar" ? "ltr" : "rtl"} className="block text-gray-500">
                                  {locale === "ar" ? issue.en : issue.ar}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {report !== null && (report.summary.invalid > 0 || report.summary.duplicates > 0) && (
                    <div className="flex flex-col gap-1">
                      <Checkbox
                        label={d.toolkitCommitAckLabel}
                        checked={acknowledged}
                        onCheckedChange={(value) => setAcknowledged(value === true)}
                      />
                      <p className="text-xs text-gray-500">{d.toolkitCommitAckHint}</p>
                    </div>
                  )}
                  {error !== null && <ErrorNotice>{error}</ErrorNotice>}
                  <div className="flex items-center justify-end gap-2 border-t border-subtle pt-3">
                    <Button type="button" variant="ghost" onClick={resetWizard}>
                      {d.importNewJob}
                    </Button>
                    {report !== null && report.issues.length > 0 && (
                      <Button type="button" variant="secondary" onClick={() => void downloadErrorReport()}>
                        {d.toolkitErrorExportBtn}
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="primary"
                      loading={busy}
                      disabled={
                        !canManage ||
                        job.status === "COMMITTED" ||
                        job.status === "COMMITTING" ||
                        (report !== null &&
                          (report.summary.invalid > 0 || report.summary.duplicates > 0) &&
                          !acknowledged)
                      }
                      onClick={() => void onCommit()}
                    >
                      {busy ? d.toolkitCommitting : d.toolkitCommitBtn}
                    </Button>
                  </div>
                </div>
              </Card>
            )}

            {phase === "done" && job !== null && (
              <Card title={d.toolkitCommittedTitle} ariaLabel={d.toolkitCommittedTitle}>
                <div className="flex flex-col gap-3">
                  <SuccessNotice>
                    {formatMessage(d.toolkitCommittedSummary, { count: job.committedRows })}
                  </SuccessNotice>
                  <div className="flex items-center justify-end">
                    <Button variant="secondary" onClick={resetWizard}>
                      {d.toolkitStartNew}
                    </Button>
                  </div>
                </div>
              </Card>
            )}

            {phase === "failed" && job !== null && (
              <Card title={d.importStep3Title} ariaLabel={d.importStep3Title}>
                <div className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <ImportStatusChip status={job.status}>{jobStatusLabel(d, job.status)}</ImportStatusChip>
                    {job.error !== null && job.error !== "" && (
                      <span className="font-mono text-xs text-gray-600">{job.error}</span>
                    )}
                  </div>
                  <ErrorNotice>{d.toolkitCommitFailed}</ErrorNotice>
                  <div className="flex items-center justify-end gap-2">
                    <Button variant="secondary" onClick={resetWizard}>
                      {d.toolkitStartNew}
                    </Button>
                  </div>
                </div>
              </Card>
            )}
          </div>
        )}

        {tab === "jobs" && (
          <Card title={d.toolkitJobsTitle} ariaLabel={d.toolkitJobsTitle}>
            <div className="mb-3 flex justify-end">
              <Button variant="secondary" loading={jobsBusy} onClick={() => void refreshJobs()}>
                {d.toolkitJobsRefresh}
              </Button>
            </div>
            <DataTable
              columns={[
                {
                  id: "kind",
                  header: activeLocaleHeader(d.importDataKindLabel),
                  accessor: (row) => row.kind,
                  render: (row) => <Badge tone="neutral">{kindLabelOf(kinds, row.kind, locale)}</Badge>,
                },
                {
                  id: "format",
                  header: activeLocaleHeader(d.importFormatLabel),
                  accessor: (row) => row.format,
                  mono: true,
                },
                {
                  id: "file",
                  header: activeLocaleHeader(d.toolkitJobsColFile),
                  accessor: (row) => row.fileName ?? "",
                  mono: true,
                  render: (row) =>
                    row.fileName === null || row.fileName === "" ? (
                      <span className="text-gray-500">—</span>
                    ) : (
                      row.fileName
                    ),
                },
                {
                  id: "rows",
                  header: activeLocaleHeader(d.importJobColRows),
                  accessor: (row) => `${row.committedRows}/${row.totalRows}`,
                  numeric: true,
                  render: (row) => (
                    <span className="font-mono">
                      {row.committedRows}/{row.totalRows}
                    </span>
                  ),
                },
                {
                  id: "status",
                  header: activeLocaleHeader(d.colStatus),
                  accessor: (row) => row.status,
                  render: (row) => (
                    <ImportStatusChip status={row.status}>{jobStatusLabel(d, row.status)}</ImportStatusChip>
                  ),
                },
              ]}
              rows={[...jobs]}
              rowKey={(row) => row.id}
              empty={{ title: d.toolkitJobsEmpty }}
            />
          </Card>
        )}

        {tab === "mappings" && (
          <Card title={d.toolkitMappingsTitle} ariaLabel={d.toolkitMappingsTitle}>
            <DataTable
              columns={[
                {
                  id: "name",
                  header: activeLocaleHeader(d.toolkitMappingColName),
                  accessor: (row) => row.name,
                },
                {
                  id: "kind",
                  header: activeLocaleHeader(d.toolkitMappingColKind),
                  accessor: (row) => row.kind,
                  render: (row) => <Badge tone="neutral">{kindLabelOf(kinds, row.kind, locale)}</Badge>,
                },
                {
                  id: "direction",
                  header: activeLocaleHeader(d.toolkitMappingColDirection),
                  accessor: (row) => row.direction,
                  render: (row) => (
                    <Badge tone="neutral">
                      {row.direction === "IMPORT"
                        ? d.toolkitMappingDirectionImport
                        : d.toolkitMappingDirectionExport}
                    </Badge>
                  ),
                },
                {
                  id: "updated",
                  header: activeLocaleHeader(d.toolkitMappingColUpdated),
                  accessor: (row) => row.updatedAt,
                  mono: true,
                  render: (row) => (
                    <span className="font-mono text-xs">{row.updatedAt.slice(0, 10)}</span>
                  ),
                },
                {
                  id: "actions",
                  header: activeLocaleHeader(" "),
                  accessor: () => "",
                  render: (row) => (
                    <Button
                      variant="secondary"
                      loading={mappingBusyId === row.id}
                      disabled={!canManage}
                      onClick={() => void deleteMapping(row.id)}
                    >
                      {d.toolkitMappingDeleteBtn}
                    </Button>
                  ),
                },
              ]}
              rows={[...mappings]}
              rowKey={(row) => row.id}
              empty={{ title: d.toolkitMappingsEmpty }}
            />
          </Card>
        )}

        {tab === "adapters" && (
          <Card title={d.toolkitAdaptersTitle} ariaLabel={d.toolkitAdaptersTitle}>
            <p className="mb-4 text-sm text-gray-600">{d.toolkitAdaptersHint}</p>
            <div className="grid gap-4 md:grid-cols-2">
              {adapters.map((adapter) => (
                <div key={adapter.key} className="rounded-md border border-subtle p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium text-gray-900">{adapter.label[locale]}</p>
                      <p className="text-xs text-gray-500">
                        {d.toolkitAdapterColSource}: {adapter.source} ·{" "}
                        {d.toolkitAdapterColTarget}: {adapter.targetKind} · {adapter.format}
                      </p>
                    </div>
                    <Badge tone="neutral">
                      {adapter.engine === "toolkit" ? d.toolkitTabWizard : d.toolkitAdapterEngineConsole}
                    </Badge>
                  </div>
                  <ul className="mt-3 flex flex-wrap gap-1">
                    {adapter.columns.map((column) => (
                      <li
                        key={column.source}
                        className="rounded-sm border border-subtle px-1.5 py-0.5 font-mono text-xs text-gray-700"
                        title={
                          column.canonical === null
                            ? "—"
                            : `${column.canonical}${column.required ? " *" : ""}`
                        }
                      >
                        {column.source}
                        {column.required === true && <span className="text-danger-text"> *</span>}
                        {column.requiresVerification === true && (
                          <span className="ms-1 text-warning-text" title={d.toolkitAdapterRequiresVerification}>
                            ?
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                  <div className="mt-3 flex justify-end">
                    <Button
                      variant="secondary"
                      disabled={!canManage}
                      onClick={() => void downloadAdapterTemplate(adapter.key)}
                    >
                      {d.toolkitAdapterTemplateBtn}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}
      </Tabs>
    </div>
  );
}

/** The demo-seed summary line (shared by the onboarding card). */
export function demoSummaryLine(
  d: ReturnType<typeof getDictionary>,
  summary: DemoSeedSummary,
): string {
  return formatMessage(d.demoDataSummaryLine, {
    partners: summary.created.partners,
    items: summary.created.items,
    invoices: summary.created.invoices,
    receipts: summary.created.receipts,
  });
}
