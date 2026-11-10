"use client";

/**
 * PHASE-029 (T11) — payroll run create form (PAGE_ARCHETYPES §3, the
 * budget-form pattern): fiscal year → REGULAR period + optional notes →
 * POST payroll/runs creates the DRAFT run shell (one live run per period
 * — the monthly law; the server rejects a second live run with the typed
 * mirror). Period options for the selected year load through the BFF
 * (the accounting-periods pattern); the initial year's periods ride the
 * server fetch. On success the form routes to the run workspace.
 */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { JSX } from "react";

import { Button, Input, Select, useToast } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type { FiscalPeriodRow, FiscalYearRow } from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { localizedApiError, localizedPayrollError } from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice } from "./notices";

export function RunForm({
  locale,
  years,
  initialPeriods,
}: {
  locale: Locale;
  years: readonly FiscalYearRow[];
  initialPeriods: readonly FiscalPeriodRow[];
}): JSX.Element {
  const d = getDictionary(locale);
  const router = useRouter();
  const { toast } = useToast();

  const [fiscalYearId, setFiscalYearId] = useState(years[0]?.id ?? "");
  const [periods, setPeriods] = useState<readonly FiscalPeriodRow[]>(initialPeriods);
  const [fiscalPeriodId, setFiscalPeriodId] = useState("");
  const [note, setNote] = useState("");
  const [noteAr, setNoteAr] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadingPeriods, setLoadingPeriods] = useState(false);

  const regularPeriods = periods.filter((period) => period.kind === "REGULAR");

  const loadPeriods = useCallback(
    async (yearId: string): Promise<void> => {
      if (yearId === "") {
        setPeriods([]);
        return;
      }
      setLoadingPeriods(true);
      const result = await bffFetch<readonly FiscalPeriodRow[]>(
        `accounting/fiscal-years/${yearId}/periods`,
      );
      setLoadingPeriods(false);
      if (!result.ok) {
        setError(localizedApiError(d, result.error, result.retryAfterSeconds));
        return;
      }
      setPeriods(result.data);
    },
    [d],
  );

  // Year changes reload the period options (the initial year's periods
  // rode the server fetch — the first run is a no-op).
  useEffect(() => {
    if (fiscalYearId === (years[0]?.id ?? "")) {
      return;
    }
    setFiscalPeriodId("");
    void loadPeriods(fiscalYearId);
  }, [fiscalYearId, years, loadPeriods]);

  async function save(): Promise<void> {
    setError(null);
    if (fiscalPeriodId === "") {
      setError(d.budgetFormInvalid);
      return;
    }
    setBusy(true);
    const created = await bffFetch<{ id: string }>("payroll/runs", {
      method: "POST",
      body: {
        fiscalPeriodId,
        note: note.trim() === "" ? null : note.trim(),
        noteAr: noteAr.trim() === "" ? null : noteAr.trim(),
      },
    });
    setBusy(false);
    if (!created.ok) {
      setError(localizedPayrollError(d, created.error, created.retryAfterSeconds));
      return;
    }
    toast({ tone: "success", title: d.payRunSubmittedToast });
    router.push(`/${locale}/payroll/runs/${created.data.id}`);
  }

  return (
    <Card title={d.payRunNew}>
      <div className="flex flex-col gap-4">
        {error !== null && <ErrorNotice>{error}</ErrorNotice>}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Select
            id="run-form-year"
            label={d.budgetsFilterYear}
            value={fiscalYearId}
            onValueChange={setFiscalYearId}
            options={years.map((year) => ({ value: year.id, label: year.name }))}
            required
          />
          <Select
            id="run-form-period"
            label={d.payRunPeriod}
            value={fiscalPeriodId}
            onValueChange={setFiscalPeriodId}
            options={[
              { value: "", label: loadingPeriods ? d.loading : "—" },
              ...regularPeriods.map((period) => ({
                value: period.id,
                label: period.name,
              })),
            ]}
            required
          />
          <Input id="run-form-note" label={d.budgetFormNote} value={note} onValueChange={setNote} />
          <Input
            id="run-form-note-ar"
            label={d.budgetFormNoteAr}
            value={noteAr}
            onValueChange={setNoteAr}
          />
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="primary" onClick={() => void save()} loading={busy}>
            {d.payRunNew}
          </Button>
        </div>
      </div>
    </Card>
  );
}
