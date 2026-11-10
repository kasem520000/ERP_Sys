"use client";

/**
 * PHASE-028 (T9) — the budget grid import wizard (PAGE_ARCHETYPES §9, the
 * PHASE-008 statement-import pattern): step 1 picks a DRAFT budget + the
 * XLSX file (read as base64 in-browser); the dry-run POST returns the
 * typed per-row validation report (rowCount/validRows/errors +
 * totalsPreview — ZERO writes); the review step renders the bilingual
 * per-row errors and the commit POST re-validates then replaces the
 * draft's grid WHOLE (idempotent per file hash server-side). The import
 * targets DRAFT budgets only (the API's IMMUTABLE_DOCUMENT contract on
 * non-DRAFT parents — the wizard never offers them).
 */
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ChangeEvent, JSX } from "react";

import { Button, Select, formatMoneyDisplay, useToast } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type { BudgetGridSaveResult, BudgetListRow, ImportDryRunResponse } from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { formatMessage, localizedName, localizedBudgetsError } from "../lib/messages";
import { Card } from "./card";
import { DefList } from "./def-list";
import { ErrorNotice, InfoNotice, SuccessNotice } from "./notices";

/** The API's file ceiling (BASE64 max 20M chars ≈ 15 MB binary). */
const MAX_IMPORT_BYTES = 15 * 1024 * 1024;

/** Reads the chosen file as a bare base64 string (no data: prefix). */
function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const comma = result.indexOf(",");
      resolve(comma === -1 ? result : result.slice(comma + 1));
    };
    reader.onerror = () => {
      reject(new Error("file read failed"));
    };
    reader.readAsDataURL(file);
  });
}

type WizardStep = "setup" | "review" | "done";
const TOTAL_STEPS = 2;

export function BudgetImportWizard({
  locale,
  budgets,
  initialBudgetId = "",
}: {
  locale: Locale;
  /** The register rows (the wizard filters the DRAFT set itself). */
  budgets: readonly BudgetListRow[];
  initialBudgetId?: string;
}): JSX.Element {
  const d = getDictionary(locale);
  const router = useRouter();
  const { toast } = useToast();

  const draftBudgets = useMemo(() => budgets.filter((row) => row.status === "DRAFT"), [budgets]);
  const [budgetId, setBudgetId] = useState(
    initialBudgetId !== "" && budgets.some((row) => row.id === initialBudgetId && row.status === "DRAFT")
      ? initialBudgetId
      : (draftBudgets[0]?.id ?? ""),
  );
  const [file, setFile] = useState<File | null>(null);
  const [fileBase64, setFileBase64] = useState("");
  const [step, setStep] = useState<WizardStep>("setup");
  const [report, setReport] = useState<ImportDryRunResponse | null>(null);
  const [committed, setCommitted] = useState<BudgetGridSaveResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function onFileChange(event: ChangeEvent<HTMLInputElement>): void {
    setFile(event.target.files?.[0] ?? null);
  }

  async function runDryRun(): Promise<void> {
    setError(null);
    if (budgetId === "") {
      setError(d.budgetImportBudgetRequired);
      return;
    }
    if (file === null) {
      setError(d.budgetImportFileRequired);
      return;
    }
    if (file.size > MAX_IMPORT_BYTES) {
      setError(d.budgetImportFileTooLarge);
      return;
    }
    setBusy(true);
    const base64 = await readFileAsBase64(file);
    setFileBase64(base64);
    const result = await bffFetch<ImportDryRunResponse>(`budgeting/budgets/${budgetId}/import/dry-run`, {
      method: "POST",
      body: { fileBase64: base64 },
    });
    setBusy(false);
    if (!result.ok) {
      setError(localizedBudgetsError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setReport(result.data);
    setStep("review");
  }

  async function commitImport(): Promise<void> {
    if (report === null || fileBase64 === "") {
      return;
    }
    setError(null);
    setBusy(true);
    const result = await bffFetch<BudgetGridSaveResult>(`budgeting/budgets/${budgetId}/import/commit`, {
      method: "POST",
      body: { fileBase64 },
    });
    setBusy(false);
    if (!result.ok) {
      setError(localizedBudgetsError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setCommitted(result.data);
    setStep("done");
    toast({
      tone: "success",
      title: formatMessage(d.budgetImportCommitToast, {
        lines: result.data.lineCount,
        total: formatMoneyDisplay(result.data.totals.year, 2),
      }),
    });
  }

  function resetWizard(): void {
    setStep("setup");
    setFile(null);
    setFileBase64("");
    setReport(null);
    setCommitted(null);
    setError(null);
  }

  const stepLabels: Record<WizardStep, string> = {
    setup: d.budgetImportStepSetup,
    review: d.budgetImportStepReview,
    done: d.budgetImportStepReview,
  };

  return (
    <div className="flex flex-col gap-4">
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}

      <nav aria-label={d.budgetsImportTitle} className="flex flex-wrap items-center gap-2">
        {([1, 2] as const).map((entry) =>
          (step === "setup" ? 1 : 2) === entry ? (
            <span
              key={entry}
              aria-current="step"
              className="rounded-md border border-primary-200 bg-primary-50 px-3 py-1.5 text-sm font-medium text-primary-800"
            >
              {formatMessage(d.instWizStepOf, { current: entry, total: TOTAL_STEPS })} — {stepLabels[step]}
            </span>
          ) : (
            <span
              key={entry}
              className="rounded-md border border-default bg-surface-card px-3 py-1.5 text-sm text-gray-500"
            >
              {formatMessage(d.instWizStepOf, { current: entry, total: TOTAL_STEPS })} —{" "}
              {entry === 1 ? d.budgetImportStepSetup : d.budgetImportStepReview}
            </span>
          ),
        )}
      </nav>

      {step === "setup" && (
        <Card title={d.budgetImportStepSetup} description={d.budgetImportRowCap}>
          <div className="flex flex-col gap-3">
            {draftBudgets.length === 0 ? (
              <InfoNotice>{d.budgetImportNoDrafts}</InfoNotice>
            ) : (
              <>
                <div className="w-full max-w-md">
                  <Select
                    id="budget-import-budget"
                    label={d.budgetsTitle}
                    value={budgetId}
                    onValueChange={setBudgetId}
                    options={draftBudgets.map((row) => ({
                      value: row.id,
                      label: `${row.code} · ${localizedName(row.name, row.nameAr, locale)}`,
                    }))}
                    required
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label htmlFor="budget-import-file" className="text-sm font-medium text-gray-700">
                    {d.budgetImportChooseFile}
                  </label>
                  <input
                    id="budget-import-file"
                    type="file"
                    accept=".xlsx"
                    onChange={onFileChange}
                    className="rounded-md border border-default bg-surface-card px-3 py-1.5 text-sm text-gray-800 outline-none hover:border-strong"
                  />
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  <Button variant="primary" onClick={() => void runDryRun()} loading={busy}>
                    {d.budgetImportDryRun}
                  </Button>
                </div>
              </>
            )}
          </div>
        </Card>
      )}

      {step === "review" && report !== null && (
        <Card title={d.budgetImportDryRunTitle}>
          <div className="flex flex-col gap-3">
            <DefList
              items={[
                { term: d.budgetImportRowCount, children: String(report.rowCount) },
                { term: d.budgetImportValidRows, children: String(report.validRows) },
                {
                  term: d.budgetImportTotalsPreview,
                  children: (
                    <span className="font-mono tabular-nums" dir="ltr">
                      {formatMoneyDisplay(report.totalsPreview, 2)}
                    </span>
                  ),
                },
              ]}
            />
            {report.errors.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <caption className="text-start text-xs font-medium text-gray-600">
                    {d.budgetImportErrors}
                  </caption>
                  <thead>
                    <tr className="border-b border-subtle">
                      <th scope="col" className="px-2 py-2 text-start font-medium">
                        #
                      </th>
                      <th scope="col" className="px-2 py-2 text-start font-medium">
                        {d.budgetImportErrors}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.errors.map((issue) => (
                      <tr key={`${issue.rowNo}-${issue.messageEn}`} className="border-b border-subtle">
                        <td className="px-2 py-2 font-mono tabular-nums" dir="ltr">
                          {issue.rowNo}
                        </td>
                        <td className="px-2 py-2 text-danger-700">
                          {locale === "ar" ? issue.messageAr : issue.messageEn}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <SuccessNotice>{d.budgetImportClean}</SuccessNotice>
            )}
            <InfoNotice>{d.budgetImportRowCap}</InfoNotice>
            <div className="flex flex-wrap justify-between gap-2">
              <Button variant="secondary" onClick={resetWizard} disabled={busy}>
                {d.instWizBack}
              </Button>
              <Button
                variant="primary"
                onClick={() => void commitImport()}
                loading={busy}
                disabled={report.errors.length > 0}
              >
                {d.budgetImportCommit}
              </Button>
            </div>
          </div>
        </Card>
      )}

      {step === "done" && committed !== null && (
        <Card
          title={
            budgets.find((row) => row.id === budgetId)?.code ?? d.budgetImportCommit
          }
        >
          <div className="flex flex-col gap-3">
            <SuccessNotice>
              {formatMessage(d.budgetImportCommitToast, {
                lines: committed.lineCount,
                total: formatMoneyDisplay(committed.totals.year, 2),
              })}
            </SuccessNotice>
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" onClick={() => router.push(`/${locale}/budgeting/${budgetId}`)}>
                {d.commonOpen}
              </Button>
              <Button variant="secondary" onClick={resetWizard}>
                {d.budgetImportStepSetup}
              </Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
