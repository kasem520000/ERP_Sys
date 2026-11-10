"use client";

/**
 * P7-T18 — GL browser (List+Search archetype, INV-006 drill-down): account
 * balances (trial-balance shape) → select an account → period movements with
 * running balance → drill into the full posted entry (lines + source chain).
 * The journal-register feed mirrors the report parameters (from/to/source).
 * Statement RENDERING is PHASE-013 — this is the data browser.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { JSX } from "react";

import {
  Button,
  DataTable,
  DocumentStatusBadge,
  Input,
  Select,
  formatMoneyDisplay,
} from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type {
  AccountBalanceRow,
  GlMovementRow,
  JournalEntryRow,
  JournalLineRow,
  JournalRegisterRow,
  ProjectRow,
} from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { localizedAccountingError, localizedDocumentStatus } from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";

interface EntryDetail {
  entry: JournalEntryRow;
  lines: JournalLineRow[];
  source: { type: string; id: string | null; resolvable: boolean; summary: string | null };
}

export function AccountingGl({
  locale,
  initialBalances,
  initialRegister,
  projects,
}: {
  locale: Locale;
  initialBalances: readonly AccountBalanceRow[];
  initialRegister: readonly JournalRegisterRow[];
  /** PHASE-019 (T50): the project filter pool (T44's projectId param). */
  projects: readonly ProjectRow[];
}): JSX.Element {
  const d = getDictionary(locale);
  const [balances, setBalances] = useState<readonly AccountBalanceRow[]>(initialBalances);
  const [register, setRegister] = useState<readonly JournalRegisterRow[]>(initialRegister);
  const [selected, setSelected] = useState<AccountBalanceRow | null>(null);
  const [movements, setMovements] = useState<readonly GlMovementRow[]>([]);
  const [detail, setDetail] = useState<EntryDetail | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  // PHASE-019 (T50): the optional project filter (T44's query param).
  const [projectId, setProjectId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reloadBalances = useCallback(async (): Promise<void> => {
    setBusy(true);
    const search = new URLSearchParams();
    if (from !== "") {
      search.set("from", from);
    }
    if (to !== "") {
      search.set("to", to);
    }
    if (projectId !== "") {
      search.set("projectId", projectId);
    }
    const suffix = search.size === 0 ? "" : `?${search.toString()}`;
    const [balancesResult, registerResult] = await Promise.all([
      bffFetch<readonly AccountBalanceRow[]>(`accounting/gl/accounts${suffix}`),
      bffFetch<readonly JournalRegisterRow[]>(`accounting/gl/journal-register${suffix}`),
    ]);
    setBusy(false);
    if (!balancesResult.ok) {
      setError(localizedAccountingError(d, balancesResult.error, balancesResult.retryAfterSeconds));
      return;
    }
    setBalances(balancesResult.data);
    setRegister(registerResult.ok ? registerResult.data : []);
  }, [d, from, to, projectId]);

  const loadMovements = useCallback(
    async (account: AccountBalanceRow): Promise<void> => {
      setSelected(account);
      setDetail(null);
      setBusy(true);
      const search = new URLSearchParams({ limit: "200" });
      if (from !== "") {
        search.set("from", from);
      }
      if (to !== "") {
        search.set("to", to);
      }
      if (projectId !== "") {
        search.set("projectId", projectId);
      }
      const result = await bffFetch<{
        account: { id: string };
        movements: readonly GlMovementRow[];
        openingBalance: string;
      }>(`accounting/gl/accounts/${account.accountId}/movements?${search.toString()}`);
      setBusy(false);
      if (!result.ok) {
        setError(localizedAccountingError(d, result.error, result.retryAfterSeconds));
        return;
      }
      setMovements(result.data.movements);
    },
    [d, from, to, projectId],
  );

  useEffect(() => {
    if (selected !== null) {
      void loadMovements(selected);
    }
  }, [loadMovements, selected]);

  const openEntry = useCallback(
    async (entryId: string): Promise<void> => {
      setBusy(true);
      const result = await bffFetch<EntryDetail>(`accounting/gl/entries/${entryId}`);
      setBusy(false);
      if (!result.ok) {
        setError(localizedAccountingError(d, result.error, result.retryAfterSeconds));
        return;
      }
      setDetail(result.data);
    },
    [d],
  );

  const totals = useMemo(
    () =>
      balances.reduce(
        (acc, row) => ({
          debit: (Number(acc.debit) + Number(row.debit)).toFixed(4),
          credit: (Number(acc.credit) + Number(row.credit)).toFixed(4),
        }),
        { debit: "0", credit: "0" },
      ),
    [balances],
  );

  return (
    <div className="flex flex-col gap-4">
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}

      <Card title={d.accountingGlTitle}>
        <div className="mb-3 flex flex-wrap items-end gap-3">
          <Input label={d.accountingFromDate} value={from} onValueChange={setFrom} mono bidiIsolate placeholder="2026-01-01" />
          <Input label={d.accountingToDate} value={to} onValueChange={setTo} mono bidiIsolate placeholder="2026-12-31" />
          {/* PHASE-019 (T50): the optional project filter (T44's param). */}
          <Select
            label={d.accountingGlProjectFilter}
            value={projectId}
            onValueChange={setProjectId}
            placeholder="—"
            options={[
              { value: "", label: d.accountingGlAllProjects },
              ...projects.map((project) => ({
                value: project.id,
                label: `${project.code} · ${project.name}`,
              })),
            ]}
          />
          <Button variant="secondary" onClick={() => void reloadBalances()} loading={busy}>
            {d.commonOpen}
          </Button>
        </div>
        <DataTable
          columns={[
            {
              id: "code",
              header: activeLocaleHeader(d.accountingColCode),
              accessor: (row) => row.code,
              mono: true,
              sortable: true,
              render: (row) => <span className="font-mono text-sm" dir="ltr">{row.code}</span>,
            },
            {
              id: "name",
              header: activeLocaleHeader(d.accountingColName),
              accessor: (row) => localizedNameOf(row, locale),
              render: (row) => localizedNameOf(row, locale),
            },
            {
              id: "debit",
              header: activeLocaleHeader(d.accountingColDebit),
              accessor: (row) => row.debit,
              numeric: true,
              render: (row) => (
                <span className="font-mono tabular-nums" dir="ltr">{formatMoneyDisplay(row.debit, 2)}</span>
              ),
            },
            {
              id: "credit",
              header: activeLocaleHeader(d.accountingColCredit),
              accessor: (row) => row.credit,
              numeric: true,
              render: (row) => (
                <span className="font-mono tabular-nums" dir="ltr">{formatMoneyDisplay(row.credit, 2)}</span>
              ),
            },
            {
              id: "balance",
              header: activeLocaleHeader(d.accountingColBalance),
              accessor: (row) => row.balance,
              numeric: true,
              render: (row) => (
                <span className="font-mono tabular-nums" dir="ltr">{formatMoneyDisplay(row.balance, 2)}</span>
              ),
            },
          ]}
          rows={[...balances]}
          rowKey={(row) => row.accountId}
          rowActions={[
            {
              id: "drill",
              label: d.accountingGlDrill,
              onSelect: (row) => setSelected(row),
            },
          ]}
          empty={{ title: d.accountingGlEmpty }}
        />
        <p className="mt-2 text-xs text-muted-foreground" dir="ltr">
          Σ {d.accountingColDebit}: {formatMoneyDisplay(totals.debit, 2)} · Σ {d.accountingColCredit}:{" "}
          {formatMoneyDisplay(totals.credit, 2)}
        </p>
      </Card>

      {selected !== null && (
        <Card
          title={`${d.accountingMovementsTitle} — ${selected.code}`}
          description={localizedNameOf(selected, locale)}
        >
          <DataTable
            columns={[
              {
                id: "date",
                header: activeLocaleHeader(d.accountingColEntryDate),
                accessor: (row) => row.entryDate,
                render: (row) => <span className="font-mono text-sm" dir="ltr">{row.entryDate}</span>,
              },
              {
                id: "entry",
                header: activeLocaleHeader(d.accountingColEntryNo),
                accessor: (row) => row.entryNo ?? "",
                render: (row) => (
                  <button
                    type="button"
                    className="font-mono text-sm text-primary-700 hover:underline"
                    onClick={() => void openEntry(row.journalEntryId)}
                  >
                    {row.entryNo ?? "—"}
                  </button>
                ),
              },
              {
                id: "memo",
                header: activeLocaleHeader(d.accountingMemo),
                accessor: (row) => row.memo ?? "",
                render: (row) => row.memo ?? "—",
              },
              {
                id: "direction",
                header: activeLocaleHeader(d.accountingColDirection),
                accessor: (row) => row.direction,
                render: (row) =>
                  row.direction === "DEBIT" ? d.accountingColDebit : d.accountingColCredit,
              },
              {
                id: "amount",
                header: activeLocaleHeader(d.accountingColAmount),
                accessor: (row) => row.amount,
                numeric: true,
                render: (row) => (
                  <span className="font-mono tabular-nums" dir="ltr">{formatMoneyDisplay(row.amount, 2)}</span>
                ),
              },
              {
                id: "base",
                header: activeLocaleHeader(d.accountingColBase),
                accessor: (row) => row.baseAmount,
                numeric: true,
                render: (row) => (
                  <span className="font-mono tabular-nums" dir="ltr">{formatMoneyDisplay(row.baseAmount, 4)}</span>
                ),
              },
              {
                id: "balance",
                header: activeLocaleHeader(d.accountingColBalance),
                accessor: (row) => row.balanceAfter ?? "",
                numeric: true,
                render: (row) =>
                  row.balanceAfter === undefined ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    <span className="font-mono tabular-nums" dir="ltr">{formatMoneyDisplay(row.balanceAfter, 4)}</span>
                  ),
              },
            ]}
            rows={[...movements]}
            rowKey={(row) => `${row.journalEntryId}-${row.lineNo}`}
            empty={{ title: d.accountingGlEmpty }}
          />
        </Card>
      )}

      {detail !== null && (
        <Card title={d.accountingPreviewTitle}>
          <dl className="mb-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            <div className="flex gap-2">
              <dt className="text-muted-foreground">{d.accountingColEntryNo}:</dt>
              <dd className="font-mono" dir="ltr">{detail.entry.entryNo ?? "—"}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-muted-foreground">{d.accountingColEntryDate}:</dt>
              <dd className="font-mono" dir="ltr">{detail.entry.entryDate}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-muted-foreground">{d.accountingColCurrency}:</dt>
              <dd className="font-mono" dir="ltr">
                {detail.entry.currencyCode} @ {detail.entry.exchangeRate}
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-muted-foreground">{d.accountingSource}:</dt>
              <dd className="font-mono text-xs" dir="ltr">
                {detail.source.type}
                {detail.source.summary === null ? "" : ` · ${detail.source.summary}`}
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-muted-foreground">{d.accountingColStatus}:</dt>
              <dd>
                <DocumentStatusBadge
                  status={detail.entry.status as "POSTED" | "REVERSED"}
                  label={localizedDocumentStatus(d, detail.entry.status)}
                />
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-muted-foreground">{d.accountingPostedAt}:</dt>
              <dd className="font-mono" dir="ltr">{detail.entry.postedAt}</dd>
            </div>
          </dl>
          <DataTable
            columns={[
              {
                id: "no",
                header: activeLocaleHeader("#"),
                accessor: (row) => String(row.lineNo),
                render: (row) => <span className="font-mono text-xs">{row.lineNo}</span>,
              },
              {
                id: "direction",
                header: activeLocaleHeader(d.accountingColDirection),
                accessor: (row) => row.direction,
                render: (row) =>
                  row.direction === "DEBIT" ? d.accountingColDebit : d.accountingColCredit,
              },
              {
                id: "amount",
                header: activeLocaleHeader(d.accountingColAmount),
                accessor: (row) => row.amount,
                numeric: true,
                render: (row) => (
                  <span className="font-mono tabular-nums" dir="ltr">{formatMoneyDisplay(row.amount, 2)}</span>
                ),
              },
              {
                id: "base",
                header: activeLocaleHeader(d.accountingColBase),
                accessor: (row) => row.baseAmount,
                numeric: true,
                render: (row) => (
                  <span className="font-mono tabular-nums" dir="ltr">{formatMoneyDisplay(row.baseAmount, 4)}</span>
                ),
              },
              {
                id: "memo",
                header: activeLocaleHeader(d.accountingMemo),
                accessor: (row) => row.memo ?? row.memoAr ?? "",
                render: (row) => row.memo ?? row.memoAr ?? "—",
              },
            ]}
            rows={[...detail.lines]}
            rowKey={(row) => row.id}
          />
        </Card>
      )}

      <Card title={d.accountingRegisterTitle}>
        <DataTable
          columns={[
            {
              id: "date",
              header: activeLocaleHeader(d.accountingColEntryDate),
              accessor: (row) => row.entryDate,
              render: (row) => <span className="font-mono text-sm" dir="ltr">{row.entryDate}</span>,
            },
            {
              id: "entry",
              header: activeLocaleHeader(d.accountingColEntryNo),
              accessor: (row) => row.entryNo ?? "",
              render: (row) => (
                <button
                  type="button"
                  className="font-mono text-sm text-primary-700 hover:underline"
                  onClick={() => void openEntry(row.id)}
                >
                  {row.entryNo ?? "—"}
                </button>
              ),
            },
            {
              id: "description",
              header: activeLocaleHeader(d.accountingDescription),
              accessor: (row) => row.description ?? "",
              render: (row) => <span className="max-w-[20rem] truncate">{row.description ?? "—"}</span>,
            },
            {
              id: "source",
              header: activeLocaleHeader(d.accountingSource),
              accessor: (row) => row.sourceType,
              render: (row) => <span className="font-mono text-xs" dir="ltr">{row.sourceType}</span>,
            },
            {
              id: "debit",
              header: activeLocaleHeader(d.accountingColDebit),
              accessor: (row) => row.totalDebit,
              numeric: true,
              render: (row) => (
                <span className="font-mono tabular-nums" dir="ltr">{formatMoneyDisplay(row.totalDebit, 2)}</span>
              ),
            },
            {
              id: "credit",
              header: activeLocaleHeader(d.accountingColCredit),
              accessor: (row) => row.totalCredit,
              numeric: true,
              render: (row) => (
                <span className="font-mono tabular-nums" dir="ltr">{formatMoneyDisplay(row.totalCredit, 2)}</span>
              ),
            },
          ]}
          rows={[...register]}
          rowKey={(row) => row.id}
          empty={{ title: d.accountingGlEmpty }}
        />
      </Card>
    </div>
  );
}

function localizedNameOf(row: { name: string; nameAr: string }, locale: Locale): string {
  return locale === "ar" && row.nameAr !== "" ? row.nameAr : row.name;
}
