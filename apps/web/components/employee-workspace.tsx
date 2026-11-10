"use client";

/**
 * PHASE-029 (T11) — the employee workspace (PAGE_ARCHETYPES §4, the
 * fixed-asset workspace pattern): the masked employee header + the edit
 * form (EmployeeForm, edit mode) + the lifecycle rail (suspend /
 * reactivate / terminate-with-date+reason) + the EOS panel (BR-055
 * balance; settlement only at termination, one-shot — G-31). Every action
 * is an exact API verb with the localized typed-error mirror; success
 * rides toasts + router.refresh() (the server page re-reads with fresh
 * audit trails — PII reads are audit-logged server-side).
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { JSX } from "react";

import { Badge, Button, Input, MoneyInput, Select, formatMoneyDisplay, useToast } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type {
  BranchRow,
  CashAccountRow,
  CostCenterRow,
  EosBalanceRow,
  EosPolicyRow,
  EmployeeListRow,
  ProjectRow,
  SalaryStructureRow,
} from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import {
  formatMessage,
  localizedName,
  localizedPayrollContract,
  localizedPayrollEmployeeStatus,
  localizedPayrollError,
} from "../lib/messages";
import { Card } from "./card";
import { EmployeeForm } from "./employee-form";
import { ErrorNotice, InfoNotice } from "./notices";

const MONEY_SHAPE = /^\d+(\.\d{1,4})?$/;

export function EmployeeWorkspace({
  locale,
  employee,
  eos,
  policy,
  cashAccounts,
  structures,
  branches,
  costCenters,
  projects,
  currency,
}: {
  locale: Locale;
  employee: EmployeeListRow;
  eos: EosBalanceRow;
  policy: EosPolicyRow;
  cashAccounts: readonly CashAccountRow[];
  structures: readonly SalaryStructureRow[];
  branches: readonly BranchRow[];
  costCenters: readonly CostCenterRow[];
  projects: readonly ProjectRow[];
  currency: string;
}): JSX.Element {
  const d = getDictionary(locale);
  const router = useRouter();
  const { toast } = useToast();

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Termination dialog state (date + reason required).
  const [terminateOpen, setTerminateOpen] = useState(false);
  const [terminationDate, setTerminationDate] = useState("");
  const [terminationReason, setTerminationReason] = useState("");

  // EOS settlement state (TERMINATED + unsettled only).
  const canSettle =
    employee.status === "TERMINATED" && eos.settled === null && policy.enabled;
  const [settleAmount, setSettleAmount] = useState(eos.balance);
  const [settleAccount, setSettleAccount] = useState(cashAccounts[0]?.id ?? "");
  const [settleDate, setSettleDate] = useState("");

  const activeCashAccounts = cashAccounts.filter((account) => account.status === "ACTIVE");

  async function lifecycle(
    action: "suspend" | "reactivate" | "terminate",
    body?: Record<string, unknown>,
  ): Promise<void> {
    setError(null);
    if (action === "terminate" && (terminationDate === "" || terminationReason.trim() === "")) {
      setError(d.budgetFormInvalid);
      return;
    }
    setBusy(action);
    const result = await bffFetch<EmployeeListRow>(`payroll/employees/${employee.id}/${action}`, {
      method: "POST",
      body: body ?? {},
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedPayrollError(d, result.error, result.retryAfterSeconds));
      return;
    }
    if (action === "terminate") {
      toast({
        tone: "success",
        title: formatMessage(d.payEmployeeTerminatedToast, {
          code: result.data.code,
          date: result.data.terminationDate ?? "",
        }),
      });
    } else {
      toast({
        tone: "success",
        title: formatMessage(d.payEmployeeUpdatedToast, { code: result.data.code }),
      });
    }
    router.refresh();
  }

  async function settleEos(): Promise<void> {
    setError(null);
    if (!MONEY_SHAPE.test(settleAmount) || settleAccount === "") {
      setError(d.budgetFormInvalid);
      return;
    }
    setBusy("settle");
    const result = await bffFetch<{ journalEntryId: string; settled: string; residual: string }>(
      `payroll/eos/employees/${employee.id}/settle`,
      {
        method: "POST",
        body: {
          settledAmount: settleAmount,
          cashAccountId: settleAccount,
          ...(settleDate === "" ? {} : { entryDate: settleDate }),
        },
      },
    );
    setBusy(null);
    if (!result.ok) {
      setError(localizedPayrollError(d, result.error, result.retryAfterSeconds));
      return;
    }
    toast({
      tone: "success",
      title: formatMessage(d.payEosSettledToast, {
        settled: formatMoneyDisplay(result.data.settled, 2),
        residual: formatMoneyDisplay(result.data.residual, 2),
      }),
    });
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}

      <Card
        title={`${employee.code} — ${localizedName(employee.name, employee.nameAr, locale)}`}
        description={d.payPiiNote}
      >
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <Badge tone={employee.status === "ACTIVE" ? "primary" : "neutral"}>
            {localizedPayrollEmployeeStatus(d, employee.status)}
          </Badge>
          <span className="text-gray-600">
            {d.payEmployeeContract}: {localizedPayrollContract(d, employee.contractType)}
          </span>
          <span className="text-gray-600" dir="ltr">
            {d.payEmployeeHireDate}: {employee.hireDate}
          </span>
          {employee.terminationDate !== null && (
            <span className="text-gray-600" dir="ltr">
              {d.payEmployeeTerminateDate}: {employee.terminationDate}
            </span>
          )}
          <span className="font-mono tabular-nums" dir="ltr">
            {d.payEmployeeBasicSalary}: {formatMoneyDisplay(employee.basicSalary, 2)}
          </span>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {(employee.status === "ACTIVE" || employee.status === "SUSPENDED") && (
            <>
              <Button
                variant="secondary"
                onClick={() => void lifecycle("suspend")}
                loading={busy === "suspend"}
              >
                {d.payEmployeeSuspend}
              </Button>
              {employee.status === "SUSPENDED" && (
                <Button
                  variant="secondary"
                  onClick={() => void lifecycle("reactivate")}
                  loading={busy === "reactivate"}
                >
                  {d.payEmployeeReactivate}
                </Button>
              )}
              <Button
                variant="danger"
                onClick={() => setTerminateOpen(terminateOpen ? false : true)}
                disabled={busy !== null}
              >
                {d.payEmployeeTerminate}
              </Button>
            </>
          )}
        </div>
        {terminateOpen && (
          <div className="mt-4 grid gap-3 rounded-md border border-gray-200 p-4 sm:grid-cols-2">
            <Input
              id="employee-terminate-date"
              label={d.payEmployeeTerminateDate}
              value={terminationDate}
              onValueChange={setTerminationDate}
              hint="YYYY-MM-DD"
              mono
              bidiIsolate
              required
            />
            <Input
              id="employee-terminate-reason"
              label={d.payEmployeeTerminateReason}
              value={terminationReason}
              onValueChange={setTerminationReason}
              required
            />
            <div className="sm:col-span-2 flex justify-end">
              <Button
                variant="danger"
                onClick={() =>
                  void lifecycle("terminate", {
                    terminationDate,
                    reason: terminationReason.trim(),
                  })
                }
                loading={busy === "terminate"}
              >
                {d.payEmployeeTerminate}
              </Button>
            </div>
          </div>
        )}
      </Card>

      <Card title={d.payEosTitle}>
        <div className="flex flex-col gap-3">
          <InfoNotice>
            {policy.enabled && policy.basisDays !== null
              ? formatMessage(d.payEosPolicy, { days: policy.basisDays })
              : d.payEosDisabled}
          </InfoNotice>
          <div className="flex flex-wrap gap-6 text-sm">
            <span className="font-mono tabular-nums" dir="ltr">
              {d.payEosAccrued}: {formatMoneyDisplay(eos.accrued, 2)}
            </span>
            <span className="font-mono tabular-nums" dir="ltr">
              {d.payEosSettled}: {eos.settled === null ? "—" : formatMoneyDisplay(eos.settled, 2)}
            </span>
            <span className="font-mono tabular-nums font-semibold" dir="ltr">
              {d.payEosBalance}: {formatMoneyDisplay(eos.balance, 2)}
            </span>
          </div>
          {canSettle && (
            <div className="grid gap-3 rounded-md border border-gray-200 p-4 sm:grid-cols-2 lg:grid-cols-4">
              <MoneyInput
                id="eos-settle-amount"
                label={d.payEosSettleAmount}
                amount={settleAmount}
                onAmountChange={setSettleAmount}
                currency={currency}
                required
              />
              <Select
                id="eos-settle-account"
                label={d.payLoanCashAccount}
                value={settleAccount}
                onValueChange={setSettleAccount}
                options={activeCashAccounts.map((account) => ({
                  value: account.id,
                  label: `${account.accountCode} — ${localizedName(account.name, account.nameAr, locale)}`,
                }))}
                required
              />
              <Input
                id="eos-settle-date"
                label={d.payEmployeeTerminateDate}
                value={settleDate}
                onValueChange={setSettleDate}
                hint="YYYY-MM-DD"
                mono
                bidiIsolate
              />
              <div className="flex items-end">
                <Button
                  variant="primary"
                  onClick={() => void settleEos()}
                  loading={busy === "settle"}
                >
                  {d.payEosSettle}
                </Button>
              </div>
            </div>
          )}
          {employee.status === "TERMINATED" && eos.settled !== null && (
            <InfoNotice>{d.payErrImmutable}</InfoNotice>
          )}
        </div>
      </Card>

      <EmployeeForm
        locale={locale}
        mode="edit"
        employee={employee}
        structures={structures}
        branches={branches}
        costCenters={costCenters}
        projects={projects}
        currency={currency}
      />
    </div>
  );
}
