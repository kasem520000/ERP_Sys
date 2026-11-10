"use client";

/**
 * P7-T18 — journal detail panel: the manual-journal document (header +
 * lines with account codes) and, once posted, the immutable ledger entry
 * (409 IMMUTABLE_DOCUMENT discipline — no edit affordance exists once
 * status leaves DRAFT; the reverse form is the only correction path).
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
  formatMoneyDisplay,
} from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type {
  AccountRow,
  JournalEntryRow,
  JournalLineRow,
  ManualJournalRow,
} from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import {
  formatDateTime,
  localizedAccountingError,
  localizedDocumentStatus,
} from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice, InfoNotice, SuccessNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";

interface DraftLine {
  direction: string;
  amount: string;
  accountId: string;
  memo: string | null;
}

export function JournalDetailPanel({
  locale,
  journalId,
  draft,
  draftLines,
  posted,
  accounts,
  canApprove,
  canPost,
  canReverse,
}: {
  locale: Locale;
  journalId: string;
  draft: ManualJournalRow;
  draftLines: readonly DraftLine[];
  posted: { entry: JournalEntryRow; lines: JournalLineRow[] } | null;
  accounts: readonly AccountRow[];
  canApprove: boolean;
  canPost: boolean;
  canReverse: boolean;
}): JSX.Element {
  const d = getDictionary(locale);
  const router = useRouter();
  const [status, setStatus] = useState(draft.status);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reverseOpen, setReverseOpen] = useState(false);
  const [reverseDate, setReverseDate] = useState(new Date().toISOString().slice(0, 10));
  const [reverseReason, setReverseReason] = useState("");

  const accountCodeOf = useMemo(() => {
    const map = new Map(accounts.map((account) => [account.id, account.code]));
    return (accountId: string): string => map.get(accountId) ?? accountId.slice(0, 8);
  }, [accounts]);

  const totals = useMemo(() => {
    let debit = 0;
    let credit = 0;
    for (const line of draftLines) {
      if (line.direction === "DEBIT") {
        debit += Number(line.amount);
      } else {
        credit += Number(line.amount);
      }
    }
    return { debit: debit.toFixed(2), credit: credit.toFixed(2) };
  }, [draftLines]);

  async function act(action: "submit" | "approve" | "post"): Promise<void> {
    setError(null);
    setNotice(null);
    setBusy(true);
    const result = await bffFetch<ManualJournalRow>(`accounting/journal-entries/${journalId}/${action}`, {
      method: "POST",
      body: action === "approve" ? { note: "detail approve" } : {},
    });
    setBusy(false);
    if (!result.ok) {
      setError(localizedAccountingError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setStatus(result.data.status);
    setNotice(
      action === "post" ? d.accountingPost : action === "approve" ? d.accountingApprove : d.accountingSubmit,
    );
    router.refresh();
  }

  async function reverse(): Promise<void> {
    setError(null);
    setBusy(true);
    const result = await bffFetch<ManualJournalRow>(`accounting/journal-entries/${journalId}/reverse`, {
      method: "POST",
      body: { entryDate: reverseDate, reason: reverseReason },
    });
    setBusy(false);
    if (!result.ok) {
      setError(localizedAccountingError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setStatus(result.data.status);
    setReverseOpen(false);
    setReverseReason("");
    setNotice(d.accountingReverse);
    router.refresh();
  }

  const isDraftFamily = status === "DRAFT" || status === "PENDING_APPROVAL" || status === "APPROVED";

  return (
    <div className="flex flex-col gap-4">
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
      {notice !== null && <SuccessNotice>{notice}</SuccessNotice>}
      {status === "POSTED" || status === "REVERSED" ? (
        <InfoNotice>{d.accountingErrImmutable}</InfoNotice>
      ) : null}

      <Card
        title={draft.description ?? draft.descriptionAr ?? d.accountingPreviewTitle}
        actions={
          <div className="flex flex-wrap gap-2">
            {status === "DRAFT" ? (
              <Button variant="primary" size="sm" onClick={() => void act("submit")} loading={busy}>
                {d.accountingSubmit}
              </Button>
            ) : null}
            {status === "PENDING_APPROVAL" && canApprove ? (
              <Button variant="primary" size="sm" onClick={() => void act("approve")} loading={busy}>
                {d.accountingApprove}
              </Button>
            ) : null}
            {status === "APPROVED" && canPost ? (
              <Button variant="primary" size="sm" onClick={() => void act("post")} loading={busy}>
                {d.accountingPost}
              </Button>
            ) : null}
            {(status === "POSTED" || status === "REVERSED") && canReverse ? (
              <Button variant="secondary" size="sm" onClick={() => setReverseOpen(true)}>
                {d.accountingReverse}
              </Button>
            ) : null}
            <Button variant="ghost" size="sm" onClick={() => router.push(`/${locale}/accounting/journals`)}>
              {d.commonCancel}
            </Button>
          </div>
        }
      >
        <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
          <div className="flex gap-2">
            <dt className="text-muted-foreground">{d.accountingColStatus}:</dt>
            <dd>
              <DocumentStatusBadge status={status} label={localizedDocumentStatus(d, status)} />
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-muted-foreground">{d.accountingColEntryDate}:</dt>
            <dd className="font-mono" dir="ltr">{draft.entryDate}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-muted-foreground">{d.accountingReference}:</dt>
            <dd className="font-mono" dir="ltr">{draft.reference ?? "—"}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-muted-foreground">{d.accountingColCurrency}:</dt>
            <dd className="font-mono" dir="ltr">
              {draft.currencyCode} @ {draft.exchangeRate ?? "—"}
            </dd>
          </div>
          {posted !== null ? (
            <>
              <div className="flex gap-2">
                <dt className="text-muted-foreground">{d.accountingColEntryNo}:</dt>
                <dd className="font-mono" dir="ltr">{posted.entry.entryNo ?? "—"}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-muted-foreground">{d.accountingPostedAt}:</dt>
                <dd className="font-mono" dir="ltr">{formatDateTime(posted.entry.postedAt, locale)}</dd>
              </div>
            </>
          ) : null}
        </dl>
      </Card>

      {reverseOpen ? (
        <Card title={d.accountingReverse}>
          <div className="flex flex-col gap-3">
            <Input
              label={d.accountingReversalDate}
              value={reverseDate}
              onValueChange={setReverseDate}
              mono
              bidiIsolate
            />
            <Input
              label={d.accountingReversalReason}
              value={reverseReason}
              onValueChange={setReverseReason}
              required
            />
            <div className="flex gap-2">
              <Button
                variant="primary"
                onClick={reverse}
                loading={busy}
                disabled={reverseReason.trim().length < 3}
              >
                {d.accountingReverse}
              </Button>
              <Button variant="ghost" onClick={() => setReverseOpen(false)}>
                {d.commonCancel}
              </Button>
            </div>
          </div>
        </Card>
      ) : null}

      <Card title={d.accountingLines}>
        <DataTable
          columns={[
            {
              id: "no",
              header: activeLocaleHeader("#"),
              accessor: (row) => String(row.lineNo ?? ""),
              render: (row) => <span className="font-mono text-xs">{row.lineNo}</span>,
            },
            {
              id: "account",
              header: activeLocaleHeader(d.accountingAccount),
              accessor: (row) => accountCodeOf(row.accountId),
              render: (row) => (
                <span className="font-mono text-sm" dir="ltr">{accountCodeOf(row.accountId)}</span>
              ),
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
              id: "memo",
              header: activeLocaleHeader(d.accountingMemo),
              accessor: (row) => row.memo ?? "",
              render: (row) => row.memo ?? "—",
            },
          ]}
          rows={
            posted !== null
              ? [...posted.lines]
              : [...draftLines.map((line, index) => ({ ...line, lineNo: index + 1, id: `${index}` }))]
          }
          rowKey={(row) => `${row.lineNo}-${row.accountId}`}
        />
        <p className="mt-2 text-xs text-muted-foreground" dir="ltr">
          Σ {d.accountingColDebit}: {totals.debit} · Σ {d.accountingColCredit}: {totals.credit} ·{" "}
          {totals.debit === totals.credit ? d.accountingBalanced : d.accountingUnbalanced}
        </p>
      </Card>

      {posted !== null ? (
        <Card title={d.accountingSource}>
          <p className="text-sm">
            <span className="font-mono text-xs" dir="ltr">
              {posted.entry.sourceType}
              {posted.entry.sourceId === null ? "" : ` · ${posted.entry.sourceId}`}
            </span>
          </p>
          {posted.entry.reversalOfId !== null || posted.entry.reversedById !== null ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {posted.entry.reversalOfId !== null ? (
                <Badge tone="neutral">{`↩ ${posted.entry.reversalOfId.slice(0, 8)}`}</Badge>
              ) : null}
              {posted.entry.reversedById !== null ? (
                <Badge tone="neutral">{`↪ ${posted.entry.reversedById.slice(0, 8)}`}</Badge>
              ) : null}
            </div>
          ) : null}
        </Card>
      ) : isDraftFamily ? (
        <InfoNotice>{d.obPostReadyNote}</InfoNotice>
      ) : null}
    </div>
  );
}
