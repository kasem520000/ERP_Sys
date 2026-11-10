"use client";

/**
 * PHASE-015 T11 (task 3-a) — the onboarding wizard's FIRST step: choose your
 * industry (industries/README §4 onboarding flow, steps 1–3).
 *
 * - activity picker from the bilingual activity catalog
 *   (`GET /api/v1/configuration/templates/activity-map`): the three catalog
 *   cards select their template directly (exact confidence by construction);
 *   free text resolves through the same endpoint's `?activity=` resolution —
 *   an "exact" hit selects, a "suggested" hit is CONFIRMED by the registrant
 *   before it counts (never a silent guess), and no match is stated honestly
 *   (plain onboarding, no wrong-industry template);
 * - template cards for the registry's ACTIVE templates (name AR/EN +
 *   description + the §4 capability preview resolved against the caller's
 *   entitlements: included / phase-gated "قادم مع المرحلة 0NN" / optional
 *   (not on the plan) / blocked (guided plan-selection guidance + the exact
 *   missing chain — a blocked card cannot be selected, the apply would fail);
 * - the honest skip-forever option: "no industry template — plain workspace".
 *   The workspace continues on platform defaults; templates can be applied
 *   later from the Industry & templates screen. The industry step is NOT a
 *   journey milestone (nothing is written here — the applied template is
 *   recorded server-side on tenant_industry_config by the apply call, which
 *   the wizard fires only AFTER provisioning succeeds).
 */

import { useEffect, useState } from "react";
import type { JSX, RefObject } from "react";

import { Badge, Button, Input } from "@erp/ui";

import { getDictionary, type Locale } from "../../i18n/dictionaries";
import type {
  ActivityMapData,
  ConfigLocalizedText,
  IndustryTemplateDetail,
  IndustryTemplateRow,
  PrerequisiteCapabilityState,
} from "../../lib/api-types";
import { bffFetch } from "../../lib/client-api";
import { localizedName } from "../../lib/messages";
import { Card } from "../card";
import { ErrorNotice, InfoNotice } from "../notices";

/** The wizard-owned industry selection (a registry key + its bilingual name). */
export interface IndustrySelection {
  key: string;
  label: ConfigLocalizedText;
}

/** The applied-template identity as resolved server-side (effective config L1). */
export interface AppliedTemplateInfo {
  key: string;
  version: string;
}

export function IndustryStep({
  locale,
  appliedTemplate,
  selection,
  busy,
  headingRef,
  onSelect,
  onContinue,
  onSkip,
}: {
  locale: Locale;
  /** Already-applied template (resumed wizard / applied elsewhere) — honest summary. */
  appliedTemplate: AppliedTemplateInfo | null;
  /** The wizard-owned selection (null = plain workspace / nothing chosen yet). */
  selection: IndustrySelection | null;
  busy: boolean;
  /** The wizard's step-heading focus target (focus lands on every step change). */
  headingRef: RefObject<HTMLHeadingElement | null>;
  onSelect: (selection: IndustrySelection | null) => void;
  /** Proceed to the provisioning step (with the current selection). */
  onContinue: () => void;
  /** The honest skip-forever: plain workspace, no template. */
  onSkip: () => void;
}): JSX.Element {
  const d = getDictionary(locale);
  const [registry, setRegistry] = useState<readonly IndustryTemplateRow[] | null>(null);
  const [activityMap, setActivityMap] = useState<ActivityMapData | null>(null);
  const [details, setDetails] = useState<ReadonlyMap<string, IndustryTemplateDetail>>(new Map());
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activityText, setActivityText] = useState("");
  const [resolving, setResolving] = useState(false);
  // The free-text resolution outcome ("suggested" needs explicit confirmation).
  const [resolution, setResolution] = useState<
    { templateKey: string; confidence: "exact" | "suggested" } | "no-match" | null
  >(null);

  // Registry + activity catalog on mount (both session routes); the per-
  // template capability previews resolve in parallel right after.
  useEffect(() => {
    void (async (): Promise<void> => {
      const [registryResult, activityResult] = await Promise.all([
        bffFetch<readonly IndustryTemplateRow[]>("configuration/templates"),
        bffFetch<ActivityMapData>("configuration/templates/activity-map"),
      ]);
      if (!registryResult.ok || !activityResult.ok) {
        setLoadError(d.industryLoadError);
        return;
      }
      setRegistry(registryResult.data);
      setActivityMap(activityResult.data);
      const entries = await Promise.all(
        registryResult.data.map(async (row) => {
          const detail = await bffFetch<IndustryTemplateDetail>(
            `configuration/templates/${encodeURIComponent(row.key)}`,
          );
          return detail.ok ? ([row.key, detail.data] as const) : null;
        }),
      );
      setDetails(
        new Map(
          entries.filter(
            (entry): entry is readonly [string, IndustryTemplateDetail] => entry !== null,
          ),
        ),
      );
    })();
    // The dictionary lookup is a stable module singleton per locale.
  }, [d]);

  /** Resolve free text through the activity-map endpoint (?activity=). */
  async function resolveActivityText(): Promise<void> {
    const text = activityText.trim();
    if (text === "") {
      return;
    }
    setResolving(true);
    setResolution(null);
    const result = await bffFetch<ActivityMapData>(
      `configuration/templates/activity-map?activity=${encodeURIComponent(text)}`,
    );
    setResolving(false);
    if (!result.ok || result.data.resolution === null) {
      setResolution("no-match");
      return;
    }
    setResolution({
      templateKey: result.data.resolution.templateKey,
      confidence: result.data.resolution.confidence,
    });
    if (result.data.resolution.confidence === "exact") {
      selectTemplateKey(result.data.resolution.templateKey);
    }
  }

  /** Select by key, resolving the bilingual label from the registry rows. */
  function selectTemplateKey(key: string): void {
    const row = registry?.find((candidate) => candidate.key === key);
    onSelect(
      row === undefined
        ? { key, label: { ar: key, en: key } }
        : { key, label: { ar: row.nameAr, en: row.name } },
    );
  }

  const resolutionNote: JSX.Element | null =
    resolution === null
      ? null
      : resolution === "no-match"
        ? <InfoNotice>{d.industryNoMatch}</InfoNotice>
        : resolution.confidence === "exact"
          ? <InfoNotice>
              {templateNameMessage(d.industryResolvedExact, resolution.templateKey, locale, registry)}
            </InfoNotice>
          : <InfoNotice>
              {templateNameMessage(d.industryResolvedSuggested, resolution.templateKey, locale, registry)}
            </InfoNotice>;

  return (
    <div className="flex w-full flex-col gap-4">
      <h2 ref={headingRef} tabIndex={-1} className="outline-none text-md font-semibold text-gray-900">
        {d.onboardingStepIndustry}
      </h2>

      {appliedTemplate !== null ? (
        <Card title={d.industryAlreadyAppliedTitle} ariaLabel={d.industryAlreadyAppliedTitle}>
          <p className="text-sm text-gray-700">
            {templateNameMessage(d.industryAlreadyApplied, appliedTemplate.key, locale, registry)}{" "}
            <span dir="ltr" className="font-mono text-xs text-gray-500">
              v{appliedTemplate.version}
            </span>
          </p>
          <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
            <Button type="button" variant="primary" disabled={busy} onClick={onContinue}>
              {d.industryContinue}
            </Button>
          </div>
        </Card>
      ) : (
        <>
          <p className="text-sm text-gray-600">{d.industryIntro}</p>
          {loadError !== null && <ErrorNotice>{loadError}</ErrorNotice>}

          {activityMap !== null && (
            <fieldset className="flex flex-col gap-3">
              <legend className="mb-1 text-sm font-medium text-gray-700">
                {d.industryActivityQuestion}
              </legend>
              <div className="grid gap-3 sm:grid-cols-3">
                {activityMap.activities.map((activity) => {
                  const isSelected = selection?.key === activity.templateKey;
                  return (
                    <button
                      key={activity.activity}
                      type="button"
                      aria-pressed={isSelected}
                      disabled={busy}
                      onClick={() =>
                        onSelect(isSelected ? null : {
                          key: activity.templateKey,
                          label: activity.label,
                        })
                      }
                      className={
                        isSelected
                          ? "flex min-h-11 flex-col gap-1 rounded-lg border border-primary-600 bg-primary-50 p-4 text-start outline-none"
                          : "flex min-h-11 flex-col gap-1 rounded-lg border border-subtle bg-surface-card p-4 text-start outline-none transition-colors duration-150 ease-standard hover:border-strong"
                      }
                    >
                      <span className="text-sm font-medium text-gray-900">
                        {activity.label[locale]}
                      </span>
                      <span className="text-xs text-gray-500">
                        {activity.label[locale === "ar" ? "en" : "ar"]}
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <div className="flex-1">
                  <Input
                    id="onb-activity-text"
                    label={d.industryActivityOther}
                    value={activityText}
                    onValueChange={(value) => {
                      setActivityText(value);
                      setResolution(null);
                    }}
                  />
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  loading={resolving}
                  disabled={busy || activityText.trim() === ""}
                  onClick={() => void resolveActivityText()}
                >
                  {d.industryActivityResolve}
                </Button>
              </div>
              {resolutionNote}
            </fieldset>
          )}

          {registry !== null && (
            <fieldset className="flex flex-col gap-3">
              <legend className="mb-1 text-sm font-medium text-gray-700">
                {d.industryTemplatesLabel}
              </legend>
              <div className="grid gap-3 lg:grid-cols-3">
                {registry.map((row) => (
                  <TemplateCard
                    key={row.key}
                    locale={locale}
                    row={row}
                    detail={details.get(row.key)}
                    selected={selection?.key === row.key}
                    disabled={busy}
                    onSelect={() =>
                      onSelect(
                        selection?.key === row.key
                          ? null
                          : { key: row.key, label: { ar: row.nameAr, en: row.name } },
                      )
                    }
                  />
                ))}
              </div>
            </fieldset>
          )}

          <InfoNotice>{d.industryApplyAfterProvisionNote}</InfoNotice>

          <div className="sticky bottom-0 flex flex-wrap items-center justify-end gap-2 border-t border-subtle pt-3">
            <Button type="button" variant="ghost" disabled={busy} onClick={onSkip}>
              {d.industrySkipPlain}
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={busy || selection === null}
              onClick={onContinue}
            >
              {d.industryContinue}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

/** One template card: bilingual name, description, capability preview (§4). */
function TemplateCard({
  locale,
  row,
  detail,
  selected,
  disabled,
  onSelect,
}: {
  locale: Locale;
  row: IndustryTemplateRow;
  detail: IndustryTemplateDetail | undefined;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
}): JSX.Element {
  const d = getDictionary(locale);
  const preview = detail?.capabilityPreview;
  const blocked = preview?.status === "blocked";
  const description =
    locale === "ar"
      ? (row.descriptionAr ?? row.description ?? "")
      : (row.description ?? row.descriptionAr ?? "");
  return (
    <div
      className={
        selected
          ? "flex flex-col gap-3 rounded-lg border border-primary-600 bg-primary-50/40 p-4"
          : "flex flex-col gap-3 rounded-lg border border-subtle bg-surface-card p-4"
      }
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col">
          <span className="text-sm font-semibold text-gray-900">
            {localizedName(row.name, row.nameAr, locale)}
          </span>
          <span className="text-xs text-gray-500">
            {localizedName(row.name, row.nameAr, locale === "ar" ? "en" : "ar")}
          </span>
        </div>
        <span dir="ltr" className="font-mono text-xs text-gray-500">
          v{row.version}
        </span>
      </div>
      {description !== "" && <p className="text-xs text-gray-600">{description}</p>}
      {preview !== undefined && (
        <ul
          className="flex max-h-64 flex-col gap-1.5 overflow-y-auto"
          aria-label={d.industryCapabilitiesLabel}
        >
          {preview.capabilities.map((capability) => (
            <li key={capability.capabilityId} className="flex flex-wrap items-center gap-1.5">
              <CapabilityStatusChip locale={locale} capability={capability} />
              <span className="text-xs text-gray-600">
                {capabilityLabelText(capability.capabilityId)[locale]}
                {capability.level === "REQUIRED" && (
                  <span className="ms-1 text-gray-400">· {d.industryCapRequired}</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {detail === undefined && (
        <p className="text-xs text-gray-500">{d.industryCapabilitiesPending}</p>
      )}
      {blocked && preview !== undefined && preview.guidance !== null && (
        <p
          role="alert"
          className="rounded-md border border-danger-border bg-danger-bg px-2 py-1.5 text-xs text-danger-text"
        >
          {preview.guidance[locale]}
          {preview.missingChain.length > 0 && (
            <span dir="ltr" className="mt-1 block font-mono text-xs text-danger-text">
              {preview.missingChain.join(" · ")}
            </span>
          )}
        </p>
      )}
      <div className="mt-auto flex items-center justify-between gap-2">
        {selected ? (
          <Badge tone="primary">{d.industrySelectedBadge}</Badge>
        ) : blocked ? (
          <Badge tone="neutral">{d.industryBlockedBadge}</Badge>
        ) : (
          <span />
        )}
        <Button
          type="button"
          variant={selected ? "secondary" : "primary"}
          disabled={disabled || blocked}
          onClick={onSelect}
        >
          {selected ? d.industryDeselect : d.industrySelect}
        </Button>
      </div>
    </div>
  );
}

/** The §4 status chip vocabulary: included / coming with phase / optional / blocked. */
function CapabilityStatusChip({
  locale,
  capability,
}: {
  locale: Locale;
  capability: PrerequisiteCapabilityState;
}): JSX.Element {
  const d = getDictionary(locale);
  switch (capability.status) {
    case "included":
      return <Badge tone="primary">{d.industryCapIncluded}</Badge>;
    case "phase_gated":
      return <StatusChip tone="warning">{phaseLabel(d.industryCapPhaseGated, capability.phase)}</StatusChip>;
    case "hidden":
      return <StatusChip tone="neutral">{d.industryCapOptional}</StatusChip>;
    case "blocked":
      return <StatusChip tone="neutral">{d.industryCapBlocked}</StatusChip>;
  }
}

/**
 * Local status chip on @erp/ui semantic tokens (the catalog Badge ships only
 * neutral/primary tones; warnings compose the token classes — the same
 * pattern as billing-history's usage chips and the notices).
 */
function StatusChip({
  children,
  tone,
}: {
  children: string;
  tone: "warning" | "neutral";
}): JSX.Element {
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

/** "قادم مع المرحلة {phase}" — the payload phase is "PHASE-0NN". */
function phaseLabel(template: string, phase: string | undefined): string {
  return template.replace("{phase}", (phase ?? "").replace(/^PHASE-/, ""));
}

/**
 * Capability id → bilingual display label. The manifest capability ids are
 * stable registry vocabulary shared by the three shipped templates (verified
 * against RETAIL/GROCERY/RESTAURANT manifests); unknown ids pass through
 * verbatim — never invented.
 */
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

/** "{template}" placeholder resolution against the registry's bilingual names. */
function templateNameMessage(
  template: string,
  templateKey: string,
  locale: Locale,
  registry: readonly IndustryTemplateRow[] | null,
): string {
  const row = registry?.find((candidate) => candidate.key === templateKey);
  const name = row === undefined ? templateKey : localizedName(row.name, row.nameAr, locale);
  return template.replace("{template}", name);
}
