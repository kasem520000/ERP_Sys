"use client";

/**
 * T14-UI (PHASE-008) — cash transfers (list-search + inline create): the
 * transfer list (transfer no., date, from → to accounts, amount + fee,
 * status) with submit/approve/post/cancel actions and the create form
 * (from/to cash accounts — must differ, amount via MoneyInput, fee, rate,
 * value date). Posting runs the two-leg cash movement + bank-charge line
 * (fee) through the engine; cancel prompts for a reason.
 */
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { JSX } from "react";

import {
  Button,
  DataTable,
  DocumentStatusBadge,
  Input,
  MoneyInput,
  Select,
  formatMoneyDisplay,
} from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type { CashAccountRow, TransferRow } from "../lib/api-types";
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

export function TreasuryTransfers({
  locale,
  initialRows,
  cashAccounts,
  canCreate,
  canApprove,
}: {
  locale: Locale;
  initialRows: readonly TransferRow[];
  cashAccounts: readonly CashAccountRow[];
  canCreate: boolean;
  canApprove: boolean;
}): JSX.Element {
  const d = getDictionary(locale);
  const router = useRouter();
  const [rows, setRows] = useState<readonly TransferRow[]>(initialRows);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState("");

  // Create form state.
  const [fromAccountId, setFromAccountId] = useState("");
  const [toAccountId, setToAccountId] = useState("");
  const [currencyCode, setCurrencyCode] = useState("");
  const [amount, setAmount] = useState("");
  const [feeAmount, setFeeAmount] = useState("");
  const [exchangeRate, setExchangeRate] = useState("");
  const [valueDate, setValueDate] = useState(new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState("");
  const [description, setDescription] = useState("");

  const activeAccounts = useMemo(
    () => cashAccounts.filter((account) => account.status === "ACTIVE"),
    [cashAccounts],
  );

  const accountNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const account of cashAccounts) {
      map.set(account.id, localizedName(account.name, account.nameAr, locale));
    }
    return map;
  }, [cashAccounts, locale]);

  const sameAccount = fromAccountId !== "" && fromAccountId === toAccountId;
  const formReady =
    fromAccountId !== "" &&
    toAccountId !== "" &&
    !sameAccount &&
    currencyCode.trim().length === 3 &&
    amount !== "" &&
    isPositiveDecimal(amount) &&
    (feeAmount === "" || isPositiveDecimal(feeAmount));

  async function createTransfer(): Promise<void> {
    setError(null);
    setNotice(null);
    setBusy("create");
    const created = await bffFetch<TransferRow>("treasury/cash-transfers", {
      method: "POST",
      body: {
        fromAccountId,
        toAccountId,
        currencyCode: currencyCode.trim().toUpperCase(),
        amount,
        feeAmount: feeAmount === "" ? "0" : feeAmount,
        exchangeRate: exchangeRate === "" ? null : exchangeRate,
        valueDate,
        reference: reference === "" ? null : reference,
        description: description === "" ? null : description,
      },
    });
    setBusy(null);
    if (!created.ok) {
      setError(localizedTreasuryError(d, created.error, created.retryAfterSeconds));
      return;
    }
    setRows((current) => [created.data, ...current]);
    setAmount("");
    setFeeAmount("");
    setExchangeRate("");
    setReference("");
    setDescription("");
    setNotice(d.treasuryTransferCreatedToast);
    router.refresh();
  }

  async function act(id: string, action: "submit" | "approve" | "post"): Promise<void> {
    setError(null);
    setNotice(null);
    setBusy(id);
    const result = await bffFetch<TransferRow>(`treasury/cash-transfers/${id}/${action}`, {
      method: "POST",
      body: {},
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedTreasuryError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setRows((current) => current.map((row) => (row.id === id ? result.data : row)));
    setNotice(action === "post" ? d.treasuryTransferPostedToast : action === "approve" ? d.accountingApprove : d.accountingSubmit);
    router.refresh();
  }

  async function cancelTransfer(): Promise<void> {
    if (cancelId === null) {
      return;
    }
    setError(null);
    setBusy(cancelId);
    const result = await bffFetch<TransferRow>(`treasury/cash-transfers/${cancelId}/cancel`, {
      method: "POST",
      body: { reason: cancelReason.trim() },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedTreasuryError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setRows((current) => current.map((row) => (row.id === cancelId ? result.data : row)));
    setCancelId(null);
    setCancelReason("");
    setNotice(d.treasuryTransferCancelledToast);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
      {notice !== null && <SuccessNotice>{notice}</SuccessNotice>}

      <Card title={d.treasuryTransfersTitle}>
        <DataTable
          columns={[
            {
              id: "no",
              header: activeLocaleHeader(d.treasuryColNo),
              accessor: (row) => row.transferNo ?? "",
              mono: true,
              sortable: true,
              render: (row) =>
                row.transferNo === null ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  <span className="font-mono text-sm" dir="ltr">{row.transferNo}</span>
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
              id: "from",
              header: activeLocaleHeader(d.treasuryColFrom),
              accessor: (row) => accountNameById.get(row.fromAccountId) ?? row.fromAccountId,
            },
            {
              id: "to",
              header: activeLocaleHeader(d.treasuryColTo),
              accessor: (row) => accountNameById.get(row.toAccountId) ?? row.toAccountId,
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
              id: "fee",
              header: activeLocaleHeader(d.treasuryColFee),
              accessor: (row) => row.feeAmount,
              numeric: true,
              render: (row) => (
                <span className="font-mono tabular-nums" dir="ltr">
                  {formatMoneyDisplay(row.feeAmount, 2)}
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
          rows={[...rows]}
          rowKey={(row) => row.id}
          rowActions={[
            ...(canCreate
              ? [
                  {
                    id: "submit",
                    label: d.accountingSubmit,
                    onSelect: (row: TransferRow) => void act(row.id, "submit"),
                  },
                  {
                    id: "cancel",
                    label: d.accountingCancel,
                    danger: true,
                    onSelect: (row: TransferRow) => {
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
                    onSelect: (row: TransferRow) => void act(row.id, "approve"),
                  },
                  {
                    id: "post",
                    label: d.accountingPost,
                    onSelect: (row: TransferRow) => void act(row.id, "post"),
                  },
                ]
              : []),
          ]}
          empty={{ title: d.treasuryTransfersEmpty }}
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
                onClick={cancelTransfer}
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
        <Card title={d.treasuryTransferNew}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Select
              label={d.treasuryTransferFrom}
              value={fromAccountId}
              onValueChange={setFromAccountId}
              placeholder="—"
              options={activeAccounts.map((account) => ({
                value: account.id,
                label: `${localizedName(account.name, account.nameAr, locale)} · ${account.currencyCode}`,
              }))}
              error={sameAccount ? d.treasuryTransferSameAccountError : undefined}
              required
            />
            <Select
              label={d.treasuryTransferTo}
              value={toAccountId}
              onValueChange={setToAccountId}
              placeholder="—"
              options={activeAccounts.map((account) => ({
                value: account.id,
                label: `${localizedName(account.name, account.nameAr, locale)} · ${account.currencyCode}`,
              }))}
              error={sameAccount ? d.treasuryTransferSameAccountError : undefined}
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
                label={d.treasuryColAmount}
                amount={amount}
                onAmountChange={setAmount}
                currency={currencyCode.trim() === "" ? "SAR" : currencyCode.trim().toUpperCase()}
                required
              />
            </div>
            <div className="sm:col-span-2 lg:col-span-1">
              <MoneyInput
                label={d.treasuryColFee}
                amount={feeAmount}
                onAmountChange={setFeeAmount}
                currency={currencyCode.trim() === "" ? "SAR" : currencyCode.trim().toUpperCase()}
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
            <Input label={d.treasuryDocReference} value={reference} onValueChange={setReference} />
            <Input label={d.treasuryDocDescription} value={description} onValueChange={setDescription} />
          </div>
          <Button
            variant="primary"
            onClick={() => void createTransfer()}
            loading={busy === "create"}
            disabled={!formReady}
            className="mt-3 self-start"
          >
            {d.commonCreate}
          </Button>
        </Card>
      )}
    </div>
  );
}
