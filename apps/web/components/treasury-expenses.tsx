"use client";

/**
 * T14-UI (PHASE-008) — expenses workspace (list-search archetype, combined):
 * the claims list (expense no., date, category, payee, amount, status) with
 * the lifecycle actions (submit → approve → post; cancel with a reason),
 * the claim form (category, cash account, payee, amount via MoneyInput,
 * optional rate + receipt file id — uploads arrive with the files
 * workspace), and the category management section (code, bilingual name,
 * GL expense account, approval mode).
 */
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { JSX } from "react";

import {
  Badge,
  Button,
  DataTable,
  DocumentStatusBadge,
  Input,
  MoneyInput,
  Select,
  formatMoneyDisplay,
} from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type {
  AccountRow,
  CashAccountRow,
  ExpenseCategoryRow,
  ExpenseRow,
} from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import {
  localizedName,
  localizedDocumentStatus,
  localizedTreasuryError,
} from "../lib/messages";
import { isPositiveDecimal } from "../lib/exact-money";
import { Card } from "./card";
import { ErrorNotice, SuccessNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";

export function TreasuryExpenses({
  locale,
  initialCategories,
  initialExpenses,
  cashAccounts,
  glAccounts,
  canCreate,
  canApprove,
}: {
  locale: Locale;
  initialCategories: readonly ExpenseCategoryRow[];
  initialExpenses: readonly ExpenseRow[];
  cashAccounts: readonly CashAccountRow[];
  glAccounts: readonly AccountRow[];
  canCreate: boolean;
  canApprove: boolean;
}): JSX.Element {
  const d = getDictionary(locale);
  const router = useRouter();
  const [categories, setCategories] = useState<readonly ExpenseCategoryRow[]>(initialCategories);
  const [expenses, setExpenses] = useState<readonly ExpenseRow[]>(initialExpenses);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState("");

  // Category form state.
  const [categoryCode, setCategoryCode] = useState("");
  const [categoryName, setCategoryName] = useState("");
  const [categoryNameAr, setCategoryNameAr] = useState("");
  const [categoryAccountId, setCategoryAccountId] = useState("");
  const [approvalMode, setApprovalMode] = useState<string>("single-approver");

  // Claim form state.
  const [categoryId, setCategoryId] = useState("");
  const [cashAccountId, setCashAccountId] = useState("");
  const [payeeName, setPayeeName] = useState("");
  const [currencyCode, setCurrencyCode] = useState("");
  const [amount, setAmount] = useState("");
  const [exchangeRate, setExchangeRate] = useState("");
  const [valueDate, setValueDate] = useState(new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState("");
  const [receiptFileId, setReceiptFileId] = useState("");

  const postableAccounts = useMemo(
    () =>
      glAccounts
        .filter((account) => account.status === "ACTIVE" && account.isPostable)
        .sort((a, b) => a.code.localeCompare(b.code)),
    [glAccounts],
  );

  const activeAccounts = useMemo(
    () => cashAccounts.filter((account) => account.status === "ACTIVE"),
    [cashAccounts],
  );

  const activeCategories = useMemo(
    () => categories.filter((category) => category.isActive),
    [categories],
  );

  const accountNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const account of cashAccounts) {
      map.set(account.id, localizedName(account.name, account.nameAr, locale));
    }
    return map;
  }, [cashAccounts, locale]);

  async function createCategory(): Promise<void> {
    setError(null);
    setNotice(null);
    setBusy("category");
    const created = await bffFetch<ExpenseCategoryRow>("treasury/expense-categories", {
      method: "POST",
      body: {
        code: categoryCode.trim(),
        name: categoryName.trim(),
        nameAr: categoryNameAr.trim(),
        accountId: categoryAccountId,
        approvalMode,
      },
    });
    setBusy(null);
    if (!created.ok) {
      setError(localizedTreasuryError(d, created.error, created.retryAfterSeconds));
      return;
    }
    setCategories((current) => [...current, created.data]);
    setCategoryCode("");
    setCategoryName("");
    setCategoryNameAr("");
    setCategoryAccountId("");
    setApprovalMode("single-approver");
    setNotice(d.treasuryExpenseCategoryCreatedToast);
    router.refresh();
  }

  const claimReady =
    categoryId !== "" &&
    cashAccountId !== "" &&
    payeeName.trim() !== "" &&
    currencyCode.trim().length === 3 &&
    amount !== "" &&
    isPositiveDecimal(amount);

  async function createClaim(): Promise<void> {
    setError(null);
    setNotice(null);
    if (!claimReady) {
      setError(d.errorsValidation);
      return;
    }
    setBusy("claim");
    const created = await bffFetch<ExpenseRow>("treasury/expenses", {
      method: "POST",
      body: {
        categoryId,
        cashAccountId,
        payeeName: payeeName.trim(),
        currencyCode: currencyCode.trim().toUpperCase(),
        amount,
        exchangeRate: exchangeRate === "" ? null : exchangeRate,
        receiptFileId: receiptFileId.trim() === "" ? null : receiptFileId.trim(),
        valueDate,
        description: description === "" ? null : description,
      },
    });
    setBusy(null);
    if (!created.ok) {
      setError(localizedTreasuryError(d, created.error, created.retryAfterSeconds));
      return;
    }
    setExpenses((current) => [created.data, ...current]);
    setCategoryId("");
    setPayeeName("");
    setAmount("");
    setExchangeRate("");
    setDescription("");
    setReceiptFileId("");
    setNotice(d.treasuryExpenseCreatedToast);
    router.refresh();
  }

  async function act(id: string, action: "submit" | "approve" | "post"): Promise<void> {
    setError(null);
    setNotice(null);
    setBusy(id);
    const result = await bffFetch<ExpenseRow>(`treasury/expenses/${id}/${action}`, {
      method: "POST",
      body: {},
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedTreasuryError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setExpenses((current) => current.map((row) => (row.id === id ? result.data : row)));
    setNotice(
      action === "post" ? d.accountingPost : action === "approve" ? d.accountingApprove : d.accountingSubmit,
    );
    router.refresh();
  }

  async function cancelClaim(): Promise<void> {
    if (cancelId === null) {
      return;
    }
    setError(null);
    setBusy(cancelId);
    const result = await bffFetch<ExpenseRow>(`treasury/expenses/${cancelId}/cancel`, {
      method: "POST",
      body: { reason: cancelReason.trim() },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedTreasuryError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setExpenses((current) => current.map((row) => (row.id === cancelId ? result.data : row)));
    setCancelId(null);
    setCancelReason("");
    setNotice(d.accountingCancel);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
      {notice !== null && <SuccessNotice>{notice}</SuccessNotice>}

      <Card title={d.treasuryExpensesTitle}>
        <DataTable
          columns={[
            {
              id: "no",
              header: activeLocaleHeader(d.treasuryExpenseColNo),
              accessor: (row) => row.expenseNo ?? "",
              mono: true,
              sortable: true,
              render: (row) =>
                row.expenseNo === null ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  <span className="font-mono text-sm" dir="ltr">{row.expenseNo}</span>
                ),
            },
            {
              id: "date",
              header: activeLocaleHeader(d.treasuryColValueDate),
              accessor: (row) => row.valueDate,
              mono: true,
              sortable: true,
              render: (row) => <span className="font-mono text-sm" dir="ltr">{row.valueDate}</span>,
            },
            {
              id: "category",
              header: activeLocaleHeader(d.treasuryExpenseColCategory),
              accessor: (row) => row.categoryCode,
              render: (row) => (
                <span className="font-mono text-xs" dir="ltr">{row.categoryCode}</span>
              ),
            },
            {
              id: "payee",
              header: activeLocaleHeader(d.treasuryExpenseColPayee),
              accessor: (row) => row.payeeName,
              render: (row) => <span className="max-w-[14rem] truncate">{row.payeeName}</span>,
            },
            {
              id: "account",
              header: activeLocaleHeader(d.treasuryDocCashAccount),
              accessor: (row) => accountNameById.get(row.cashAccountId) ?? row.cashAccountId,
            },
            {
              id: "amount",
              header: activeLocaleHeader(d.treasuryColAmount),
              accessor: (row) => row.amount,
              numeric: true,
              sortable: true,
              render: (row) => (
                <span className="font-mono tabular-nums" dir="ltr">
                  {formatMoneyDisplay(row.amount, 2)}{" "}
                  <span className="text-xs text-muted-foreground">{row.currencyCode}</span>
                </span>
              ),
            },
            {
              id: "status",
              header: activeLocaleHeader(d.accountingColStatus),
              accessor: (row) => row.status,
              render: (row) => (
                <DocumentStatusBadge
                  status={row.status as "DRAFT" | "PENDING_APPROVAL" | "APPROVED" | "POSTED" | "CANCELLED"}
                  label={localizedDocumentStatus(d, row.status)}
                />
              ),
            },
          ]}
          rows={[...expenses]}
          rowKey={(row) => row.id}
          rowActions={[
            ...(canCreate
              ? [
                  {
                    id: "submit",
                    label: d.accountingSubmit,
                    onSelect: (row: ExpenseRow) => void act(row.id, "submit"),
                  },
                  {
                    id: "cancel",
                    label: d.accountingCancel,
                    danger: true,
                    onSelect: (row: ExpenseRow) => {
                      setCancelReason("");
                      setCancelId(row.id);
                    },
                  },
                ]
              : []),
            ...(canApprove
              ? [
                  {
                    id: "approve",
                    label: d.accountingApprove,
                    onSelect: (row: ExpenseRow) => void act(row.id, "approve"),
                  },
                  {
                    id: "post",
                    label: d.accountingPost,
                    onSelect: (row: ExpenseRow) => void act(row.id, "post"),
                  },
                ]
              : []),
          ]}
          empty={{ title: d.treasuryExpensesEmpty }}
        />
      </Card>

      {cancelId !== null && (
        <Card title={d.accountingCancel}>
          <div className="flex flex-col gap-3">
            <Input
              label={d.treasuryCancelReason}
              value={cancelReason}
              onValueChange={setCancelReason}
              required
            />
            <div className="flex gap-2">
              <Button
                variant="danger"
                onClick={cancelClaim}
                loading={busy === cancelId}
                disabled={cancelReason.trim().length < 3}
              >
                {d.accountingCancel}
              </Button>
              <Button variant="ghost" onClick={() => setCancelId(null)}>
                {d.commonCancel}
              </Button>
            </div>
          </div>
        </Card>
      )}

      {canCreate && (
        <>
          <Card title={d.treasuryExpenseClaimNew} description={d.treasuryExpenseReceiptNote}>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Select
                label={d.treasuryExpenseColCategory}
                value={categoryId}
                onValueChange={setCategoryId}
                placeholder="—"
                options={activeCategories.map((category) => ({
                  value: category.id,
                  label: `${category.code} · ${localizedName(category.name, category.nameAr, locale)}`,
                }))}
                required
              />
              <Select
                label={d.treasuryDocCashAccount}
                value={cashAccountId}
                onValueChange={setCashAccountId}
                placeholder="—"
                options={activeAccounts.map((account) => ({
                  value: account.id,
                  label: `${localizedName(account.name, account.nameAr, locale)} · ${account.currencyCode}`,
                }))}
                required
              />
              <Input
                label={d.treasuryExpenseColPayee}
                value={payeeName}
                onValueChange={setPayeeName}
                required
              />
              <Input
                label={d.treasuryDocCurrency}
                value={currencyCode}
                onValueChange={setCurrencyCode}
                placeholder="SAR"
                mono
                bidiIsolate
                required
              />
              <div className="sm:col-span-2 lg:col-span-1">
                <MoneyInput
                  label={d.treasuryDocAmount}
                  amount={amount}
                  onAmountChange={setAmount}
                  currency={currencyCode.trim() === "" ? "SAR" : currencyCode.trim().toUpperCase()}
                  required
                />
              </div>
              <Input
                label={d.treasuryDocRate}
                value={exchangeRate}
                onValueChange={setExchangeRate}
                hint={d.treasuryDocRateHint}
                inputMode="decimal"
                mono
                bidiIsolate
              />
              <Input
                label={d.treasuryDocValueDate}
                value={valueDate}
                onValueChange={setValueDate}
                mono
                bidiIsolate
                required
              />
              <Input
                label={d.treasuryExpenseReceiptFileId}
                value={receiptFileId}
                onValueChange={setReceiptFileId}
                hint={d.treasuryExpenseReceiptNote}
                mono
                bidiIsolate
              />
              <Input
                label={d.treasuryDocDescription}
                value={description}
                onValueChange={setDescription}
              />
            </div>
            <Button
              variant="primary"
              onClick={() => void createClaim()}
              loading={busy === "claim"}
              disabled={!claimReady}
              className="mt-3 self-start"
            >
              {d.commonCreate}
            </Button>
          </Card>

          <Card title={d.treasuryExpenseCategoryNew}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                label={d.treasuryExpenseCategoryCode}
                value={categoryCode}
                onValueChange={setCategoryCode}
                mono
                required
              />
              <Select
                label={d.treasuryExpenseCategoryApproval}
                value={approvalMode}
                onValueChange={setApprovalMode}
                options={[
                  { value: "none", label: d.treasuryExpenseApprovalNone },
                  { value: "single-approver", label: d.treasuryExpenseApprovalSingle },
                ]}
                required
              />
              <Input label={d.treasuryAccountName} value={categoryName} onValueChange={setCategoryName} required />
              <Input label={d.treasuryAccountNameAr} value={categoryNameAr} onValueChange={setCategoryNameAr} required />
              <Select
                label={d.treasuryExpenseCategoryAccount}
                value={categoryAccountId}
                onValueChange={setCategoryAccountId}
                placeholder="—"
                options={postableAccounts.map((account) => ({
                  value: account.id,
                  label: `${account.code} · ${localizedName(account.name, account.nameAr, locale)}`,
                }))}
                required
              />
            </div>
            <Button
              variant="primary"
              onClick={() => void createCategory()}
              loading={busy === "category"}
              disabled={
                categoryCode.trim().length < 2 ||
                categoryName.trim() === "" ||
                categoryNameAr.trim() === "" ||
                categoryAccountId === ""
              }
              className="mt-3 self-start"
            >
              {d.commonCreate}
            </Button>
          </Card>
        </>
      )}

      <Card title={d.treasuryExpenseCategoriesTitle}>
        <DataTable
          columns={[
            {
              id: "code",
              header: activeLocaleHeader(d.treasuryExpenseCategoryCode),
              accessor: (row) => row.code,
              mono: true,
              sortable: true,
              render: (row) => <span className="font-mono text-sm" dir="ltr">{row.code}</span>,
            },
            {
              id: "name",
              header: activeLocaleHeader(d.colName),
              accessor: (row) => localizedName(row.name, row.nameAr, locale),
              render: (row) => localizedName(row.name, row.nameAr, locale),
            },
            {
              id: "account",
              header: activeLocaleHeader(d.treasuryExpenseCategoryAccount),
              accessor: (row) => row.accountCode,
              mono: true,
              render: (row) => <span className="font-mono text-sm" dir="ltr">{row.accountCode}</span>,
            },
            {
              id: "approval",
              header: activeLocaleHeader(d.treasuryExpenseCategoryApproval),
              accessor: (row) => row.approvalMode,
              render: (row) =>
                row.approvalMode === "none" ? (
                  <Badge tone="neutral">{d.treasuryExpenseApprovalNone}</Badge>
                ) : (
                  <Badge tone="primary">{d.treasuryExpenseApprovalSingle}</Badge>
                ),
            },
            {
              id: "active",
              header: activeLocaleHeader(d.colStatus),
              accessor: (row) => (row.isActive ? "1" : "0"),
              render: (row) =>
                row.isActive ? (
                  <Badge tone="primary">{d.statusActive}</Badge>
                ) : (
                  <Badge tone="neutral">{d.statusArchived}</Badge>
                ),
            },
          ]}
          rows={[...categories]}
          rowKey={(row) => row.id}
          empty={{ title: d.treasuryExpenseCategoriesEmpty }}
        />
      </Card>
    </div>
  );
}
