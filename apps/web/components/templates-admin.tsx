"use client";

/**
 * PHASE-015 T11 (task 3-a) — the admin "Industry & templates" screen
 * (client half; the server page resolves the session, the registry, the
 * per-template details, and the effective config).
 *
 * - Applied-template card: key, bilingual name, the APPLIED version pin +
 *   short manifest hash (from the detail's appliedHere), registry status.
 *   NOTE (honest gap): the API exposes no applied_at timestamp on any read
 *   route — the card omits the date rather than fabricating one.
 * - Registry list with the §4 capability previews; actions are
 *   permission-gated (`configuration.templates.apply`): Apply when no
 *   template is applied; Preview switch/extend → the R9 what-will-change
 *   dialog → Switch/Extend with the REQUIRED-phase-gated acknowledgement
 *   checkbox ("phase-gated features arrive later" — never auto-enabled).
 * - Upgrade offers (POST /templates/drift-check, holders only): PATCH/MINOR
 *   offers with a review CTA into the same diff preview; MAJOR flagged
 *   critical with the migration-note wording; never auto-applied.
 * - Policy defaults: the effective policy map as a read-only bilingual table
 *   with per-key source badges ONLY where the payload can prove them
 *   (template-default for the applied template's unmapped workflow keys —
 *   no other layer can produce those; your-explicit for provable numbering
 *   overrides). Rows whose source the payload cannot distinguish carry no
 *   badge — the note states the three possible origins honestly.
 */

import { useEffect, useState } from "react";
import type { JSX, ReactNode } from "react";
import { useRouter } from "next/navigation";

import { Badge, Button, Checkbox, Dialog } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type {
  ConfigLocalizedText,
  EffectiveConfig,
  IndustryTemplateDetail,
  IndustryTemplateRow,
  TemplateApplyOutcome,
  TemplateDriftResult,
  TemplateSwitchPreview,
  TemplateSwitchResult,
} from "../lib/api-types";
import { isRecord } from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { formatMessage, localizedName, localizedBillingError } from "../lib/messages";
import { Card } from "./card";
import { DefList } from "./def-list";
import { ErrorNotice, InfoNotice, SuccessNotice } from "./notices";

interface DiffDialogState {
  mode: "switch" | "extend";
  key: string;
  diff: TemplateSwitchPreview | null;
  loading: boolean;
  error: string | null;
  ackChecked: boolean;
}

/** The applied L1 identity from the effective config. */
function appliedOf(effective: EffectiveConfig | null): { key: string; version: string } | null {
  const l1 = effective?.layers.l1_template;
  return l1 === null || l1 === undefined ? null : { key: l1.key, version: l1.version };
}

/** Narrow the acknowledgement-required error's details.preview (typed backstop). */
function previewOfDetails(details: unknown): TemplateSwitchPreview | null {
  if (
    isRecord(details) &&
    isRecord(details.preview) &&
    (details.preview.mode === "switch" || details.preview.mode === "extend") &&
    isRecord(details.preview.toTemplate)
  ) {
    return details.preview as unknown as TemplateSwitchPreview;
  }
  return null;
}

/** The typed blocked-error guidance (422 configuration/template-prerequisites-blocked). */
function blockedGuidanceOf(details: unknown): ConfigLocalizedText | null {
  if (
    isRecord(details) &&
    isRecord(details.guidance) &&
    typeof details.guidance.ar === "string" &&
    typeof details.guidance.en === "string"
  ) {
    return { ar: details.guidance.ar, en: details.guidance.en };
  }
  return null;
}

function missingChainOf(details: unknown): readonly string[] {
  if (isRecord(details) && Array.isArray(details.missingChain)) {
    return details.missingChain.filter((key: unknown): key is string => typeof key === "string");
  }
  return [];
}

/** "sha256:ac0a9334…" — the short manifest-hash form. */
function shortHash(hash: string): string {
  return hash.length > 16 ? `${hash.slice(0, 16)}…` : hash;
}

export function TemplatesAdmin({
  locale,
  canApply,
  registry,
  details,
  effective,
}: {
  locale: Locale;
  canApply: boolean;
  registry: readonly IndustryTemplateRow[];
  details: ReadonlyMap<string, IndustryTemplateDetail>;
  effective: EffectiveConfig | null;
}): JSX.Element {
  const d = getDictionary(locale);
  const router = useRouter();
  const applied = appliedOf(effective);
  const appliedRow = applied === null ? undefined : registry.find((row) => row.key === applied.key);
  const appliedDetail = applied === null ? undefined : details.get(applied.key);

  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [blockedGuidance, setBlockedGuidance] = useState<{ text: string; chain: readonly string[] } | null>(null);
  const [diffDialog, setDiffDialog] = useState<DiffDialogState | null>(null);
  const [drift, setDrift] = useState<TemplateDriftResult | null>(null);
  const [driftLoading, setDriftLoading] = useState(false);

  // Upgrade-offer drift check (holders only — the POST both checks and
  // records the offer; it never applies anything).
  useEffect(() => {
    if (!canApply || applied === null) {
      return;
    }
    void (async (): Promise<void> => {
      setDriftLoading(true);
      const result = await bffFetch<TemplateDriftResult>("configuration/templates/drift-check", {
        method: "POST",
        body: {},
      });
      setDriftLoading(false);
      if (result.ok) {
        setDrift(result.data);
      }
    })();
    // applied key changes only on refresh with a new server payload
  }, [canApply, applied?.key]);

  /** POST apply (first apply on a template-less tenant). */
  async function applyTemplate(row: IndustryTemplateRow): Promise<void> {
    setBusyKey(row.key);
    setActionError(null);
    setBlockedGuidance(null);
    setNotice(null);
    const result = await bffFetch<TemplateApplyOutcome>(
      `configuration/templates/${encodeURIComponent(row.key)}/apply`,
      { method: "POST", body: {} },
    );
    setBusyKey(null);
    if (result.ok) {
      setNotice(
        result.data.applied
          ? formatMessage(d.templatesApplyDone, { template: templateName(row, locale), version: result.data.version })
          : d.templatesApplyAlready,
      );
      router.refresh();
      return;
    }
    if (result.error.code === "configuration/template-prerequisites-blocked") {
      const guidance = blockedGuidanceOf(result.error.details);
      setBlockedGuidance({
        text: guidance !== null ? guidance[locale] : d.templatesBlockedGeneric,
        chain: missingChainOf(result.error.details),
      });
      return;
    }
    setActionError(localizedBillingError(d, result.error, result.retryAfterSeconds));
  }

  /** POST preview (the R9 diff — NO writes) and open the dialog. */
  async function openPreview(mode: "switch" | "extend", row: IndustryTemplateRow): Promise<void> {
    setDiffDialog({ mode, key: row.key, diff: null, loading: true, error: null, ackChecked: false });
    const result = await bffFetch<TemplateSwitchPreview>(
      `configuration/templates/${encodeURIComponent(row.key)}/preview`,
      { method: "POST", body: { mode } },
    );
    if (!result.ok) {
      setDiffDialog({
        mode,
        key: row.key,
        diff: null,
        loading: false,
        error: localizedBillingError(d, result.error, result.retryAfterSeconds),
        ackChecked: false,
      });
      return;
    }
    setDiffDialog({ mode, key: row.key, diff: result.data, loading: false, error: null, ackChecked: false });
  }

  /** POST switch/extend (with the acknowledgement when the diff requires it). */
  async function confirmSwitchOrExtend(): Promise<void> {
    const state = diffDialog;
    if (state === null) {
      return;
    }
    setBusyKey(state.key);
    setDiffDialog({ ...state, error: null });
    const result = await bffFetch<TemplateSwitchResult>(
      `configuration/templates/${encodeURIComponent(state.key)}/${state.mode}`,
      { method: "POST", body: state.ackChecked ? { acknowledged: true } : {} },
    );
    setBusyKey(null);
    if (result.ok) {
      const row = registry.find((candidate) => candidate.key === state.key);
      setNotice(
        result.data.applied
          ? formatMessage(
              state.mode === "switch" ? d.templatesSwitchDone : d.templatesExtendDone,
              { template: row === undefined ? state.key : templateName(row, locale) },
            )
          : d.templatesApplyAlready,
      );
      setDiffDialog(null);
      router.refresh();
      return;
    }
    if (result.error.code === "configuration/template-switch-acknowledgement-required") {
      // The typed error carries the FULL preview — render it and require the
      // explicit acknowledgement (BR-038; the honest "arrive later" wording).
      const preview = previewOfDetails(result.error.details);
      setDiffDialog({
        ...state,
        diff: preview ?? state.diff,
        ackChecked: false,
        error: d.templatesAckRequiredNote,
      });
      return;
    }
    if (result.error.code === "configuration/template-prerequisites-blocked") {
      const guidance = blockedGuidanceOf(result.error.details);
      setDiffDialog({
        ...state,
        error:
          guidance !== null
            ? `${d.templatesBlockedGeneric} ${guidance[locale]}`
            : d.templatesBlockedGeneric,
      });
      return;
    }
    setDiffDialog({
      ...state,
      error: localizedBillingError(d, result.error, result.retryAfterSeconds),
    });
  }

  const appliedCard: ReactNode =
    applied === null ? (
      <InfoNotice>{d.templatesNoneApplied}</InfoNotice>
    ) : (
      <Card title={d.templatesAppliedCard} ariaLabel={d.templatesAppliedCard}>
        {appliedRow === undefined ? (
          <ErrorNotice>{d.templatesAppliedNotInRegistry}</ErrorNotice>
        ) : (
          <DefList
            items={[
              {
                term: d.templatesKey,
                children: (
                  <span dir="ltr" className="font-mono text-xs">
                    {applied.key}
                  </span>
                ),
              },
              {
                term: d.templatesName,
                children: localizedName(appliedRow.name, appliedRow.nameAr, locale),
              },
              {
                term: d.templatesAppliedVersion,
                children: (
                  <span dir="ltr" className="font-mono">
                    v{appliedDetail?.appliedHere?.appliedVersion ?? applied.version}
                  </span>
                ),
              },
              {
                term: d.templatesHash,
                children: (
                  <span dir="ltr" className="font-mono text-xs">
                    {appliedDetail?.appliedHere?.appliedManifestHash !== undefined
                      ? shortHash(appliedDetail.appliedHere.appliedManifestHash)
                      : "—"}
                  </span>
                ),
              },
              {
                term: d.templatesStatus,
                children: <Badge tone="primary">{d.templatesStatusActive}</Badge>,
              },
            ]}
          />
        )}
        <p className="mt-2 text-xs text-gray-500">{d.templatesAppliedNote}</p>
      </Card>
    );

  return (
    <div className="flex flex-col gap-6">
      {notice !== null && <SuccessNotice>{notice}</SuccessNotice>}
      {actionError !== null && <ErrorNotice>{actionError}</ErrorNotice>}
      {blockedGuidance !== null && (
        <ErrorNotice>
          {blockedGuidance.text}
          {blockedGuidance.chain.length > 0 && (
            <span dir="ltr" className="mt-1 block font-mono text-xs">
              {blockedGuidance.chain.join(" · ")}
            </span>
          )}
        </ErrorNotice>
      )}

      {appliedCard}

      {canApply && applied !== null && (
        <Card title={d.templatesDriftTitle} ariaLabel={d.templatesDriftTitle}>
          {driftLoading ? (
            <p className="text-sm text-gray-600">{d.loading}</p>
          ) : drift === null ? (
            <p className="text-sm text-gray-600">{d.templatesDriftPending}</p>
          ) : drift.status === "current" ? (
            <p className="text-sm text-gray-700">{d.templatesDriftCurrent}</p>
          ) : drift.status === "registry-behind" ? (
            <p role="note" className="rounded-md border border-warning-border bg-warning-bg px-3 py-2 text-sm text-warning-text">
              {d.templatesDriftBehind}
            </p>
          ) : drift.status === "upgrade-available" ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-gray-700">
                {formatMessage(d.templatesDriftAvailable, {
                  registry: drift.registryVersion ?? "—",
                  applied: drift.appliedVersion ?? "—",
                })}
              </p>
              {drift.drift === "major" ? (
                <p role="alert" className="rounded-md border border-danger-border bg-danger-bg px-3 py-2 text-sm text-danger-text">
                  {d.templatesDriftMajor}
                </p>
              ) : (
                <p className="text-sm text-gray-600">{d.templatesDriftWhatNext}</p>
              )}
              {drift.notification?.recorded === true && (
                <p className="text-xs text-gray-500">{d.templatesDriftRecorded}</p>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busyKey !== null}
                  onClick={() => {
                    const row = registry.find((candidate) => candidate.key === drift.templateKey);
                    if (row !== undefined) {
                      void openPreview("switch", row);
                    }
                  }}
                >
                  {d.templatesDriftReview}
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-600">{d.templatesDriftPending}</p>
          )}
          <p className="mt-2 text-xs text-gray-500">{d.templatesDriftNeverAuto}</p>
        </Card>
      )}

      <section aria-label={d.templatesRegistryTitle} className="flex flex-col gap-3">
        <h2 className="text-md font-semibold text-gray-900">{d.templatesRegistryTitle}</h2>
        {!canApply && <InfoNotice>{d.templatesNoPermission}</InfoNotice>}
        <div className="grid gap-4 lg:grid-cols-3">
          {registry.map((row) => (
            <RegistryCard
              key={row.key}
              locale={locale}
              row={row}
              detail={details.get(row.key)}
              isApplied={applied?.key === row.key}
              busy={busyKey === row.key}
              canApply={canApply}
              hasApplied={applied !== null}
              onApply={() => void applyTemplate(row)}
              onPreview={(mode) => void openPreview(mode, row)}
            />
          ))}
        </div>
      </section>

      {effective !== null && <PolicyDefaults locale={locale} effective={effective} appliedDetail={appliedDetail} />}

      <Dialog
        open={diffDialog !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDiffDialog(null);
          }
        }}
        title={d.templatesDiffTitle}
        description={
          diffDialog !== null
            ? formatMessage(d.templatesDiffDescription, {
                mode: diffDialog.mode === "switch" ? d.templatesModeSwitch : d.templatesModeExtend,
              })
            : undefined
        }
        size="lg"
      >
        {diffDialog !== null && (
          <SwitchDiffBody
            locale={locale}
            state={diffDialog}
            busy={busyKey !== null}
            onAckChange={(checked) => setDiffDialog({ ...diffDialog, ackChecked: checked })}
            onConfirm={() => void confirmSwitchOrExtend()}
          />
        )}
      </Dialog>
    </div>
  );
}

/** "{template}" display name helper. */
function templateName(row: IndustryTemplateRow, locale: Locale): string {
  return localizedName(row.name, row.nameAr, locale);
}

/** One registry card with its §4 capability preview and permission-gated actions. */
function RegistryCard({
  locale,
  row,
  detail,
  isApplied,
  hasApplied,
  busy,
  canApply,
  onApply,
  onPreview,
}: {
  locale: Locale;
  row: IndustryTemplateRow;
  detail: IndustryTemplateDetail | undefined;
  isApplied: boolean;
  hasApplied: boolean;
  busy: boolean;
  canApply: boolean;
  onApply: () => void;
  onPreview: (mode: "switch" | "extend") => void;
}): JSX.Element {
  const d = getDictionary(locale);
  const preview = detail?.capabilityPreview;
  const description =
    locale === "ar"
      ? (row.descriptionAr ?? row.description ?? "")
      : (row.description ?? row.descriptionAr ?? "");
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-subtle bg-surface-card p-4 shadow-e1">
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col">
          <span className="text-sm font-semibold text-gray-900">{templateName(row, locale)}</span>
          <span className="text-xs text-gray-500">
            <span dir="ltr" className="font-mono">
              {row.key}
            </span>
          </span>
        </div>
        {isApplied ? (
          <Badge tone="primary">{d.templatesAppliedBadge}</Badge>
        ) : (
          <span dir="ltr" className="font-mono text-xs text-gray-500">
            v{row.version}
          </span>
        )}
      </div>
      {description !== "" && <p className="text-xs text-gray-600">{description}</p>}
      {preview !== undefined ? (
        <ul
          className="flex max-h-64 flex-col gap-1.5 overflow-y-auto"
          aria-label={d.industryCapabilitiesLabel}
        >
          {preview.capabilities.map((capability) => (
            <li key={capability.capabilityId} className="flex flex-wrap items-center gap-1.5">
              <CapabilityChip locale={locale} status={capability.status} phase={capability.phase} />
              <span className="text-xs text-gray-600">
                {capabilityLabelText(capability.capabilityId)[locale]}
                {capability.level === "REQUIRED" && (
                  <span className="ms-1 text-gray-400">· {d.industryCapRequired}</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-gray-500">{d.industryCapabilitiesPending}</p>
      )}
      {canApply && !isApplied && (
        <div className="mt-auto flex flex-wrap items-center gap-2">
          {!hasApplied ? (
            <Button type="button" variant="primary" loading={busy} disabled={busy} onClick={onApply}>
              {d.templatesApplyButton}
            </Button>
          ) : (
            <>
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() => onPreview("switch")}
              >
                {d.templatesPreviewSwitch}
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() => onPreview("extend")}
              >
                {d.templatesPreviewExtend}
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** The §4 status chip vocabulary (shared with the onboarding industry step). */
function CapabilityChip({
  locale,
  status,
  phase,
}: {
  locale: Locale;
  status: "included" | "phase_gated" | "hidden" | "blocked";
  phase?: string;
}): JSX.Element {
  const d = getDictionary(locale);
  switch (status) {
    case "included":
      return <Badge tone="primary">{d.industryCapIncluded}</Badge>;
    case "phase_gated":
      return (
        <StatusChip tone="warning">
          {d.industryCapPhaseGated.replace("{phase}", (phase ?? "").replace(/^PHASE-/, ""))}
        </StatusChip>
      );
    case "hidden":
      return <StatusChip tone="neutral">{d.industryCapOptional}</StatusChip>;
    case "blocked":
      return <StatusChip tone="neutral">{d.industryCapBlocked}</StatusChip>;
  }
}

/** Local status chip on @erp/ui semantic tokens (BillingHistory's chip pattern). */
function StatusChip({ children, tone }: { children: string; tone: "warning" | "neutral" }): JSX.Element {
  const toneClass =
    tone === "warning"
      ? "border-warning-border bg-warning-bg text-warning-text"
      : "border-subtle bg-gray-100 text-gray-600";
  return (
    <span
      className={`inline-flex w-fit items-center rounded-sm border px-1.5 py-0.5 text-xs leading-4 ${toneClass}`}
    >
      {children}
    </span>
  );
}

/** Capability id → bilingual label (the shared registry vocabulary; unknown ids pass through). */
function capabilityLabelText(capabilityId: string): ConfigLocalizedText {
  const known: Record<string, ConfigLocalizedText> = {
    barcode_pos: { ar: "نقطة البيع بالباركود", en: "Barcode POS" },
    cashier_shifts: { ar: "ورديات الصندوق", en: "Cashier shifts" },
    imei_tracking: { ar: "تتبّع أجهزة IMEI", en: "IMEI tracking" },
    composite_kits: { ar: "الأصناف المركّبة", en: "Composite kits" },
    free_goods_promo: { ar: "عروض الأصناف المجانية", en: "Free-goods promotions" },
    landed_costs: { ar: "التكاليف الواردة", en: "Landed costs" },
    scale_barcodes: { ar: "باركود الميزان", en: "Scale barcodes" },
    expiry_tracking_fefo: { ar: "تتبّع الصلاحية (FEFO)", en: "Expiry tracking (FEFO)" },
    customer_price_tiers: { ar: "فئات أسعار العملاء", en: "Customer price tiers" },
    qc_inspections: { ar: "فحوص الجودة", en: "QC inspections" },
    table_service: { ar: "خدمة الطاولات", en: "Table service" },
    kitchen_display: { ar: "شاشة المطبخ", en: "Kitchen display" },
    bom_production: { ar: "قوائم المواد والإنتاج", en: "BOM & production" },
  };
  return known[capabilityId] ?? { ar: capabilityId, en: capabilityId };
}

/** The R9 what-will-change dialog body (BR-038 rules annotations R3/R5/R6). */
function SwitchDiffBody({
  locale,
  state,
  busy,
  onAckChange,
  onConfirm,
}: {
  locale: Locale;
  state: DiffDialogState;
  busy: boolean;
  onAckChange: (checked: boolean) => void;
  onConfirm: () => void;
}): JSX.Element {
  const d = getDictionary(locale);
  const diff = state.diff;
  if (state.loading) {
    return <p className="text-sm text-gray-600">{d.loading}</p>;
  }
  if (diff === null) {
    return <ErrorNotice>{state.error ?? d.errorsGeneric}</ErrorNotice>;
  }
  const row = (label: string, children: ReactNode): ReactNode => (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
      <span className="text-xs text-gray-600 sm:w-36 sm:shrink-0">{label}</span>
      <span className="min-w-0 text-sm text-gray-900">{children}</span>
    </div>
  );
  const keyList = (keys: readonly string[]): ReactNode => (
    <span dir="ltr" className="font-mono text-xs">
      {keys.join(" · ")}
    </span>
  );
  return (
    <div className="flex flex-col gap-4">
      {state.error !== null && <ErrorNotice>{state.error}</ErrorNotice>}
      <p className="text-sm text-gray-700">
        {formatMessage(d.templatesDiffFromTo, {
          from: diff.fromTemplate === null ? "—" : diff.fromTemplate.key,
          to: diff.toTemplate.key,
        })}{" "}
        <span dir="ltr" className="font-mono text-xs text-gray-500">
          v{diff.toTemplate.version}
        </span>
      </p>

      {diff.blocked && (
        <ErrorNotice>
          {d.templatesDiffBlocked}
          {diff.missingChain.length > 0 && (
            <span dir="ltr" className="mt-1 block font-mono text-xs">
              {diff.missingChain.join(" · ")}
            </span>
          )}
        </ErrorNotice>
      )}

      <section className="flex flex-col gap-2" aria-label={d.templatesDiffAddedCaps}>
        <h3 className="text-sm font-semibold text-gray-900">{d.templatesDiffAddedCaps}</h3>
        {diff.addedCapabilities.included.length > 0 && (
          <>
            <p className="text-xs font-medium text-gray-600">{d.templatesDiffAddedIncluded}</p>
            <ul className="flex flex-col gap-1">
              {diff.addedCapabilities.included.map((capability) => (
                <li key={capability.capabilityId} className="text-sm text-gray-800">
                  {capabilityLabelText(capability.capabilityId)[locale]}
                </li>
              ))}
            </ul>
          </>
        )}
        {diff.addedCapabilities.phaseGated.length > 0 && (
          <>
            <p className="text-xs font-medium text-gray-600">{d.templatesDiffAddedPhaseGated}</p>
            <ul className="flex flex-col gap-1">
              {diff.addedCapabilities.phaseGated.map((capability) => (
                <li key={capability.capabilityId} className="flex flex-wrap items-center gap-1.5">
                  <StatusChip tone="warning">
                    {d.industryCapPhaseGated.replace(
                      "{phase}",
                      (capability.phase ?? "").replace(/^PHASE-/, ""),
                    )}
                  </StatusChip>
                  <span className="text-sm text-gray-800">
                    {capabilityLabelText(capability.capabilityId)[locale]}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
        {diff.addedCapabilities.optionalMissing.length > 0 && (
          <>
            <p className="text-xs font-medium text-gray-600">{d.templatesDiffAddedOptionalMissing}</p>
            <ul className="flex flex-col gap-1">
              {diff.addedCapabilities.optionalMissing.map((capability) => (
                <li key={capability.capabilityId} className="text-sm text-gray-800">
                  {capabilityLabelText(capability.capabilityId)[locale]}
                </li>
              ))}
            </ul>
          </>
        )}
        {diff.addedCapabilities.included.length === 0 &&
          diff.addedCapabilities.phaseGated.length === 0 &&
          diff.addedCapabilities.optionalMissing.length === 0 && (
            <p className="text-xs text-gray-500">{d.templatesDiffEmpty}</p>
          )}
      </section>

      {diff.archivedCapabilities.length > 0 && (
        <section className="flex flex-col gap-1" aria-label={d.templatesDiffArchived}>
          <h3 className="text-sm font-semibold text-gray-900">{d.templatesDiffArchived}</h3>
          <ul className="flex flex-col gap-1">
            {diff.archivedCapabilities.map((capability) => (
              <li key={capability.capabilityId} className="text-sm text-gray-800">
                {capabilityLabelText(capability.capabilityId)[locale]}
              </li>
            ))}
          </ul>
          <p className="text-xs text-gray-500">{d.templatesDiffArchivedNote}</p>
        </section>
      )}

      {diff.renamedLabels.length > 0 && (
        <section className="flex flex-col gap-1" aria-label={d.templatesDiffRenamed}>
          <h3 className="text-sm font-semibold text-gray-900">{d.templatesDiffRenamed}</h3>
          <ul className="flex max-h-48 flex-col gap-1.5 overflow-y-auto">
            {diff.renamedLabels.map((entry) => (
              <li key={entry.termKey} className="flex flex-col gap-0.5">
                <span dir="ltr" className="font-mono text-xs text-gray-500">
                  {entry.termKey}
                </span>
                <span className="text-sm text-gray-800">
                  <span dir="rtl" lang="ar">
                    {entry.from?.ar ?? "—"} ← {entry.to?.ar ?? "—"}
                  </span>
                  <span className="mx-1 text-gray-400">·</span>
                  <span dir="ltr" lang="en">
                    {entry.from?.en ?? "—"} → {entry.to?.en ?? "—"}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {diff.newNumberingSeries.length > 0 && (
        <section className="flex flex-col gap-1" aria-label={d.templatesDiffSeries}>
          <h3 className="text-sm font-semibold text-gray-900">{d.templatesDiffSeries}</h3>
          <ul className="flex flex-col gap-1">
            {diff.newNumberingSeries.map((series) => (
              <li key={series.docType}>
                {row(
                  series.docType,
                  <span dir="ltr" className="font-mono text-xs">
                    {series.format}
                  </span>,
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {diff.keptNumberingSeries.length > 0 && (
        <p className="text-xs text-gray-500">
          {d.templatesDiffKeptSeries}{" "}
          <span dir="ltr" className="font-mono text-xs">
            {diff.keptNumberingSeries.map((series) => series.docType).join(" · ")}
          </span>
        </p>
      )}

      {diff.inventoryDefaultChanges.length > 0 && (
        <section className="flex flex-col gap-1" aria-label={d.templatesDiffInventory}>
          <h3 className="text-sm font-semibold text-gray-900">{d.templatesDiffInventory}</h3>
          <ul className="flex flex-col gap-1">
            {diff.inventoryDefaultChanges.map((change) => (
              <li key={change.key}>
                {row(
                  change.key,
                  <span dir="ltr" className="font-mono text-xs">
                    {String(change.from)} → {String(change.to)}
                  </span>,
                )}
              </li>
            ))}
          </ul>
          <p className="text-xs text-gray-500">{d.templatesDiffInventoryNote}</p>
        </section>
      )}

      {diff.workflowPolicyChanges.length > 0 && (
        <section className="flex flex-col gap-1" aria-label={d.templatesDiffPolicies}>
          <h3 className="text-sm font-semibold text-gray-900">{d.templatesDiffPolicies}</h3>
          <ul className="flex flex-col gap-1">
            {diff.workflowPolicyChanges.map((change) => (
              <li key={change.key}>
                {row(
                  change.key,
                  <span>
                    <span dir="ltr" className="font-mono text-xs">
                      {change.from === null ? "—" : String(change.from)} → {String(change.to)}
                    </span>
                    {change.conflict && (
                      <span className="ms-2 text-xs text-warning-text">
                        {d.templatesDiffPolicyConflict}
                      </span>
                    )}
                  </span>,
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {(diff.reportPinChanges.added.length > 0 || diff.reportPinChanges.removed.length > 0) && (
        <section className="flex flex-col gap-1" aria-label={d.templatesDiffPins}>
          <h3 className="text-sm font-semibold text-gray-900">{d.templatesDiffPins}</h3>
          {diff.reportPinChanges.added.length > 0 &&
            row(d.templatesDiffPinsAdded, keyList(diff.reportPinChanges.added))}
          {diff.reportPinChanges.removed.length > 0 &&
            row(d.templatesDiffPinsRemoved, keyList(diff.reportPinChanges.removed))}
        </section>
      )}

      {(diff.onboardingChecklistChanges.added.length > 0 ||
        diff.onboardingChecklistChanges.removed.length > 0) && (
        <section className="flex flex-col gap-1" aria-label={d.templatesDiffChecklist}>
          <h3 className="text-sm font-semibold text-gray-900">{d.templatesDiffChecklist}</h3>
          {diff.onboardingChecklistChanges.added.length > 0 &&
            row(d.templatesDiffPinsAdded, keyList(diff.onboardingChecklistChanges.added))}
          {diff.onboardingChecklistChanges.removed.length > 0 &&
            row(d.templatesDiffPinsRemoved, keyList(diff.onboardingChecklistChanges.removed))}
        </section>
      )}

      {diff.acknowledgementRequired && !diff.blocked && (
        <div className="flex flex-col gap-2 rounded-md border border-warning-border bg-warning-bg p-3">
          <p className="text-sm text-warning-text">{d.templatesAckRequiredNote}</p>
          <Checkbox
            label={formatMessage(d.templatesAckLabel, {
              phases: diff.acknowledgementPhases.join(", "),
            })}
            checked={state.ackChecked}
            onCheckedChange={(checked) => onAckChange(checked === true)}
          />
        </div>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-subtle pt-3">
        <Button
          type="button"
          variant="primary"
          disabled={
            busy || diff.blocked || (diff.acknowledgementRequired && !state.ackChecked)
          }
          onClick={onConfirm}
        >
          {state.mode === "switch" ? d.templatesSwitchButton : d.templatesExtendButton}
        </Button>
      </div>
    </div>
  );
}

/**
 * The effective policy defaults (read-only) with per-key source badges ONLY
 * where the payloads can prove them:
 *
 * - "قالب الصناعة" (template default, L1): the applied template's UNMAPPED
 *   workflow_policies keys appear in the merged map verbatim — no other
 *   layer can produce those keys (mergePolicies writes settings keys and
 *   approvals.* only);
 * - "إعدادك" (your explicit setting, L5): a numbering.<dt>.assign_at value
 *   that contradicts the template's reserve_on_approval posture could only
 *   come from the tenant's explicit numbering.defaults row;
 * - everything else carries NO badge: the payload merges L5/L1/platform
 *   values without per-key provenance (GET /tenancy/settings returns the
 *   effective snapshot — defaults merged in — so explicit-vs-default is not
 *   distinguishable client-side). The single note says so honestly.
 */
function PolicyDefaults({
  locale,
  effective,
  appliedDetail,
}: {
  locale: Locale;
  effective: EffectiveConfig;
  appliedDetail: IndustryTemplateDetail | undefined;
}): JSX.Element {
  const d = getDictionary(locale);
  const manifest = appliedDetail?.manifest;
  const keys = Object.keys(effective.policies)
    .filter((key) => {
      const value = effective.policies[key];
      return value !== undefined;
    })
    .sort();
  const templatePolicyKeys = new Set<string>(
    manifest === undefined ? [] : Object.keys(manifest.workflow_policies),
  );

  function sourceOf(key: string, value: string | number | boolean): "template" | "tenant" | null {
    if (templatePolicyKeys.has(key)) {
      return "template";
    }
    if (key.startsWith("numbering.") && key.endsWith(".assign_at")) {
      const docType = key.slice("numbering.".length, -".assign_at".length);
      const rule = manifest?.document_numbering_defaults[
        docType as keyof typeof manifest.document_numbering_defaults
      ];
      const reserveOnApproval = rule !== undefined && "reserve_on_approval" in rule ? rule.reserve_on_approval : false;
      if (value === "approval" && !reserveOnApproval) {
        return "tenant";
      }
      if (value === "posting" && reserveOnApproval) {
        return "tenant";
      }
    }
    return null;
  }

  return (
    <section aria-label={d.templatesPoliciesTitle} className="flex flex-col gap-3">
      <h2 className="text-md font-semibold text-gray-900">{d.templatesPoliciesTitle}</h2>
      <p className="text-sm text-gray-600">{d.templatesPoliciesNote}</p>
      <div className="overflow-x-auto rounded-lg border border-subtle bg-surface-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-subtle text-start">
              <th scope="col" className="px-3 py-2 text-start text-xs font-medium text-gray-600">
                {d.templatesPolicyKey}
              </th>
              <th scope="col" className="px-3 py-2 text-start text-xs font-medium text-gray-600">
                {d.templatesPolicyValue}
              </th>
              <th scope="col" className="px-3 py-2 text-start text-xs font-medium text-gray-600">
                {d.templatesPolicySource}
              </th>
            </tr>
          </thead>
          <tbody>
            {keys.map((key) => {
              const value = effective.policies[key];
              if (value === undefined) {
                return null;
              }
              const source = sourceOf(key, value);
              return (
                <tr key={key} className="border-b border-subtle last:border-b-0">
                  <td className="px-3 py-2">
                    <span dir="ltr" className="font-mono text-xs text-gray-800">
                      {key}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-gray-900">
                    {typeof value === "boolean" ? (
                      value ? d.templatesPolicyOn : d.templatesPolicyOff
                    ) : (
                      <span dir="ltr" className="font-mono text-xs">
                        {String(value)}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {source === "template" ? (
                      <Badge tone="primary">{d.templatesPolicySourceTemplate}</Badge>
                    ) : source === "tenant" ? (
                      <Badge tone="neutral">{d.templatesPolicySourceTenant}</Badge>
                    ) : (
                      <span className="text-xs text-gray-400">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-500">{d.templatesPolicyLegend}</p>
    </section>
  );
}
