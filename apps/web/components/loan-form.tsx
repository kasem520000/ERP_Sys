"use client";

/**
 * PHASE-029 (T11) — employee loan create form (PAGE_ARCHETYPES §3, the
 * run-form pattern): employee + amount + installments + start period
 * (year → REGULAR period) + the treasury cash account the disbursement
 * pays from → POST payroll/loans creates AND disburses in one ambient
 * transaction (the disbursement JE posts immediately — INV-013; the
 * server validates the control-account mapping + the BR-054 net cap
 * with typed mirrors). On success the form routes to the loan schedule.
 */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { JSX } from "react";

import { Button, Input, MoneyInput, Select, useToast } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type {
  CashAccountRow,
  EmployeeListRow,
  FiscalPeriodRow,
  FiscalYearRow,
} from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import {
  formatMessage,
  localizedName,
  localizedApiError,
  localizedPayrollError,
} from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice } from "./notices";

const MONEY_SHAPE = /^\d+(\.\d{1,4})?$/;

export function LoanForm({
  locale,
  employees,
  years,
  initialPeriods,
  cashAccounts,
  currency,
}: {
  locale: Locale;
  employees: readonly EmployeeListRow[];
  years: readonly FiscalYearRow[];
  initialPeriods: readonly FiscalPeriodRow[];
  cashAccounts: readonly CashAccountRow[];
  currency: string;
}): JSX.Element {
  const d = getDictionary(locale);
  const router = useRouter();
  const { toast } = useToast();

  const activeEmployees = employees.filter((employee) => employee.status !== "TERMINATED");
  const activeCashAccounts = cashAccounts.filter((account) => account.status === "ACTIVE");

  const [code, setCode] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [amount, setAmount] = useState("");
  const [installmentsCount, setInstallmentsCount] = useState("12");
  const [fiscalYearId, setFiscalYearId] = useState(years[0]?.id ?? "");
  const [periods, setPeriods] = useState<readonly FiscalPeriodRow[]>(initialPeriods);
  const [startPeriodId, setStartPeriodId] = useState("");
  const [cashAccountId, setCashAccountId] = useState(activeCashAccounts[0]?.id ?? "");
  const [valueDate, setValueDate] = useState("");
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
    setStartPeriodId("");
    void loadPeriods(fiscalYearId);
  }, [fiscalYearId, years, loadPeriods]);

  async function save(): Promise<void> {
    setError(null);
    const installments = Number(installmentsCount);
    if (
      code.trim() === "" ||
      employeeId === "" ||
      !MONEY_SHAPE.test(amount) ||
      !Number.isInteger(installments) ||
      installments < 1 ||
      installments > 120 ||
      startPeriodId === "" ||
      cashAccountId === ""
    ) {
      setError(d.budgetFormInvalid);
      return;
    }
    setBusy(true);
    const created = await bffFetch<{ id: string }>("payroll/loans", {
      method: "POST",
      body: {
        code: code.trim(),
        employeeId,
        amount,
        installmentsCount: installments,
        startPeriodId,
        cashAccountId,
        ...(valueDate === "" ? {} : { valueDate }),
        note: note.trim() === "" ? null : note.trim(),
        noteAr: noteAr.trim() === "" ? null : noteAr.trim(),
      },
    });
    setBusy(false);
    if (!created.ok) {
      setError(localizedPayrollError(d, created.error, created.retryAfterSeconds));
      return;
    }
    toast({
      tone: "success",
      title: formatMessage(d.payLoanDisbursedToast, {
        code: code.trim(),
        amount,
      }),
    });
    router.push(`/${locale}/payroll/loans/${created.data.id}`);
  }

  return (
    <Card title={d.payLoanNew} description={d.payErrLoanCap}>
      <div className="flex flex-col gap-4">
        {error !== null && <ErrorNotice>{error}</ErrorNotice>}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Input
            id="loan-form-code"
            label={d.payLoanCode}
            value={code}
            onValueChange={setCode}
            mono
            bidiIsolate
            required
          />
          <div className="lg:col-span-2">
            <Select
              id="loan-form-employee"
              label={d.payLoanEmployee}
              value={employeeId}
              onValueChange={setEmployeeId}
              options={[
                { value: "", label: "—" },
                ...activeEmployees.map((employee) => ({
                  value: employee.id,
                  label: `${employee.code} — ${localizedName(employee.name, employee.nameAr, locale)}`,
                })),
              ]}
              required
            />
          </div>
          <MoneyInput
            id="loan-form-amount"
            label={d.payLoanAmount}
            amount={amount}
            onAmountChange={setAmount}
            currency={currency}
            required
          />
          <Input
            id="loan-form-installments"
            label={d.payLoanInstallments}
            value={installmentsCount}
            onValueChange={setInstallmentsCount}
            inputMode="numeric"
            mono
            bidiIsolate
            required
          />
          <Select
            id="loan-form-year"
            label={d.budgetsFilterYear}
            value={fiscalYearId}
            onValueChange={setFiscalYearId}
            options={years.map((year) => ({ value: year.id, label: year.name }))}
            required
          />
          <Select
            id="loan-form-start-period"
            label={d.payLoanStartPeriod}
            value={startPeriodId}
            onValueChange={setStartPeriodId}
            options={[
              { value: "", label: loadingPeriods ? d.loading : "—" },
              ...regularPeriods.map((period) => ({ value: period.id, label: period.name })),
            ]}
            required
          />
          <Select
            id="loan-form-cash-account"
            label={d.payLoanCashAccount}
            value={cashAccountId}
            onValueChange={setCashAccountId}
            options={activeCashAccounts.map((account) => ({
              value: account.id,
              label: `${account.accountCode} — ${localizedName(account.name, account.nameAr, locale)}`,
            }))}
            required
          />
          <Input
            id="loan-form-value-date"
            label={d.payEmployeeTerminateDate}
            value={valueDate}
            onValueChange={setValueDate}
            hint="YYYY-MM-DD"
            mono
            bidiIsolate
          />
          <Input id="loan-form-note" label={d.budgetFormNote} value={note} onValueChange={setNote} />
          <Input
            id="loan-form-note-ar"
            label={d.budgetFormNoteAr}
            value={noteAr}
            onValueChange={setNoteAr}
          />
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="primary" onClick={() => void save()} loading={busy}>
            {d.payLoanNew}
          </Button>
        </div>
      </div>
    </Card>
  );
}
