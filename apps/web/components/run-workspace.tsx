"use client";

/**
 * PHASE-029 (T11) — the payroll run workspace (PAGE_ARCHETYPES §4, the
 * budget-workspace pattern): the INV-025 totals header + the lifecycle
 * rail (calculate → submit → approve (SoD) → post (G-29) → payout (G-30)
 * / reverse) + the frozen per-employee lines + the payslips batch
 * (masked C-PII; fetched on demand). Every action is an exact API verb
 * with the localized typed-error mirror; warnings from BR-054 loan
 * clamps / skipped employees render under the action rail. Success rides
 * toasts + router.refresh() (the server page re-reads the frozen rows).
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { JSX } from "react";

import {
  Badge,
  Button,
  DataTable,
  Input,
  MoneyInput,
  Select,
  formatMoneyDisplay,
  useToast,
  type DataTableSort,
} from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type {
  CashAccountRow,
  EmployeeListRow,
  PayrollRunListRow,
  PayrollRunLineRow,
  PayslipsResult,
  RunCalculationResult,
} from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { subtractExact } from "../lib/exact-money";
import {
  formatMessage,
  localizedName,
  localizedPayrollEmployeeStatus,
  localizedPayrollError,
  localizedPayrollRunStatus,
} from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice, InfoNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";

const MONEY_SHAPE = /^\d+(\.\d{1,4})?$/;

export function RunWorkspace({
  locale,
  run,
  lines,
  periodName,
  employees,
  cashAccounts,
  currency,
}: {
  locale: Locale;
  run: PayrollRunListRow;
  lines: readonly PayrollRunLineRow[];
  periodName: string;
  employees: readonly EmployeeListRow[];
  cashAccounts: readonly CashAccountRow[];
  currency: string;
}): JSX.Element {
  const d = getDictionary(locale);
  const router = useRouter();
  const { toast } = useToast();

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<RunCalculationResult["warnings"] | null>(null);
  const [sort, setSort] = useState<DataTableSort[]>([]);

  // Payout state (POSTED runs, outstanding > 0).
  const outstanding =
    run.status === "POSTED" ? subtractExact(run.netTotal, run.paidNetTotal) : "0.0000";
  const [payoutOpen, setPayoutOpen] = useState(false);
  const [payoutAmount, setPayoutAmount] = useState(outstanding);
  const [payoutAccount, setPayoutAccount] = useState(cashAccounts[0]?.id ?? "");
  const [payoutDate, setPayoutDate] = useState("");

  // Reverse state (POSTED runs, not yet reversed).
  const [reverseOpen, setReverseOpen] = useState(false);
  const [reverseReason, setReverseReason] = useState("");
  const [reverseDate, setReverseDate] = useState("");

  // Payslips (on demand — the masked batch).
  const [payslips, setPayslips] = useState<PayslipsResult | null>(null);
  const [payslipsBusy, setPayslipsBusy] = useState(false);

  const activeCashAccounts = cashAccounts.filter((account) => account.status === "ACTIVE");
  const employeeById = new Map(employees.map((employee) => [employee.id, employee]));

  async function act(
    action: "calculate" | "submit" | "approve" | "post" | "payout" | "reverse",
    body?: Record<string, unknown>,
  ): Promise<void> {
    setError(null);
    setBusy(action);
    const result = await bffFetch<Record<string, unknown>>(`payroll/runs/${run.id}/${action}`, {
      method: "POST",
      body: body ?? {},
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedPayrollError(d, result.error, result.retryAfterSeconds));
      return;
    }
    if (action === "calculate") {
      const data = result.data as unknown as RunCalculationResult;
      setWarnings(data.warnings);
      toast({
        tone: "success",
        title: formatMessage(d.payRunCalculatedToast, {
          count: data.lineCount,
          gross: formatMoneyDisplay(data.run.grossTotal, 2),
          net: formatMoneyDisplay(data.run.netTotal, 2),
        }),
      });
    } else if (action === "submit") {
      toast({ tone: "success", title: d.payRunSubmittedToast });
    } else if (action === "approve") {
      toast({ tone: "success", title: d.payRunApprovedToast });
    } else if (action === "post") {
      const posted = result.data as unknown as PayrollRunListRow;
      toast({
        tone: "success",
        title: formatMessage(d.payRunPostedToast, {
          runNo: posted.runNo ?? "—",
          entryNo: posted.entryNo ?? "—",
        }),
      });
    } else if (action === "payout") {
      const paid = result.data as unknown as { amount: string };
      toast({
        tone: "success",
        title: formatMessage(d.payRunPayoutToast, {
          amount: formatMoneyDisplay(paid.amount, 2),
          outstanding: formatMoneyDisplay(subtractExact(outstanding, paid.amount), 2),
        }),
      });
      setPayoutOpen(false);
      setPayoutAmount(subtractExact(outstanding, paid.amount));
    } else if (action === "reverse") {
      toast({ tone: "success", title: d.treasuryDocReverseToast });
    }
    router.refresh();
  }

  async function loadPayslips(): Promise<void> {
    if (payslips !== null) {
      setPayslips(null);
      return;
    }
    setPayslipsBusy(true);
    setError(null);
    const result = await bffFetch<PayslipsResult>(`payroll/runs/${run.id}/payslips?locale=${locale}`);
    setPayslipsBusy(false);
    if (!result.ok) {
      setError(localizedPayrollError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setPayslips(result.data);
  }

  function payout(): void {
    if (payoutAccount === "" || !MONEY_SHAPE.test(payoutAmount)) {
      setError(d.budgetFormInvalid);
      return;
    }
    void act("payout", {
      cashAccountId: payoutAccount,
      amount: payoutAmount,
      ...(payoutDate === "" ? {} : { entryDate: payoutDate }),
    });
  }

  function reverse(): void {
    if (reverseReason.trim() === "" || reverseDate === "") {
      setError(d.budgetFormInvalid);
      return;
    }
    void act("reverse", { reason: reverseReason.trim(), entryDate: reverseDate });
  }

  return (
    <div className="flex flex-col gap-4">
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}

      <Card
        title={`${run.runNo ?? d.payRunDraft} — ${periodName}`}
        actions={
          <Badge tone={run.status === "POSTED" ? "primary" : "neutral"}>
            {localizedPayrollRunStatus(d, run.status)}
          </Badge>
        }
      >
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-6 text-sm">
            <span className="font-mono tabular-nums" dir="ltr">
              {d.payRunGross}: {formatMoneyDisplay(run.grossTotal, 2)}
            </span>
            <span className="font-mono tabular-nums" dir="ltr">
              {d.payRunDeductions}: {formatMoneyDisplay(run.deductionsTotal, 2)}
            </span>
            <span className="font-mono tabular-nums font-semibold" dir="ltr">
              {d.payRunNet}: {formatMoneyDisplay(run.netTotal, 2)}
            </span>
            <span className="font-mono tabular-nums" dir="ltr">
              {d.payRunEmployer}: {formatMoneyDisplay(run.employerContributionsTotal, 2)}
            </span>
            <span className="font-mono tabular-nums" dir="ltr">
              {d.payRunEos}: {formatMoneyDisplay(run.eosAccrualTotal, 2)}
            </span>
            <span className="font-mono tabular-nums" dir="ltr">
              {d.payRunPaid}: {formatMoneyDisplay(run.paidNetTotal, 2)}
            </span>
            {run.status === "POSTED" && (
              <span className="font-mono tabular-nums font-semibold" dir="ltr">
                {d.payRunOutstanding}: {formatMoneyDisplay(outstanding, 2)}
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-4 text-xs text-gray-500" dir="ltr">
            {run.entryNo !== null && <span>G-29: {run.entryNo}</span>}
            {run.approvedAt !== null && <span>✓ {run.approvedAt.slice(0, 10)}</span>}
            {run.postedAt !== null && <span>⇥ {run.postedAt.slice(0, 10)}</span>}
            {run.reversalJournalEntryId !== null && <span>⇄ reversal</span>}
          </div>

          {/* The lifecycle rail — exact verbs per status (the state chart). */}
          <div className="flex flex-wrap gap-2">
            {run.status === "DRAFT" && (
              <>
                <Button
                  variant="primary"
                  onClick={() => void act("calculate")}
                  loading={busy === "calculate"}
                >
                  {d.payRunCalculate}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => void act("submit")}
                  loading={busy === "submit"}
                  disabled={lines.length === 0}
                >
                  {d.payRunSubmit}
                </Button>
              </>
            )}
            {run.status === "PENDING_APPROVAL" && run.approvedAt === null && (
              <Button
                variant="primary"
                onClick={() => void act("approve")}
                loading={busy === "approve"}
              >
                {d.payRunApprove}
              </Button>
            )}
            {run.status === "PENDING_APPROVAL" && run.approvedAt !== null && (
              <Button variant="primary" onClick={() => void act("post")} loading={busy === "post"}>
                {d.payRunPost}
              </Button>
            )}
            {run.status === "POSTED" && run.reversalJournalEntryId === null && (
              <>
                {outstanding !== "0.0000" && (
                  <Button
                    variant="primary"
                    onClick={() => setPayoutOpen(payoutOpen ? false : true)}
                    disabled={busy !== null}
                  >
                    {d.payRunPayout}
                  </Button>
                )}
                <Button
                  variant="danger"
                  onClick={() => setReverseOpen(reverseOpen ? false : true)}
                  disabled={busy !== null}
                >
                  {d.payRunReverse}
                </Button>
              </>
            )}
            {lines.length > 0 && (
              <Button
                variant="secondary"
                onClick={() => void loadPayslips()}
                loading={payslipsBusy}
                disabled={busy !== null}
              >
                {d.payRunPayslips}
              </Button>
            )}
          </div>

          {run.status === "DRAFT" && lines.length === 0 && (
            <InfoNotice>{d.payRunEmptyLines}</InfoNotice>
          )}
          {warnings !== null && (
            <div className="flex flex-col gap-2">
              {warnings.loanClamps.map((clamp) => (
                <ErrorNotice key={`${clamp.employeeCode}-${clamp.loanId}`}>
                  {formatMessage(d.payRunLoanClampWarning, {
                    clampedTo: formatMoneyDisplay(clamp.clampedTo, 2),
                    scheduled: formatMoneyDisplay(clamp.scheduled, 2),
                  })}
                </ErrorNotice>
              ))}
              {warnings.skippedEmployees.length > 0 && (
                <ErrorNotice>
                  {formatMessage(d.payRunSkippedWarning, {
                    list: warnings.skippedEmployees.map((entry) => `${entry.code} (${entry.reason})`).join(", "),
                  })}
                </ErrorNotice>
              )}
            </div>
          )}

          {payoutOpen && (
            <div className="grid gap-3 rounded-md border border-gray-200 p-4 sm:grid-cols-2 lg:grid-cols-4">
              <MoneyInput
                id="run-payout-amount"
                label={d.payRunPayout}
                amount={payoutAmount}
                onAmountChange={setPayoutAmount}
                currency={currency}
                required
              />
              <Select
                id="run-payout-account"
                label={d.payLoanCashAccount}
                value={payoutAccount}
                onValueChange={setPayoutAccount}
                options={activeCashAccounts.map((account) => ({
                  value: account.id,
                  label: `${account.accountCode} — ${localizedName(account.name, account.nameAr, locale)}`,
                }))}
                required
              />
              <Input
                id="run-payout-date"
                label={d.payEmployeeTerminateDate}
                value={payoutDate}
                onValueChange={setPayoutDate}
                hint="YYYY-MM-DD"
                mono
                bidiIsolate
              />
              <div className="flex items-end">
                <Button variant="primary" onClick={payout} loading={busy === "payout"}>
                  {d.payRunPayout}
                </Button>
              </div>
            </div>
          )}

          {reverseOpen && (
            <div className="grid gap-3 rounded-md border border-gray-200 p-4 sm:grid-cols-2 lg:grid-cols-3">
              <Input
                id="run-reverse-reason"
                label={d.payLoanWriteOffReason}
                value={reverseReason}
                onValueChange={setReverseReason}
                required
              />
              <Input
                id="run-reverse-date"
                label={d.payEmployeeTerminateDate}
                value={reverseDate}
                onValueChange={setReverseDate}
                hint="YYYY-MM-DD"
                mono
                bidiIsolate
                required
              />
              <div className="flex items-end">
                <Button variant="danger" onClick={reverse} loading={busy === "reverse"}>
                  {d.payRunReverse}
                </Button>
              </div>
            </div>
          )}
        </div>
      </Card>

      {payslips !== null && (
        <Card title={d.payRunPayslips} description={d.payPiiNote}>
          <div className="flex flex-col gap-3">
            {payslips.slips.map((slip) => (
              <div key={slip.employee.id} className="rounded-md border border-subtle p-3">
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <span className="font-mono text-primary-700" dir="ltr">
                    {slip.employee.code}
                  </span>
                  <span className="font-semibold">
                    {localizedName(slip.employee.name, slip.employee.nameAr, locale)}
                  </span>
                  <Badge tone="neutral">
                    {localizedPayrollEmployeeStatus(d, slip.employee.status)}
                  </Badge>
                  <span className="ms-auto flex gap-4 font-mono tabular-nums" dir="ltr">
                    <span>{formatMoneyDisplay(slip.gross, 2)}</span>
                    <span>−{formatMoneyDisplay(slip.deductions, 2)}</span>
                    <span className="font-semibold">{formatMoneyDisplay(slip.net, 2)}</span>
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-xs text-gray-600">
                  {slip.components.map((component) => (
                    <span key={component.key}>
                      {localizedName(component.name, component.nameAr, locale)}:{" "}
                      <span className="font-mono" dir="ltr">
                        {formatMoneyDisplay(component.computed, 2)}
                      </span>
                    </span>
                  ))}
                  {slip.loanDeductions.map((loan, index) => (
                    <span key={index}>
                      {d.payLoansTitle}:{" "}
                      <span className="font-mono" dir="ltr">
                        {formatMoneyDisplay(loan.amount, 2)}
                      </span>
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card title={d.payRunLines}>
        <DataTable
          columns={[
            {
              id: "code",
              header: activeLocaleHeader(d.payEmployeeCode),
              accessor: (row) => employeeById.get(row.employeeId)?.code ?? row.employeeId,
              mono: true,
              sortable: true,
              width: "8rem",
              render: (row) => {
                const employee = employeeById.get(row.employeeId);
                return employee === undefined ? (
                  <span className="font-mono" dir="ltr">
                    {row.employeeId}
                  </span>
                ) : (
                  <a
                    href={`/${locale}/payroll/employees/${employee.id}`}
                    className="font-mono text-primary-700 underline decoration-primary-200 hover:text-primary-800"
                    dir="ltr"
                  >
                    {employee.code}
                  </a>
                );
              },
            },
            {
              id: "name",
              header: activeLocaleHeader(d.payEmployeeName),
              accessor: (row) => {
                const employee = employeeById.get(row.employeeId);
                return employee === undefined
                  ? row.employeeId
                  : localizedName(employee.name, employee.nameAr, locale);
              },
              sortable: true,
              render: (row) => {
                const employee = employeeById.get(row.employeeId);
                return employee === undefined
                  ? row.employeeId
                  : localizedName(employee.name, employee.nameAr, locale);
              },
            },
            {
              id: "gross",
              header: activeLocaleHeader(d.payRunGross),
              accessor: (row) => row.grossAmount,
              numeric: true,
              sortable: true,
              render: (row) => (
                <span className="font-mono tabular-nums" dir="ltr">
                  {formatMoneyDisplay(row.grossAmount, 2)}
                </span>
              ),
            },
            {
              id: "deductions",
              header: activeLocaleHeader(d.payRunDeductions),
              accessor: (row) => row.deductionsAmount,
              numeric: true,
              sortable: true,
              render: (row) => (
                <span className="font-mono tabular-nums" dir="ltr">
                  {formatMoneyDisplay(row.deductionsAmount, 2)}
                </span>
              ),
            },
            {
              id: "net",
              header: activeLocaleHeader(d.payRunNet),
              accessor: (row) => row.netAmount,
              numeric: true,
              sortable: true,
              render: (row) => (
                <span className="font-mono tabular-nums font-semibold" dir="ltr">
                  {formatMoneyDisplay(row.netAmount, 2)}
                </span>
              ),
            },
            {
              id: "employer",
              header: activeLocaleHeader(d.payRunEmployer),
              accessor: (row) => row.employerContributions,
              numeric: true,
              sortable: true,
              render: (row) => (
                <span className="font-mono tabular-nums" dir="ltr">
                  {formatMoneyDisplay(row.employerContributions, 2)}
                </span>
              ),
            },
            {
              id: "eos",
              header: activeLocaleHeader(d.payRunEos),
              accessor: (row) => row.eosAccrual,
              numeric: true,
              sortable: true,
              render: (row) => (
                <span className="font-mono tabular-nums" dir="ltr">
                  {formatMoneyDisplay(row.eosAccrual, 2)}
                </span>
              ),
            },
          ]}
          rows={[...lines]}
          rowKey={(row) => row.id}
          sort={sort}
          onSortChange={setSort}
          empty={{ title: d.payRunEmptyLines }}
        />
      </Card>
    </div>
  );
}
