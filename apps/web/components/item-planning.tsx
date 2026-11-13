"use client";

/**
 * PHASE-043 T-14 (part 2) — the item card's planning tab: the planning
 * policy editor over GET/PUT manufacturing/planning/policies/:itemId (the
 * planning_policies tier). The policy loads on mount (403 renders the
 * forbidden notice — the tab is a grant, not a given); the form keeps every
 * numeric as a canonical decimal/int string (ADR-0009) and PUTs the whole
 * form (the API merges — same data + same params ⇒ the same plan). The
 * lot-sizing labels come from the seeded catalog read, falling back to the
 * raw codes; INVALID_VALUE / ATP_INPUT_INVALID answers arrive as toasts +
 * inline notices.
 */
import { useEffect, useState } from "react";
import type { JSX } from "react";

import { Button, Input, Select, useToast } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type {
  ApiErrorBody,
  ItemPlanningPolicyRow,
  LotSizingRuleRow,
} from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { localizedName, localizedManufacturingError } from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice, SuccessNotice } from "./notices";

/** Decimal quantities ≤ 6dp (the API QTY contract — ADR-0009). */
const QTY_RE = /^\d+(\.\d{1,6})?$/;
/** The four seeded rule codes (catalog fallback labels). */
const RULE_FALLBACK = ["LOT_FOR_LOT", "FIXED_ORDER_QTY", "ORDER_MULTIPLE", "PERIOD_SUPPLY"] as const;

/** One editable policy draft (numbers stay strings until the PUT parses them). */
interface PolicyDraft {
  leadTimeDays: string;
  safetyStockPolicy: "MANUAL" | "AUTO";
  safetyStockQty: string;
  ssServiceLevelPct: string;
  ssLookbackDays: string;
  lotSizingRule: string;
  fixedOrderQty: string;
  orderMultiple: string;
  periodSupplyBuckets: string;
  frozenFenceDays: string;
  slushyFenceDays: string;
}

function draftOf(policy: ItemPlanningPolicyRow): PolicyDraft {
  return {
    leadTimeDays: policy.leadTimeDays === null ? "" : String(policy.leadTimeDays),
    safetyStockPolicy: policy.safetyStockPolicy === "AUTO" ? "AUTO" : "MANUAL",
    safetyStockQty: policy.safetyStockQty ?? "",
    ssServiceLevelPct: policy.ssServiceLevelPct ?? "",
    ssLookbackDays: policy.ssLookbackDays === null ? "" : String(policy.ssLookbackDays),
    lotSizingRule: policy.lotSizingRule,
    fixedOrderQty: policy.fixedOrderQty ?? "",
    orderMultiple: policy.orderMultiple ?? "",
    periodSupplyBuckets: policy.periodSupplyBuckets === null ? "" : String(policy.periodSupplyBuckets),
    frozenFenceDays: String(policy.frozenFenceDays),
    slushyFenceDays: String(policy.slushyFenceDays),
  };
}

function intIn(value: string, min: number, max: number): boolean {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max;
}

export function ItemPlanning({
  locale,
  itemId,
}: {
  locale: Locale;
  itemId: string;
}): JSX.Element {
  const d = getDictionary(locale);
  const { toast } = useToast();
  const [policy, setPolicy] = useState<ItemPlanningPolicyRow | null>(null);
  const [draft, setDraft] = useState<PolicyDraft | null>(null);
  const [rules, setRules] = useState<readonly LotSizingRuleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadForbidden, setLoadForbidden] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      const [policyResult, rulesResult] = await Promise.all([
        bffFetch<ItemPlanningPolicyRow>(`manufacturing/planning/policies/${itemId}`),
        bffFetch<readonly LotSizingRuleRow[]>("manufacturing/planning/lot-sizing-rules"),
      ]);
      if (cancelled) return;
      setLoading(false);
      if (!policyResult.ok) {
        if (policyResult.status === 403 || policyResult.error.code === "FORBIDDEN") {
          setLoadForbidden(true);
          return;
        }
        setLoadError(localizedManufacturingError(d, policyResult.error, policyResult.retryAfterSeconds));
        return;
      }
      setPolicy(policyResult.data);
      setDraft(draftOf(policyResult.data));
      if (rulesResult.ok) setRules(rulesResult.data);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [itemId]);

  /** Validation-failed values keep their honest API message (INVALID_VALUE). */
  function localizeSaveError(error: ApiErrorBody, retryAfterSeconds?: number): string {
    if (error.code === "domain/invalid-value" || error.code === "INVALID_VALUE") {
      return error.message !== "" ? error.message : d.errorsValidation;
    }
    return localizedManufacturingError(d, error, retryAfterSeconds);
  }

  const ruleOptions =
    rules.length > 0
      ? rules.map((rule) => ({
          value: rule.code,
          label: localizedName(rule.name, rule.nameAr, locale),
        }))
      : RULE_FALLBACK.map((code) => ({ value: code, label: code }));

  // -- save -------------------------------------------------------------------------------

  function draftValid(value: PolicyDraft): boolean {
    if (value.leadTimeDays !== "" && !intIn(value.leadTimeDays, 0, 365)) return false;
    if (value.safetyStockQty !== "" && !QTY_RE.test(value.safetyStockQty)) return false;
    if (
      value.ssServiceLevelPct !== "" &&
      !["90", "95", "98", "99"].includes(value.ssServiceLevelPct)
    ) {
      return false;
    }
    if (value.ssLookbackDays !== "" && !intIn(value.ssLookbackDays, 30, 1095)) return false;
    if (value.fixedOrderQty !== "" && !QTY_RE.test(value.fixedOrderQty)) return false;
    if (value.orderMultiple !== "" && !QTY_RE.test(value.orderMultiple)) return false;
    if (value.periodSupplyBuckets !== "" && !intIn(value.periodSupplyBuckets, 1, 13)) return false;
    if (!intIn(value.frozenFenceDays, 0, 90)) return false;
    if (!intIn(value.slushyFenceDays, 0, 180)) return false;
    return true;
  }

  async function save(): Promise<void> {
    if (draft === null || !draftValid(draft)) {
      setSaveError(d.errorsValidation);
      return;
    }
    setSaving(true);
    setSaveError(null);
    setSavedNotice(null);
    const result = await bffFetch<ItemPlanningPolicyRow>(
      `manufacturing/planning/policies/${itemId}`,
      {
        method: "PUT",
        body: {
          leadTimeDays: draft.leadTimeDays === "" ? null : Number(draft.leadTimeDays),
          safetyStockPolicy: draft.safetyStockPolicy,
          safetyStockQty: draft.safetyStockQty === "" ? null : draft.safetyStockQty,
          ssServiceLevelPct: draft.ssServiceLevelPct === "" ? null : draft.ssServiceLevelPct,
          ssLookbackDays: draft.ssLookbackDays === "" ? null : Number(draft.ssLookbackDays),
          lotSizingRule: draft.lotSizingRule,
          fixedOrderQty: draft.fixedOrderQty === "" ? null : draft.fixedOrderQty,
          orderMultiple: draft.orderMultiple === "" ? null : draft.orderMultiple,
          periodSupplyBuckets:
            draft.periodSupplyBuckets === "" ? null : Number(draft.periodSupplyBuckets),
          frozenFenceDays: Number(draft.frozenFenceDays),
          slushyFenceDays: Number(draft.slushyFenceDays),
        },
      },
    );
    setSaving(false);
    if (!result.ok) {
      const message = localizeSaveError(result.error, result.retryAfterSeconds);
      setSaveError(message);
      toast({ tone: "danger", title: message });
      return;
    }
    setPolicy(result.data);
    setDraft(draftOf(result.data));
    setSavedNotice(d.mfgPlanSaved);
    toast({ tone: "success", title: d.mfgPlanSaved });
  }

  // -- render -----------------------------------------------------------------------------

  if (loading) {
    return <p className="text-sm text-gray-600">{d.mfgPlanLoading}</p>;
  }
  if (loadForbidden) {
    return <ErrorNotice>{d.errorsForbidden}</ErrorNotice>;
  }
  if (loadError !== null || draft === null || policy === null) {
    return <ErrorNotice>{loadError ?? d.mfgPlanLoadFailed}</ErrorNotice>;
  }

  const invalid = !draftValid(draft);

  function set(field: keyof PolicyDraft, value: string): void {
    setDraft((current) => (current === null ? current : { ...current, [field]: value }));
  }

  return (
    <Card title={d.mfgPlanningTab} description={`${policy.sku} · ${localizedName(policy.name, policy.nameAr, locale)}`}>
      <div className="flex flex-col gap-3">
        {saveError !== null && <ErrorNotice>{saveError}</ErrorNotice>}
        {savedNotice !== null && <SuccessNotice>{savedNotice}</SuccessNotice>}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="w-36">
            <Input
              label={d.mfgPlanLeadTime}
              value={draft.leadTimeDays}
              onValueChange={(value) => set("leadTimeDays", value)}
              mono
              inputMode="numeric"
              error={
                draft.leadTimeDays !== "" && !intIn(draft.leadTimeDays, 0, 365)
                  ? d.errorsValidation
                  : undefined
              }
            />
          </div>
          <Select
            label={d.mfgPlanSafetyPolicy}
            value={draft.safetyStockPolicy}
            onValueChange={(value) => set("safetyStockPolicy", value === "AUTO" ? "AUTO" : "MANUAL")}
            options={[
              { value: "MANUAL", label: d.mfgPlanSafetyManual },
              { value: "AUTO", label: d.mfgPlanSafetyAuto },
            ]}
          />
          <div className="w-36">
            <Input
              label={d.mfgPlanSafetyQty}
              value={draft.safetyStockQty}
              onValueChange={(value) => set("safetyStockQty", value)}
              mono
              inputMode="decimal"
              error={
                draft.safetyStockQty !== "" && !QTY_RE.test(draft.safetyStockQty)
                  ? d.errorsValidation
                  : undefined
              }
            />
          </div>
          <Select
            label={d.mfgPlanServiceLevel}
            value={draft.ssServiceLevelPct}
            onValueChange={(value) => set("ssServiceLevelPct", value)}
            options={[
              { value: "", label: "—" },
              { value: "90", label: "90%" },
              { value: "95", label: "95%" },
              { value: "98", label: "98%" },
              { value: "99", label: "99%" },
            ]}
          />
          <div className="w-36">
            <Input
              label={d.mfgPlanLookback}
              value={draft.ssLookbackDays}
              onValueChange={(value) => set("ssLookbackDays", value)}
              mono
              inputMode="numeric"
              error={
                draft.ssLookbackDays !== "" && !intIn(draft.ssLookbackDays, 30, 1095)
                  ? d.errorsValidation
                  : undefined
              }
            />
          </div>
          <Select
            label={d.mfgPlanLotSizing}
            value={draft.lotSizingRule}
            onValueChange={(value) => set("lotSizingRule", value)}
            options={ruleOptions}
          />
          <div className="w-36">
            <Input
              label={d.mfgPlanFixedQty}
              value={draft.fixedOrderQty}
              onValueChange={(value) => set("fixedOrderQty", value)}
              mono
              inputMode="decimal"
              error={
                draft.fixedOrderQty !== "" && !QTY_RE.test(draft.fixedOrderQty)
                  ? d.errorsValidation
                  : undefined
              }
            />
          </div>
          <div className="w-36">
            <Input
              label={d.mfgPlanOrderMultiple}
              value={draft.orderMultiple}
              onValueChange={(value) => set("orderMultiple", value)}
              mono
              inputMode="decimal"
              error={
                draft.orderMultiple !== "" && !QTY_RE.test(draft.orderMultiple)
                  ? d.errorsValidation
                  : undefined
              }
            />
          </div>
          <div className="w-36">
            <Input
              label={d.mfgPlanPeriodBuckets}
              value={draft.periodSupplyBuckets}
              onValueChange={(value) => set("periodSupplyBuckets", value)}
              mono
              inputMode="numeric"
              error={
                draft.periodSupplyBuckets !== "" && !intIn(draft.periodSupplyBuckets, 1, 13)
                  ? d.errorsValidation
                  : undefined
              }
            />
          </div>
          <div className="w-36">
            <Input
              label={d.mfgPlanFrozenFence}
              value={draft.frozenFenceDays}
              onValueChange={(value) => set("frozenFenceDays", value)}
              mono
              required
              inputMode="numeric"
              error={
                !intIn(draft.frozenFenceDays, 0, 90) ? d.errorsValidation : undefined
              }
            />
          </div>
          <div className="w-36">
            <Input
              label={d.mfgPlanSlushyFence}
              value={draft.slushyFenceDays}
              onValueChange={(value) => set("slushyFenceDays", value)}
              mono
              required
              inputMode="numeric"
              error={
                !intIn(draft.slushyFenceDays, 0, 180) ? d.errorsValidation : undefined
              }
            />
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="primary" loading={saving} disabled={invalid} onClick={() => void save()}>
            {d.mfgPlanSave}
          </Button>
        </div>
      </div>
    </Card>
  );
}
