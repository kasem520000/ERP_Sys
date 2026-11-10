"use client";

/**
 * P6-T11b — import wizard (wizard archetype; PHASE-006 upload seam):
 * step 1 picks kind/format + a carrier partner, then uploads the chosen file
 * through the carrier's attachment slot (issue → presigned PUT) and creates
 * the preview job (`items/import-jobs`); step 2 renders the dry-run report
 * and applies it (POST `…/:id/commit`, polling the job every 2s until
 * COMMITTED/FAILED — the worker is asynchronous); step 3 confirms the
 * committed row count. The jobs history table re-renders from server data
 * (router.refresh after each transition).
 */
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ChangeEvent, FormEvent, JSX } from "react";

import { Badge, Button, DataTable, PartnerPicker, Select, useToast } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type { AttachmentIssuedUpload, ImportJobRow } from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { formatMessage, localizedMasterDataError } from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice } from "./notices";
import { ExportCard } from "./export-card";
import { ImportReport, ImportStatusChip, importReportOf, type ImportReportView } from "./import-report";
import { usePartnerPickerOptions } from "./picker-data";
import { activeLocaleHeader } from "./table-header";

const MAX_IMPORT_BYTES = 8 * 1024 * 1024;
const CSV_MIME = "text/csv";
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const POLL_INTERVAL_MS = 2000;

/** Server filename contract (files module U-06): [A-Za-z0-9._-]. */
function sanitizeFilenameInput(name: string): string {
  return name.trim().replace(/[^A-Za-z0-9._-]+/g, "-");
}

/** Browser mime with an extension fallback (some platforms report ""). */
function effectiveImportContentType(file: File): string | null {
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

function jobStatusLabel(
  d: ReturnType<typeof getDictionary>,
  status: ImportJobRow["status"],
): string {
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

type WizardStep = "setup" | "preview" | "done" | "failed";

export function ImportWizard({
  locale,
  initialJobs,
}: {
  locale: Locale;
  initialJobs: readonly ImportJobRow[];
}): JSX.Element {
  const d = getDictionary(locale);
  const router = useRouter();
  const { toast } = useToast();
  const picker = usePartnerPickerOptions(locale, 25);

  const [step, setStep] = useState<WizardStep>("setup");
  const [kind, setKind] = useState<string>("PARTNERS");
  const [format, setFormat] = useState<string>("CSV");
  const [carrierId, setCarrierId] = useState<string>("");
  const [file, setFile] = useState<File | null>(null);
  const [setupBusy, setSetupBusy] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [job, setJob] = useState<ImportJobRow | null>(null);
  const [report, setReport] = useState<ImportReportView | null>(null);
  const [committing, setCommitting] = useState(false);
  const pollRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (pollRef.current !== null) {
        window.clearTimeout(pollRef.current);
      }
    };
  }, []);

  function onFileChange(event: ChangeEvent<HTMLInputElement>): void {
    setFile(event.target.files?.[0] ?? null);
  }

  function resetWizard(): void {
    if (pollRef.current !== null) {
      window.clearTimeout(pollRef.current);
      pollRef.current = null;
    }
    setStep("setup");
    setFile(null);
    setSetupError(null);
    setJob(null);
    setReport(null);
    setCommitting(false);
  }

  async function onStartPreview(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSetupError(null);
    if (carrierId === "") {
      setSetupError(d.importCarrierRequired);
      return;
    }
    if (file === null) {
      setSetupError(d.importFileRequired);
      return;
    }
    if (file.size > MAX_IMPORT_BYTES) {
      setSetupError(d.importFileTooLarge);
      return;
    }
    const contentType = effectiveImportContentType(file);
    if (contentType === null) {
      setSetupError(d.importFileTypeInvalid);
      return;
    }
    setSetupBusy(true);
    const safeName = sanitizeFilenameInput(file.name);

    // (d) issue the carrier's attachment upload slot
    const issued = await bffFetch<AttachmentIssuedUpload>(
      `partners/partners/${carrierId}/attachments`,
      { method: "POST", body: { filename: safeName, contentType, sizeBytes: file.size } },
    );
    if (!issued.ok) {
      setSetupBusy(false);
      setSetupError(localizedMasterDataError(d, issued.error, issued.retryAfterSeconds));
      return;
    }

    // (e) PUT the bytes to the presigned URL (direct storage upload)
    try {
      const uploaded = await fetch(issued.data.uploadUrl, {
        method: "PUT",
        body: file,
        headers: { "content-type": contentType },
      });
      if (!uploaded.ok) {
        setSetupBusy(false);
        setSetupError(d.importUploadFailed);
        return;
      }
    } catch {
      setSetupBusy(false);
      setSetupError(d.importUploadFailed);
      return;
    }

    // (f) create the preview job (dry-run; writes nothing)
    const created = await bffFetch<ImportJobRow>("items/import-jobs", {
      method: "POST",
      body: {
        kind,
        format,
        uploadToken: randomUploadToken(),
        fileKey: issued.data.key,
        fileName: safeName,
      },
    });
    setSetupBusy(false);
    if (!created.ok) {
      setSetupError(localizedMasterDataError(d, created.error, created.retryAfterSeconds));
      return;
    }
    setJob(created.data);
    setReport(importReportOf(created.data.report));
    setStep("preview");
    router.refresh(); // history card re-renders from the server
  }

  function pollJobStatus(jobId: string): void {
    const tick = async (): Promise<void> => {
      const result = await bffFetch<ImportJobRow>(`items/import-jobs/${jobId}`);
      if (!result.ok) {
        setCommitting(false);
        setStep("failed");
        return;
      }
      const current = result.data;
      setJob(current);
      if (current.status === "COMMITTED") {
        setCommitting(false);
        setStep("done");
        toast({ tone: "success", title: d.importCommitToast });
        router.refresh();
        return;
      }
      if (current.status === "FAILED") {
        setCommitting(false);
        setStep("failed");
        return;
      }
      pollRef.current = window.setTimeout(() => void tick(), POLL_INTERVAL_MS);
    };
    pollRef.current = window.setTimeout(() => void tick(), POLL_INTERVAL_MS);
  }

  async function onCommit(): Promise<void> {
    if (job === null) return;
    setCommitting(true);
    const committed = await bffFetch<ImportJobRow>(`items/import-jobs/${job.id}/commit`, {
      method: "POST",
    });
    if (!committed.ok) {
      setCommitting(false);
      setStep("failed");
      return;
    }
    setJob(committed.data);
    if (committed.data.status === "COMMITTED") {
      setCommitting(false);
      setStep("done");
      toast({ tone: "success", title: d.importCommitToast });
      router.refresh();
      return;
    }
    pollJobStatus(committed.data.id);
  }

  return (
    <div className="flex flex-col gap-6">
      {step === "setup" && (
        <Card title={d.importStep1Title} ariaLabel={d.importStep1Title}>
          <form onSubmit={onStartPreview} noValidate className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Select
                id="import-kind"
                label={d.importDataKindLabel}
                value={kind}
                onValueChange={setKind}
                options={[
                  { value: "PARTNERS", label: d.importKindPartners },
                  { value: "ITEMS", label: d.importKindItems },
                  { value: "OPENING_BALANCES", label: d.importKindOpeningBalances },
                ]}
                required
              />
              <Select
                id="import-format"
                label={d.importFormatLabel}
                value={format}
                onValueChange={setFormat}
                options={[
                  { value: "CSV", label: d.importFormatCsv },
                  { value: "XLSX", label: d.importFormatXlsx },
                ]}
                required
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <PartnerPicker
                label={d.importCarrierLabel}
                hint={d.importCarrierHint}
                items={picker.options}
                value={carrierId}
                onSelect={setCarrierId}
                onSearch={picker.onSearch}
                loading={picker.loading}
                placeholder={d.partnerPickerPlaceholder}
                emptyText={d.pickerEmptyText}
                required
              />
              <div className="flex flex-col gap-1">
                <label htmlFor="import-file" className="text-sm font-medium text-gray-700">
                  {d.importFileLabel}
                </label>
                <input
                  id="import-file"
                  type="file"
                  accept=".csv,.xlsx"
                  onChange={onFileChange}
                  className="rounded-md border border-default bg-surface-card px-3 py-1.5 text-sm text-gray-800 outline-none hover:border-strong"
                />
                <p className="text-xs text-gray-600">{d.importFileHint}</p>
              </div>
            </div>
            {setupError !== null && <ErrorNotice>{setupError}</ErrorNotice>}
            <div className="flex items-center justify-end border-t border-subtle pt-3">
              <Button type="submit" variant="primary" loading={setupBusy}>
                {d.importSubmitPreview}
              </Button>
            </div>
          </form>
        </Card>
      )}

      {step !== "setup" && job !== null && (
        <div className="flex flex-col gap-4">
          {report !== null && step !== "done" && <ImportReport locale={locale} report={report} />}
          {step === "preview" && (
            <Card ariaLabel={d.importCommit}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <ImportStatusChip status={job.status}>
                  {jobStatusLabel(d, job.status)}
                </ImportStatusChip>
                <div className="flex items-center gap-2">
                  <Button variant="secondary" onClick={resetWizard}>
                    {d.importNewJob}
                  </Button>
                  <Button
                    variant="primary"
                    loading={committing}
                    onClick={() => void onCommit()}
                  >
                    {d.importCommit}
                  </Button>
                </div>
              </div>
            </Card>
          )}
          {step === "done" && (
            <Card title={d.importStep3Title} ariaLabel={d.importStep3Title}>
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-3">
                  <ImportStatusChip status={job.status}>
                    {jobStatusLabel(d, job.status)}
                  </ImportStatusChip>
                  <span className="text-sm text-gray-800">
                    {formatMessage(d.importCommittedRows, { count: job.committedRows })}
                  </span>
                </div>
                <div className="flex items-center justify-end">
                  <Button variant="secondary" onClick={resetWizard}>
                    {d.importNewJob}
                  </Button>
                </div>
              </div>
            </Card>
          )}
          {step === "failed" && (
            <Card title={d.importStep3Title} ariaLabel={d.importStep3Title}>
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-3">
                  <ImportStatusChip status={job.status}>{jobStatusLabel(d, job.status)}</ImportStatusChip>
                  {job.error !== null && job.error !== "" && (
                    <span className="font-mono text-xs text-gray-600">{job.error}</span>
                  )}
                </div>
                <ErrorNotice>{d.importCommitFailed}</ErrorNotice>
                <div className="flex items-center justify-end">
                  <Button variant="secondary" onClick={resetWizard}>
                    {d.importNewJob}
                  </Button>
                </div>
              </div>
            </Card>
          )}
        </div>
      )}

      <ExportCard locale={locale} />

      <Card title={d.importJobsTitle} ariaLabel={d.importJobsTitle}>
        <DataTable
          columns={[
            {
              id: "kind",
              header: activeLocaleHeader(d.importDataKindLabel),
              accessor: (row) => row.kind,
              render: (row) => (
                <Badge tone="neutral">
                  {row.kind === "PARTNERS"
                    ? d.importKindPartners
                    : row.kind === "ITEMS"
                      ? d.importKindItems
                      : d.importKindOpeningBalances}
                </Badge>
              ),
            },
            {
              id: "format",
              header: activeLocaleHeader(d.importFormatLabel),
              accessor: (row) => row.format,
              mono: true,
            },
            {
              id: "file",
              header: activeLocaleHeader(d.importFileLabel),
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
          rows={[...initialJobs]}
          rowKey={(row) => row.id}
          empty={{ title: d.importJobsEmpty }}
        />
      </Card>
    </div>
  );
}
