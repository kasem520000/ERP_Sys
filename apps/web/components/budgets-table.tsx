"use client";

/**
 * PHASE-028 (T9) — the budgets register list (PAGE_ARCHETYPES §2,
 * List+Search — the installments-table pattern): status/scope/fiscal-year
 * filters reload through the BFF (the API's own filter set — the list
 * route carries no search parameter, so the free-text box filters the
 * loaded page client-side — the honest degrade, never a fabricated
 * server param). The register's money column is the year total (canonical
 * decimal string, formatMoneyDisplay); the revision column renders the
 * BR-050 revision number. The new/import/reports sibling surfaces ride
 * the filter rail links.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { JSX } from "react";

import {
  Badge,
  DataTable,
  SearchInput,
  Select,
  formatMoneyDisplay,
  type DataTableSort,
} from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type { BudgetListRow, FiscalYearRow } from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import {
  localizedName,
  localizedBudgetScope,
  localizedBudgetStatus,
  localizedBudgetsError,
} from "../lib/messages";
import { LinkButton } from "./link-button";
import { ErrorNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";

export function BudgetsTable({
  locale,
  initialRows,
  years,
}: {
  locale: Locale;
  initialRows: readonly BudgetListRow[];
  years: readonly FiscalYearRow[];
}): JSX.Element {
  const d = getDictionary(locale);
  const router = useRouter();
  const [rows, setRows] = useState<readonly BudgetListRow[]>(initialRows);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [scope, setScope] = useState("");
  const [fiscalYearId, setFiscalYearId] = useState("");
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
    // The budgets list route carries no limit parameter (unlike notes) —
    // only its own fiscalYearId/scope/status filter vocabulary is sent.
    const search = new URLSearchParams();
    if (status !== "") {
      search.set("status", status);
    }
    if (scope !== "") {
      search.set("scope", scope);
    }
    if (fiscalYearId !== "") {
      search.set("fiscalYearId", fiscalYearId);
    }
    const suffix = search.size > 0 ? `?${search.toString()}` : "";
    const result = await bffFetch<readonly BudgetListRow[]>(`budgeting/budgets${suffix}`);
    if (run !== runRef.current) {
      return; // stale response — a newer filter change superseded it
    }
    setBusy(false);
    if (!result.ok) {
      setError(localizedBudgetsError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setRows(result.data);
  }, [d, status, scope, fiscalYearId]);

  // Filter changes reload the list; the server page already fetched the
  // initial (empty-filter) rows — the first run is a no-op.
  useEffect(() => {
    if (skipInitialLoad.current) {
      skipInitialLoad.current = false;
      return;
    }
    void loadPage();
  }, [loadPage]);

  const yearName = useCallback(
    (id: string): string => {
      const year = years.find((entry) => entry.id === id);
      return year === undefined ? id : year.name;
    },
    [years],
  );

  const budgetLabel = useCallback(
    (row: BudgetListRow): string => localizedName(row.name, row.nameAr, locale),
    [locale],
  );

  // Free-text search over the loaded page (code / name / year) — the API
  // list route has no search parameter; this never fabricates one.
  const visibleRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === "") {
      return rows;
    }
    return rows.filter(
      (row) =>
        row.code.toLowerCase().includes(needle) ||
        budgetLabel(row).toLowerCase().includes(needle) ||
        yearName(row.fiscalYearId).toLowerCase().includes(needle),
    );
  }, [rows, query, budgetLabel, yearName]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full max-w-xs">
          <SearchInput
            value={query}
            onValueChange={setQuery}
            placeholder={d.budgetsSearchPlaceholder}
            label={d.listSearchLabel}
          />
        </div>
        <div className="w-48">
          <Select
            id="budgets-filter-status"
            label={d.budgetsFilterStatus}
            value={status}
            onValueChange={setStatus}
            options={[
              { value: "", label: d.budgetsAllStatuses },
              { value: "DRAFT", label: d.budgetStatusDraft },
              { value: "PENDING_APPROVAL", label: d.budgetStatusPendingApproval },
              { value: "ACTIVE", label: d.budgetStatusActive },
              { value: "REVISED", label: d.budgetStatusRevised },
              { value: "CLOSED", label: d.budgetStatusClosed },
            ]}
          />
        </div>
        <div className="w-48">
          <Select
            id="budgets-filter-scope"
            label={d.budgetsFilterScope}
            value={scope}
            onValueChange={setScope}
            options={[
              { value: "", label: d.kindFilterAll },
              { value: "ACCOUNTS", label: d.budgetScopeAccounts },
              { value: "COST_CENTERS", label: d.budgetScopeCostCenters },
              { value: "PROJECTS", label: d.budgetScopeProjects },
              { value: "BRANCHES", label: d.budgetScopeBranches },
            ]}
          />
        </div>
        <div className="w-52">
          <Select
            id="budgets-filter-year"
            label={d.budgetsFilterYear}
            value={fiscalYearId}
            onValueChange={setFiscalYearId}
            options={[
              { value: "", label: d.kindFilterAll },
              ...years.map((year) => ({ value: year.id, label: year.name })),
            ]}
          />
        </div>
        <LinkButton href={`/${locale}/budgeting/new`} variant="primary">
          {d.budgetsNewButton}
        </LinkButton>
        <LinkButton href={`/${locale}/budgeting/import`}>{d.budgetsImportLink}</LinkButton>
        <LinkButton href={`/${locale}/budgeting/reports`}>{d.budgetReportsTitle}</LinkButton>
      </div>
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
      <DataTable
        columns={[
          {
            id: "code",
            header: activeLocaleHeader(d.budgetColCode),
            accessor: (row) => row.code,
            mono: true,
            sortable: true,
            width: "10rem",
            render: (row) => (
              <a
                href={`/${locale}/budgeting/${row.id}`}
                className="font-mono text-primary-700 underline decoration-primary-200 hover:text-primary-800"
                dir="ltr"
              >
                {row.code}
              </a>
            ),
          },
          {
            id: "name",
            header: activeLocaleHeader(d.budgetColName),
            accessor: (row) => budgetLabel(row),
            sortable: true,
            render: (row) => budgetLabel(row),
          },
          {
            id: "year",
            header: activeLocaleHeader(d.budgetColYear),
            accessor: (row) => yearName(row.fiscalYearId),
            sortable: true,
            render: (row) => yearName(row.fiscalYearId),
          },
          {
            id: "scope",
            header: activeLocaleHeader(d.budgetColScope),
            accessor: (row) => row.scope,
            render: (row) => localizedBudgetScope(d, row.scope),
          },
          {
            id: "revision",
            header: activeLocaleHeader(d.budgetColRevision),
            accessor: (row) => String(row.revisionNo),
            numeric: true,
            sortable: true,
            render: (row) => (
              <span className="font-mono tabular-nums" dir="ltr">
                r{row.revisionNo}
              </span>
            ),
          },
          {
            id: "lines",
            header: activeLocaleHeader(d.budgetColLines),
            accessor: (row) => String(row.lineCount),
            numeric: true,
            sortable: true,
            render: (row) => (
              <span className="font-mono tabular-nums" dir="ltr">
                {row.lineCount}
              </span>
            ),
          },
          {
            id: "total",
            header: activeLocaleHeader(d.budgetColTotal),
            accessor: (row) => row.yearTotal,
            numeric: true,
            sortable: true,
            render: (row) => (
              <span className="font-mono tabular-nums" dir="ltr">
                {formatMoneyDisplay(row.yearTotal, 2)}
              </span>
            ),
          },
          {
            id: "status",
            header: activeLocaleHeader(d.budgetColStatus),
            accessor: (row) => row.status,
            render: (row) => (
              <Badge tone={row.status === "ACTIVE" ? "primary" : "neutral"}>
                {localizedBudgetStatus(d, row.status)}
              </Badge>
            ),
          },
        ]}
        rows={[...visibleRows]}
        rowKey={(row) => row.id}
        sort={sort}
        onSortChange={setSort}
        loading={busy && visibleRows.length === 0}
        rowActions={[
          {
            id: "open",
            label: d.commonOpen,
            onSelect: (row) => router.push(`/${locale}/budgeting/${row.id}`),
          },
        ]}
        empty={{ title: d.budgetsEmpty }}
      />
    </div>
  );
}
