/**
 * /{locale}/crm/pipeline — the lead board (PHASE-019 T50, MASTER-PLAN §14):
 * the NEW → QUALIFIED → CONVERTED/LOST intake pipeline with status tabs +
 * counts, the create dialog, the conversion wizard (NEW_PARTNER / MERGE
 * onto an existing partner) and the lose-with-reason dialog. Leads are the
 * primary resource (crm.leads.manage + crm.leads) — 403 renders the
 * forbidden state; the users pool (owner rep select) and the partners pool
 * (merge targets) degrade to empty. No money fields, no ledger effects.
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import { CrmPipeline } from "../../../../components/crm-pipeline";
import { RetryButton } from "../../../../components/retry-button";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type { LeadRow, PartnerRow, TenantUserRow } from "../../../../lib/api-types";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function CrmPipelinePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<JSX.Element> {
  const { locale } = await params;
  if (!isLocale(locale)) {
    notFound();
  }
  const localeValue = locale as Locale;
  const d = getDictionary(localeValue);

  await requireSessionToken(localeValue);

  const [leads, users, partners] = await Promise.all([
    fetchApi<readonly LeadRow[]>("crm/leads?limit=200"),
    // Supporting reads (degrade to empty): the users pool feeds the owner
    // rep select (identity/users — the users screen's route) and the
    // partners pool feeds the MERGE conversion target select.
    fetchApi<readonly TenantUserRow[]>("identity/users"),
    fetchApi<readonly PartnerRow[]>("partners/partners?limit=100"),
  ]);
  if (!leads.ok && leads.status === 401) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!leads.ok) {
    const forbidden = leads.status === 403 || leads.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden
            ? d.errorsForbidden
            : localizedApiError(d, leads.error, leads.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    content = (
      <CrmPipeline
        locale={localeValue}
        initialRows={leads.data}
        users={users.ok ? users.data : []}
        partners={partners.ok ? partners.data : []}
      />
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="crm/pipeline" title={d.crmPipelineTitle}>
      {content}
    </AppShell>
  );
}
