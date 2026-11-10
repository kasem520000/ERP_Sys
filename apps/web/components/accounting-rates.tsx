"use client";

/**
 * P7-T18 — exchange-rate editor (List+Search archetype): the dated rate
 * table (base per 1 foreign, CURRENCY_AND_PRECISION §5) with the manual
 * upsert form (MANUAL source). Rates are positive decimals; the posting
 * engine fails closed with MISSING_FX_RATE when a dated lookup is absent.
 */
import { useMemo, useState } from "react";

import { Button, DataTable, Input, Select } from "@erp/ui";
import type { JSX } from "react";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type { ExchangeRateRow } from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { localizedAccountingError } from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice, SuccessNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";

const COMMON_CURRENCIES = ["AED", "BHD", "EGP", "EUR", "GBP", "IQD", "JOD", "KWD", "OMR", "QAR", "SAR", "USD", "YER"] as const;

export function AccountingRates({
  locale,
  initialRates,
}: {
  locale: Locale;
  initialRates: readonly ExchangeRateRow[];
}): JSX.Element {
  const d = getDictionary(locale);
  const [rates, setRates] = useState<readonly ExchangeRateRow[]>(initialRates);
  const [currency, setCurrency] = useState("USD");
  const [rateDate, setRateDate] = useState(new Date().toISOString().slice(0, 10));
  const [rate, setRate] = useState("");
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const filtered = useMemo(
    () =>
      filter === ""
        ? rates
        : rates.filter((row) => row.currencyCode === filter),
    [rates, filter],
  );

  async function upsert(): Promise<void> {
    setError(null);
    setNotice(null);
    setBusy(true);
    const result = await bffFetch<ExchangeRateRow>("accounting/exchange-rates", {
      method: "POST",
      body: {
        currencyCode: currency.toUpperCase(),
        rateDate,
        rate,
      },
    });
    setBusy(false);
    if (!result.ok) {
      setError(localizedAccountingError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setRates((current) => {
      const next = current.filter(
        (row) => !(row.currencyCode === result.data.currencyCode && row.rateDate === result.data.rateDate),
      );
      return [...next, result.data].sort(
        (a, b) =>
          a.currencyCode.localeCompare(b.currencyCode) || b.rateDate.localeCompare(a.rateDate),
      );
    });
    setNotice(d.accountingRatesSave);
  }

  return (
    <div className="flex flex-col gap-4">
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
      {notice !== null && <SuccessNotice>{notice}</SuccessNotice>}

      <Card title={d.accountingRatesTitle} description={d.accountingRateHint}>
        <div className="grid gap-3 sm:grid-cols-4">
          <Select
            label={d.accountingRatesCurrency}
            value={currency}
            onValueChange={setCurrency}
            options={COMMON_CURRENCIES.map((code) => ({ value: code, label: code }))}
          />
          <Input
            label={d.accountingRatesDate}
            value={rateDate}
            onValueChange={setRateDate}
            mono
            bidiIsolate
          />
          <Input
            label={d.accountingRatesRate}
            value={rate}
            onValueChange={setRate}
            inputMode="decimal"
            mono
            bidiIsolate
            required
          />
          <div className="flex items-end">
            <Button
              variant="primary"
              onClick={upsert}
              loading={busy}
              disabled={rate === "" || Number(rate) <= 0}
            >
              {d.accountingRatesSave}
            </Button>
          </div>
        </div>
      </Card>

      <Card>
        <div className="mb-3">
          <Select
            value={filter}
            onValueChange={setFilter}
            options={[
              { value: "", label: d.kindFilterAll },
              ...Array.from(new Set(rates.map((row) => row.currencyCode)))
                .sort()
                .map((code) => ({ value: code, label: code })),
            ]}
            aria-label={d.accountingRatesCurrency}
          />
        </div>
        <DataTable
          columns={[
            {
              id: "currency",
              header: activeLocaleHeader(d.accountingRatesCurrency),
              accessor: (row) => row.currencyCode,
              mono: true,
              sortable: true,
              render: (row) => <span className="font-mono text-sm" dir="ltr">{row.currencyCode}</span>,
            },
            {
              id: "date",
              header: activeLocaleHeader(d.accountingRatesDate),
              accessor: (row) => row.rateDate,
              sortable: true,
              render: (row) => <span className="font-mono text-sm" dir="ltr">{row.rateDate}</span>,
            },
            {
              id: "rate",
              header: activeLocaleHeader(d.accountingRatesRate),
              accessor: (row) => row.rate,
              numeric: true,
              render: (row) => <span className="font-mono tabular-nums" dir="ltr">{row.rate}</span>,
            },
            {
              id: "source",
              header: activeLocaleHeader(d.accountingSource),
              accessor: (row) => row.source,
              render: (row) => <span className="font-mono text-xs" dir="ltr">{row.source}</span>,
            },
          ]}
          rows={[...filtered]}
          rowKey={(row) => row.id}
          empty={{ title: d.accountingRatesEmpty }}
        />
      </Card>
    </div>
  );
}
