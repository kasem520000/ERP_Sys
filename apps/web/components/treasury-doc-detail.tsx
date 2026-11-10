"use client";

/**
 * T14-UI (PHASE-008) — receipt/payment detail (document-detail archetype):
 * the DefList summary (doc no., dates, partner, method, counterparty,
 * amount + rate + FX, allocated vs on-account) with the lifecycle actions —
 * submit/approve/post (post mints the RCV/PYM number + the journal entry,
 * INV-021; the result notice shows both), reverse (date + reason — the
 * immutable-ledger correction path), cancel (reason). The allocation panel
 * below edits the INV-016 rows (PUT) while the document is still a DRAFT.
 */
import { useState } from "react";
import type { JSX } from "react";

import { Button, DocumentStatusBadge, Input, formatMoneyDisplay } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type {
  CashAccountRow,
  PartnerRow,
  SettlementPostResult,
  TreasuryDocRow,
} from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import {
  formatDateTime,
  formatMessage,
  localizedName,
  localizedDocumentStatus,
  localizedTreasuryError,
  localizedTreasuryMethod,
} from "../lib/messages";
import { subtractExact } from "../lib/exact-money";
import { Card } from "./card";
import { DefList } from "./def-list";
import { ErrorNotice, SuccessNotice } from "./notices";
import { TreasuryAllocationEditor } from "./treasury-allocation-editor";

export function TreasuryDocDetail({
  locale,
  kind,
  side,
  doc,
  cashAccounts,
  partners,
  canSubmit,
  canApprove,
}: {
  locale: Locale;
  /** "receipts" | "payments" — wire path + labels. */
  kind: "receipts" | "payments";
  side: "AR" | "AP";
  doc: TreasuryDocRow;
  cashAccounts: readonly CashAccountRow[];
  partners: readonly PartnerRow[];
  canSubmit: boolean;
  canApprove: boolean;
}): JSX.Element {
  const d = getDictionary(locale);
  const isReceipt = kind === "receipts";
  const [row, setRow] = useState<TreasuryDocRow>(doc);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [reverseDate, setReverseDate] = useState(new Date().toISOString().slice(0, 10));
  const [reverseReason, setReverseReason] = useState("");
  const [cancelReason, setCancelReason] = useState("");

  const account = cashAccounts.find((candidate) => candidate.id === row.cashAccountId);
  const partner = partners.find((candidate) => candidate.id === row.partnerId);
  const onAccount = subtractExact(row.amount, row.allocatedAmount);

  async function act(action: "submit" | "approve"): Promise<void> {
    setError(null);
    setNotice(null);
    setBusy(action);
    const result = await bffFetch<TreasuryDocRow>(`treasury/${kind}/${row.id}/${action}`, {
      method: "POST",
      body: {},
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedTreasuryError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setRow(result.data);
    setNotice(action === "approve" ? d.accountingApprove : d.accountingSubmit);
  }

  async function post(): Promise<void> {
    setError(null);
    setNotice(null);
    setBusy("post");
    const result = await bffFetch<SettlementPostResult>(`treasury/${kind}/${row.id}/post`, {
      method: "POST",
      body: {},
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedTreasuryError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setNotice(
      formatMessage(d.treasuryDocPostedToast, {
        no: result.data.docNo,
        entry: result.data.journalEntryNo ?? result.data.journalEntryId,
      }),
    );
    const refreshed = await bffFetch<TreasuryDocRow>(`treasury/${kind}/${row.id}`);
    if (refreshed.ok) {
      setRow(refreshed.data);
    }
  }

  async function reverse(): Promise<void> {
    setError(null);
    setNotice(null);
    setBusy("reverse");
    const result = await bffFetch<unknown>(`treasury/${kind}/${row.id}/reverse`, {
      method: "POST",
      body: { entryDate: reverseDate, reason: reverseReason.trim() },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedTreasuryError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setNotice(d.treasuryDocReverseToast);
    const refreshed = await bffFetch<TreasuryDocRow>(`treasury/${kind}/${row.id}`);
    if (refreshed.ok) {
      setRow(refreshed.data);
    }
  }

  async function cancel(): Promise<void> {
    setError(null);
    setNotice(null);
    setBusy("cancel");
    const result = await bffFetch<TreasuryDocRow>(`treasury/${kind}/${row.id}/cancel`, {
      method: "POST",
      body: { reason: cancelReason.trim() },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedTreasuryError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setRow(result.data);
    setNotice(d.treasuryDocCancelToast);
  }

  return (
    <div className="flex flex-col gap-4">
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
      {notice !== null && <SuccessNotice>{notice}</SuccessNotice>}

      <Card
        title={d.treasuryDocDetailTitle}
        actions={
          <DocumentStatusBadge
            status={row.status}
            label={localizedDocumentStatus(d, row.status)}
          />
        }
      >
        <DefList
          items={[
            {
              term: d.treasuryColDocNo,
              children:
                row.docNo === null ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  <span className="font-mono text-sm" dir="ltr">{row.docNo}</span>
                ),
            },
            {
              term: d.treasuryColValueDate,
              children: <span className="font-mono text-sm" dir="ltr">{row.valueDate}</span>,
            },
            {
              term: d.treasuryDocPartner,
              children:
                partner === undefined
                  ? row.partnerId
                  : partner.code === ""
                    ? localizedName(partner.name, partner.nameAr, locale)
                    : `${partner.code} · ${localizedName(partner.name, partner.nameAr, locale)}`,
            },
            {
              term: d.treasuryDocCashAccount,
              children:
                account === undefined
                  ? row.cashAccountId
                  : `${localizedName(account.name, account.nameAr, locale)} · ${account.accountCode}`,
            },
            {
              term: isReceipt ? d.treasuryColPayer : d.treasuryColPayee,
              children: row.counterpartyName ?? <span className="text-muted-foreground">—</span>,
            },
            { term: d.treasuryDocMethod, children: localizedTreasuryMethod(d, row.method) },
            {
              term: d.treasuryDocAmount,
              children: (
                <span className="font-mono tabular-nums" dir="ltr">
                  {formatMoneyDisplay(row.amount, 2)} {row.currencyCode}
                </span>
              ),
            },
            {
              term: d.treasuryDocRate,
              children:
                row.exchangeRate === null ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  <span className="font-mono tabular-nums" dir="ltr">{row.exchangeRate}</span>
                ),
            },
            {
              term: d.treasuryColAllocated,
              children: (
                <span className="font-mono tabular-nums" dir="ltr">
                  {formatMoneyDisplay(row.allocatedAmount, 2)}
                </span>
              ),
            },
            {
              term: d.treasuryDocOnAccount,
              children: (
                <span className="font-mono tabular-nums" dir="ltr">
                  {formatMoneyDisplay(onAccount, 2)}
                </span>
              ),
            },
            {
              term: d.treasuryColFx,
              children: (
                <span className="font-mono tabular-nums" dir="ltr">
                  {formatMoneyDisplay(row.fxGainLoss, 2)}
                </span>
              ),
            },
            {
              term: d.treasuryDocReference,
              children: row.reference ?? <span className="text-muted-foreground">—</span>,
            },
            {
              term: d.treasuryDocDescription,
              children:
                (locale === "ar" ? row.descriptionAr ?? row.description : row.description) ?? (
                  <span className="text-muted-foreground">—</span>
                ),
            },
            {
              term: d.accountingPostedAt,
              children: formatDateTime(row.createdAt, locale),
            },
          ]}
        />

        <div className="mt-4 flex flex-wrap items-center gap-2 border-t pt-4">
          {canSubmit && row.status === "DRAFT" && (
            <Button variant="secondary" onClick={() => void act("submit")} loading={busy === "submit"}>
              {d.accountingSubmit}
            </Button>
          )}
          {canApprove && row.status === "PENDING_APPROVAL" && (
            <Button variant="secondary" onClick={() => void act("approve")} loading={busy === "approve"}>
              {d.accountingApprove}
            </Button>
          )}
          {canApprove && (row.status === "DRAFT" || row.status === "APPROVED" || row.status === "POSTED") && (
            <Button variant="primary" onClick={() => void post()} loading={busy === "post"}>
              {d.accountingPost}
            </Button>
          )}
        </div>
      </Card>

      {row.status === "POSTED" && (
        <Card title={d.accountingReverse}>
          <div className="flex flex-col gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                label={d.treasuryDocReverseDate}
                value={reverseDate}
                onValueChange={setReverseDate}
                mono
                bidiIsolate
                required
              />
              <Input
                label={d.treasuryDocReverseReason}
                value={reverseReason}
                onValueChange={setReverseReason}
                required
              />
            </div>
            <div className="flex gap-2">
              <Button
                variant="primary"
                onClick={() => void reverse()}
                loading={busy === "reverse"}
                disabled={reverseReason.trim().length < 3}
              >
                {d.accountingReverse}
              </Button>
            </div>
          </div>
        </Card>
      )}

      {row.status === "DRAFT" && (
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
                onClick={() => void cancel()}
                loading={busy === "cancel"}
                disabled={cancelReason.trim().length < 3}
              >
                {d.accountingCancel}
              </Button>
            </div>
          </div>
        </Card>
      )}

      <TreasuryAllocationEditor
        locale={locale}
        docKind={kind}
        side={side}
        partnerId={row.partnerId}
        docId={row.id}
        amount={row.amount}
        currency={row.currencyCode}
        readOnly={row.status !== "DRAFT"}
      />
    </div>
  );
}
