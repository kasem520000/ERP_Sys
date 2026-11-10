"use client";

/**
 * P4-T12a — manual plan assignment. POST /api/bff/platform/tenants/:id/plan
 * { planKey, trialDays? } → { planKey, grantedKeys } (audited dual: platform
 * row + tenant-visible row).
 */
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent, JSX } from "react";

import { Button, NumberInput, Select } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type { PlanAssignResult } from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { formatMessage, localizedTenancyError } from "../lib/messages";
import { PLAN_KEYS, type PlanKey } from "../lib/constants";
import { ErrorNotice, SuccessNotice } from "./notices";

export function PlatformPlanForm({
  locale,
  tenantId,
  currentPlanKey,
}: {
  locale: Locale;
  tenantId: string;
  currentPlanKey: string | null;
}): JSX.Element {
  const d = getDictionary(locale);
  const router = useRouter();
  const [planKey, setPlanKey] = useState<PlanKey>(
    currentPlanKey !== null && (PLAN_KEYS as readonly string[]).includes(currentPlanKey)
      ? (currentPlanKey as PlanKey)
      : "starter",
  );
  const [trialDays, setTrialDays] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    const body: Record<string, unknown> = { planKey };
    const days = Number.parseInt(trialDays, 10);
    if (!Number.isNaN(days) && trialDays.trim() !== "" && days >= 1 && days <= 365) {
      body.trialDays = days;
    }
    const result = await bffFetch<PlanAssignResult>(`platform/tenants/${encodeURIComponent(tenantId)}/plan`, {
      method: "POST",
      body,
    });
    setBusy(false);
    if (!result.ok) {
      setError(localizedTenancyError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setNotice(
      formatMessage(d.platformPlanAssigned, { plan: result.data.planKey, count: result.data.grantedKeys }),
    );
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full max-w-44">
          <Select
            id={`plan-key-${tenantId}`}
            label={d.platformPlanLabel}
            value={planKey}
            onValueChange={(value) => setPlanKey(value as PlanKey)}
            options={PLAN_KEYS.map((key) => ({ value: key, label: key }))}
          />
        </div>
        <div className="w-full max-w-36">
          <NumberInput
            id={`plan-trial-${tenantId}`}
            label={d.platformTrialDaysLabel}
            value={trialDays}
            onValueChange={setTrialDays}
            min={1}
            max={365}
          />
        </div>
        <Button type="submit" variant="primary" loading={busy}>
          {d.platformPlanSubmit}
        </Button>
      </div>
      {notice !== null && <SuccessNotice>{notice}</SuccessNotice>}
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
    </form>
  );
}
