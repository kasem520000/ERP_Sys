"use client";

/**
 * T14-UI (PHASE-008) — receipt/payment create form (transaction-entry
 * archetype), shared by both sides of the settlement pair (receipts = money
 * in / AR, payments = money out / AP): cash-account select, partner select,
 * method, currency + optional manual rate (MISSING_FX_RATE only when the
 * dated lookup is absent — the rate field is the override), MoneyInput
 * amount, value date + reference + bilingual description. Below sits the
 * allocation panel (INV-016): open items load for the chosen partner, the
 * FIFO suggestion applies, and the live totals bar shows allocated vs
 * amount vs the on-account remainder. Saving creates the DRAFT (POST) then
 * PUTs the allocations and routes to the document detail.
 */
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { JSX } from "react";

import { Button, Input, MoneyInput, Select } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type { CashAccountRow, PartnerRow, TreasuryDocRow } from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { localizedName, localizedTreasuryError, localizedTreasuryMethod } from "../lib/messages";
import { isPositiveDecimal, isZeroExact } from "../lib/exact-money";
import { Card } from "./card";
import { ErrorNotice } from "./notices";
import {
  TreasuryAllocationEditor,
  type AllocationDraft,
} from "./treasury-allocation-editor";

const METHODS = ["CASH", "BANK", "CHEQUE", "CARD", "TRANSFER"] as const;

export function TreasuryDocForm({
  locale,
  kind,
  side,
  baseCurrency,
  cashAccounts,
  partners,
}: {
  locale: Locale;
  /** "receipts" | "payments" — wire path + numbering prefix. */
  kind: "receipts" | "payments";
  /** AR for receipts, AP for payments. */
  side: "AR" | "AP";
  baseCurrency: string;
  cashAccounts: readonly CashAccountRow[];
  partners: readonly PartnerRow[];
}): JSX.Element {
  const d = getDictionary(locale);
  const router = useRouter();
  const isReceipt = kind === "receipts";
  const [cashAccountId, setCashAccountId] = useState("");
  const [partnerId, setPartnerId] = useState("");
  const [method, setMethod] = useState<string>("CASH");
  const [counterpartyName, setCounterpartyName] = useState("");
  const [currencyCode, setCurrencyCode] = useState(baseCurrency === "" ? "SAR" : baseCurrency);
  const [amount, setAmount] = useState("");
  const [exchangeRate, setExchangeRate] = useState("");
  const [valueDate, setValueDate] = useState(new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState("");
  const [description, setDescription] = useState("");
  const [descriptionAr, setDescriptionAr] = useState("");
  const [allocations, setAllocations] = useState<AllocationDraft[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const activeAccounts = useMemo(
    () => cashAccounts.filter((account) => account.status === "ACTIVE"),
    [cashAccounts],
  );

  const counterpartyLabel = isReceipt ? d.treasuryColPayer : d.treasuryColPayee;
  const formReady =
    cashAccountId !== "" &&
    partnerId !== "" &&
    currencyCode.trim().length === 3 &&
    amount !== "" &&
    isPositiveDecimal(amount);

  async function save(): Promise<void> {
    setError(null);
    if (!formReady) {
      setError(d.errorsValidation);
      return;
    }
    setBusy(true);
    const created = await bffFetch<TreasuryDocRow>(`treasury/${kind}`, {
      method: "POST",
      body: {
        cashAccountId,
        partnerId,
        method,
        counterpartyName: counterpartyName.trim() === "" ? null : counterpartyName.trim(),
        currencyCode: currencyCode.trim().toUpperCase(),
        amount,
        exchangeRate: exchangeRate === "" ? null : exchangeRate,
        valueDate,
        reference: reference === "" ? null : reference,
        description: description === "" ? null : description,
        descriptionAr: descriptionAr === "" ? null : descriptionAr,
      },
    });
    if (!created.ok) {
      setBusy(false);
      setError(localizedTreasuryError(d, created.error, created.retryAfterSeconds));
      return;
    }
    // INV-016: allocation drafts persist right after the DRAFT document.
    if (allocations.length > 0 && !isZeroExact(amount)) {
      const saved = await bffFetch<unknown>(`treasury/${kind}/${created.data.id}/allocations`, {
        method: "PUT",
        body: {
          allocations: allocations.map((row) => ({ openItemId: row.openItemId, amount: row.amount })),
        },
      });
      if (!saved.ok) {
        setBusy(false);
        setError(localizedTreasuryError(d, saved.error, saved.retryAfterSeconds));
        return;
      }
    }
    setBusy(false);
    router.push(`/${locale}/treasury/${kind}/${created.data.id}`);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}

      <Card title={isReceipt ? d.treasuryReceiptsNew : d.treasuryPaymentsNew}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
          <Select
            label={d.treasuryDocPartner}
            value={partnerId}
            onValueChange={setPartnerId}
            placeholder="—"
            options={partners.map((partner) => ({
              value: partner.id,
              label: partner.code === "" ? partner.name : `${partner.code} · ${partner.name}`,
            }))}
            required
          />
          <Select
            label={d.treasuryDocMethod}
            value={method}
            onValueChange={setMethod}
            options={METHODS.map((value) => ({
              value,
              label: localizedTreasuryMethod(d, value),
            }))}
            required
          />
          <Input
            label={counterpartyLabel}
            value={counterpartyName}
            onValueChange={setCounterpartyName}
          />
          <Input
            label={d.treasuryDocCurrency}
            value={currencyCode}
            onValueChange={setCurrencyCode}
            placeholder={baseCurrency === "" ? "SAR" : baseCurrency}
            hint={baseCurrency === "" ? undefined : `${d.treasuryDocCurrency}: ${baseCurrency}`}
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
          <Input label={d.treasuryDocReference} value={reference} onValueChange={setReference} />
          <Input label={d.treasuryDocDescription} value={description} onValueChange={setDescription} />
          <Input
            label={d.treasuryDocDescriptionAr}
            value={descriptionAr}
            onValueChange={setDescriptionAr}
          />
        </div>
      </Card>

      <p className="text-xs text-muted-foreground">{d.treasuryDocSideHint}</p>

      <TreasuryAllocationEditor
        locale={locale}
        docKind={kind}
        side={side}
        partnerId={partnerId}
        amount={amount}
        currency={currencyCode.trim().toUpperCase()}
        onAllocationsChange={setAllocations}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" onClick={() => void save()} loading={busy} disabled={!formReady}>
          {d.commonCreate}
        </Button>
        <Button variant="ghost" onClick={() => router.push(`/${locale}/treasury/${kind}`)}>
          {d.commonCancel}
        </Button>
      </div>
    </div>
  );
}
