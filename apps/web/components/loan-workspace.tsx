"use client";

/**
 * PHASE-029 (T11) — the loan workspace (PAGE_ARCHETYPES §4): the header
 * (code + employee + amount + installments + status) + the per-period
 * schedule table (amount / status / the run that deducted it) + the
 * rail actions — waive a PENDING line (reason required), write off the
 * whole ACTIVE loan (reason required; the server posts the write-off
 * JE). Period names resolve through the period pool; the run column
 * deep-links to the deducting run.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { JSX } from "react";

import {
  Badge,
  Button,
  DataTable,
  Input,
  formatMoneyDisplay,
  useToast,
  type DataTableSort,
} from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type {
  EmployeeListRow,
  EmployeeLoanRow,
  EmployeeLoanLineRow,
  FiscalPeriodRow,
} from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import {
  formatMessage,
  localizedName,
  localizedPayrollError,
  localizedPayrollLoanLineStatus,
  localizedPayrollLoanStatus,
} from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice, InfoNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";

export function LoanWorkspace({
  locale,
  loan,
  lines,
  employee,
  periods,
}: {
  locale: Locale;
  loan: EmployeeLoanRow;
  lines: readonly EmployeeLoanLineRow[];
  employee: EmployeeListRow | null;
  periods: readonly FiscalPeriodRow[];
}): JSX.Element {
  const d = getDictionary(locale);
  const router = useRouter();
  const { toast } = useToast();

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [sort, setSort] = useState<DataTableSort[]>([]);

  // Waive per line (PENDING only).
  const [waiveLineId, setWaiveLineId] = useState<string | null>(null);
  const [waiveReason, setWaiveReason] = useState("");

  // Write-off (ACTIVE only).
  const [writeOffOpen, setWriteOffOpen] = useState(false);
  const [writeOffReason, setWriteOffReason] = useState("");

  const periodName = (id: string): string => {
    const period = periods.find((entry) => entry.id === id);
    return period === undefined ? id : period.name;
  };

  async function waive(): Promise<void> {
    if (waiveLineId === null || waiveReason.trim() === "") {
      setError(d.budgetFormInvalid);
      return;
    }
    setError(null);
    setBusy("waive");
    const result = await bffFetch<EmployeeLoanLineRow>(`payroll/loans/lines/${waiveLineId}/waive`, {
      method: "POST",
      body: { reason: waiveReason.trim() },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedPayrollError(d, result.error, result.retryAfterSeconds));
      return;
    }
    toast({ tone: "success", title: formatMessage(d.payLoanWaivedToast, { reason: waiveReason.trim() }) });
    setWaiveLineId(null);
    setWaiveReason("");
    router.refresh();
  }

  async function writeOff(): Promise<void> {
    if (writeOffReason.trim() === "") {
      setError(d.budgetFormInvalid);
      return;
    }
    setError(null);
    setBusy("write-off");
    const result = await bffFetch<EmployeeLoanRow>(`payroll/loans/${loan.id}/write-off`, {
      method: "POST",
      body: { reason: writeOffReason.trim() },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedPayrollError(d, result.error, result.retryAfterSeconds));
      return;
    }
    toast({
      tone: "success",
      title: formatMessage(d.payLoanWrittenOffToast, {
        code: result.data.code,
        reason: writeOffReason.trim(),
      }),
    });
    setWriteOffOpen(false);
    setWriteOffReason("");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}

      <Card
        title={loan.code}
        actions={
          <Badge tone={loan.status === "ACTIVE" ? "primary" : "neutral"}>
            {localizedPayrollLoanStatus(d, loan.status)}
          </Badge>
        }
      >
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-6 text-sm">
            {employee !== null && (
              <a
                href={`/${locale}/payroll/employees/${employee.id}`}
                className="font-mono text-primary-700 underline decoration-primary-200 hover:text-primary-800"
                dir="ltr"
              >
                {employee.code}
              </a>
            )}
            {employee !== null && (
              <span>{localizedName(employee.name, employee.nameAr, locale)}</span>
            )}
            <span className="font-mono tabular-nums" dir="ltr">
              {d.payLoanAmount}: {formatMoneyDisplay(loan.amount, 2)}
            </span>
            <span className="font-mono tabular-nums" dir="ltr">
              {d.payLoanInstallments}: {loan.installmentsCount}
            </span>
          </div>
          {loan.status === "ACTIVE" && (
            <InfoNotice>{d.payErrLoanCap}</InfoNotice>
          )}
          {loan.writeOffReason !== null && <ErrorNotice>{loan.writeOffReason}</ErrorNotice>}
          {loan.status === "ACTIVE" && (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="danger"
                onClick={() => setWriteOffOpen(writeOffOpen ? false : true)}
                disabled={busy !== null}
              >
                {d.payLoanWriteOff}
              </Button>
            </div>
          )}
          {writeOffOpen && (
            <div className="grid gap-3 rounded-md border border-gray-200 p-4 sm:grid-cols-2">
              <Input
                id="loan-write-off-reason"
                label={d.payLoanWriteOffReason}
                value={writeOffReason}
                onValueChange={setWriteOffReason}
                required
              />
              <div className="flex items-end">
                <Button variant="danger" onClick={() => void writeOff()} loading={busy === "write-off"}>
                  {d.payLoanWriteOff}
                </Button>
              </div>
            </div>
          )}
        </div>
      </Card>

      <Card title={d.payLoanSchedule}>
        <DataTable
          columns={[
            {
              id: "period",
              header: activeLocaleHeader(d.payLoanStartPeriod),
              accessor: (row) => periodName(row.fiscalPeriodId),
              sortable: true,
              render: (row) => periodName(row.fiscalPeriodId),
            },
            {
              id: "amount",
              header: activeLocaleHeader(d.payLoanLineAmount),
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
              id: "status",
              header: activeLocaleHeader(d.payLoanLineStatus),
              accessor: (row) => row.status,
              render: (row) => (
                <Badge tone={row.status === "PENDING" ? "neutral" : "primary"}>
                  {localizedPayrollLoanLineStatus(d, row.status)}
                </Badge>
              ),
            },
            {
              id: "run",
              header: activeLocaleHeader(d.payRunsTitle),
              accessor: (row) => row.payrollRunId ?? "—",
              render: (row) =>
                row.payrollRunId === null ? (
                  "—"
                ) : (
                  <a
                    href={`/${locale}/payroll/runs/${row.payrollRunId}`}
                    className="font-mono text-primary-700 underline decoration-primary-200 hover:text-primary-800"
                    dir="ltr"
                  >
                    run {row.payrollRunId.slice(0, 8)}
                  </a>
                ),
            },
            {
              id: "waivedReason",
              header: activeLocaleHeader(d.payLoanWaiveReason),
              accessor: (row) => row.waivedReason ?? "—",
              render: (row) => row.waivedReason ?? "—",
            },
          ]}
          rows={[...lines]}
          rowKey={(row) => row.id}
          sort={sort}
          onSortChange={setSort}
          rowActions={[
            {
              id: "waive",
              label: d.payLoanWaive,
              // PENDING lines on an ACTIVE loan only (DEDUCTED/WAIVED are
              // terminal; a written-off loan waives nothing).
              onSelect: (row) => {
                if (row.status !== "PENDING" || loan.status !== "ACTIVE") {
                  setError(d.payErrStateInvalid);
                  return;
                }
                setWaiveLineId(waiveLineId === row.id ? null : row.id);
                setWaiveReason("");
              },
            },
          ]}
          empty={{ title: d.payEmployeesEmpty }}
        />
        {waiveLineId !== null && (
          <div className="mt-3 grid gap-3 rounded-md border border-gray-200 p-4 sm:grid-cols-2">
            <Input
              id="loan-waive-reason"
              label={d.payLoanWaiveReason}
              value={waiveReason}
              onValueChange={setWaiveReason}
              required
            />
            <div className="flex items-end">
              <Button variant="primary" onClick={() => void waive()} loading={busy === "waive"}>
                {d.payLoanWaive}
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
