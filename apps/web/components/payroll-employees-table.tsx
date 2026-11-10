"use client";

/**
 * PHASE-029 (T11) — the employees register (PAGE_ARCHETYPES §2, List+Search
 * — the budgets-table pattern): status/branch filters reload through the
 * BFF (the API's own filter vocabulary — payroll/employees?status=&branchId=);
 * the free-text box filters the loaded page client-side (the list route
 * carries no search parameter — the honest degrade, never a fabricated
 * server param). The register renders the MASKED employee view only
 * (toEmployeeView — C-PII law); the PII notice rides the top of the page.
 * Structure/branch columns resolve through the server-fetched reference
 * pools (raw ids degrade on reference failure).
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
import type { BranchRow, EmployeeListRow, SalaryStructureRow } from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import {
  localizedName,
  localizedPayrollContract,
  localizedPayrollEmployeeStatus,
  localizedPayrollError,
} from "../lib/messages";
import { LinkButton } from "./link-button";
import { ErrorNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";

export function PayrollEmployeesTable({
  locale,
  initialRows,
  structures,
  branches,
}: {
  locale: Locale;
  initialRows: readonly EmployeeListRow[];
  structures: readonly SalaryStructureRow[];
  branches: readonly BranchRow[];
}): JSX.Element {
  const d = getDictionary(locale);
  const router = useRouter();
  const [rows, setRows] = useState<readonly EmployeeListRow[]>(initialRows);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [branchId, setBranchId] = useState("");
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
    if (status !== "") {
      search.set("status", status);
    }
    if (branchId !== "") {
      search.set("branchId", branchId);
    }
    const suffix = search.size > 0 ? `?${search.toString()}` : "";
    const result = await bffFetch<readonly EmployeeListRow[]>(`payroll/employees${suffix}`);
    if (run !== runRef.current) {
      return; // stale response — a newer filter change superseded it
    }
    setBusy(false);
    if (!result.ok) {
      setError(localizedPayrollError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setRows(result.data);
  }, [d, status, branchId]);

  // Filter changes reload the list; the server page already fetched the
  // initial (empty-filter) rows — the first run is a no-op.
  useEffect(() => {
    if (skipInitialLoad.current) {
      skipInitialLoad.current = false;
      return;
    }
    void loadPage();
  }, [loadPage]);

  const structureLabel = useCallback(
    (id: string | null): string => {
      if (id === null) {
        return "—";
      }
      const structure = structures.find((entry) => entry.id === id);
      return structure === undefined ? id : localizedName(structure.name, structure.nameAr, locale);
    },
    [structures, locale],
  );

  const branchLabel = useCallback(
    (id: string | null): string => {
      if (id === null) {
        return "—";
      }
      const branch = branches.find((entry) => entry.id === id);
      return branch === undefined ? id : localizedName(branch.name, branch.nameAr, locale);
    },
    [branches, locale],
  );

  const employeeLabel = useCallback(
    (row: EmployeeListRow): string => localizedName(row.name, row.nameAr, locale),
    [locale],
  );

  // Free-text search over the loaded page (code / name / masked national
  // id) — the API list route has no search parameter; this never
  // fabricates one.
  const visibleRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === "") {
      return rows;
    }
    return rows.filter(
      (row) =>
        row.code.toLowerCase().includes(needle) ||
        employeeLabel(row).toLowerCase().includes(needle) ||
        (row.nationalIdMasked ?? "").toLowerCase().includes(needle),
    );
  }, [rows, query, employeeLabel]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full max-w-xs">
          <SearchInput
            value={query}
            onValueChange={setQuery}
            placeholder={d.payEmployeesSearch}
            label={d.listSearchLabel}
          />
        </div>
        <div className="w-48">
          <Select
            id="payroll-employees-filter-status"
            label={d.payEmployeeStatus}
            value={status}
            onValueChange={setStatus}
            options={[
              { value: "", label: d.kindFilterAll },
              { value: "ACTIVE", label: d.payStatusActive },
              { value: "SUSPENDED", label: d.payStatusSuspended },
              { value: "TERMINATED", label: d.payStatusTerminated },
            ]}
          />
        </div>
        <div className="w-52">
          <Select
            id="payroll-employees-filter-branch"
            label={d.payEmployeeBranch}
            value={branchId}
            onValueChange={setBranchId}
            options={[
              { value: "", label: d.kindFilterAll },
              ...branches.map((branch) => ({
                value: branch.id,
                label: localizedName(branch.name, branch.nameAr, locale),
              })),
            ]}
          />
        </div>
        <LinkButton href={`/${locale}/payroll/employees/new`} variant="primary">
          {d.payEmployeesNew}
        </LinkButton>
        <LinkButton href={`/${locale}/payroll/reports`}>{d.payReportsTitle}</LinkButton>
      </div>
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
      <DataTable
        columns={[
          {
            id: "code",
            header: activeLocaleHeader(d.payEmployeeCode),
            accessor: (row) => row.code,
            mono: true,
            sortable: true,
            width: "8rem",
            render: (row) => (
              <a
                href={`/${locale}/payroll/employees/${row.id}`}
                className="font-mono text-primary-700 underline decoration-primary-200 hover:text-primary-800"
                dir="ltr"
              >
                {row.code}
              </a>
            ),
          },
          {
            id: "name",
            header: activeLocaleHeader(d.payEmployeeName),
            accessor: (row) => employeeLabel(row),
            sortable: true,
            render: (row) => employeeLabel(row),
          },
          {
            id: "nationalId",
            header: activeLocaleHeader(d.payEmployeeNationalId),
            accessor: (row) => row.nationalIdMasked ?? "—",
            mono: true,
            render: (row) => (
              <span className="font-mono" dir="ltr">
                {row.nationalIdMasked ?? "—"}
              </span>
            ),
          },
          {
            id: "hireDate",
            header: activeLocaleHeader(d.payEmployeeHireDate),
            accessor: (row) => row.hireDate,
            sortable: true,
            render: (row) => (
              <span className="font-mono text-sm" dir="ltr">
                {row.hireDate}
              </span>
            ),
          },
          {
            id: "contract",
            header: activeLocaleHeader(d.payEmployeeContract),
            accessor: (row) => row.contractType,
            render: (row) => localizedPayrollContract(d, row.contractType),
          },
          {
            id: "basicSalary",
            header: activeLocaleHeader(d.payEmployeeBasicSalary),
            accessor: (row) => row.basicSalary,
            numeric: true,
            sortable: true,
            render: (row) => (
              <span className="font-mono tabular-nums" dir="ltr">
                {formatMoneyDisplay(row.basicSalary, 2)}
              </span>
            ),
          },
          {
            id: "structure",
            header: activeLocaleHeader(d.payEmployeeStructure),
            accessor: (row) => structureLabel(row.salaryStructureId),
            render: (row) => structureLabel(row.salaryStructureId),
          },
          {
            id: "branch",
            header: activeLocaleHeader(d.payEmployeeBranch),
            accessor: (row) => branchLabel(row.branchId),
            render: (row) => branchLabel(row.branchId),
          },
          {
            id: "status",
            header: activeLocaleHeader(d.payEmployeeStatus),
            accessor: (row) => row.status,
            render: (row) => (
              <Badge tone={row.status === "ACTIVE" ? "primary" : "neutral"}>
                {localizedPayrollEmployeeStatus(d, row.status)}
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
            onSelect: (row) => router.push(`/${locale}/payroll/employees/${row.id}`),
          },
        ]}
        empty={{ title: d.payEmployeesEmpty }}
      />
    </div>
  );
}
