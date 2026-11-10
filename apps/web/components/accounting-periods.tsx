"use client";

/**
 * P7-T18 — fiscal calendar workspace (List+Search archetype): fiscal years
 * with their generated periods, the audited state actions (soft-close →
 * lock, reopen with mandatory reason — INV-020), the live close checklist
 * (PERIOD_CLOSING §2 — NOT_APPLICABLE is explicit, never a silent pass),
 * the reconciliation-run panel (AR/AP — RC-01/RC-02), opening-balance
 * posting (BR-035 once-only) and the year-end close (execute + reverse).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { JSX } from "react";

import {
  Badge,
  Button,
  DataTable,
  Input,
  formatMoneyDisplay,
} from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type {
  CloseChecklistResult,
  FiscalPeriodRow,
  FiscalYearRow,
  ReconciliationRunRow,
} from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import {
  localizedAccountingError,
  localizedPeriodKind,
  localizedPeriodStatus,
} from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice, InfoNotice, SuccessNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";

export function AccountingPeriods({
  locale,
  initialYears,
  initialRuns,
}: {
  locale: Locale;
  initialYears: readonly FiscalYearRow[];
  initialRuns: readonly ReconciliationRunRow[];
}): JSX.Element {
  const d = getDictionary(locale);
  const [years, setYears] = useState<readonly FiscalYearRow[]>(initialYears);
  const [selectedYear, setSelectedYear] = useState<FiscalYearRow | null>(initialYears[0] ?? null);
  const [periods, setPeriods] = useState<readonly FiscalPeriodRow[]>([]);
  const [runs, setRuns] = useState<readonly ReconciliationRunRow[]>(initialRuns);
  const [checklist, setChecklist] = useState<CloseChecklistResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reopenId, setReopenId] = useState<string | null>(null);
  const [reopenReason, setReopenReason] = useState("");

  // New-year form.
  const [yearName, setYearName] = useState("");
  const [yearStart, setYearStart] = useState("");
  const [yearEnd, setYearEnd] = useState("");

  const loadPeriods = useCallback(
    async (year: FiscalYearRow): Promise<void> => {
      setSelectedYear(year);
      setChecklist(null);
      const result = await bffFetch<readonly FiscalPeriodRow[]>(
        `accounting/fiscal-years/${year.id}/periods`,
      );
      if (!result.ok) {
        setError(localizedAccountingError(d, result.error, result.retryAfterSeconds));
        return;
      }
      setPeriods(result.data);
    },
    [d],
  );

  useEffect(() => {
    if (selectedYear !== null) {
      void loadPeriods(selectedYear);
    }
  }, [loadPeriods, selectedYear]);

  async function createYear(): Promise<void> {
    setError(null);
    setNotice(null);
    setBusy(true);
    const created = await bffFetch<FiscalYearRow>("accounting/fiscal-years", {
      method: "POST",
      body: { name: yearName, startDate: yearStart, endDate: yearEnd },
    });
    setBusy(false);
    if (!created.ok) {
      setError(localizedAccountingError(d, created.error, created.retryAfterSeconds));
      return;
    }
    setYears((current) => [...current, created.data]);
    setSelectedYear(created.data);
    setYearName("");
    setYearStart("");
    setYearEnd("");
    setNotice(d.accountingCreateYear);
  }

  async function periodAction(
    period: FiscalPeriodRow,
    action: "soft-close" | "lock",
  ): Promise<void> {
    setError(null);
    setNotice(null);
    setBusy(true);
    const result = await bffFetch<FiscalPeriodRow>(`accounting/periods/${period.id}/${action}`, {
      method: "POST",
      body: {},
    });
    setBusy(false);
    if (!result.ok) {
      setError(localizedAccountingError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setPeriods((current) => current.map((row) => (row.id === period.id ? result.data : row)));
    setNotice(action === "lock" ? d.accountingLock : d.accountingSoftClose);
  }

  async function reopen(): Promise<void> {
    if (reopenId === null) {
      return;
    }
    setError(null);
    setBusy(true);
    const result = await bffFetch<FiscalPeriodRow>(`accounting/periods/${reopenId}/reopen`, {
      method: "POST",
      body: { reason: reopenReason },
    });
    setBusy(false);
    if (!result.ok) {
      setError(localizedAccountingError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setPeriods((current) => current.map((row) => (row.id === reopenId ? result.data : row)));
    setReopenId(null);
    setReopenReason("");
    setNotice(d.accountingReopen);
  }

  async function runChecklist(period: FiscalPeriodRow): Promise<void> {
    setError(null);
    setBusy(true);
    const result = await bffFetch<CloseChecklistResult>(`accounting/periods/${period.id}/checklist`, {
      method: "POST",
      body: {},
    });
    setBusy(false);
    if (!result.ok) {
      setError(localizedAccountingError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setChecklist(result.data);
  }

  async function runReconciliation(kind: "AR" | "AP"): Promise<void> {
    setError(null);
    setNotice(null);
    setBusy(true);
    const result = await bffFetch<ReconciliationRunRow>("accounting/reconciliation/run", {
      method: "POST",
      body: { kind },
    });
    setBusy(false);
    if (!result.ok) {
      setError(localizedAccountingError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setRuns((current) => [
      ...current.filter((run) => run.kind !== result.data.kind),
      result.data,
    ]);
    setNotice(kind === "AR" ? d.accountingRunAr : d.accountingRunAp);
  }

  async function refreshRuns(): Promise<void> {
    const result = await bffFetch<readonly ReconciliationRunRow[]>("accounting/reconciliation/runs");
    if (result.ok) {
      setRuns(result.data);
    }
  }

  const arRun = useMemo(() => runs.find((run) => run.kind === "AR"), [runs]);
  const apRun = useMemo(() => runs.find((run) => run.kind === "AP"), [runs]);

  async function runYearEnd(action: "execute" | "reverse"): Promise<void> {
    if (selectedYear === null) {
      return;
    }
    setError(null);
    setNotice(null);
    if (!window.confirm(action === "execute" ? d.accountingYearEndConfirm : d.accountingYearEndReverse + "?")) {
      return;
    }
    setBusy(true);
    const result = await bffFetch<{ closingEntryId: string }>(
      `accounting/year-end-close/${selectedYear.id}/${action}`,
      { method: "POST", body: action === "reverse" ? { reason: "screen reverse" } : {} },
    );
    setBusy(false);
    if (!result.ok) {
      setError(localizedAccountingError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setNotice(action === "execute" ? d.accountingYearEndExecute : d.accountingYearEndReverse);
  }

  return (
    <div className="flex flex-col gap-4">
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
      {notice !== null && <SuccessNotice>{notice}</SuccessNotice>}

      <Card
        title={d.accountingYearsTitle}
      >
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {years.map((year) => (
            <Button
              key={year.id}
              variant={selectedYear?.id === year.id ? "primary" : "secondary"}
              size="sm"
              onClick={() => void loadPeriods(year)}
            >
              {year.name}
            </Button>
          ))}
        </div>
        <div className="grid gap-3 border-t pt-4 sm:grid-cols-4">
          <Input label={d.accountingYearName} value={yearName} onValueChange={setYearName} placeholder="FY-2026" required />
          <Input label={d.accountingYearStart} value={yearStart} onValueChange={setYearStart} mono bidiIsolate placeholder="2026-01-01" required />
          <Input label={d.accountingYearEnd} value={yearEnd} onValueChange={setYearEnd} mono bidiIsolate placeholder="2026-12-31" required />
          <div className="flex items-end">
            <Button
              variant="primary"
              onClick={createYear}
              loading={busy}
              disabled={yearName === "" || yearStart === "" || yearEnd === ""}
            >
              {d.accountingCreateYear}
            </Button>
          </div>
        </div>
      </Card>

      {selectedYear !== null && (
        <Card title={`${d.accountingPeriodsTitle} — ${selectedYear.name}`}>
          <div className="mb-3 flex flex-wrap gap-2 border-b pb-3">
            <Button variant="primary" size="sm" onClick={() => void runYearEnd("execute")} loading={busy}>
              {d.accountingYearEndExecute}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => void runYearEnd("reverse")} loading={busy}>
              {d.accountingYearEndReverse}
            </Button>
          </div>
          <DataTable
            columns={[
              {
                id: "name",
                header: activeLocaleHeader(d.accountingColName),
                accessor: (row) => row.name,
                render: (row) => row.name,
              },
              {
                id: "kind",
                header: activeLocaleHeader(d.accountingColType),
                accessor: (row) => row.kind,
                render: (row) => localizedPeriodKind(d, row.kind),
              },
              {
                id: "window",
                header: activeLocaleHeader(d.accountingColEntryDate),
                accessor: (row) => `${row.startDate} → ${row.endDate}`,
                render: (row) => (
                  <span className="font-mono text-xs" dir="ltr">
                    {row.startDate} → {row.endDate}
                  </span>
                ),
              },
              {
                id: "status",
                header: activeLocaleHeader(d.accountingColStatus),
                accessor: (row) => row.status,
                render: (row) => (
                  <Badge
                    tone={
                      row.status === "OPEN" ? "primary" : "neutral"
                    }
                  >
                    {localizedPeriodStatus(d, row.status)}
                  </Badge>
                ),
              },
              {
                id: "reopened",
                header: activeLocaleHeader(d.accountingReopenReason),
                accessor: (row) => row.reopenReason ?? "",
                render: (row) =>
                  row.reopenReason === null ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    <span className="text-xs">{row.reopenReason}</span>
                  ),
              },
            ]}
            rows={[...periods]}
            rowKey={(row) => row.id}
            rowActions={[
              {
                id: "checklist",
                label: d.accountingChecklist,
                onSelect: (row) => void runChecklist(row),
              },
              {
                id: "soft-close",
                label: d.accountingSoftClose,
                onSelect: (row) => void periodAction(row, "soft-close"),
              },
              {
                id: "lock",
                label: d.accountingLock,
                danger: true,
                onSelect: (row) => void periodAction(row, "lock"),
              },
              {
                id: "reopen",
                label: d.accountingReopen,
                onSelect: (row) => {
                  setReopenReason("");
                  setReopenId(row.id);
                },
              },
            ]}
            empty={{ title: d.accountingPeriodsEmpty }}
          />
        </Card>
      )}

      {reopenId !== null && (
        <Card title={d.accountingReopen}>
          <div className="flex flex-col gap-3">
            <InfoNotice>{d.accountingReopenPrompt}</InfoNotice>
            <Input
              label={d.accountingReopenReason}
              value={reopenReason}
              onValueChange={setReopenReason}
              required
            />
            <div className="flex gap-2">
              <Button
                variant="primary"
                onClick={reopen}
                loading={busy}
                disabled={reopenReason.trim().length < 3}
              >
                {d.accountingReopen}
              </Button>
              <Button variant="ghost" onClick={() => setReopenId(null)}>
                {d.commonCancel}
              </Button>
            </div>
          </div>
        </Card>
      )}

      {checklist !== null && (
        <Card title={`${d.accountingChecklist} — ${checklist.period.name}`}>
          <ul className="divide-y">
            {checklist.items.map((item) => (
              <li key={item.key} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div className="flex flex-col">
                  <span className="text-sm">{locale === "ar" ? item.label.ar : item.label.en}</span>
                  {item.detail !== null && (
                    <span className="text-xs text-muted-foreground">{item.detail}</span>
                  )}
                </div>
                <Badge
                  tone={item.state === "OK" ? "primary" : item.state === "BROKEN" ? "neutral" : "neutral"}
                >
                  {item.state === "OK"
                    ? d.accountingChecklistOk
                    : item.state === "BROKEN"
                      ? d.accountingChecklistBroken
                      : item.state === "NOT_RUN"
                        ? d.accountingChecklistNotRun
                        : d.accountingChecklistNotApplicable}
                </Badge>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-sm">
            {checklist.allSatisfied ? d.accountingChecklistOk : d.accountingChecklistBroken}
          </p>
        </Card>
      )}

      <Card title={`${d.accountingReconStatusOk} / ${d.accountingReconStatusBroken}`}>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => void runReconciliation("AR")} loading={busy}>
            {d.accountingRunAr}
          </Button>
          <Button variant="secondary" onClick={() => void runReconciliation("AP")} loading={busy}>
            {d.accountingRunAp}
          </Button>
          <Button variant="ghost" onClick={() => void refreshRuns()}>
            {d.commonOpen}
          </Button>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {[arRun, apRun].map((run) =>
            run === undefined ? null : (
              <div key={run.id} className="rounded-lg border p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs" dir="ltr">{run.kind}</span>
                  <Badge tone={run.status === "OK" ? "primary" : "neutral"}>
                    {run.status === "OK" ? d.accountingReconStatusOk : d.accountingReconStatusBroken}
                  </Badge>
                </div>
                <p className="mt-2 font-mono text-xs" dir="ltr">
                  {formatMoneyDisplay(run.controlBalance, 2)} / {formatMoneyDisplay(run.subledgerBalance, 2)} · Δ
                  {" "}
                  {run.diffCount}
                </p>
                <p className="mt-1 text-xs text-muted-foreground" dir="ltr">{run.asOf}</p>
              </div>
            ),
          )}
        </div>
      </Card>
    </div>
  );
}
