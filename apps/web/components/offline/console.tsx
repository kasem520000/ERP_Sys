"use client";
/**
 * PHASE-021 T2-b · the Offline Console (DR-P21-06 / MASTER-PLAN §6 — the
 * phase's UI centerpiece). 100% bridge-driven: reads through
 * lib/shell/store-client (async bridge.sql), writes through the enqueue
 * path (outbox FIRST, then the draft projection), sync control through
 * the optional bridge.sync member (DR-P21-09). The 9 OFFLINE-DRAFT tabs
 * (matrix rows 6/7/10/11/21/23/25/26/34), the FULL CONFLICT_RESOLUTION
 * §3 rejection action table, cached reads with as-of labels, reprint from
 * cache, and the honest-state banners (read-only / revoked / corrupt).
 * Browser mode renders ONLINE-ONLY states everywhere — never a queue,
 * never a simulation.
 */
import { useCallback, useEffect, useState } from "react";
import type { JSX } from "react";

import { Button, Tabs } from "@erp/ui";
import { generateUuidV7 } from "@erp/domain-core";

import { getDictionary, type Locale } from "../../i18n/dictionaries";
import { useShell } from "../../lib/shell/bridge";
import {
  buildCashTransferCreateDraft,
  buildDeliveryNoteCreateDraft,
  buildDraftInvoiceCreate,
  buildExpenseCreate,
  buildPartnerContactMerge,
  buildPartnerCreate,
  buildQuotationCreateDraft,
  buildStockCountSubmitLines,
  buildStockTransferCreateDraft,
  type SyncCommandV2Envelope,
} from "../../lib/shell/builders";
import {
  appendLocalEvent,
  enqueueDraftCommand,
  readCachedCountSessions,
  readCachedItems,
  readCachedPartners,
  readCachedTaxCodes,
  readDrafts,
  readOutbox,
  updateDraftStatus,
  type DraftDocType,
  type DraftRowView,
  type OutboxRowView,
} from "../../lib/shell/store-client";
import { useSyncMirror } from "../../lib/shell/sync-mirror";
import { AsOfLabel } from "./as-of-label";
import { CachedReads } from "./cached-reads";
import { ConnectivityDot } from "./connectivity-dot";
import { HonestStateBadge } from "./honest-state-badge";
import { OfflineBadge } from "./offline-badge";
import { OnlineOnlyDisabled } from "./online-only-disabled";
import { parseTypedRejection, type RejectionActionId } from "./rejection-actions";
import { OutboxView, type OutboxChoiceInput } from "./outbox-view";
import { SyncNowButton } from "./sync-now-button";
import { CashTransferForm } from "./forms/cash-transfer-form";
import { DeliveryNoteForm } from "./forms/delivery-note-form";
import { ExpenseForm } from "./forms/expense-form";
import { InvoiceDraftForm } from "./forms/invoice-draft-form";
import { PartnerContactForm } from "./forms/partner-contact-form";
import { PartnerCreateForm } from "./forms/partner-create-form";
import { QuotationForm } from "./forms/quotation-form";
import { StockCountForm } from "./forms/stock-count-form";
import { StockTransferForm } from "./forms/stock-transfer-form";
import type { ConsoleOptions, EditingDraft } from "./forms/options";

const TAB_IDS: readonly DraftDocType[] = [
  "sales_invoice_draft",
  "quotation_draft",
  "delivery_note",
  "stock_count_lines",
  "partner_contact_merge",
  "partner_create",
  "expense",
  "cash_transfer",
  "stock_transfer",
];

function tabLabelKey(docType: DraftDocType): keyof ReturnType<typeof getDictionary> {
  switch (docType) {
    case "sales_invoice_draft":
      return "offlineTabInvoice";
    case "quotation_draft":
      return "offlineTabQuotation";
    case "delivery_note":
      return "offlineTabDelivery";
    case "stock_count_lines":
      return "offlineTabStockCount";
    case "partner_contact_merge":
      return "offlineTabPartnerContact";
    case "partner_create":
      return "offlineTabPartnerCreate";
    case "expense":
      return "offlineTabExpense";
    case "cash_transfer":
      return "offlineTabCashTransfer";
    case "stock_transfer":
      return "offlineTabStockTransfer";
  }
}

function docTypeFor(row: OutboxRowView): DraftDocType | null {
  const key = `${row.entityType}:${row.intent}`;
  switch (key) {
    case "sales_invoice:create_draft":
      return "sales_invoice_draft";
    case "quotation:create_draft":
      return "quotation_draft";
    case "delivery_note:create_draft":
      return "delivery_note";
    case "stock_count:submit_lines":
      return "stock_count_lines";
    case "partner:contact_merge":
      return "partner_contact_merge";
    case "partner:create":
      return "partner_create";
    case "expense:create":
      return "expense";
    case "cash_transfer:create_draft":
      return "cash_transfer";
    case "stock_transfer:create_draft":
      return "stock_transfer";
    default:
      return null;
  }
}

/** Direct resend: rebuild the command for a known intent from a modified
 * payload. Foreign intents (pos_sale, cashier_shift, …) return null. */
function buildFor(row: OutboxRowView, payload: Record<string, unknown>): SyncCommandV2Envelope | null {
  const key = `${row.entityType}:${row.intent}`;
  switch (key) {
    case "sales_invoice:create_draft":
      return buildDraftInvoiceCreate(payload as Parameters<typeof buildDraftInvoiceCreate>[0]);
    case "quotation:create_draft":
      return buildQuotationCreateDraft(payload as Parameters<typeof buildQuotationCreateDraft>[0]);
    case "delivery_note:create_draft":
      return buildDeliveryNoteCreateDraft(payload as Parameters<typeof buildDeliveryNoteCreateDraft>[0]);
    case "stock_count:submit_lines":
      return buildStockCountSubmitLines(payload as Parameters<typeof buildStockCountSubmitLines>[0]);
    case "partner:contact_merge": {
      const { partnerId, ...fields } = payload as Record<string, string>;
      if (typeof partnerId !== "string") return null;
      return buildPartnerContactMerge(partnerId, fields);
    }
    case "partner:create":
      return buildPartnerCreate(payload as Parameters<typeof buildPartnerCreate>[0]);
    case "expense:create":
      return buildExpenseCreate(payload as Parameters<typeof buildExpenseCreate>[0]);
    case "cash_transfer:create_draft":
      return buildCashTransferCreateDraft(payload as Parameters<typeof buildCashTransferCreateDraft>[0]);
    case "stock_transfer:create_draft":
      return buildStockTransferCreateDraft(payload as Parameters<typeof buildStockTransferCreateDraft>[0]);
    default:
      return null;
  }
}

export function OfflineConsole({ locale }: { locale: Locale }): JSX.Element {
  const d = getDictionary(locale);
  const { bridge, capabilities, online, mode } = useShell();
  const mirror = useSyncMirror();
  const [tab, setTab] = useState<DraftDocType>("sales_invoice_draft");
  const [editing, setEditing] = useState<EditingDraft | null>(null);
  const [outboxRows, setOutboxRows] = useState<readonly OutboxRowView[]>([]);
  const [drafts, setDrafts] = useState<readonly DraftRowView[]>([]);
  const [options, setOptions] = useState<ConsoleOptions>({
    items: [],
    partners: [],
    taxCodes: [],
    countSessions: [],
  });

  const storeUsable = bridge !== null && bridge.capabilities.sqlite === true;
  const gateClosed =
    mirror.state.phase === "read-only" || mirror.state.phase === "revoked" || mirror.state.phase === "corrupt";

  const reload = useCallback(async (): Promise<void> => {
    if (bridge === null || bridge.capabilities.sqlite !== true) return;
    const [rows, nextDrafts, items, partners, taxCodes, countSessions] = await Promise.all([
      readOutbox(bridge),
      readDrafts(bridge),
      readCachedItems(bridge),
      readCachedPartners(bridge),
      readCachedTaxCodes(bridge),
      readCachedCountSessions(bridge),
    ]);
    setOutboxRows(rows);
    setDrafts(nextDrafts);
    setOptions({ items, partners, taxCodes, countSessions });
  }, [bridge]);

  useEffect(() => {
    void reload();
  }, [reload, mirror.state.version]);

  /** After a draft lands in the queue: refresh the mirror (which also
   * reconciles projections) and fire the post-write fast push when the
   * shell driver is available (MASTER-PLAN §6). */
  const afterEnqueue = useCallback(async (): Promise<void> => {
    await mirror.refresh();
    if (mirror.syncAvailable) {
      await mirror.triggerPushNow();
    }
  }, [mirror]);

  /** The §3 executor: audit-log the choice, then apply its effect. */
  const choose = useCallback(
    async (
      row: OutboxRowView,
      action: RejectionActionId,
      input?: OutboxChoiceInput,
    ): Promise<void> => {
      if (bridge === null) return;
      const typed = parseTypedRejection(row.lastError, row.rejectionReason);
      const draftRow = drafts.find((candidate) => candidate.commandId === row.commandId) ?? null;
      let eventPayload: unknown = input?.payload ?? null;
      if (eventPayload === null) {
        try {
          eventPayload = JSON.parse(row.payload);
        } catch {
          eventPayload = null;
        }
      }
      await appendLocalEvent(bridge, {
        kind: "rejection_choice",
        choice: action,
        reason: typed.reason,
        traceId: typed.traceId,
        commandId: row.commandId,
        payload: eventPayload,
        at: new Date().toISOString(),
      });

      if (action === "edit_and_resend" || action === "substitute_and_resend") {
        if (draftRow !== null) {
          setEditing({ draft: draftRow, row });
          setTab(draftRow.docType);
        }
      } else if (action === "accept_server_price" || action === "accept_partial") {
        const payload = input?.payload;
        if (payload !== undefined) {
          const command = buildFor(row, payload);
          if (command !== null) {
            await enqueueDraftCommand(bridge, command, {
              localId: draftRow?.localId ?? generateUuidV7(),
              docType: docTypeFor(row) ?? "expense",
              entityId: draftRow?.entityId ?? null,
              payload,
              initialStatus: row.intent === "contact_merge" ? "PENDING_MERGE" : "DRAFT_LOCAL",
            });
          }
        }
      } else if (action === "cancel" || action === "discard") {
        if (draftRow !== null) {
          await updateDraftStatus(bridge, draftRow.localId, "CANCELLED_LOCAL", typed.reason);
        }
      }
      // request_approval_online: the event IS the effect (collect the
      // prepayment via an online receipt, then edit & resend).
      await mirror.refresh();
    },
    [bridge, drafts, mirror],
  );

  const tabItems = TAB_IDS.map((docType) => ({
    value: docType,
    label: d[tabLabelKey(docType)],
  }));

  const draftsForTab = drafts.filter((draft) => draft.docType === tab);

  return (
    <div lang={locale} dir={locale === "ar" ? "rtl" : "ltr"} className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <h1 className="text-xl font-semibold text-gray-900">{d.offlineConsoleTitle}</h1>
        <p className="max-w-3xl text-sm leading-6 text-gray-700">{d.offlineConsoleIntro}</p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <ConnectivityDot locale={locale} online={online} />
          <OfflineBadge locale={locale} phase={mirror.state.phase} queueDepth={mirror.state.queueDepth} />
          <AsOfLabel locale={locale} asOf={mirror.state.lastSyncAt} />
          <span className="flex flex-wrap items-center gap-2">
            <SyncNowButton
              locale={locale}
              variant="sync"
              available={mirror.syncAvailable}
              busy={mirror.state.phase === "syncing"}
              onClick={() => {
                void mirror.triggerSyncNow();
              }}
            />
            <SyncNowButton
              locale={locale}
              variant="push"
              available={mirror.syncAvailable}
              busy={mirror.state.phase === "syncing"}
              disabled={mirror.state.queueDepth === 0}
              onClick={() => {
                void mirror.triggerPushNow();
              }}
            />
          </span>
        </div>
      </div>

      {mirror.state.phase === "read-only" && (
        <HonestBanner
          locale={locale}
          tone="warning"
          text={d.offlineBannerReadOnly}
          action={
            capabilities.updater ? (
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  void bridge?.updater.checkNow();
                }}
              >
                {d.offlineUpdateAction}
              </Button>
            ) : undefined
          }
          prompt={d.offlineUpdatePrompt}
        />
      )}
      {mirror.state.phase === "revoked" && (
        <HonestBanner locale={locale} tone="danger" text={d.offlineBannerRevoked} />
      )}
      {mirror.state.phase === "corrupt" && (
        <HonestBanner locale={locale} tone="danger" text={d.offlineBannerCorrupt} />
      )}

      <Tabs
        items={tabItems}
        value={tab}
        onValueChange={(value) => {
          setTab(value as DraftDocType);
          if (editing !== null && editing.draft.docType !== (value as DraftDocType)) {
            setEditing(null);
          }
        }}
      >
        {TAB_IDS.map((docType) => (
          <div key={docType} data-slot={docType} className="flex flex-col gap-4">
            {mode === "browser" ? (
              <OnlineOnlyDisabled locale={locale} reason={d.offlineReasonBrowser} />
            ) : !storeUsable ? (
              <OnlineOnlyDisabled locale={locale} reason={d.offlineReasonNoStore} />
            ) : gateClosed ? (
              <OnlineOnlyDisabled locale={locale} reason={d.offlineReadOnlyGate} />
            ) : (
              <>
                {docType === "sales_invoice_draft" && (
                  <InvoiceDraftForm
                    locale={locale}
                    bridge={bridge}
                    options={options}
                    onEnqueued={afterEnqueue}
                    editing={editing !== null && editing.draft.docType === docType ? editing : null}
                  />
                )}
                {docType === "quotation_draft" && (
                  <QuotationForm
                    locale={locale}
                    bridge={bridge}
                    options={options}
                    onEnqueued={afterEnqueue}
                    editing={editing !== null && editing.draft.docType === docType ? editing : null}
                  />
                )}
                {docType === "delivery_note" && (
                  <DeliveryNoteForm
                    locale={locale}
                    bridge={bridge}
                    options={options}
                    onEnqueued={afterEnqueue}
                    editing={editing !== null && editing.draft.docType === docType ? editing : null}
                  />
                )}
                {docType === "stock_count_lines" && (
                  <StockCountForm
                    locale={locale}
                    bridge={bridge}
                    options={options}
                    onEnqueued={afterEnqueue}
                    editing={editing !== null && editing.draft.docType === docType ? editing : null}
                  />
                )}
                {docType === "partner_contact_merge" && (
                  <PartnerContactForm
                    locale={locale}
                    bridge={bridge}
                    options={options}
                    onEnqueued={afterEnqueue}
                    editing={editing !== null && editing.draft.docType === docType ? editing : null}
                  />
                )}
                {docType === "partner_create" && (
                  <PartnerCreateForm
                    locale={locale}
                    bridge={bridge}
                    options={options}
                    onEnqueued={afterEnqueue}
                    editing={editing !== null && editing.draft.docType === docType ? editing : null}
                  />
                )}
                {docType === "expense" && (
                  <ExpenseForm
                    locale={locale}
                    bridge={bridge}
                    options={options}
                    onEnqueued={afterEnqueue}
                    editing={editing !== null && editing.draft.docType === docType ? editing : null}
                  />
                )}
                {docType === "cash_transfer" && (
                  <CashTransferForm
                    locale={locale}
                    bridge={bridge}
                    options={options}
                    onEnqueued={afterEnqueue}
                    editing={editing !== null && editing.draft.docType === docType ? editing : null}
                  />
                )}
                {docType === "stock_transfer" && (
                  <StockTransferForm
                    locale={locale}
                    bridge={bridge}
                    options={options}
                    onEnqueued={afterEnqueue}
                    editing={editing !== null && editing.draft.docType === docType ? editing : null}
                  />
                )}
              </>
            )}
          </div>
        ))}
      </Tabs>

      {storeUsable && draftsForTab.length > 0 && (
        <section aria-label={d.offlineLinesTitle} className="flex flex-col gap-2">
          <ul className="flex flex-wrap gap-2">
            {draftsForTab.map((draft) => (
              <li key={draft.localId} className="flex items-center gap-2 rounded-md border border-subtle bg-surface-card px-3 py-2">
                <HonestStateBadge locale={locale} status={draft.localStatus} />
                <span dir="ltr" className="font-mono text-xs text-gray-500">
                  {draft.updatedAt}
                </span>
                {draft.rejection !== null && (
                  <span className="text-xs text-danger-text">{draft.rejection}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {storeUsable && (
        <OutboxView locale={locale} rows={outboxRows} drafts={drafts} busy={false} onChoose={choose} />
      )}
      <CachedReads locale={locale} bridge={bridge} reloadKey={mirror.state.version} canPrint={capabilities.print} />
    </div>
  );
}

function HonestBanner({
  locale,
  tone,
  text,
  action,
  prompt,
}: {
  locale: Locale;
  tone: "warning" | "danger";
  text: string;
  action?: JSX.Element;
  prompt?: string;
}): JSX.Element {
  const toneClass =
    tone === "warning"
      ? "border-warning-border bg-warning-bg text-warning-text"
      : "border-danger-border bg-danger-bg text-danger-text";
  return (
    <div
      role="status"
      lang={locale}
      dir={locale === "ar" ? "rtl" : "ltr"}
      className={`flex flex-wrap items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm ${toneClass}`}
    >
      <span className="max-w-3xl leading-6">{text}</span>
      <span className="flex items-center gap-2">
        {prompt !== undefined && <span className="text-xs">{prompt}</span>}
        {action}
      </span>
    </div>
  );
}
