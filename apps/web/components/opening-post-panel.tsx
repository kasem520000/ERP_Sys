"use client";

/**
 * P7-T18 — opening-balances POST step (BR-035): the PHASE-006 draft console
 * gains its posting surface — pick the fiscal year, review the draft kinds
 * (partner rows → per-partner AR/AP subledger rows from entry #1, account
 * rows → declared balances; stock drafts remain DRAFT until PHASE-010),
 * then post ONCE through the OPENING period. The OPENING_EQUITY purpose
 * balances the entry (G-16 shape); afterwards corrections are normal
 * journals in open periods.
 */
import { useEffect, useMemo, useState } from "react";

import { Badge, Button, DataTable, Select } from "@erp/ui";
import type { JSX } from "react";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type { FiscalYearRow, OpeningBalanceDocRow } from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { localizedAccountingError, localizedStatus } from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice, SuccessNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";

export function OpeningPostPanel({
  locale,
  years,
  initialDrafts,
}: {
  locale: Locale;
  years: readonly FiscalYearRow[];
  initialDrafts: readonly OpeningBalanceDocRow[];
}): JSX.Element {
  const d = getDictionary(locale);
  const [drafts, setDrafts] = useState<readonly OpeningBalanceDocRow[]>(initialDrafts);
  const [yearId, setYearId] = useState(years[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const byKind = useMemo(() => {
    const counts = new Map<string, number>();
    for (const draft of drafts) {
      counts.set(draft.kind, (counts.get(draft.kind) ?? 0) + 1);
    }
    return counts;
  }, [drafts]);

  useEffect(() => {
    if (yearId === "") {
      return;
    }
    void (async (): Promise<void> => {
      const result = await bffFetch<readonly OpeningBalanceDocRow[]>("accounting/opening-balances");
      if (result.ok) {
        setDrafts(result.data);
      }
    })();
  }, [yearId]);

  async function post(): Promise<void> {
    if (yearId === "") {
      return;
    }
    setError(null);
    setNotice(null);
    if (!window.confirm(d.accountingPostOpeningConfirm)) {
      return;
    }
    setBusy(true);
    const result = await bffFetch<{ journalEntryId: string; partnerRows: number; accountRows: number }>(
      `accounting/opening-balances/${yearId}/post`,
      { method: "POST", body: {} },
    );
    setBusy(false);
    if (!result.ok) {
      setError(localizedAccountingError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setNotice(`${d.accountingPostOpening}: ${result.data.journalEntryId}`);
    const refreshed = await bffFetch<readonly OpeningBalanceDocRow[]>("accounting/opening-balances");
    if (refreshed.ok) {
      setDrafts(refreshed.data);
    }
  }

  return (
    <Card
      title={d.accountingPostOpening}
      description={d.obPostReadyNote}
    >
      <div className="flex flex-col gap-3">
        {error !== null && <ErrorNotice>{error}</ErrorNotice>}
        {notice !== null && <SuccessNotice>{notice}</SuccessNotice>}
        <div className="flex flex-wrap items-end gap-3">
          <Select
            label={d.accountingYearsTitle}
            value={yearId}
            onValueChange={setYearId}
            options={years.map((year) => ({
              value: year.id,
              label: `${year.name} (${year.startDate} → ${year.endDate})`,
            }))}
          />
          <Button
            variant="primary"
            onClick={post}
            loading={busy}
            disabled={yearId === "" || drafts.length === 0}
          >
            {d.accountingPostOpening}
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          {Array.from(byKind.entries()).map(([kind, count]) => (
            <Badge key={kind} tone="neutral">
              {localizedStatus(d, kind === "PARTNER" ? "ACTIVE" : kind)} · {count}
            </Badge>
          ))}
          {byKind.size === 0 ? <span className="text-sm text-muted-foreground">{d.accountingJournalsEmpty}</span> : null}
        </div>
        <DataTable
          columns={[
            {
              id: "kind",
              header: activeLocaleHeader(d.kindLabel),
              accessor: (row) => row.kind,
              render: (row) => <span className="font-mono text-xs" dir="ltr">{row.kind}</span>,
            },
            {
              id: "amount",
              header: activeLocaleHeader(d.accountingColAmount),
              accessor: (row) => row.amount ?? "",
              numeric: true,
              render: (row) =>
                row.amount === null ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  <span className="font-mono tabular-nums" dir="ltr">{row.amount}</span>
                ),
            },
            {
              id: "currency",
              header: activeLocaleHeader(d.accountingColCurrency),
              accessor: (row) => row.currencyCode,
              render: (row) => <span className="font-mono text-sm" dir="ltr">{row.currencyCode}</span>,
            },
            {
              id: "status",
              header: activeLocaleHeader(d.accountingColStatus),
              accessor: (row) => row.status,
              render: (row) => <Badge tone={row.status === "DRAFT" ? "neutral" : "primary"}>{row.status}</Badge>,
            },
          ]}
          rows={[...drafts]}
          rowKey={(row) => row.id}
          empty={{ title: d.obEmpty }}
        />
      </div>
    </Card>
  );
}
