"use client";

/**
 * PHASE-029 (T11) — the payroll runs register (PAGE_ARCHETYPES §2,
 * List+Search — the budgets-table pattern): fiscal-year/status filters
 * reload through the BFF (the API's own filter vocabulary —
 * payroll/runs?fiscalYearId=&status=); the period column resolves
 * through the server-fetched period pool (all years' periods). The
 * INV-025 totals ride canonical money columns (formatMoneyDisplay); the
 * paid column pairs with net to surface the G-30 outstanding visually.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { JSX } from "react";

import {
  Badge,
  DataTable,
  Select,
  formatMoneyDisplay,
  type DataTableSort,
} from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type { FiscalPeriodRow, FiscalYearRow, PayrollRunListRow } from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { localizedPayrollError, localizedPayrollRunStatus } from "../lib/messages";
import { LinkButton } from "./link-button";
import { ErrorNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";

export function PayrollRunsTable({
  locale,
  initialRows,
  years,
  periods,
}: {
  locale: Locale;
  initialRows: readonly PayrollRunListRow[];
  years: readonly FiscalYearRow[];
  periods: readonly FiscalPeriodRow[];
}): JSX.Element {
  const d = getDictionary(locale);
  const router = useRouter();
  const [rows, setRows] = useState<readonly PayrollRunListRow[]>(initialRows);
  const [fiscalYearId, setFiscalYearId] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<DataTableSort[]>([]);
  const runRef = useRef(0);
  const skipInitialLoad = useRef(true);

  const loadPage = useCallback(async (): Promise<void> => {
    const run = runRef.current + 1;
    runRef.current = run;
    setBusy(true);
    setError(null);
    const search = new URLSearchParams();
    if (fiscalYearId !== "") {
      search.set("fiscalYearId", fiscalYearId);
    }
    if (status !== "") {
      search.set("status", status);
    }
    const suffix = search.size > 0 ? `?${search.toString()}` : "";
    const result = await bffFetch<readonly PayrollRunListRow[]>(`payroll/runs${suffix}`);
    if (run !== runRef.current) {
      return; // stale response — a newer filter change superseded it
    }
    setBusy(false);
    if (!result.ok) {
      setError(localizedPayrollError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setRows(result.data);
  }, [d, fiscalYearId, status]);

  // Filter changes reload the list; the server page already fetched the
  // initial (empty-filter) rows — the first run is a no-op.
  useEffect(() => {
    if (skipInitialLoad.current) {
      skipInitialLoad.current = false;
      return;
    }
    void loadPage();
  }, [loadPage]);

  const periodName = useCallback(
    (id: string): string => {
      const period = periods.find((entry) => entry.id === id);
      return period === undefined ? id : period.name;
    },
    [periods],
  );

  const visibleRows = useMemo(
    () =>
      [...rows].sort((left, right) =>
        periodName(left.fiscalPeriodId).localeCompare(periodName(right.fiscalPeriodId)),
      ),
    [rows, periodName],
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-52">
          <Select
            id="payroll-runs-filter-year"
            label={d.budgetsFilterYear}
            value={fiscalYearId}
            onValueChange={setFiscalYearId}
            options={[
              { value: "", label: d.kindFilterAll },
              ...years.map((year) => ({ value: year.id, label: year.name })),
            ]}
          />
        </div>
        <div className="w-48">
          <Select
            id="payroll-runs-filter-status"
            label={d.payRunStatus}
            value={status}
            onValueChange={setStatus}
            options={[
              { value: "", label: d.kindFilterAll },
              { value: "DRAFT", label: d.payRunDraft },
              { value: "PENDING_APPROVAL", label: d.payRunPending },
              { value: "POSTED", label: d.payRunPosted },
            ]}
          />
        </div>
        <LinkButton href={`/${locale}/payroll/runs/new`} variant="primary">
          {d.payRunNew}
        </LinkButton>
        <LinkButton href={`/${locale}/payroll/reports`}>{d.payReportsTitle}</LinkButton>
      </div>
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
      <DataTable
        columns={[
          {
            id: "runNo",
            header: activeLocaleHeader(d.payRunNumber),
            accessor: (row) => row.runNo ?? "—",
            mono: true,
            sortable: true,
            width: "9rem",
            render: (row) => (
              <a
                href={`/${locale}/payroll/runs/${row.id}`}
                className="font-mono text-primary-700 underline decoration-primary-200 hover:text-primary-800"
                dir="ltr"
              >
                {row.runNo ?? "—"}
              </a>
            ),
          },
          {
            id: "period",
            header: activeLocaleHeader(d.payRunPeriod),
            accessor: (row) => periodName(row.fiscalPeriodId),
            sortable: true,
            render: (row) => periodName(row.fiscalPeriodId),
          },
          {
            id: "status",
            header: activeLocaleHeader(d.payRunStatus),
            accessor: (row) => row.status,
            render: (row) => (
              <Badge tone={row.status === "POSTED" ? "primary" : "neutral"}>
                {localizedPayrollRunStatus(d, row.status)}
              </Badge>
            ),
          },
          {
            id: "gross",
            header: activeLocaleHeader(d.payRunGross),
            accessor: (row) => row.grossTotal,
            numeric: true,
            sortable: true,
            render: (row) => (
              <span className="font-mono tabular-nums" dir="ltr">
                {formatMoneyDisplay(row.grossTotal, 2)}
              </span>
            ),
          },
          {
            id: "deductions",
            header: activeLocaleHeader(d.payRunDeductions),
            accessor: (row) => row.deductionsTotal,
            numeric: true,
            sortable: true,
            render: (row) => (
              <span className="font-mono tabular-nums" dir="ltr">
                {formatMoneyDisplay(row.deductionsTotal, 2)}
              </span>
            ),
          },
          {
            id: "net",
            header: activeLocaleHeader(d.payRunNet),
            accessor: (row) => row.netTotal,
            numeric: true,
            sortable: true,
            render: (row) => (
              <span className="font-mono tabular-nums font-semibold" dir="ltr">
                {formatMoneyDisplay(row.netTotal, 2)}
              </span>
            ),
          },
          {
            id: "paid",
            header: activeLocaleHeader(d.payRunPaid),
            accessor: (row) => row.paidNetTotal,
            numeric: true,
            sortable: true,
            render: (row) => (
              <span className="font-mono tabular-nums" dir="ltr">
                {formatMoneyDisplay(row.paidNetTotal, 2)}
              </span>
            ),
          },
          {
            id: "entryNo",
            header: activeLocaleHeader(d.payRunPost),
            accessor: (row) => row.entryNo ?? "—",
            mono: true,
            render: (row) => (
              <span className="font-mono text-sm" dir="ltr">
                {row.entryNo ?? "—"}
              </span>
            ),
          },
        ]}
        rows={visibleRows}
        rowKey={(row) => row.id}
        sort={sort}
        onSortChange={setSort}
        loading={busy && visibleRows.length === 0}
        rowActions={[
          {
            id: "open",
            label: d.commonOpen,
            onSelect: (row) => router.push(`/${locale}/payroll/runs/${row.id}`),
          },
        ]}
        empty={{ title: d.payRunEmptyLines }}
      />
    </div>
  );
}
