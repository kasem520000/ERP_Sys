"use client";

/**
 * PHASE-040 T-09 — the one-click demo-data card on the onboarding home
 * (TB-19/TB-20): the 13-template catalog with this tenant's seeded marker,
 * one POST that seeds partners/items/posted invoices/receipts through the
 * posting engine (idempotent; a tenant with posted real documents refuses —
 * the guardrail is the typed ONBOARDING_DEMO_SEED_REFUSED). The button is
 * disabled when the tenant already carries a seed (re-run is a zero-write
 * no-op server-side) or when the session lacks the manage key.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { JSX } from "react";

import { Badge, Button, Select, useToast } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type { DemoDataStatus, DemoSeedSummary } from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { localizedOnboardingError } from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice, SuccessNotice } from "./notices";
import { demoSummaryLine } from "./imports-toolkit-workspace";

export function DemoDataCard({
  locale,
  status,
  canManage,
}: {
  locale: Locale;
  status: DemoDataStatus;
  canManage: boolean;
}): JSX.Element {
  const d = getDictionary(locale);
  const router = useRouter();
  const { toast } = useToast();

  const seededTemplate = status.tenant.demoTemplate;
  const [templateKey, setTemplateKey] = useState<string>(
    seededTemplate ?? status.templates[0]?.key ?? "",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summaryLine, setSummaryLine] = useState<string | null>(null);

  async function onSeed(): Promise<void> {
    if (templateKey === "") return;
    setBusy(true);
    setError(null);
    const result = await bffFetch<DemoSeedSummary>("onboarding/demo-data", {
      method: "POST",
      body: { templateKey },
    });
    setBusy(false);
    if (!result.ok) {
      setError(localizedOnboardingError(d, result.error, result.retryAfterSeconds));
      return;
    }
    if (result.data.skipped !== null) {
      setSummaryLine(d.demoDataSeededBadge);
    } else {
      setSummaryLine(demoSummaryLine(d, result.data));
    }
    toast({ tone: "success", title: d.demoDataDoneTitle });
    router.refresh();
  }

  return (
    <Card title={d.demoDataTitle} ariaLabel={d.demoDataTitle}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-gray-600">{d.demoDataHint}</p>
        {seededTemplate !== null && (
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="neutral">{d.demoDataSeededBadge}</Badge>
            <span className="text-sm text-gray-700">
              {d.demoDataSeededAt}:{" "}
              <span className="font-mono text-xs">
                {(status.tenant.demoSeededAt ?? "").slice(0, 10)}
              </span>{" "}
              ({seededTemplate})
            </span>
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
          <Select
            id="demo-template"
            label={d.demoDataTemplateLabel}
            value={templateKey}
            onValueChange={setTemplateKey}
            options={status.templates.map((entry) => ({
              value: entry.key,
              label: `${locale === "ar" && entry.nameAr !== null ? entry.nameAr : entry.name}${entry.seeded ? " ✓" : ""}`,
            }))}
            required
          />
          <Button
            variant="primary"
            loading={busy}
            disabled={!canManage || templateKey === ""}
            onClick={() => void onSeed()}
          >
            {busy ? d.demoDataSeeding : d.demoDataSeedBtn}
          </Button>
        </div>
        {summaryLine !== null && <SuccessNotice>{summaryLine}</SuccessNotice>}
        {error !== null && <ErrorNotice>{error}</ErrorNotice>}
      </div>
    </Card>
  );
}
