"use client";

/**
 * PHASE-041 T-10 — the /settings/communication back office (FD-30 +
 * BR-067 + TB-23 defaults; PAGE_ARCHETYPES §6 settings archetype): three
 * tabs over the communications API.
 *
 * - Templates: the effective catalog (tenant overrides flagged vs the
 *   builtin fallbacks), the override editor (channel × locale × module,
 *   typed variables rendered as chips), the fail-closed preview (sample
 *   variables → the exact outgoing output), and delete-override (the
 *   builtin resumes).
 * - Providers: per-channel selection with the honest BR-067 resolution
 *   (live / sandbox / blocked-on-credentials), the sealed-credential
 *   editor (values never displayed after saving — blank keeps the stored
 *   value), per-market senders, and the daily hard cap.
 * - Defaults: the tenant-default notification matrix (module × channel)
 *   that every user inherits until they customize their own row.
 */
import { useState } from "react";
import type { FormEvent, JSX } from "react";

import { Badge, Button, Checkbox, DataTable, Input, Select, Tabs, Textarea, useToast } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type {
  CommunicationPreferenceDefault,
  CommunicationProviderCatalog,
  CommunicationProviderEntry,
  CommunicationTemplate,
  CommunicationTemplatePreview,
} from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { localizedApiError } from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice, InfoNotice, SuccessNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";

type SettingsTab = "templates" | "providers" | "defaults";

type OutboundChannel = "EMAIL" | "WHATSAPP" | "SMS";
const CHANNELS: readonly OutboundChannel[] = ["EMAIL", "WHATSAPP", "SMS"];

type MarketRow = {
  code: string;
  whatsappPhoneNumberId: string;
  smsSenderName: string;
  emailFromAddress: string;
};

/** The template-editor form state (an override upsert). */
interface TemplateDraft {
  key: string;
  channel: OutboundChannel;
  locale: "ar" | "en";
  module: string;
  subject: string;
  body: string;
  isActive: boolean;
}

function emptyDraft(): TemplateDraft {
  return { key: "", channel: "EMAIL", locale: "ar", module: "collections", subject: "", body: "", isActive: true };
}

function draftOf(template: CommunicationTemplate): TemplateDraft {
  return {
    key: template.key,
    channel: template.channel,
    locale: template.locale,
    module: template.module,
    subject: template.subject ?? "",
    body: template.body,
    isActive: template.isActive,
  };
}

export function CommunicationSettingsWorkspace({
  locale,
  canManage,
  canManageDefaults,
  initialTemplates,
  initialCatalog,
  initialDefaults,
}: {
  locale: Locale;
  canManage: boolean;
  canManageDefaults: boolean;
  initialTemplates: readonly CommunicationTemplate[];
  initialCatalog: CommunicationProviderCatalog;
  initialDefaults: readonly CommunicationPreferenceDefault[];
}): JSX.Element {
  const d = getDictionary(locale);
  const { toast } = useToast();

  const [tab, setTab] = useState<SettingsTab>("templates");
  const [templates, setTemplates] = useState<readonly CommunicationTemplate[]>(initialTemplates);
  const [catalog, setCatalog] = useState<CommunicationProviderCatalog>(initialCatalog);

  // -- templates state --------------------------------------------------------
  const [draft, setDraft] = useState<TemplateDraft | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [previewOf, setPreviewOf] = useState<CommunicationTemplate | null>(null);
  const [previewVars, setPreviewVars] = useState<Record<string, string>>({});
  const [previewResult, setPreviewResult] = useState<CommunicationTemplatePreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);

  // -- providers state --------------------------------------------------------
  const [selection, setSelection] = useState<Record<OutboundChannel, string>>({
    EMAIL: initialCatalog.channels.EMAIL.providerId === "sandbox" ? "" : initialCatalog.channels.EMAIL.providerId,
    WHATSAPP: initialCatalog.channels.WHATSAPP.providerId === "sandbox" ? "" : initialCatalog.channels.WHATSAPP.providerId,
    SMS: initialCatalog.channels.SMS.providerId === "sandbox" ? "" : initialCatalog.channels.SMS.providerId,
  });
  const [credentialDrafts, setCredentialDrafts] = useState<Record<string, Record<string, string>>>({});
  const [credentialOpen, setCredentialOpen] = useState<string | null>(null);
  const [markets, setMarkets] = useState<readonly MarketRow[]>(
    Object.entries(initialCatalog.markets).map(([code, config]) => ({
      code,
      whatsappPhoneNumberId: config.whatsappPhoneNumberId ?? "",
      smsSenderName: config.smsSenderName ?? "",
      emailFromAddress: config.emailFromAddress ?? "",
    })),
  );
  const [sendCap, setSendCap] = useState<string>(initialCatalog.sendCap.dailyHardCap === undefined ? "" : String(initialCatalog.sendCap.dailyHardCap));
  const [providersError, setProvidersError] = useState<string | null>(null);
  const [providersNotice, setProvidersNotice] = useState<string | null>(null);
  const [savingProviders, setSavingProviders] = useState(false);

  const channelLabel = (channel: OutboundChannel): string =>
    channel === "EMAIL" ? d.commTplChannelEmail : channel === "WHATSAPP" ? d.commTplChannelWhatsapp : d.commTplChannelSms;

  const providersOf = (channel: OutboundChannel): readonly CommunicationProviderEntry[] =>
    catalog.providers.filter((provider) => provider.kind === channel);

  const resolutionBadge = (channel: OutboundChannel): JSX.Element => {
    const resolution = catalog.channels[channel];
    if (resolution.live) {
      return <Badge tone="primary">{d.commProvLiveBadge}</Badge>;
    }
    if (resolution.blockedOnCredentials) {
      return <Badge tone="neutral">{d.commProvBlockedBadge}</Badge>;
    }
    return <Badge tone="neutral">{d.commProvSandboxBadge}</Badge>;
  };

  async function refreshTemplates(): Promise<void> {
    const result = await bffFetch<readonly CommunicationTemplate[]>("communication/templates");
    if (result.ok) {
      setTemplates(result.data);
    }
  }

  async function saveTemplate(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (draft === null) {
      return;
    }
    setSavingTemplate(true);
    setDraftError(null);
    const result = await bffFetch<CommunicationTemplate>("communication/templates", {
      method: "POST",
      body: {
        key: draft.key.trim(),
        channel: draft.channel,
        locale: draft.locale,
        module: draft.module.trim(),
        subject: draft.channel === "EMAIL" && draft.subject.trim().length > 0 ? draft.subject.trim() : null,
        body: draft.body,
        // The typed-variable vocabulary is catalog-driven: the editor
        // carries the source row's declarations forward unchanged.
        variables: templates
          .filter(
            (row) =>
              row.key === draft.key && row.channel === draft.channel && row.locale === draft.locale,
          )
          .flatMap((row) => row.variables),
        isActive: draft.isActive,
      },
    });
    setSavingTemplate(false);
    if (!result.ok) {
      setDraftError(localizedApiError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setDraft(null);
    await refreshTemplates();
    toast({ tone: "success", title: d.commTplSavedToast });
  }

  async function deleteOverride(template: CommunicationTemplate): Promise<void> {
    const query = `communication/templates?key=${encodeURIComponent(template.key)}&channel=${template.channel}&locale=${template.locale}`;
    const result = await bffFetch<{ removed: boolean }>(query, { method: "DELETE" });
    if (!result.ok) {
      setDraftError(localizedApiError(d, result.error, result.retryAfterSeconds));
      return;
    }
    await refreshTemplates();
    toast({ tone: "success", title: d.commTplDeletedToast });
  }

  async function runPreview(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (previewOf === null) {
      return;
    }
    setPreviewBusy(true);
    setPreviewError(null);
    setPreviewResult(null);
    const result = await bffFetch<CommunicationTemplatePreview>("communication/templates/preview", {
      method: "POST",
      body: {
        key: previewOf.key,
        channel: previewOf.channel,
        locale: previewOf.locale,
        variables: previewVars,
      },
    });
    setPreviewBusy(false);
    if (!result.ok) {
      setPreviewError(localizedApiError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setPreviewResult(result.data);
  }

  async function saveProviders(event: FormEvent): Promise<void> {
    event.preventDefault();
    setSavingProviders(true);
    setProvidersError(null);
    setProvidersNotice(null);
    // Assemble the PUT: selection ("" = sandbox), only the TYPED
    // credential fields travel (blank keeps the stored value), the
    // whole-market map, and the cap (empty = no cap).
    const credentials: Record<string, Record<string, string>> = {};
    for (const [providerId, fields] of Object.entries(credentialDrafts)) {
      const typed = Object.fromEntries(
        Object.entries(fields).filter(([, value]) => value.trim().length > 0),
      );
      if (Object.keys(typed).length > 0) {
        credentials[providerId] = typed;
      }
    }
    const marketMap: Record<string, Record<string, string>> = {};
    for (const market of markets) {
      const code = market.code.trim().toUpperCase();
      if (!/^[A-Z]{2}$/.test(code)) {
        continue;
      }
      marketMap[code] = {
        ...(market.whatsappPhoneNumberId.trim().length > 0 ? { whatsappPhoneNumberId: market.whatsappPhoneNumberId.trim() } : {}),
        ...(market.smsSenderName.trim().length > 0 ? { smsSenderName: market.smsSenderName.trim() } : {}),
        ...(market.emailFromAddress.trim().length > 0 ? { emailFromAddress: market.emailFromAddress.trim() } : {}),
      };
    }
    const cap = sendCap.trim();
    const result = await bffFetch<CommunicationProviderCatalog>("communication/providers", {
      method: "PUT",
      body: {
        selection: {
          EMAIL: selection.EMAIL,
          WHATSAPP: selection.WHATSAPP,
          SMS: selection.SMS,
        },
        ...(Object.keys(credentials).length > 0 ? { credentials } : {}),
        markets: marketMap,
        sendCap: { dailyHardCap: cap.length > 0 ? Number(cap) : null },
      },
    });
    setSavingProviders(false);
    if (!result.ok) {
      setProvidersError(localizedApiError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setCatalog(result.data);
    setCredentialDrafts({});
    setProvidersNotice(d.commProvCredsSavedToast);
    toast({ tone: "success", title: d.commProvCredsSavedToast });
  }

  const templateTable = (
      <DataTable
        columns={[
          {
            id: "key",
            header: activeLocaleHeader(d.commTplColKey),
            accessor: (row) => row.key,
            mono: true,
          },
          {
            id: "channel",
            header: activeLocaleHeader(d.commTplColChannel),
            accessor: (row) => row.channel,
            render: (row) => <Badge tone="neutral">{channelLabel(row.channel)}</Badge>,
          },
          {
            id: "locale",
            header: activeLocaleHeader(d.commTplColLocale),
            accessor: (row) => row.locale,
            mono: true,
          },
          {
            id: "module",
            header: activeLocaleHeader(d.commTplColModule),
            accessor: (row) => row.module,
            mono: true,
          },
          {
            id: "status",
            header: activeLocaleHeader(d.commTplColStatus),
            accessor: (row) => (row.overridden ? "override" : "builtin") + (row.isActive ? "+active" : "+inactive"),
            render: (row) => (
              <span className="flex flex-wrap items-center gap-1">
                <Badge tone={row.overridden ? "primary" : "neutral"}>
                  {row.overridden ? d.commTplOverrideBadge : d.commTplBuiltinBadge}
                </Badge>
                <Badge tone={row.isActive ? "primary" : "neutral"}>
                  {row.isActive ? d.commTplActive : d.commTplInactive}
                </Badge>
              </span>
            ),
          },
          {
            id: "actions",
            header: activeLocaleHeader(d.commTplColAction),
            accessor: (row) => row.key,
            render: (row) => (
              <span className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setPreviewOf(row);
                    setPreviewVars({});
                    setPreviewResult(null);
                    setPreviewError(null);
                  }}
                >
                  {d.commTplPreviewBtn}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setDraft(draftOf(row));
                    setDraftError(null);
                  }}
                >
                  {d.commTplEditBtn}
                </Button>
                {row.overridden && (
                  <Button size="sm" variant="secondary" onClick={() => void deleteOverride(row)}>
                    {d.commTplDeleteBtn}
                  </Button>
                )}
              </span>
            ),
          },
        ]}
        rows={[...templates]}
        rowKey={(row) => `${row.key}|${row.channel}|${row.locale}`}
        empty={{ title: d.commInboxEmpty }}
      />
  );

  return (
    <div className="flex flex-col gap-6">
      {!canManage && <InfoNotice>{d.errorsForbidden}</InfoNotice>}

      <Tabs
        items={[
          { value: "templates", label: d.commTabTemplates },
          { value: "providers", label: d.commTabProviders },
          { value: "defaults", label: d.commTabDefaults },
        ]}
        value={tab}
        onValueChange={(value) => setTab(value as SettingsTab)}
      >
        {tab === "templates" && (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-gray-600">{d.commTemplatesHint}</p>

            {draft === null ? (
              <Card title={d.commTplEditorNewTitle} ariaLabel={d.commTplEditorNewTitle}>
                <Button
                  variant="primary"
                  disabled={!canManage}
                  onClick={() => {
                    setDraft(emptyDraft());
                    setDraftError(null);
                  }}
                >
                  {d.commTplEditorNewTitle}
                </Button>
              </Card>
            ) : (
              <Card
                title={draft.body === "" && draft.key === "" ? d.commTplEditorNewTitle : d.commTplEditorEditTitle}
                ariaLabel={d.commTplEditorEditTitle}
              >
                <form onSubmit={(event) => void saveTemplate(event)} noValidate className="flex flex-col gap-4">
                  {draftError !== null && <ErrorNotice>{draftError}</ErrorNotice>}
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Input
                      id="comm-tpl-key"
                      label={d.commTplFormKey}
                      value={draft.key}
                      onValueChange={(value) => setDraft({ ...draft, key: value })}
                      mono
                      required
                    />
                    <Input
                      id="comm-tpl-module"
                      label={d.commTplFormModule}
                      value={draft.module}
                      onValueChange={(value) => setDraft({ ...draft, module: value })}
                      mono
                      required
                    />
                    <Select
                      id="comm-tpl-channel"
                      label={d.commTplColChannel}
                      value={draft.channel}
                      onValueChange={(value) => setDraft({ ...draft, channel: value as OutboundChannel })}
                      options={CHANNELS.map((channel) => ({ value: channel, label: channelLabel(channel) }))}
                    />
                    <Select
                      id="comm-tpl-locale"
                      label={d.commTplColLocale}
                      value={draft.locale}
                      onValueChange={(value) => setDraft({ ...draft, locale: value as "ar" | "en" })}
                      options={[
                        { value: "ar", label: "العربية" },
                        { value: "en", label: "English" },
                      ]}
                    />
                  </div>
                  {draft.channel === "EMAIL" && (
                    <Input
                      id="comm-tpl-subject"
                      label={d.commTplFormSubject}
                      value={draft.subject}
                      onValueChange={(value) => setDraft({ ...draft, subject: value })}
                    />
                  )}
                  <Textarea
                    id="comm-tpl-body"
                    label={d.commTplFormBody}
                    value={draft.body}
                    onValueChange={(value) => setDraft({ ...draft, body: value })}
                    rows={8}
                    required
                  />
                  <Checkbox
                    label={d.commTplFormActive}
                    checked={draft.isActive}
                    onCheckedChange={(checked) => setDraft({ ...draft, isActive: checked === true })}
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <Button type="submit" variant="primary" loading={savingTemplate} disabled={!canManage}>
                      {d.commTplSaveBtn}
                    </Button>
                    <Button variant="secondary" onClick={() => setDraft(null)}>
                      {d.commTplCancelBtn}
                    </Button>
                  </div>
                </form>
              </Card>
            )}

            {previewOf !== null && (
              <Card title={d.commTplPreviewTitle} ariaLabel={d.commTplPreviewTitle}>
                <p className="mb-3 font-mono text-xs text-gray-600">
                  {previewOf.key} · {channelLabel(previewOf.channel)} · {previewOf.locale}
                </p>
                <p className="mb-3 text-sm text-gray-600">{d.commTplPreviewVarsHint}</p>
                <form onSubmit={(event) => void runPreview(event)} noValidate className="flex flex-col gap-4">
                  {previewError !== null && <ErrorNotice>{previewError}</ErrorNotice>}
                  {previewOf.variables.length === 0 && <InfoNotice>{d.commTplFormVars}: —</InfoNotice>}
                  <div className="grid gap-4 sm:grid-cols-2">
                    {previewOf.variables.map((variable) => (
                      <Input
                        key={variable.name}
                        id={`comm-preview-${variable.name}`}
                        label={`${variable.name}${variable.required ? " *" : ""}`}
                        value={previewVars[variable.name] ?? ""}
                        onValueChange={(value) => setPreviewVars({ ...previewVars, [variable.name]: value })}
                        mono
                      />
                    ))}
                  </div>
                  <div>
                    <Button type="submit" variant="primary" loading={previewBusy}>
                      {d.commTplPreviewRunBtn}
                    </Button>
                  </div>
                  {previewResult !== null && (
                    <div className="flex flex-col gap-3 rounded-md border border-subtle bg-gray-50 p-4">
                      {previewResult.subject !== null && (
                        <div>
                          <p className="text-xs font-medium text-gray-600">{d.commTplPreviewSubject}</p>
                          <p className="text-sm">{previewResult.subject}</p>
                        </div>
                      )}
                      <div>
                        <p className="text-xs font-medium text-gray-600">{d.commTplPreviewBody}</p>
                        <p className="whitespace-pre-wrap text-sm">{previewResult.body}</p>
                      </div>
                      {previewResult.whatsappParams !== null && (
                        <div>
                          <p className="text-xs font-medium text-gray-600">{d.commTplPreviewWhatsappParams}</p>
                          <p className="font-mono text-sm" dir="ltr">
                            {previewResult.whatsappParams.join(" · ")}
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </form>
              </Card>
            )}

            <Card title={d.commTabTemplates} ariaLabel={d.commTabTemplates}>
              {templateTable}
            </Card>
          </div>
        )}

        {tab === "providers" && (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-gray-600">{d.commProvidersHint}</p>
            {providersError !== null && <ErrorNotice>{providersError}</ErrorNotice>}
            {providersNotice !== null && <SuccessNotice>{providersNotice}</SuccessNotice>}

            {CHANNELS.map((channel) => (
              <Card
                key={channel}
                title={`${channelLabel(channel)} — ${d.commProvSelectLabel}`}
                ariaLabel={channelLabel(channel)}
              >
                <div className="flex flex-col gap-4">
                  <div className="flex flex-wrap items-center gap-3">
                    {resolutionBadge(channel)}
                    <Select
                      id={`comm-prov-select-${channel}`}
                      label={d.commProvSelectLabel}
                      value={selection[channel]}
                      onValueChange={(value) => setSelection({ ...selection, [channel]: value })}
                      options={[
                        { value: "", label: d.commProvSelectSandbox },
                        ...providersOf(channel).map((provider) => ({
                          value: provider.id,
                          label: provider.label[locale],
                        })),
                      ]}
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    {providersOf(channel).map((provider) => (
                      <div key={provider.id} className="rounded-md border border-subtle p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-medium">{provider.label[locale]}</span>
                            {provider.requiresVerification && (
                              <Badge tone="neutral">{d.commProvRequiresVerification}</Badge>
                            )}
                            {provider.credentialFields.every((field) => field.configured) ? (
                              <Badge tone="primary">{d.commProvCredsConfigured}</Badge>
                            ) : (
                              <Badge tone="neutral">{d.commProvCredsNotConfigured}</Badge>
                            )}
                          </div>
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={!canManage}
                            onClick={() =>
                              setCredentialOpen(credentialOpen === provider.id ? null : provider.id)
                            }
                          >
                            {d.commProvCredsTitle}
                          </Button>
                        </div>
                        {credentialOpen === provider.id && (
                          <div className="mt-3 flex flex-col gap-3">
                            <p className="text-xs text-gray-600">{d.commProvCredsHint}</p>
                            {provider.credentialFields.map((field) => {
                              const typed = credentialDrafts[provider.id]?.[field.name] ?? "";
                              return (
                                <Input
                                  key={field.name}
                                  id={`comm-cred-${provider.id}-${field.name}`}
                                  label={`${field.label[locale]}${field.required ? " *" : ""}${
                                    field.configured ? ` · ${d.commProvCredsConfigured}` : ""
                                  }`}
                                  value={typed}
                                  onValueChange={(value) =>
                                    setCredentialDrafts({
                                      ...credentialDrafts,
                                      [provider.id]: {
                                        ...(credentialDrafts[provider.id] ?? {}),
                                        [field.name]: value,
                                      },
                                    })
                                  }
                                  type={field.secret ? "password" : "text"}
                                  mono={field.secret}
                                />
                              );
                            })}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </Card>
            ))}

            <Card title={d.commProvMarketsTitle} ariaLabel={d.commProvMarketsTitle}>
              <div className="flex flex-col gap-4">
                <p className="text-sm text-gray-600">{d.commProvMarketsHint}</p>
                {markets.map((market, index) => (
                  <div key={index} className="grid gap-3 rounded-md border border-subtle p-3 sm:grid-cols-2 lg:grid-cols-5">
                    <Input
                      id={`comm-market-code-${index}`}
                      label={d.commProvMarketCodeLabel}
                      value={market.code}
                      onValueChange={(value) =>
                        setMarkets(
                          markets.map((row, i) => (i === index ? { ...row, code: value.toUpperCase() } : row)),
                        )
                      }
                      mono
                    />
                    <Input
                      id={`comm-market-wa-${index}`}
                      label={d.commProvMarketWhatsappId}
                      value={market.whatsappPhoneNumberId}
                      onValueChange={(value) =>
                        setMarkets(
                          markets.map((row, i) => (i === index ? { ...row, whatsappPhoneNumberId: value } : row)),
                        )
                      }
                      mono
                    />
                    <Input
                      id={`comm-market-sms-${index}`}
                      label={d.commProvMarketSmsSender}
                      value={market.smsSenderName}
                      onValueChange={(value) =>
                        setMarkets(markets.map((row, i) => (i === index ? { ...row, smsSenderName: value } : row)))
                      }
                      mono
                    />
                    <Input
                      id={`comm-market-mail-${index}`}
                      label={d.commProvMarketEmailFrom}
                      value={market.emailFromAddress}
                      onValueChange={(value) =>
                        setMarkets(
                          markets.map((row, i) => (i === index ? { ...row, emailFromAddress: value } : row)),
                        )
                      }
                      bidiIsolate
                    />
                    <div className="flex items-end">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setMarkets(markets.filter((_, i) => i !== index))}
                      >
                        {d.commProvMarketRemoveBtn}
                      </Button>
                    </div>
                  </div>
                ))}
                <div>
                  <Button
                    variant="secondary"
                    disabled={!canManage}
                    onClick={() =>
                      setMarkets([
                        ...markets,
                        { code: "", whatsappPhoneNumberId: "", smsSenderName: "", emailFromAddress: "" },
                      ])
                    }
                  >
                    {d.commProvMarketAddBtn}
                  </Button>
                </div>
              </div>
            </Card>

            <Card title={d.commProvCapTitle} ariaLabel={d.commProvCapTitle}>
              <form onSubmit={(event) => void saveProviders(event)} noValidate className="flex flex-col gap-4">
                <p className="text-sm text-gray-600">{d.commProvCapHint}</p>
                <div className="max-w-xs">
                  <Input
                    id="comm-prov-cap"
                    label={d.commProvCapLabel}
                    value={sendCap}
                    onValueChange={(value) => setSendCap(value.replace(/[^\d]/g, ""))}
                    inputMode="numeric"
                    mono
                  />
                </div>
                <div>
                  <Button type="submit" variant="primary" loading={savingProviders} disabled={!canManage}>
                    {d.commProvCredSaveBtn}
                  </Button>
                </div>
              </form>
            </Card>
          </div>
        )}

        {tab === "defaults" && (
          <DefaultsTab locale={locale} canManage={canManageDefaults} initialDefaults={initialDefaults} />
        )}
      </Tabs>
    </div>
  );
}

/**
 * The tenant-default matrix (TB-23): one card per preference module with
 * the four channel toggles; writes ride POST communication/preferences/
 * defaults (communication.preferences.manage).
 */
function DefaultsTab({
  locale,
  canManage,
  initialDefaults,
}: {
  locale: Locale;
  canManage: boolean;
  initialDefaults: readonly CommunicationPreferenceDefault[];
}): JSX.Element {
  const d = getDictionary(locale);
  const { toast } = useToast();
  const [rows, setRows] = useState<readonly CommunicationPreferenceDefault[]>(initialDefaults);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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

  async function load(): Promise<void> {
    const result = await bffFetch<readonly CommunicationPreferenceDefault[]>(
      "communication/preferences/defaults",
    );
    if (!result.ok) {
      setError(localizedApiError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setRows(result.data);
  }

  const enabledOf = (module: string, channel: string): boolean =>
    rows.some((row) => row.module === module && row.channel === channel && row.enabled);

  async function toggle(module: string, channel: string, next: boolean): Promise<void> {
    setBusy(true);
    const result = await bffFetch<{ updated: boolean }>("communication/preferences/defaults", {
      method: "POST",
      body: { module, channel, enabled: next },
    });
    setBusy(false);
    if (!result.ok) {
      setError(localizedApiError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setError(null);
    toast({ tone: "success", title: d.commPrefSavedToast });
    await load();
  }

  if (error !== null && rows.length === 0) {
    return <ErrorNotice>{error}</ErrorNotice>;
  }

  const modules = [...new Set(rows.map((row) => row.module))];
  const channelOptions = ["IN_APP", "EMAIL", "SMS", "WHATSAPP"] as const;
  const channelLabel = (channel: (typeof channelOptions)[number]): string =>
    channel === "IN_APP"
      ? d.commPrefChInApp
      : channel === "EMAIL"
        ? d.commPrefChEmail
        : channel === "SMS"
          ? d.commPrefChSms
          : d.commPrefChWhatsapp;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-gray-600">{d.commDefaultsHint}</p>
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
      <Card title={d.commTabDefaults} ariaLabel={d.commTabDefaults}>
        <div className="flex flex-col gap-3">
          {modules.map((module) => (
            <div
              key={module}
              className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-subtle p-3"
            >
              <span className="text-sm font-medium">{moduleLabel(module)}</span>
              <div className="flex flex-wrap items-center gap-4">
                {channelOptions.map((channel) => (
                  <Checkbox
                    key={channel}
                    label={channelLabel(channel)}
                    checked={enabledOf(module, channel)}
                    disabled={!canManage || busy}
                    onCheckedChange={(checked) => void toggle(module, channel, checked === true)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
