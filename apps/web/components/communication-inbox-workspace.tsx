"use client";

/**
 * PHASE-041 T-10 — the /communication/inbox workspace (UX-14 + IN-16 +
 * TB-23 self plane; PAGE_ARCHETYPES §2 list-search archetype): three tabs.
 *
 * - Timeline: the unified per-partner message+call timeline with kind,
 *   channel, and direction filters (every send and logged call lands
 *   here — the outbound ledger's read surface).
 * - Log a call: the IN-16 manual entry (outcome + duration + notes linked
 *   to the partner and the logging user).
 * - My preferences: the caller's own module × channel matrix (TB-23) —
 *   opting out stops every send on that module×channel for this user.
 */
import { useState } from "react";
import type { FormEvent, JSX } from "react";

import { Badge, Button, Checkbox, DataTable, Input, Select, Tabs, Textarea, useToast } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type {
  CommunicationInboxEntry,
  CommunicationPreferenceRow,
  PartnerRow,
} from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { formatMessage, localizedApiError, localizedName } from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";

type InboxTab = "timeline" | "call" | "prefs";

const CHANNEL_FILTERS = ["EMAIL", "WHATSAPP", "SMS", "CALL"] as const;
const PREF_CHANNELS = ["IN_APP", "EMAIL", "SMS", "WHATSAPP"] as const;

type CallOutcome =
  | "COMPLETED"
  | "NO_ANSWER"
  | "BUSY"
  | "VOICEMAIL"
  | "FAILED"
  | "SCHEDULED";

function formatAt(iso: string): string {
  return new Date(iso).toLocaleString();
}

export function CommunicationInboxWorkspace({
  locale,
  partners,
  initialTimeline,
  initialPrefs,
}: {
  locale: Locale;
  partners: readonly PartnerRow[];
  initialTimeline: readonly CommunicationInboxEntry[];
  initialPrefs: readonly CommunicationPreferenceRow[];
}): JSX.Element {
  const d = getDictionary(locale);
  const { toast } = useToast();

  const [tab, setTab] = useState<InboxTab>("timeline");

  // -- timeline state ---------------------------------------------------------
  const [timeline, setTimeline] = useState<readonly CommunicationInboxEntry[]>(initialTimeline);
  const [partnerFilter, setPartnerFilter] = useState("");
  const [kindFilter, setKindFilter] = useState("");
  const [channelFilter, setChannelFilter] = useState("");
  const [directionFilter, setDirectionFilter] = useState("");
  const [timelineError, setTimelineError] = useState<string | null>(null);
  const [loadingTimeline, setLoadingTimeline] = useState(false);

  // -- call-form state --------------------------------------------------------
  const [callPartner, setCallPartner] = useState("");
  const [callDirection, setCallDirection] = useState<"INBOUND" | "OUTBOUND">("OUTBOUND");
  const [callOutcome, setCallOutcome] = useState<CallOutcome>("COMPLETED");
  const [callSummary, setCallSummary] = useState("");
  const [callBody, setCallBody] = useState("");
  const [callDuration, setCallDuration] = useState("");
  const [callError, setCallError] = useState<string | null>(null);
  const [loggingCall, setLoggingCall] = useState(false);

  // -- my-preferences state ---------------------------------------------------
  const [prefs, setPrefs] = useState<readonly CommunicationPreferenceRow[]>(initialPrefs);
  const [prefsError, setPrefsError] = useState<string | null>(null);
  const [prefsBusy, setPrefsBusy] = useState(false);

  const channelLabel = (channel: string): string =>
    channel === "EMAIL"
      ? d.commTplChannelEmail
      : channel === "WHATSAPP"
        ? d.commTplChannelWhatsapp
        : channel === "SMS"
          ? d.commTplChannelSms
          : d.commInboxKindCall;

  const prefChannelLabel = (channel: (typeof PREF_CHANNELS)[number]): string =>
    channel === "IN_APP"
      ? d.commPrefChInApp
      : channel === "EMAIL"
        ? d.commPrefChEmail
        : channel === "SMS"
          ? d.commPrefChSms
          : d.commPrefChWhatsapp;

  const moduleLabel = (module: string): string => {
    switch (module) {
      case "limits":
        return d.commPrefModuleLimits;
      case "subscription":
        return d.commPrefModuleSubscription;
      case "reconciliation":
        return d.commPrefModuleReconciliation;
      case "invoice_overdue":
        return d.commPrefModuleInvoiceOverdue;
      case "stock":
        return d.commPrefModuleStock;
      case "templates":
        return d.commPrefModuleTemplates;
      case "crm":
        return d.commPrefModuleCrm;
      case "einvoicing":
        return d.commPrefModuleEinvoicing;
      case "notes":
        return d.commPrefModuleNotes;
      case "installments":
        return d.commPrefModuleInstallments;
      case "budgeting":
        return d.commPrefModuleBudgeting;
      case "purchasing":
        return d.commPrefModulePurchasing;
      case "collections":
        return d.commPrefModuleCollections;
      case "warranties":
        return d.commPrefModuleWarranties;
      case "digest":
        return d.commPrefModuleDigest;
      default:
        return module;
    }
  };

  const outcomeLabel = (outcome: CallOutcome): string => {
    switch (outcome) {
      case "COMPLETED":
        return d.commCallOutcomeCompleted;
      case "NO_ANSWER":
        return d.commCallOutcomeNoAnswer;
      case "BUSY":
        return d.commCallOutcomeBusy;
      case "VOICEMAIL":
        return d.commCallOutcomeVoicemail;
      case "FAILED":
        return d.commCallOutcomeFailed;
      case "SCHEDULED":
        return d.commCallOutcomeScheduled;
    }
  };

  async function refreshTimeline(): Promise<void> {
    setLoadingTimeline(true);
    setTimelineError(null);
    const params = new URLSearchParams();
    if (partnerFilter !== "") {
      params.set("partnerId", partnerFilter);
    }
    if (kindFilter !== "") {
      params.set("kind", kindFilter);
    }
    if (channelFilter !== "") {
      params.set("channel", channelFilter);
    }
    if (directionFilter !== "") {
      params.set("direction", directionFilter);
    }
    params.set("limit", "100");
    const result = await bffFetch<readonly CommunicationInboxEntry[]>(
      `communication/inbox?${params.toString()}`,
    );
    setLoadingTimeline(false);
    if (!result.ok) {
      setTimelineError(localizedApiError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setTimeline(result.data);
  }

  async function logCall(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (callPartner === "") {
      setCallError(d.commCallErrInvalid);
      return;
    }
    setLoggingCall(true);
    setCallError(null);
    const duration = callDuration.trim();
    const result = await bffFetch<CommunicationInboxEntry>("communication/inbox/calls", {
      method: "POST",
      body: {
        partnerId: callPartner,
        direction: callDirection,
        outcome: callOutcome,
        summary: callSummary.trim(),
        body: callBody.trim().length > 0 ? callBody : null,
        ...(duration.length > 0 ? { durationMinutes: Number(duration) } : {}),
      },
    });
    setLoggingCall(false);
    if (!result.ok) {
      setCallError(localizedApiError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setCallSummary("");
    setCallBody("");
    setCallDuration("");
    setTimeline([result.data, ...timeline]);
    toast({ tone: "success", title: d.commCallLoggedToast });
    setTab("timeline");
  }

  async function togglePref(module: string, channel: (typeof PREF_CHANNELS)[number], next: boolean): Promise<void> {
    setPrefsBusy(true);
    setPrefsError(null);
    const result = await bffFetch<{ updated: boolean }>("communication/preferences/me", {
      method: "POST",
      body: { module, channel, enabled: next },
    });
    setPrefsBusy(false);
    if (!result.ok) {
      setPrefsError(localizedApiError(d, result.error, result.retryAfterSeconds));
      return;
    }
    const refreshed = await bffFetch<readonly CommunicationPreferenceRow[]>("communication/preferences/me");
    if (refreshed.ok) {
      setPrefs(refreshed.data);
    }
    toast({ tone: "success", title: d.commMyPrefsSavedToast });
  }

  return (
    <div className="flex flex-col gap-6">
      <Tabs
        items={[
          { value: "timeline", label: d.commInboxTabTimeline },
          { value: "call", label: d.commInboxTabCall },
          { value: "prefs", label: d.commInboxTabPrefs },
        ]}
        value={tab}
        onValueChange={(value) => setTab(value as InboxTab)}
      >
        {tab === "timeline" && (
          <div className="flex flex-col gap-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Select
                id="comm-inbox-filter-partner"
                label={d.commCallPartnerLabel}
                value={partnerFilter}
                onValueChange={setPartnerFilter}
                options={[
                  { value: "", label: d.commInboxFilterAll },
                  ...partners.map((partner) => ({
                    value: partner.id,
                    label: `${localizedName(partner.name, partner.nameAr, locale)} · ${partner.code}`,
                  })),
                ]}
              />
              <Select
                id="comm-inbox-filter-kind"
                label={d.commInboxFilterKind}
                value={kindFilter}
                onValueChange={setKindFilter}
                options={[
                  { value: "", label: d.commInboxFilterAll },
                  { value: "MESSAGE", label: d.commInboxKindMessage },
                  { value: "CALL", label: d.commInboxKindCall },
                ]}
              />
              <Select
                id="comm-inbox-filter-channel"
                label={d.commInboxFilterChannel}
                value={channelFilter}
                onValueChange={setChannelFilter}
                options={[
                  { value: "", label: d.commInboxFilterAll },
                  ...CHANNEL_FILTERS.map((channel) => ({ value: channel, label: channelLabel(channel) })),
                ]}
              />
              <Select
                id="comm-inbox-filter-direction"
                label={d.commInboxFilterDirection}
                value={directionFilter}
                onValueChange={setDirectionFilter}
                options={[
                  { value: "", label: d.commInboxFilterAll },
                  { value: "INBOUND", label: d.commInboxDirInbound },
                  { value: "OUTBOUND", label: d.commInboxDirOutbound },
                ]}
              />
            </div>
            <div>
              <Button variant="primary" loading={loadingTimeline} onClick={() => void refreshTimeline()}>
                {d.commInboxRefresh}
              </Button>
            </div>
            {timelineError !== null && <ErrorNotice>{timelineError}</ErrorNotice>}
            <Card title={d.commInboxTabTimeline} ariaLabel={d.commInboxTabTimeline}>
              <DataTable
                columns={[
                  {
                    id: "at",
                    header: activeLocaleHeader(d.commInboxColAt),
                    accessor: (row) => row.at,
                    render: (row) => <span className="whitespace-nowrap text-xs">{formatAt(row.at)}</span>,
                  },
                  {
                    id: "kind",
                    header: activeLocaleHeader(d.commInboxColKind),
                    accessor: (row) => row.kind,
                    render: (row) => (
                      <Badge tone={row.kind === "CALL" ? "primary" : "neutral"}>
                        {row.kind === "CALL" ? d.commInboxKindCall : d.commInboxKindMessage}
                      </Badge>
                    ),
                  },
                  {
                    id: "channel",
                    header: activeLocaleHeader(d.commInboxColChannel),
                    accessor: (row) => row.channel,
                    render: (row) => <span className="text-xs">{channelLabel(row.channel)}</span>,
                  },
                  {
                    id: "direction",
                    header: activeLocaleHeader(d.commInboxFilterDirection),
                    accessor: (row) => row.direction,
                    render: (row) => (
                      <span className="text-xs">
                        {row.direction === "INBOUND" ? d.commInboxDirInbound : d.commInboxDirOutbound}
                      </span>
                    ),
                  },
                  {
                    id: "counterparty",
                    header: activeLocaleHeader(d.commInboxColCounterparty),
                    accessor: (row) => row.counterparty ?? row.partnerId ?? "—",
                    render: (row) => {
                      const partner = partners.find((entry) => entry.id === row.partnerId);
                      return (
                        <span className="text-sm">
                          {partner !== undefined
                            ? localizedName(partner.name, partner.nameAr, locale)
                            : (row.counterparty ?? "—")}
                        </span>
                      );
                    },
                  },
                  {
                    id: "summary",
                    header: activeLocaleHeader(d.commInboxColSummary),
                    accessor: (row) => row.summary ?? row.body ?? "—",
                    render: (row) => (
                      <div className="flex flex-col gap-1">
                        <span className="text-sm">{row.summary ?? "—"}</span>
                        {row.kind === "CALL" && row.outcome !== null && (
                          <span className="flex flex-wrap items-center gap-1">
                            <Badge tone="neutral">{outcomeLabel(row.outcome as CallOutcome)}</Badge>
                            {row.durationMinutes !== null && (
                              <span className="text-xs text-gray-500">
                                {formatMessage(d.commInboxDurationValue, { minutes: row.durationMinutes })}
                              </span>
                            )}
                          </span>
                        )}
                      </div>
                    ),
                  },
                ]}
                rows={[...timeline]}
                rowKey={(row) => row.id}
                empty={{ title: d.commInboxEmpty }}
              />
            </Card>
          </div>
        )}

        {tab === "call" && (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-gray-600">{d.commCallFormHint}</p>
            <Card title={d.commCallFormTitle} ariaLabel={d.commCallFormTitle}>
              <form onSubmit={(event) => void logCall(event)} noValidate className="flex flex-col gap-4">
                {callError !== null && <ErrorNotice>{callError}</ErrorNotice>}
                <div className="grid gap-4 sm:grid-cols-2">
                  <Select
                    id="comm-call-partner"
                    label={d.commCallPartnerLabel}
                    value={callPartner}
                    onValueChange={setCallPartner}
                    options={partners.map((partner) => ({
                      value: partner.id,
                      label: `${localizedName(partner.name, partner.nameAr, locale)} · ${partner.code}`,
                    }))}
                    required
                  />
                  <Select
                    id="comm-call-direction"
                    label={d.commCallDirectionLabel}
                    value={callDirection}
                    onValueChange={(value) => setCallDirection(value as "INBOUND" | "OUTBOUND")}
                    options={[
                      { value: "OUTBOUND", label: d.commInboxDirOutbound },
                      { value: "INBOUND", label: d.commInboxDirInbound },
                    ]}
                    required
                  />
                  <Select
                    id="comm-call-outcome"
                    label={d.commCallOutcomeLabel}
                    value={callOutcome}
                    onValueChange={(value) => setCallOutcome(value as CallOutcome)}
                    options={(
                      [
                        "COMPLETED",
                        "NO_ANSWER",
                        "BUSY",
                        "VOICEMAIL",
                        "FAILED",
                        "SCHEDULED",
                      ] as const
                    ).map((outcome) => ({ value: outcome, label: outcomeLabel(outcome) }))}
                    required
                  />
                  <Input
                    id="comm-call-duration"
                    label={d.commCallDurationLabel}
                    value={callDuration}
                    onValueChange={(value) => setCallDuration(value.replace(/[^\d]/g, ""))}
                    inputMode="numeric"
                    mono
                  />
                </div>
                <Input
                  id="comm-call-summary"
                  label={d.commCallSummaryLabel}
                  value={callSummary}
                  onValueChange={setCallSummary}
                  required
                />
                <Textarea
                  id="comm-call-body"
                  label={d.commCallBodyLabel}
                  value={callBody}
                  onValueChange={setCallBody}
                  rows={4}
                />
                <div>
                  <Button type="submit" variant="primary" loading={loggingCall}>
                    {d.commCallSubmitBtn}
                  </Button>
                </div>
              </form>
            </Card>
          </div>
        )}

        {tab === "prefs" && (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-gray-600">{d.commMyPrefsHint}</p>
            {prefsError !== null && <ErrorNotice>{prefsError}</ErrorNotice>}
            <Card title={d.commMyPrefsTitle} ariaLabel={d.commMyPrefsTitle}>
              <div className="flex flex-col gap-3">
                {prefs.map((row) => (
                  <div
                    key={row.module}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-subtle p-3"
                  >
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{moduleLabel(row.module)}</span>
                      {row.explicit && <Badge tone="primary">{d.commMyPrefsExplicitBadge}</Badge>}
                    </span>
                    <div className="flex flex-wrap items-center gap-4">
                      {PREF_CHANNELS.map((channel) => (
                        <Checkbox
                          key={channel}
                          label={prefChannelLabel(channel)}
                          checked={row.channels[channel]}
                          disabled={prefsBusy}
                          onCheckedChange={(checked) =>
                            void togglePref(row.module, channel, checked === true)
                          }
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-xs text-gray-500">{d.commMyPrefsInheritNote}</p>
            </Card>
          </div>
        )}
      </Tabs>
    </div>
  );
}
