"use client";

/**
 * PHASE-029 (T11) — the employee loans register (PAGE_ARCHETYPES §2,
 * List+Search — the budgets-table pattern): employee/status filters
 * reload through the BFF (the API's own filter vocabulary —
 * payroll/loans?employeeId=&status=); the employee column resolves
 * through the masked employee pool (code + localized name). The
 * disbursement JE column surfaces the posted entry (the create posts
 * the disbursement immediately — INV-013).
 */
import { useCallback, useEffect, useRef, useState } from "react";
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
import type { EmployeeListRow, EmployeeLoanRow } from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import {
  localizedName,
  localizedPayrollEmployeeStatus,
  localizedPayrollError,
  localizedPayrollLoanStatus,
} from "../lib/messages";
import { LinkButton } from "./link-button";
import { ErrorNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";

export function LoansTable({
  locale,
  initialRows,
  employees,
}: {
  locale: Locale;
  initialRows: readonly EmployeeLoanRow[];
  employees: readonly EmployeeListRow[];
}): JSX.Element {
  const d = getDictionary(locale);
  const router = useRouter();
  const [rows, setRows] = useState<readonly EmployeeLoanRow[]>(initialRows);
  const [employeeId, setEmployeeId] = useState("");
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
    if (employeeId !== "") {
      search.set("employeeId", employeeId);
    }
    if (status !== "") {
      search.set("status", status);
    }
    const suffix = search.size > 0 ? `?${search.toString()}` : "";
    const result = await bffFetch<readonly EmployeeLoanRow[]>(`payroll/loans${suffix}`);
    if (run !== runRef.current) {
      return; // stale response — a newer filter change superseded it
    }
    setBusy(false);
    if (!result.ok) {
      setError(localizedPayrollError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setRows(result.data);
  }, [d, employeeId, status]);

  // Filter changes reload the list; the server page already fetched the
  // initial (empty-filter) rows — the first run is a no-op.
  useEffect(() => {
    if (skipInitialLoad.current) {
      skipInitialLoad.current = false;
      return;
    }
    void loadPage();
  }, [loadPage]);

  const employeeById = new Map(employees.map((employee) => [employee.id, employee]));

  const employeeLabel = (id: string): string => {
    const employee = employeeById.get(id);
    if (employee === undefined) {
      return id;
    }
    return `${employee.code} — ${localizedName(employee.name, employee.nameAr, locale)}`;
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-64">
          <Select
            id="payroll-loans-filter-employee"
            label={d.payLoanEmployee}
            value={employeeId}
            onValueChange={setEmployeeId}
            options={[
              { value: "", label: d.kindFilterAll },
              ...employees.map((employee) => ({
                value: employee.id,
                label: `${employee.code} — ${localizedName(employee.name, employee.nameAr, locale)}`,
              })),
            ]}
          />
        </div>
        <div className="w-48">
          <Select
            id="payroll-loans-filter-status"
            label={d.payLoanLineStatus}
            value={status}
            onValueChange={setStatus}
            options={[
              { value: "", label: d.kindFilterAll },
              { value: "ACTIVE", label: d.payLoanActive },
              { value: "CLOSED", label: d.payLoanClosed },
              { value: "WRITE_OFF", label: d.payLoanWriteOffStatus },
            ]}
          />
        </div>
        <LinkButton href={`/${locale}/payroll/loans/new`} variant="primary">
          {d.payLoanNew}
        </LinkButton>
      </div>
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
      <DataTable
        columns={[
          {
            id: "code",
            header: activeLocaleHeader(d.payLoanCode),
            accessor: (row) => row.code,
            mono: true,
            sortable: true,
            width: "9rem",
            render: (row) => (
              <a
                href={`/${locale}/payroll/loans/${row.id}`}
                className="font-mono text-primary-700 underline decoration-primary-200 hover:text-primary-800"
                dir="ltr"
              >
                {row.code}
              </a>
            ),
          },
          {
            id: "employee",
            header: activeLocaleHeader(d.payLoanEmployee),
            accessor: (row) => employeeLabel(row.employeeId),
            sortable: true,
            render: (row) => {
              const employee = employeeById.get(row.employeeId);
              return employee === undefined ? (
                row.employeeId
              ) : (
                <span className="flex flex-wrap items-center gap-2">
                  <a
                    href={`/${locale}/payroll/employees/${employee.id}`}
                    className="font-mono text-primary-700 underline decoration-primary-200 hover:text-primary-800"
                    dir="ltr"
                  >
                    {employee.code}
                  </a>
                  <span>{localizedName(employee.name, employee.nameAr, locale)}</span>
                  <Badge tone="neutral">
                    {localizedPayrollEmployeeStatus(d, employee.status)}
                  </Badge>
                </span>
              );
            },
          },
          {
            id: "amount",
            header: activeLocaleHeader(d.payLoanAmount),
            accessor: (row) => row.amount,
            numeric: true,
            sortable: true,
            render: (row) => (
              <span className="font-mono tabular-nums" dir="ltr">
                {formatMoneyDisplay(row.amount, 2)}
              </span>
            ),
          },
          {
            id: "installments",
            header: activeLocaleHeader(d.payLoanInstallments),
            accessor: (row) => String(row.installmentsCount),
            numeric: true,
            sortable: true,
            render: (row) => (
              <span className="font-mono tabular-nums" dir="ltr">
                {row.installmentsCount}
              </span>
            ),
          },
          {
            id: "status",
            header: activeLocaleHeader(d.payLoanLineStatus),
            accessor: (row) => row.status,
            render: (row) => (
              <Badge tone={row.status === "ACTIVE" ? "primary" : "neutral"}>
                {localizedPayrollLoanStatus(d, row.status)}
              </Badge>
            ),
          },
          {
            id: "disbursed",
            header: activeLocaleHeader(d.accountingColEntryNo),
            accessor: (row) => (row.disbursementJournalEntryId === null ? "—" : "✓"),
            render: (row) =>
              row.disbursementJournalEntryId === null ? (
                "—"
              ) : (
                <span className="font-mono text-xs text-gray-500" dir="ltr">
                  JE {row.disbursementJournalEntryId.slice(0, 8)}
                </span>
              ),
          },
        ]}
        rows={[...rows]}
        rowKey={(row) => row.id}
        sort={sort}
        onSortChange={setSort}
        loading={busy && rows.length === 0}
        rowActions={[
          {
            id: "open",
            label: d.commonOpen,
            onSelect: (row) => router.push(`/${locale}/payroll/loans/${row.id}`),
          },
        ]}
        empty={{ title: d.payEmployeesEmpty }}
      />
    </div>
  );
}
