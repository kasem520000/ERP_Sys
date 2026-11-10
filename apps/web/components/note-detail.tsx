"use client";

/**
 * PHASE-027 (wave F) — note document detail (PAGE_ARCHETYPES §5, the
 * fixed-asset-detail pattern): the overview DefList, the CUSTODY TIMELINE
 * (note_events through the TimelinePanel — the new @erp/ui pattern), and
 * the state-machine actions. The legal-transition table mirrors the API's
 * custody machine (BR-047) client-side — endorse/deposit from IN_CUSTODY,
 * collect/dishonor/return from the live statuses, discount from
 * IN_CUSTODY/DEPOSITED; ISSUED notes take the mirrored subset — and the
 * permission keys hide buttons the session cannot use (the server remains
 * the enforcer). Money actions open a small dialog (cash accounts via the
 * treasury surface; the dishonor reason is required — BR-046).
 */
import { useState } from "react";
import type { JSX } from "react";

import {
  Badge,
  Button,
  Dialog,
  Input,
  MoneyInput,
  Select,
  TimelinePanel,
  formatMoneyDisplay,
  type TimelineItem,
  type TimelineTone,
} from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type {
  CashAccountRow,
  NoteDetailRow,
  NoteEventRow,
  NoteListRow,
  PartnerRow,
} from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import {
  formatMessage,
  localizedName,
  localizedNoteDirection,
  localizedNoteEvent,
  localizedNoteKind,
  localizedNoteStatus,
  localizedNotesError,
} from "../lib/messages";
import { Card } from "./card";
import { DefList } from "./def-list";
import { ErrorNotice, SuccessNotice } from "./notices";

/** The custody machine's legal sources per (direction, event) — BR-047. */
const LEGAL_SOURCES: Record<"RECEIVED" | "ISSUED", Partial<Record<CustodyAction, readonly string[]>>> = {
  RECEIVED: {
    endorse: ["IN_CUSTODY"],
    deposit: ["IN_CUSTODY"],
    collect: ["IN_CUSTODY", "ENDORSED_OUT", "DEPOSITED"],
    dishonor: ["IN_CUSTODY", "ENDORSED_OUT", "DEPOSITED"],
    discount: ["IN_CUSTODY", "DEPOSITED"],
    return: ["IN_CUSTODY", "ENDORSED_OUT", "DEPOSITED"],
  },
  ISSUED: {
    collect: ["IN_CUSTODY"],
    dishonor: ["IN_CUSTODY"],
    return: ["IN_CUSTODY"],
  },
};

type CustodyAction = "endorse" | "deposit" | "collect" | "dishonor" | "discount" | "return";

const ACTION_PERMISSIONS: Record<CustodyAction, string> = {
  endorse: "notes.notes.endorse",
  deposit: "notes.notes.deposit",
  collect: "notes.notes.deposit",
  dishonor: "notes.notes.record_dishonor",
  discount: "notes.notes.discount",
  return: "notes.notes.return",
};

/** Event kind → timeline tone (the custody machine's note_event_kind set;
 * RECLASSIFY is metadata-only — BR-047 — so it stays on the neutral trail). */
const EVENT_TONES: Record<string, TimelineTone> = {
  DEPOSIT: "default",
  ENDORSE: "default",
  COLLECT: "positive",
  DISHONOR: "critical",
  DISCOUNT: "warning",
  RETURN: "warning",
  RECLASSIFY: "default",
};
const EVENT_ICONS: Record<string, TimelineItem["icon"]> = {
  ENDORSE: "send",
  DEPOSIT: "landmark",
  COLLECT: "circle-check",
  DISHONOR: "warning",
  DISCOUNT: "banknote",
  RETURN: "corner-up-left",
  RECLASSIFY: "pencil",
};

export function NoteDetail({
  locale,
  detail,
  partner,
  cashAccounts,
  permissions,
  today,
}: {
  locale: Locale;
  detail: NoteDetailRow;
  partner: PartnerRow | null;
  cashAccounts: readonly CashAccountRow[];
  permissions: readonly string[];
  today: string;
}): JSX.Element {
  const d = getDictionary(locale);
  const [note, setNote] = useState<NoteListRow>(detail.note);
  const [events, setEvents] = useState<readonly NoteEventRow[]>(detail.events);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // -- dialog state (one open action at a time) --------------------------------
  const [dialog, setDialog] = useState<CustodyAction | null>(null);
  const [eventDate, setEventDate] = useState(today);
  const [memo, setMemo] = useState("");
  const [endorsee, setEndorsee] = useState("");
  const [cashAccountId, setCashAccountId] = useState("");
  const [exchangeRate, setExchangeRate] = useState("");
  const [reason, setReason] = useState("");
  const [bankFee, setBankFee] = useState("");
  const [fee, setFee] = useState("");

  const accountOptions = cashAccounts
    .filter((account) => account.status === "ACTIVE")
    .map((account) => ({
      value: account.id,
      label: `${localizedName(account.name, account.nameAr, locale)} · ${account.currencyCode}`,
    }));

  const legalFor = (action: CustodyAction): boolean => {
    const sources = LEGAL_SOURCES[note.direction][action];
    if (sources === undefined) {
      return false;
    }
    return sources.includes(note.status) && permissions.includes(ACTION_PERMISSIONS[action]);
  };

  const timelineItems: TimelineItem[] = events.map((event) => ({
    date: event.eventDate,
    kind: event.eventKind,
    title: localizedNoteEvent(d, event.eventKind),
    subtitle:
      localizedName(event.memo ?? "", event.memoAr, locale) === "" && event.journalEntryId === null
        ? undefined
        : [
            localizedName(event.memo ?? "", event.memoAr, locale),
            event.journalEntryId === null ? undefined : `${d.notesJournalEntry}: ${event.journalEntryId}`,
          ]
            .filter((part) => part !== undefined && part !== "")
            .join(" · "),
    tone: EVENT_TONES[event.eventKind],
    icon: EVENT_ICONS[event.eventKind],
  }));

  async function refresh(): Promise<void> {
    const refreshed = await bffFetch<NoteDetailRow>(`notes/${note.id}`);
    if (refreshed.ok) {
      setNote(refreshed.data.note);
      setEvents(refreshed.data.events);
    }
  }

  function closeDialog(): void {
    setDialog(null);
    setMemo("");
    setEndorsee("");
    setCashAccountId("");
    setExchangeRate("");
    setReason("");
    setBankFee("");
    setFee("");
    setEventDate(today);
  }

  async function run(action: CustodyAction): Promise<void> {
    setError(null);
    setNotice(null);
    // Client-side mirrors of the typed server validations (the server
    // remains the enforcer — these only prevent the obvious 422s).
    if (action === "dishonor" && reason.trim() === "") {
      setError(d.notesActionReasonHint);
      return;
    }
    if ((action === "deposit" || action === "discount") && cashAccountId === "") {
      setError(d.notesErrAccountRequired);
      return;
    }
    if (action === "discount" && fee.trim() === "") {
      setError(d.notesErrFeeInvalid);
      return;
    }
    setBusy(action);
    const memoField = memo.trim() === "" ? null : memo.trim();
    const body: Record<string, unknown> = { eventDate, memo: memoField, memoAr: memoField };
    if (action === "endorse") {
      body.endorsee = endorsee.trim() === "" ? null : endorsee.trim();
    }
    if (action === "deposit" || action === "discount") {
      body.cashAccountId = cashAccountId;
    }
    if (action === "collect") {
      body.cashAccountId = cashAccountId === "" ? null : cashAccountId;
      body.exchangeRate = exchangeRate.trim() === "" ? undefined : exchangeRate.trim();
    }
    if (action === "dishonor") {
      body.reason = reason.trim();
      body.bankFee = bankFee.trim() === "" ? null : bankFee.trim();
      body.cashAccountId = cashAccountId === "" ? null : cashAccountId;
    }
    if (action === "discount") {
      body.fee = fee.trim();
    }
    const acted = await bffFetch<Record<string, unknown>>(`notes/${note.id}/${action}`, {
      method: "POST",
      body,
    });
    setBusy(null);
    if (!acted.ok) {
      setError(localizedNotesError(d, acted.error, acted.retryAfterSeconds));
      return;
    }
    const entry = typeof acted.data.journalEntryId === "string" ? acted.data.journalEntryId : null;
    const proceeds = typeof acted.data.proceeds === "string" ? acted.data.proceeds : null;
    const label =
      action === "endorse"
        ? d.notesEndorseToast
        : action === "deposit"
          ? d.notesDepositToast
          : action === "collect"
            ? d.notesCollectToast
            : action === "dishonor"
              ? d.notesDishonorToast
              : action === "discount"
                ? d.notesDiscountToast
                : d.notesReturnToast;
    setNotice(
      formatMessage(label, {
        entry: entry ?? "—",
        proceeds: proceeds === null ? "—" : formatMoneyDisplay(proceeds, 2),
      }),
    );
    closeDialog();
    await refresh();
  }

  const hasActions =
    legalFor("endorse") ||
    legalFor("deposit") ||
    legalFor("collect") ||
    legalFor("dishonor") ||
    legalFor("discount") ||
    legalFor("return");

  const partnerLabel =
    partner === null ? note.partnerId : localizedName(partner.name, partner.nameAr, locale);
  const accountLabel = (id: string | null): string => {
    if (id === null) {
      return "—";
    }
    const account = cashAccounts.find((row) => row.id === id);
    return account === undefined ? id : localizedName(account.name, account.nameAr, locale);
  };

  return (
    <div className="flex flex-col gap-4">
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
      {notice !== null && <SuccessNotice>{notice}</SuccessNotice>}

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Card
          title={d.notesOverviewTitle}
          actions={
            <Badge tone={note.status === "IN_CUSTODY" ? "primary" : "neutral"}>
              {localizedNoteStatus(d, note.status)}
            </Badge>
          }
        >
          <DefList
            items={[
              { term: d.notesFilterKind, children: localizedNoteKind(d, note.kind) },
              { term: d.notesFilterDirection, children: localizedNoteDirection(d, note.direction) },
              { term: d.notesFilterPartner, children: partnerLabel },
              {
                term: d.notesFormNumber,
                children:
                  note.number === null ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    <span className="font-mono text-sm" dir="ltr">
                      {note.number}
                    </span>
                  ),
              },
              {
                term: d.notesFormBank,
                children:
                  note.issuingBank === null || note.issuingBank === "" ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    note.issuingBank
                  ),
              },
              {
                term: d.notesFormAmount,
                children: (
                  <span className="font-mono tabular-nums" dir="ltr">
                    {formatMoneyDisplay(note.amount, 2)} {note.currency}
                  </span>
                ),
              },
              {
                term: d.notesFormRate,
                children: (
                  <span className="font-mono tabular-nums" dir="ltr">
                    {formatMoneyDisplay(note.exchangeRate, 4)}
                  </span>
                ),
              },
              {
                term: d.notesFormIssueDate,
                children:
                  note.issueDate === null ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    <span className="font-mono text-sm" dir="ltr">
                      {note.issueDate}
                    </span>
                  ),
              },
              {
                term: d.notesFormMaturityDate,
                children: (
                  <span className="font-mono text-sm" dir="ltr">
                    {note.maturityDate}
                  </span>
                ),
              },
              {
                term: d.notesSourceLabel,
                children:
                  note.sourceType === null ? (
                    <span className="text-muted-foreground">{d.notesFormSourceNone}</span>
                  ) : (
                    <span className="font-mono text-xs" dir="ltr">
                      {note.sourceType} · {note.sourceId}
                    </span>
                  ),
              },
              {
                term: d.notesCashAccountLabel,
                children: accountLabel(note.cashAccountId),
              },
              {
                term: d.notesJournalEntry,
                children:
                  note.journalEntryId === null ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    <span className="font-mono text-xs" dir="ltr">
                      {note.journalEntryId}
                    </span>
                  ),
              },
              { term: d.notesFormNote, children: note.note ?? <span className="text-muted-foreground">—</span> },
              { term: d.notesFormNoteAr, children: note.noteAr ?? <span className="text-muted-foreground">—</span> },
            ]}
          />
        </Card>

        <TimelinePanel
          locale={locale}
          title={d.notesCustodyTitle}
          items={timelineItems}
          emptyText={d.notesCustodyEmpty}
        />
      </div>

      <Card title={d.notesActionsTitle}>
        {hasActions ? (
          <div className="flex flex-wrap gap-2">
            {legalFor("endorse") && (
              <Button variant="secondary" onClick={() => setDialog("endorse")}>
                {d.notesActionEndorse}
              </Button>
            )}
            {legalFor("deposit") && (
              <Button variant="secondary" onClick={() => setDialog("deposit")}>
                {d.notesActionDeposit}
              </Button>
            )}
            {legalFor("collect") && (
              <Button variant="secondary" onClick={() => setDialog("collect")}>
                {d.notesActionCollect}
              </Button>
            )}
            {legalFor("dishonor") && (
              <Button variant="secondary" onClick={() => setDialog("dishonor")}>
                {d.notesActionDishonor}
              </Button>
            )}
            {legalFor("discount") && (
              <Button variant="secondary" onClick={() => setDialog("discount")}>
                {d.notesActionDiscount}
              </Button>
            )}
            {legalFor("return") && (
              <Button variant="secondary" onClick={() => setDialog("return")}>
                {d.notesActionReturn}
              </Button>
            )}
          </div>
        ) : (
          <p className="text-sm text-gray-600">{d.notesTerminalHint}</p>
        )}
      </Card>

      <Dialog
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open) {
            closeDialog();
          }
        }}
        title={
          dialog === "endorse"
            ? d.notesActionEndorse
            : dialog === "deposit"
              ? d.notesActionDeposit
              : dialog === "collect"
                ? d.notesActionCollect
                : dialog === "dishonor"
                  ? d.notesActionDishonor
                  : dialog === "discount"
                    ? d.notesActionDiscount
                    : d.notesActionReturn
        }
        size="sm"
      >
        <div className="flex flex-col gap-3">
          <Input
            id="note-action-date"
            label={d.notesActionDate}
            value={eventDate}
            onValueChange={setEventDate}
            placeholder="YYYY-MM-DD"
            mono
            bidiIsolate
            required
          />
          {dialog === "endorse" && (
            <Input
              id="note-action-endorsee"
              label={d.notesActionEndorsee}
              value={endorsee}
              onValueChange={setEndorsee}
            />
          )}
          {(dialog === "deposit" || dialog === "collect" || dialog === "discount" || dialog === "dishonor") && (
            <Select
              id="note-action-account"
              label={d.notesActionAccount}
              value={cashAccountId}
              onValueChange={setCashAccountId}
              options={[{ value: "", label: d.kindFilterAll }, ...accountOptions]}
              required={dialog === "deposit" || dialog === "discount"}
            />
          )}
          {dialog === "collect" && (
            <Input
              id="note-action-rate"
              label={d.notesActionRate}
              value={exchangeRate}
              onValueChange={setExchangeRate}
              hint={d.notesFormRateHint}
              mono
              bidiIsolate
            />
          )}
          {dialog === "dishonor" && (
            <>
              <Input
                id="note-action-reason"
                label={`${d.notesActionReason} (${d.notesActionReasonHint})`}
                value={reason}
                onValueChange={setReason}
                required
              />
              <MoneyInput
                id="note-action-bank-fee"
                label={d.notesActionBankFee}
                amount={bankFee}
                onAmountChange={setBankFee}
                currency={note.currency}
              />
            </>
          )}
          {dialog === "discount" && (
            <MoneyInput
              id="note-action-fee"
              label={d.notesActionFee}
              amount={fee}
              onAmountChange={setFee}
              currency={note.currency}
              required
            />
          )}
          <Input id="note-action-memo" label={d.notesFormNote} value={memo} onValueChange={setMemo} />
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={closeDialog}>
              {d.commonCancel}
            </Button>
            <Button
              variant="primary"
              onClick={() => dialog !== null && void run(dialog)}
              loading={busy !== null}
            >
              {d.commonConfirm}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
