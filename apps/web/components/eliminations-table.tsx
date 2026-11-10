"use client";

/**
 * PHASE-034 (T11) — the eliminations log (PAGE_ARCHETYPES §2, List+Search —
 * the notes-table pattern): group/status filters reload through the BFF (the
 * API's own filter set — groupId/fiscalPeriodId/status); the KIND filter runs
 * client-side over the loaded page (the list endpoint carries no kind
 * parameter — the honest degrade, never a fabricated server param). Each row
 * carries the exact ΣDR/ΣCR totals (sumExact — never floats, ADR-0009), the
 * status + approved badges, the journals count and the reversalOf
 * cross-reference. Lifecycle actions ride the row menu: approve (SoD — a
 * second user), post (confirm dialog) and reverse (note dialog → a NEW DRAFT
 * counter-entry).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { JSX } from "react";

import {
  Badge,
  Button,
  DataTable,
  Dialog,
  Input,
  Select,
  formatMoneyDisplay,
  type DataTableSort,
} from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type {
  ConsolidationGroupRow,
  EliminationRow,
  FiscalPeriodRow,
} from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { sumExact } from "../lib/exact-money";
import { formatMessage, localizedName, localizedApiError, localizedDocumentStatus } from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice, InfoNotice, SuccessNotice } from "./notices";
import { LinkButton } from "./link-button";
import { activeLocaleHeader } from "./table-header";

export interface EliminationsInitialFilters {
  groupId: string;
  status: string;
}

const EMPTY_FILTERS: EliminationsInitialFilters = { groupId: "", status: "" };

export function EliminationsTable({
  locale,
  initialRows,
  groups,
  periods,
  initialFilters = EMPTY_FILTERS,
}: {
  locale: Locale;
  initialRows: readonly EliminationRow[];
  groups: readonly ConsolidationGroupRow[];
  periods: readonly FiscalPeriodRow[];
  initialFilters?: EliminationsInitialFilters;
}): JSX.Element {
  const d = getDictionary(locale);
  const [rows, setRows] = useState<readonly EliminationRow[]>(initialRows);
  const [groupId, setGroupId] = useState(initialFilters.groupId);
  const [status, setStatus] = useState(initialFilters.status);
  const [kind, setKind] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sort, setSort] = useState<DataTableSort[]>([]);
  const [postTarget, setPostTarget] = useState<EliminationRow | null>(null);
  const [reverseTarget, setReverseTarget] = useState<EliminationRow | null>(null);
  const [reverseNote, setReverseNote] = useState("");
  const runRef = useRef(0);
  const skipInitialLoad = useRef(
    initialFilters.groupId === "" && initialFilters.status === "",
  );

  const groupOf = useCallback(
    (id: string): ConsolidationGroupRow | undefined => groups.find((group) => group.id === id),
    [groups],
  );

  const periodLabel = useCallback(
    (id: string): string => {
      const period = periods.find((row) => row.id === id);
      return period === undefined ? id.slice(0, 8) : period.name;
    },
    [periods],
  );

  const loadPage = useCallback(async (): Promise<void> => {
    const run = runRef.current + 1;
    runRef.current = run;
    setBusy("list");
    setError(null);
    const search = new URLSearchParams();
    if (groupId !== "") {
      search.set("groupId", groupId);
    }
    if (status !== "") {
      search.set("status", status);
    }
    const path =
      search.toString() === ""
        ? "consolidation/eliminations"
        : `consolidation/eliminations?${search.toString()}`;
    const result = await bffFetch<readonly EliminationRow[]>(path);
    if (run !== runRef.current) {
      return; // stale response — a newer filter change superseded it
    }
    setBusy(null);
    if (!result.ok) {
      setError(localizedApiError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setRows(result.data);
  }, [d, groupId, status]);

  // Filter changes reload the list. The server page already fetched the
  // initial rows — the first run is a no-op unless a deep link pre-filter
  // arrived (then the page fetched with those filters and no refetch fires).
  useEffect(() => {
    if (skipInitialLoad.current) {
      skipInitialLoad.current = false;
      return;
    }
    void loadPage();
  }, [loadPage]);

  // The kind filter runs client-side over the loaded page (the API's list
  // carries no kind parameter — never a fabricated server param).
  const visibleRows = useMemo(() => {
    if (kind === "") {
      return rows;
    }
    return rows.filter((row) => row.kind === kind);
  }, [rows, kind]);

  const debitTotal = useCallback(
    (row: EliminationRow): string =>
      sumExact(row.lines.filter((line) => line.direction === "DEBIT").map((line) => line.amount)),
    [],
  );
  const creditTotal = useCallback(
    (row: EliminationRow): string =>
      sumExact(row.lines.filter((line) => line.direction === "CREDIT").map((line) => line.amount)),
    [],
  );

  async function approve(row: EliminationRow): Promise<void> {
    setError(null);
    setBusy(`approve-${row.id}`);
    const approved = await bffFetch<EliminationRow>(`consolidation/eliminations/${row.id}/approve`, {
      method: "POST",
      body: {},
    });
    setBusy(null);
    if (!approved.ok) {
      setError(localizedApiError(d, approved.error, approved.retryAfterSeconds));
      return;
    }
    setNotice(d.eliminationsApproveToast);
    await loadPage();
  }

  async function post(): Promise<void> {
    if (postTarget === null) {
      return;
    }
    setError(null);
    setBusy(`post-${postTarget.id}`);
    const posted = await bffFetch<EliminationRow>(
      `consolidation/eliminations/${postTarget.id}/post`,
      { method: "POST", body: {} },
    );
    const target = postTarget;
    setPostTarget(null);
    setBusy(null);
    if (!posted.ok) {
      setError(localizedApiError(d, posted.error, posted.retryAfterSeconds));
      return;
    }
    setNotice(
      formatMessage(d.eliminationsPostToast, {
        no: posted.data.eliminationNo ?? target.id.slice(0, 8),
        entry: posted.data.journalEntryIds[0] ?? "—",
      }),
    );
    await loadPage();
  }

  async function reverse(): Promise<void> {
    if (reverseTarget === null) {
      return;
    }
    setError(null);
    setBusy(`reverse-${reverseTarget.id}`);
    const body: Record<string, unknown> = {};
    if (reverseNote.trim() !== "") body.note = reverseNote.trim();
    const reversed = await bffFetch<EliminationRow>(
      `consolidation/eliminations/${reverseTarget.id}/reverse`,
      { method: "POST", body },
    );
    setReverseTarget(null);
    setReverseNote("");
    setBusy(null);
    if (!reversed.ok) {
      setError(localizedApiError(d, reversed.error, reversed.retryAfterSeconds));
      return;
    }
    setNotice(d.eliminationsReverseToast);
    await loadPage();
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-56">
          <Select
            id="eliminations-filter-group"
            label={d.consolidationColGroup}
            value={groupId}
            onValueChange={setGroupId}
            options={[
              { value: "", label: d.kindFilterAll },
              ...groups.map((group) => ({
                value: group.id,
                label: localizedName(group.name, group.nameAr, locale),
              })),
            ]}
          />
        </div>
        <div className="w-44">
          <Select
            id="eliminations-filter-status"
            label={d.colStatus}
            value={status}
            onValueChange={setStatus}
            options={[
              { value: "", label: d.kindFilterAll },
              { value: "DRAFT", label: d.statusDraft },
              { value: "POSTED", label: d.statusPosted },
            ]}
          />
        </div>
        <div className="w-52">
          <Select
            id="eliminations-filter-kind"
            label={d.eliminationsFilterKind}
            value={kind}
            onValueChange={setKind}
            options={[
              { value: "", label: d.kindFilterAll },
              { value: "INTERCOMPANY", label: d.eliminationsKindIntercompany },
              { value: "INVESTMENT_EQUITY", label: d.eliminationsKindInvestmentEquity },
            ]}
          />
        </div>
        <LinkButton href={`/${locale}/consolidation/eliminations/new`} variant="primary">
          {d.consolidationNewElimination}
        </LinkButton>
      </div>
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
      {notice !== null && <SuccessNotice>{notice}</SuccessNotice>}
      <Card title={d.eliminationsTitle}>
        <DataTable
          columns={[
            {
              id: "no",
              header: activeLocaleHeader(d.eliminationsColNo),
              accessor: (row) => row.eliminationNo ?? "",
              mono: true,
              width: "9rem",
              render: (row) =>
                row.eliminationNo === null ? (
                  <span className="text-gray-500">—</span>
                ) : (
                  <span className="font-mono text-xs" dir="ltr">
                    {row.eliminationNo}
                  </span>
                ),
            },
            {
              id: "group",
              header: activeLocaleHeader(d.consolidationColGroup),
              accessor: (row) => {
                const group = groupOf(row.groupId);
                return group === undefined ? row.groupId.slice(0, 8) : localizedName(group.name, group.nameAr, locale);
              },
              render: (row) => {
                const group = groupOf(row.groupId);
                return (
                  <span className="truncate">
                    {group === undefined ? (
                      <span className="font-mono text-xs" dir="ltr">
                        {row.groupId.slice(0, 8)}
                      </span>
                    ) : (
                      localizedName(group.name, group.nameAr, locale)
                    )}
                  </span>
                );
              },
            },
            {
              id: "period",
              header: activeLocaleHeader(d.consolidationFiscalPeriod),
              accessor: (row) => periodLabel(row.fiscalPeriodId),
              render: (row) => (
                <span className="font-mono text-xs" dir="ltr">
                  {periodLabel(row.fiscalPeriodId)}
                </span>
              ),
            },
            {
              id: "kind",
              header: activeLocaleHeader(d.eliminationsFilterKind),
              accessor: (row) => row.kind,
              render: (row) =>
                row.kind === "INTERCOMPANY"
                  ? d.eliminationsKindIntercompany
                  : d.eliminationsKindInvestmentEquity,
            },
            {
              id: "description",
              header: activeLocaleHeader(d.eliminationsColDescription),
              accessor: (row) => row.description,
              render: (row) => <span className="truncate">{row.description}</span>,
            },
            {
              id: "lines",
              header: activeLocaleHeader(d.eliminationsColLines),
              accessor: (row) => String(row.lines.length),
              numeric: true,
              render: (row) => (
                <span className="font-mono tabular-nums" dir="ltr">
                  {row.lines.length}
                </span>
              ),
            },
            {
              id: "debit",
              header: activeLocaleHeader(d.accountingColDebit),
              accessor: (row) => debitTotal(row),
              numeric: true,
              render: (row) => (
                <span className="font-mono tabular-nums" dir="ltr">
                  {formatMoneyDisplay(debitTotal(row), 2)}
                </span>
              ),
            },
            {
              id: "credit",
              header: activeLocaleHeader(d.accountingColCredit),
              accessor: (row) => creditTotal(row),
              numeric: true,
              render: (row) => (
                <span className="font-mono tabular-nums" dir="ltr">
                  {formatMoneyDisplay(creditTotal(row), 2)}
                </span>
              ),
            },
            {
              id: "status",
              header: activeLocaleHeader(d.colStatus),
              accessor: (row) => row.status,
              render: (row) => (
                <span className="flex flex-wrap items-center gap-2">
                  <Badge tone={row.status === "POSTED" ? "primary" : "neutral"}>
                    {localizedDocumentStatus(d, row.status)}
                  </Badge>
                  {row.approvedAt !== null && (
                    <Badge tone="neutral">{d.eliminationsApprovedBadge}</Badge>
                  )}
                </span>
              ),
            },
            {
              id: "journals",
              header: activeLocaleHeader(d.eliminationsColJournals),
              accessor: (row) => String(row.journalEntryIds.length),
              numeric: true,
              render: (row) => (
                <span className="font-mono tabular-nums" dir="ltr">
                  {row.journalEntryIds.length}
                </span>
              ),
            },
            {
              id: "reversalOf",
              header: activeLocaleHeader(d.eliminationsColReversalOf),
              accessor: (row) => row.reversalOf ?? "",
              mono: true,
              render: (row) => {
                if (row.reversalOf === null) {
                  return <span className="text-gray-500">—</span>;
                }
                const source = rows.find((entry) => entry.id === row.reversalOf);
                return (
                  <span className="font-mono text-xs" dir="ltr" title={row.reversalOf}>
                    {source?.eliminationNo ?? row.reversalOf.slice(0, 8)}
                  </span>
                );
              },
            },
          ]}
          rows={[...visibleRows]}
          rowKey={(row) => row.id}
          sort={sort}
          onSortChange={setSort}
          loading={busy === "list" && visibleRows.length === 0}
          rowActions={[
            {
              id: "approve",
              label: d.accountingApprove,
              onSelect: (row) => void approve(row),
            },
            {
              id: "post",
              label: d.accountingPost,
              onSelect: (row) => setPostTarget(row),
            },
            {
              id: "reverse",
              label: d.eliminationsReverseAction,
              danger: true,
              onSelect: (row) => {
                setReverseTarget(row);
                setReverseNote("");
              },
            },
          ]}
          empty={{ title: d.eliminationsEmpty }}
        />
        <p className="mt-3 text-xs text-gray-600">{d.eliminationsSodHint}</p>
        <p className="mt-1 text-xs text-gray-600">{d.consolidationDisclaimer}</p>
      </Card>

      <Dialog
        open={postTarget !== null}
        onOpenChange={(open) => {
          if (!open) setPostTarget(null);
        }}
        title={d.eliminationsPostConfirmTitle}
        size="sm"
      >
        {postTarget !== null && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-gray-700">
              {formatMessage(d.eliminationsPostConfirmBody, {
                amount: formatMoneyDisplay(debitTotal(postTarget), 2),
              })}
            </p>
            <InfoNotice>{d.eliminationsSodHint}</InfoNotice>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setPostTarget(null)}>
                {d.commonCancel}
              </Button>
              <Button variant="primary" onClick={() => void post()}>
                {d.accountingPost}
              </Button>
            </div>
          </div>
        )}
      </Dialog>

      <Dialog
        open={reverseTarget !== null}
        onOpenChange={(open) => {
          if (!open) setReverseTarget(null);
        }}
        title={d.eliminationsReverseConfirmTitle}
        size="sm"
      >
        {reverseTarget !== null && (
          <div className="flex flex-col gap-3">
            <Input
              id="elimination-reverse-note"
              label={d.consolidationNoteEn}
              value={reverseNote}
              onValueChange={setReverseNote}
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setReverseTarget(null)}>
                {d.commonCancel}
              </Button>
              <Button
                variant="danger"
                onClick={() => void reverse()}
                loading={busy === `reverse-${reverseTarget.id}`}
              >
                {d.eliminationsReverseAction}
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}
