"use client";

/**
 * P7-T18 — manual journal workspace (PAGE_ARCHETYPES archetype 4,
 * transaction entry): the @erp/ui JournalEntryGrid pattern with its embedded
 * MoneySummaryBar (live Σdebit/Σcredit/Δ — the INV-001 mirror). Header
 * fields: entry date, bilingual descriptions, reference, currency +
 * optional manual FX rate. Saving posts NOTHING — it creates a DRAFT via
 * `POST accounting/journal-entries`; submit/approve/post run from the list
 * (the engine is the only writer of the ledger).
 */
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { JSX } from "react";

import {
  Button,
  Input,
  JournalEntryGrid,
  emptyLine,
  type JournalEntryGridLabels,
  type JournalLineDraft,
  type PickerOption,
} from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type { AccountRow, CostCenterRow, PartnerRow, PurposeRow } from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { localizedAccountingError } from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice, SuccessNotice } from "./notices";

/** Exact 4-dp totals over canonical strings (BigInt minor units — ADR-0009). */
function sumExact(values: readonly string[]): string {
  let minor = 0n;
  for (const value of values) {
    if (value === "") {
      continue;
    }
    const negative = value.startsWith("-");
    const [int = "0", frac = ""] = value.replace("-", "").split(".");
    const units = BigInt(int) * 10_000n + BigInt(frac.slice(0, 4).padEnd(4, "0"));
    minor += negative ? -units : units;
  }
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  return `${negative ? "-" : ""}${abs / 10_000n}.${(abs % 10_000n).toString().padStart(4, "0")}`;
}

export function JournalWorkspace({
  locale,
  accounts,
  partners,
  costCenters,
  purposes,
  baseCurrency,
}: {
  locale: Locale;
  accounts: readonly AccountRow[];
  partners: readonly PartnerRow[];
  costCenters: readonly CostCenterRow[];
  purposes: readonly PurposeRow[];
  /** Tenant base currency (empty when the profile is not readable — display only). */
  baseCurrency: string;
}): JSX.Element {
  const d = getDictionary(locale);
  const router = useRouter();
  const [entryDate, setEntryDate] = useState(new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState("");
  const [descriptionAr, setDescriptionAr] = useState("");
  const [reference, setReference] = useState("");
  const [currencyCode, setCurrencyCode] = useState("");
  const [exchangeRate, setExchangeRate] = useState("");
  const [lines, setLines] = useState<JournalLineDraft[]>([emptyLine(), emptyLine()]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const accountOptions = useMemo<PickerOption[]>(
    () =>
      accounts
        .filter((account) => account.status === "ACTIVE" && account.isPostable)
        .map((account) => ({
          id: account.id,
          label: `${account.code} · ${account.name}`,
          labelAr: account.nameAr === "" ? undefined : `${account.code} · ${account.nameAr}`,
          meta: account.currencyCode ?? undefined,
        })),
    [accounts],
  );

  const partnerOptions = useMemo<PickerOption[]>(
    () =>
      partners.map((partner) => ({
        id: partner.id,
        label: partner.code === "" ? partner.name : `${partner.code} · ${partner.name}`,
        labelAr: partner.nameAr ?? undefined,
      })),
    [partners],
  );

  const costCenterOptions = useMemo<PickerOption[]>(
    () =>
      costCenters
        .filter((center) => center.isActive)
        .map((center) => ({
          id: center.id,
          label: `${center.code} · ${center.name}`,
          labelAr: center.nameAr ?? undefined,
        })),
    [costCenters],
  );

  /** Inline INV-009 rule: AR/AP control accounts demand a partner. */
  const partnerRequiredAccountIds = useMemo(() => {
    const ids = new Set<string>();
    for (const purpose of purposes) {
      if (purpose.activeTo === null && (purpose.purposeKey === "AR_CONTROL" || purpose.purposeKey === "AP_CONTROL")) {
        ids.add(purpose.accountId);
      }
    }
    return ids;
  }, [purposes]);

  const gridLabels = useMemo<JournalEntryGridLabels>(
    () => ({
      account: d.accountingAccount,
      description: d.accountingMemo,
      costCenter: d.accountingCostCenter,
      partner: d.accountingPartner,
      debit: d.accountingColDebit,
      credit: d.accountingColCredit,
      taxCode: d.accountingTaxCode,
      lineTotal: d.accountingLineTotal,
      addLine: d.accountingAddLine,
      removeLine: d.accountingRemoveLine,
      duplicateLine: d.accountingDuplicateLine,
      partnerRequired: d.accountingPartnerRequired,
      summary: {
        debit: d.accountingColDebit,
        credit: d.accountingColCredit,
        difference: d.accountingDifference,
        balanced: d.accountingBalanced,
        unbalanced: d.accountingUnbalanced,
      },
    }),
    [d],
  );

  const filledLines = lines.filter(
    (line) => line.accountId !== undefined && (line.debit !== "" || line.credit !== ""),
  );

  const totals = useMemo(() => {
    const debit = sumExact(lines.map((line) => (line.debit === "" ? "0" : line.debit)));
    const credit = sumExact(lines.map((line) => (line.credit === "" ? "0" : line.credit)));
    const debitMinor =
      BigInt(debit.replace(".", "").replace("-", "")) * (debit.startsWith("-") ? -1n : 1n);
    const creditMinor =
      BigInt(credit.replace(".", "").replace("-", "")) * (credit.startsWith("-") ? -1n : 1n);
    return { debit, credit, diffMinor: debitMinor - creditMinor };
  }, [lines]);

  const balanced = totals.diffMinor === 0n && filledLines.length >= 2;

  async function save(submit: boolean): Promise<void> {
    setError(null);
    setNotice(null);
    if (filledLines.length < 2 || !balanced) {
      setError(d.accountingErrEntryNotBalanced);
      return;
    }
    setBusy(true);
    const created = await bffFetch<{ id: string }>("accounting/journal-entries", {
      method: "POST",
      body: {
        entryDate,
        currencyCode: currencyCode === "" ? undefined : currencyCode.toUpperCase(),
        exchangeRate: exchangeRate === "" ? null : exchangeRate,
        rateSource: exchangeRate === "" ? undefined : "MANUAL",
        description: description === "" ? null : description,
        descriptionAr: descriptionAr === "" ? null : descriptionAr,
        reference: reference === "" ? null : reference,
        lines: filledLines.map((line) => ({
          accountId: line.accountId,
          direction: line.debit !== "" ? "DEBIT" : "CREDIT",
          amount: line.debit !== "" ? line.debit : line.credit,
          partnerId: line.partnerId ?? null,
          costCenterId: line.costCenterId ?? null,
          memo: line.memo === "" ? null : line.memo,
        })),
      },
    });
    setBusy(false);
    if (!created.ok) {
      setError(localizedAccountingError(d, created.error, created.retryAfterSeconds));
      return;
    }
    if (submit) {
      const submitted = await bffFetch<{ id: string }>(
        `accounting/journal-entries/${created.data.id}/submit`,
        { method: "POST", body: {} },
      );
      if (!submitted.ok) {
        setError(localizedAccountingError(d, submitted.error, submitted.retryAfterSeconds));
        return;
      }
    }
    setNotice(d.accountingSaveDraft);
    router.push(`/${locale}/accounting/journals`);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
      {notice !== null && <SuccessNotice>{notice}</SuccessNotice>}

      <Card title={d.accountingJournalsNew}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Input label={d.accountingColEntryDate} value={entryDate} onValueChange={setEntryDate} mono bidiIsolate required />
          <Input label={`${d.accountingDescription} (EN)`} value={description} onValueChange={setDescription} />
          <Input label={`${d.accountingDescription} (AR)`} value={descriptionAr} onValueChange={setDescriptionAr} />
          <Input label={d.accountingReference} value={reference} onValueChange={setReference} />
          <Input
            label={d.accountingColCurrency}
            value={currencyCode}
            onValueChange={setCurrencyCode}
            placeholder={baseCurrency === "" ? "SAR" : baseCurrency}
            hint={baseCurrency === "" ? undefined : `${d.accountingColCurrency}: ${baseCurrency}`}
            mono
            bidiIsolate
          />
          <Input
            label={d.accountingExchangeRate}
            value={exchangeRate}
            onValueChange={setExchangeRate}
            hint={d.accountingRateHint}
            mono
            bidiIsolate
          />
        </div>
      </Card>

      <JournalEntryGrid
        currency={currencyCode === "" ? baseCurrency : currencyCode.toUpperCase()}
        minorUnits={2}
        accounts={accountOptions}
        partners={partnerOptions}
        costCenters={costCenterOptions}
        partnerRequiredAccountIds={partnerRequiredAccountIds}
        labels={gridLabels}
        lines={lines}
        onLinesChange={setLines}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" onClick={() => void save(true)} loading={busy} disabled={!balanced}>
          {d.accountingSubmit}
        </Button>
        <Button variant="secondary" onClick={() => void save(false)} loading={busy} disabled={!balanced}>
          {d.accountingSaveDraft}
        </Button>
        <Button variant="ghost" onClick={() => router.push(`/${locale}/accounting/journals`)}>
          {d.commonCancel}
        </Button>
      </div>
    </div>
  );
}
