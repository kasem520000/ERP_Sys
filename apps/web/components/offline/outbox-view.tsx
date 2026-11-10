"use client";
/**
 * PHASE-021 T2-b · the outbox / rejection queue view (DR-P21-06/§6 +
 * CONFLICT_RESOLUTION §3 — the FULL action table): every outbox row with
 * its honest status, the official number on ACCEPTED rows, and the typed
 * rejection payload rendered exactly as the server sent it. Each REJECTED
 * row offers exactly its §3 action set; every user choice is audit-logged
 * (local_events) by the console's onChoose and its effect applied —
 * resends go through the enqueue path (NEW commandId + fresh
 * idempotencyKey, same entity id), cancels mark the draft CANCELLED_LOCAL.
 */
import { useState } from "react";
import type { JSX } from "react";

import { Button } from "@erp/ui";

import { formatMessage } from "../../lib/messages";
import { getDictionary, type Dictionary, type Locale } from "../../i18n/dictionaries";
import type { DraftRowView, OutboxRowView } from "../../lib/shell/store-client";
import { OutboxStatusBadge } from "./honest-state-badge";
import {
  availableQtyFromDetails,
  isAdministrative,
  parseTypedRejection,
  rejectionActionsFor,
  rejectionLabelKeys,
  serverPriceFromDetails,
  type RejectionActionId,
} from "./rejection-actions";

export interface OutboxChoiceInput {
  /** The modified payload for direct resends (accept-server-price / accept-partial). */
  readonly payload?: Record<string, unknown>;
  readonly serverPrice?: string;
  readonly availableQty?: string;
}

export interface OutboxViewProps {
  locale: Locale;
  rows: readonly OutboxRowView[];
  drafts: readonly DraftRowView[];
  busy: boolean;
  /** The console's §3 executor: appends the local_events row + applies the effect. */
  onChoose: (row: OutboxRowView, action: RejectionActionId, input?: OutboxChoiceInput) => Promise<void>;
}

interface RowNote {
  readonly text: string;
}

function findDraft(drafts: readonly DraftRowView[], row: OutboxRowView): DraftRowView | null {
  return drafts.find((draft) => draft.commandId === row.commandId) ?? null;
}

/** The line index a PRICE_CHANGED / INSUFFICIENT_STOCK detail points at
 * (details.lineIndex → lineNo); single-line payloads default to 0. */
function detailLineIndex(details: Record<string, unknown> | null): number | null {
  if (details === null) return null;
  for (const key of ["lineIndex", "lineNo", "line"]) {
    const value = details[key];
    if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
  }
  return null;
}

export function OutboxView({ locale, rows, drafts, busy, onChoose }: OutboxViewProps): JSX.Element {
  const d = getDictionary(locale);
  const [notes, setNotes] = useState<Record<string, RowNote>>({});
  const [diffOpen, setDiffOpen] = useState<Record<string, boolean>>({});
  const [pending, setPending] = useState<string | null>(null);

  if (rows.length === 0) {
    return (
      <section lang={locale} dir={locale === "ar" ? "rtl" : "ltr"} className="flex flex-col gap-3">
        <h2 className="text-md font-semibold text-gray-900">{d.offlineOutboxTitle}</h2>
        <p className="text-sm text-gray-600">{d.offlineOutboxIntro}</p>
        <p className="rounded-md border border-subtle bg-surface-card p-3 text-sm text-gray-600">
          {d.offlineOutboxEmpty}
        </p>
      </section>
    );
  }

  const sorted = [...rows].sort((a, b) => b.clientCreatedAt.localeCompare(a.clientCreatedAt));

  async function choose(
    row: OutboxRowView,
    action: RejectionActionId,
    input?: OutboxChoiceInput,
    noteText?: string,
  ): Promise<void> {
    setPending(row.commandId);
    try {
      await onChoose(row, action, input);
      if (noteText !== undefined) {
        setNotes((prev) => ({ ...prev, [row.commandId]: { text: noteText } }));
      }
    } finally {
      setPending(null);
    }
  }

  return (
    <section lang={locale} dir={locale === "ar" ? "rtl" : "ltr"} className="flex flex-col gap-3">
      <h2 className="text-md font-semibold text-gray-900">{d.offlineOutboxTitle}</h2>
      <p className="text-sm text-gray-600">{d.offlineOutboxIntro}</p>
      <ul className="flex flex-col gap-3">
        {sorted.map((row) => {
          const draft = findDraft(drafts, row);
          const typed = parseTypedRejection(row.lastError, row.rejectionReason);
          const { labelKey, meaningKey } = rejectionLabelKeys(typed.reason);
          const isRejected = row.status === "REJECTED";
          const admin = isRejected && isAdministrative(typed.reason);
          const note = notes[row.commandId];
          const rowBusy = busy || pending === row.commandId;
          return (
            <li key={row.commandId} className="flex flex-col gap-2 rounded-lg border border-subtle bg-surface-card p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span dir="ltr" className="font-mono text-sm text-gray-900">
                  {row.entityType}:{row.intent}
                </span>
                <OutboxStatusBadge locale={locale} status={row.status} />
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600">
                <span dir="ltr" className="font-mono">
                  {row.commandId.slice(0, 13)}…
                </span>
                <span dir="ltr" className="font-mono">
                  {row.clientCreatedAt}
                </span>
                {row.officialNo !== null && (
                  <span dir="ltr" className="font-mono font-semibold text-success-text">
                    {formatMessage(d.offlineOutboxOfficialNo, { no: row.officialNo })}
                  </span>
                )}
              </div>

              {isRejected && (
                <div
                  className="flex flex-col gap-2 rounded-md border border-danger-border bg-danger-bg p-3"
                  role="alert"
                >
                  <span className="text-sm font-semibold text-danger-text">{d[labelKey]}</span>
                  <span className="text-sm text-gray-700">{d[meaningKey]}</span>
                  {typed.message !== null && typed.message.length > 0 && (
                    <span dir="ltr" className="font-mono text-xs text-gray-700">
                      {typed.message}
                    </span>
                  )}
                  {typed.traceId !== null && (
                    <span dir="ltr" className="font-mono text-xs text-gray-500">
                      trace: {typed.traceId}
                    </span>
                  )}
                  <details>
                    <summary className="cursor-pointer text-xs text-gray-700 underline-offset-2">
                      {d.offlineOutboxServerResponse}
                    </summary>
                    <pre dir="ltr" className="mt-1 overflow-x-auto rounded bg-surface-card p-2 font-mono text-xs text-gray-700">
                      {JSON.stringify({ ...typed, details: typed.details }, null, 2)}
                    </pre>
                  </details>

                  {admin ? (
                    <p className="text-sm font-medium text-danger-text">{d.offlineRejAdminNote}</p>
                  ) : (
                    <RejectionActionRow
                      d={d}
                      locale={locale}
                      row={row}
                      draft={draft}
                      typedPayload={parseRowPayload(row)}
                      typedReason={typed.reason}
                      details={typed.details}
                      busy={rowBusy}
                      diffOpen={diffOpen[row.commandId] === true}
                      onToggleDiff={() =>
                        setDiffOpen((prev) => ({ ...prev, [row.commandId]: !(prev[row.commandId] === true) }))
                      }
                      onChoose={choose}
                      draftPayloadText={draft !== null ? draft.payload : null}
                    />
                  )}
                </div>
              )}

              {note !== undefined && (
                <p role="status" className="rounded-md border border-success-border bg-success-bg px-3 py-2 text-sm text-success-text">
                  {note.text}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function parseRowPayload(row: OutboxRowView): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(row.payload);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      const record = parsed as Record<string, unknown>;
      // DR-P21-3b-1: the column carries the FULL v2 envelope; the business
      // payload rides inside it. Older rows (pre-fix) stored the bare
      // payload — the compat unwrap serves both shapes.
      const inner = record.payload;
      if (typeof inner === "object" && inner !== null && !Array.isArray(inner)) {
        return inner as Record<string, unknown>;
      }
      return record;
    }
    return null;
  } catch {
    return null;
  }
}

function RejectionActionRow({
  d,
  locale,
  row,
  draft,
  typedPayload,
  typedReason,
  details,
  busy,
  diffOpen,
  onToggleDiff,
  onChoose,
  draftPayloadText,
}: {
  d: Dictionary;
  locale: Locale;
  row: OutboxRowView;
  draft: DraftRowView | null;
  typedPayload: Record<string, unknown> | null;
  typedReason: string;
  details: Record<string, unknown> | null;
  busy: boolean;
  diffOpen: boolean;
  onToggleDiff: () => void;
  onChoose: (
    row: OutboxRowView,
    action: RejectionActionId,
    input?: OutboxChoiceInput,
    noteText?: string,
  ) => Promise<void>;
  draftPayloadText: string | null;
}): JSX.Element {
  const actions = rejectionActionsFor(typedReason);
  const payloadLines = Array.isArray(typedPayload?.lines) ? (typedPayload?.lines as Record<string, unknown>[]) : null;
  const lineIndex = detailLineIndex(details);
  const usableLineIndex = lineIndex !== null ? lineIndex : payloadLines !== null && payloadLines.length === 1 ? 0 : null;
  const serverPrice = serverPriceFromDetails(details);
  const availableQty = availableQtyFromDetails(details);
  const canDirectPrice = serverPrice !== null && usableLineIndex !== null && payloadLines !== null;
  const canDirectPartial = availableQty !== null && usableLineIndex !== null && payloadLines !== null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {actions.map((action) => {
          const label = d[action.labelKey];
          if (action.id === "review_and_merge") {
            return (
              <Button key={action.id} type="button" variant="secondary" onClick={onToggleDiff} disabled={busy}>
                {label}
              </Button>
            );
          }
          if (action.id === "edit_and_resend" || action.id === "substitute_and_resend") {
            return (
              <Button
                key={action.id}
                type="button"
                variant="secondary"
                disabled={busy || draft === null}
                aria-label={draft === null ? d.offlineOutboxNoDraft : undefined}
                onClick={() => {
                  void onChoose(row, action.id);
                }}
              >
                {label}
              </Button>
            );
          }
          if (action.id === "accept_server_price") {
            return (
              <Button
                key={action.id}
                type="button"
                variant="secondary"
                disabled={busy || !canDirectPrice}
                aria-label={canDirectPrice ? undefined : d.offlineActionUnavailable}
                onClick={() => {
                  if (!canDirectPrice || payloadLines === null || serverPrice === null || usableLineIndex === null) return;
                  const nextLines = payloadLines.map((line, index) =>
                    index === usableLineIndex ? { ...line, unitPrice: serverPrice } : line,
                  );
                  const payload: Record<string, unknown> = { ...(typedPayload ?? {}), lines: nextLines };
                  void onChoose(
                    row,
                    action.id,
                    { payload, serverPrice },
                    `${formatMessage(d.offlineEffectAcceptPrice, { price: serverPrice })} ${d.offlineChoiceRecorded}`,
                  );
                }}
              >
                {label}
              </Button>
            );
          }
          if (action.id === "accept_partial") {
            return (
              <Button
                key={action.id}
                type="button"
                variant="secondary"
                disabled={busy || !canDirectPartial}
                aria-label={canDirectPartial ? undefined : d.offlineActionUnavailable}
                onClick={() => {
                  if (!canDirectPartial || payloadLines === null || availableQty === null || usableLineIndex === null) return;
                  const nextLines = payloadLines.map((line, index) =>
                    index === usableLineIndex ? { ...line, qty: availableQty } : line,
                  );
                  const payload: Record<string, unknown> = { ...(typedPayload ?? {}), lines: nextLines };
                  void onChoose(
                    row,
                    action.id,
                    { payload, availableQty },
                    `${formatMessage(d.offlineEffectAcceptPartial, { qty: availableQty })} ${d.offlineChoiceRecorded}`,
                  );
                }}
              >
                {label}
              </Button>
            );
          }
          if (action.id === "request_approval_online") {
            return (
              <Button
                key={action.id}
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  void onChoose(row, action.id, undefined, `${d.offlineEffectApproval} ${d.offlineChoiceRecorded}`);
                }}
              >
                {label}
              </Button>
            );
          }
          // cancel / discard
          return (
            <Button
              key={action.id}
              type="button"
              variant="secondary"
              disabled={busy || (action.id === "discard" && draft === null)}
              aria-label={action.id === "discard" && draft === null ? d.offlineOutboxNoDraft : undefined}
              onClick={() => {
                void onChoose(
                  row,
                  action.id,
                  undefined,
                  action.id === "discard"
                    ? `${d.offlineEffectDiscard} ${d.offlineChoiceRecorded}`
                    : d.offlineChoiceRecorded,
                );
              }}
            >
              {label}
            </Button>
          );
        })}
      </div>

      {diffOpen && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" dir={locale === "ar" ? "rtl" : "ltr"}>
          <div className="rounded-md border border-subtle bg-surface-card p-2">
            <span className="text-xs font-semibold text-gray-800">{d.offlineDiffServerRow}</span>
            <pre dir="ltr" className="mt-1 overflow-x-auto font-mono text-xs text-gray-700">
              {JSON.stringify(details?.currentRow ?? details ?? {}, null, 2)}
            </pre>
          </div>
          <div className="rounded-md border border-subtle bg-surface-card p-2">
            <span className="text-xs font-semibold text-gray-800">{d.offlineDiffLocalRow}</span>
            <pre dir="ltr" className="mt-1 overflow-x-auto font-mono text-xs text-gray-700">
              {draftPayloadText ?? row.payload}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
