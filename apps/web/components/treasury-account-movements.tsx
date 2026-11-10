"use client";

/**
 * T14-UI (PHASE-008) — cash-account movement ledger (drill-down on
 * /treasury/accounts/[id]): the append-only IN/OUT ledger with a value-date
 * range filter (from/to) refetched through the BFF. Amounts stay canonical
 * decimal strings; the base column shows the tenant-currency equivalent of
 * each movement (INV-019).
 */
import { useState } from "react";
import type { JSX } from "react";

import { Badge, Button, DataTable, Input, formatMoneyDisplay } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type { CashMovementRow } from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { localizedTreasuryError } from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";

const MOVEMENT_LIMIT = 200;

export function TreasuryAccountMovements({
  locale,
  cashAccountId,
  initialMovements,
}: {
  locale: Locale;
  cashAccountId: string;
  initialMovements: readonly CashMovementRow[];
}): JSX.Element {
  const d = getDictionary(locale);
  const [rows, setRows] = useState<readonly CashMovementRow[]>(initialMovements);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reload(): Promise<void> {
    setError(null);
    setBusy(true);
    const params = new URLSearchParams({ limit: String(MOVEMENT_LIMIT) });
    if (from !== "") {
      params.set("from", from);
    }
    if (to !== "") {
      params.set("to", to);
    }
    const refreshed = await bffFetch<readonly CashMovementRow[]>(
      `treasury/cash-accounts/${cashAccountId}/movements?${params.toString()}`,
    );
    setBusy(false);
    if (!refreshed.ok) {
      setError(localizedTreasuryError(d, refreshed.error, refreshed.retryAfterSeconds));
      return;
    }
    setRows(refreshed.data);
  }

  return (
    <Card title={d.treasuryAccountMovementsTitle}>
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <div className="w-40">
          <Input
            label={d.accountingFromDate}
            value={from}
            onValueChange={setFrom}
            mono
            bidiIsolate
            placeholder="YYYY-MM-DD"
          />
        </div>
        <div className="w-40">
          <Input
            label={d.accountingToDate}
            value={to}
            onValueChange={setTo}
            mono
            bidiIsolate
            placeholder="YYYY-MM-DD"
          />
        </div>
        <Button variant="secondary" onClick={reload} loading={busy}>
          {d.treasuryAllocationReloadBtn}
        </Button>
      </div>
      <DataTable
        columns={[
          {
            id: "date",
            header: activeLocaleHeader(d.treasuryColValueDate),
            accessor: (row) => row.valueDate,
            mono: true,
            sortable: true,
            render: (row) => <span className="font-mono text-sm" dir="ltr">{row.valueDate}</span>,
          },
          {
            id: "direction",
            header: activeLocaleHeader(d.accountingColDirection),
            accessor: (row) => row.direction,
            render: (row) => (
              <Badge tone={row.direction === "IN" ? "primary" : "neutral"}>
                {row.direction === "IN" ? d.treasuryColDirectionIn : d.treasuryColDirectionOut}
              </Badge>
            ),
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
            id: "rate",
            header: activeLocaleHeader(d.treasuryColRate),
            accessor: (row) => row.exchangeRate,
            numeric: true,
            render: (row) => (
              <span className="font-mono tabular-nums" dir="ltr">{row.exchangeRate}</span>
            ),
          },
          {
            id: "base",
            header: activeLocaleHeader(d.treasuryColBaseAmount),
            accessor: (row) => row.baseAmount,
            numeric: true,
            render: (row) => (
              <span className="font-mono tabular-nums" dir="ltr">
                {formatMoneyDisplay(row.baseAmount, 2)}
              </span>
            ),
          },
          {
            id: "source",
            header: activeLocaleHeader(d.treasuryColSource),
            accessor: (row) => row.sourceType,
            render: (row) => (
              <span className="font-mono text-xs" dir="ltr">{row.sourceType}</span>
            ),
          },
          {
            id: "memo",
            header: activeLocaleHeader(d.treasuryColMemo),
            accessor: (row) => row.memo ?? row.memoAr ?? "",
            render: (row) => {
              const text = locale === "ar" ? (row.memoAr ?? row.memo) : (row.memo ?? row.memoAr);
              return text === null || text === "" ? (
                <span className="text-muted-foreground">—</span>
              ) : (
                <span className="max-w-[20rem] truncate">{text}</span>
              );
            },
          },
        ]}
        rows={[...rows]}
        rowKey={(row) => row.id}
        empty={{ title: d.treasuryAccountMovementsEmpty }}
      />
    </Card>
  );
}
