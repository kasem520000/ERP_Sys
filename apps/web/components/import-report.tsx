"use client";

/**
 * P6-T11b — import preview report (wizard step 2): the dry-run summary
 * counts + the per-row table. Row status chips use the semantic tint tokens
 * (VALID success / ERROR danger / DUPLICATE neutral / WARNING warning);
 * errors join as "field: message; …". The wire `report` is `unknown` — a
 * tolerant narrower builds the view, dropping malformed rows.
 */
import type { JSX } from "react";

import { DataTable } from "@erp/ui";

import { isRecord } from "../lib/api-types";
import { getDictionary, type Locale } from "../i18n/dictionaries";
import { Card } from "./card";
import { DefList } from "./def-list";
import { activeLocaleHeader } from "./table-header";

export type ImportRowStatus = "VALID" | "ERROR" | "DUPLICATE" | "WARNING";

export interface ImportReportRow {
  row: number;
  status: ImportRowStatus;
  errors: Array<{ field: string; message: string }>;
  warnings: Array<{ field: string; message: string }>;
  preview: Record<string, string>;
}

export interface ImportReportView {
  summary: { total: number; valid: number; invalid: number; duplicates: number; warnings: number };
  rows: ImportReportRow[];
}

function rowErrorsOf(value: unknown): Array<{ field: string; message: string }> {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (entry): entry is { field: string; message: string } =>
      isRecord(entry) &&
      typeof entry.field === "string" &&
      typeof entry.message === "string",
  );
}

function previewOf(value: unknown): Record<string, string> {
  if (!isRecord(value)) {
    return {};
  }
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string") {
      out[key] = entry;
    }
  }
  return out;
}

/** Narrows the API's opaque `report` into the view the table renders. */
export function importReportOf(value: unknown): ImportReportView | null {
  if (!isRecord(value) || !isRecord(value.summary) || !Array.isArray(value.rows)) {
    return null;
  }
  const summary = value.summary;
  const num = (entry: unknown): number => (typeof entry === "number" ? entry : 0);
  const rows: ImportReportRow[] = [];
  for (const entry of value.rows) {
    if (!isRecord(entry)) continue;
    const status = entry.status;
    if (
      status !== "VALID" &&
      status !== "ERROR" &&
      status !== "DUPLICATE" &&
      status !== "WARNING"
    ) {
      continue;
    }
    rows.push({
      row: num(entry.row),
      status,
      errors: rowErrorsOf(entry.errors),
      warnings: rowErrorsOf(entry.warnings),
      preview: previewOf(entry.preview),
    });
  }
  return {
    summary: {
      total: num(summary.total),
      valid: num(summary.valid),
      invalid: num(summary.invalid),
      duplicates: num(summary.duplicates),
      warnings: num(summary.warnings),
    },
    rows,
  };
}

/** The preview column prefers the human name, then sku/code, then any value. */
function previewLabel(preview: Record<string, string>): string {
  const preferred = ["name", "nameAr", "sku", "code", "partner", "account"];
  for (const key of preferred) {
    const value = preview[key];
    if (value !== undefined && value !== "") {
      return value;
    }
  }
  const first = Object.values(preview).find((value) => value !== "");
  return first ?? "—";
}

/** Semantic-tint status chip (catalog Badge exposes neutral/primary only). */
export function ImportStatusChip({
  status,
  children,
}: {
  status: ImportRowStatus | "FAILED" | "COMMITTED" | "PREVIEW_READY" | "PREVIEWING" | "COMMITTING";
  children: string;
}): JSX.Element {
  const tone =
    status === "VALID" || status === "COMMITTED"
      ? "border-success-border bg-success-bg text-success-text"
      : status === "ERROR" || status === "FAILED"
        ? "border-danger-border bg-danger-bg text-danger-text"
        : status === "WARNING"
          ? "border-warning-border bg-warning-bg text-warning-text"
          : "border-default bg-surface-sunken text-gray-700";
  return (
    <span
      className={`inline-flex w-fit items-center rounded-sm border px-1.5 py-0.5 text-xs leading-4 ${tone}`}
    >
      {children}
    </span>
  );
}

export function ImportReport({
  locale,
  report,
}: {
  locale: Locale;
  report: ImportReportView;
}): JSX.Element {
  const d = getDictionary(locale);
  const joined = (errors: ImportReportRow["errors"]): string =>
    errors.map((entry) => `${entry.field}: ${entry.message}`).join("; ");

  return (
    <Card title={d.importStep2Title} ariaLabel={d.importStep2Title}>
      <DefList
        items={[
          {
            term: d.importColTotal,
            children: <span className="font-mono">{report.summary.total.toLocaleString(locale === "ar" ? "ar" : "en")}</span>,
          },
          {
            term: d.importColValid,
            children: <span className="font-mono">{report.summary.valid}</span>,
          },
          {
            term: d.importColInvalid,
            children: <span className="font-mono">{report.summary.invalid}</span>,
          },
          {
            term: d.importColDuplicates,
            children: <span className="font-mono">{report.summary.duplicates}</span>,
          },
          {
            term: d.importColWarnings,
            children: <span className="font-mono">{report.summary.warnings}</span>,
          },
        ]}
      />
      {report.rows.length === 0 ? (
        <p className="mt-3 text-sm text-gray-600">{d.importPreviewEmpty}</p>
      ) : (
        <div className="mt-3">
          <DataTable
            columns={[
              {
                id: "row",
                header: activeLocaleHeader(d.importColRow),
                accessor: (row) => String(row.row),
                numeric: true,
                mono: true,
                width: "5rem",
              },
              {
                id: "status",
                header: activeLocaleHeader(d.colStatus),
                accessor: (row) => row.status,
                render: (row) => (
                  <ImportStatusChip status={row.status}>
                    {row.status === "VALID"
                      ? d.importRowValid
                      : row.status === "ERROR"
                        ? d.importRowError
                        : row.status === "DUPLICATE"
                          ? d.importRowDuplicate
                          : d.importRowWarning}
                  </ImportStatusChip>
                ),
              },
              {
                id: "preview",
                header: activeLocaleHeader(d.importColPreview),
                accessor: (row) => previewLabel(row.preview),
              },
              {
                id: "errors",
                header: activeLocaleHeader(d.importColErrors),
                accessor: (row) => joined(row.errors) + joined(row.warnings),
                render: (row) => {
                  const messages = [
                    ...row.errors.map((entry) => `${entry.field}: ${entry.message}`),
                    ...row.warnings.map((entry) => `${entry.field}: ${entry.message}`),
                  ];
                  return messages.length === 0 ? (
                    <span className="text-gray-500">—</span>
                  ) : (
                    <span className="text-xs">{messages.join("; ")}</span>
                  );
                },
              },
            ]}
            rows={report.rows}
            rowKey={(row) => `${row.row}-${row.status}`}
            empty={{ title: d.importPreviewEmpty }}
          />
        </div>
      )}
    </Card>
  );
}
