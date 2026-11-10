/**
 * /{locale}/crm/time — time entries (PHASE-019 T50, MASTER-PLAN §14): the
 * timeslips table (project / fee item / hours / snapshotted rate /
 * narrative / billable / status), the create + DRAFT-only edit dialogs
 * (case-policy hint — this tenant requires a projectId), the void action
 * (DRAFT/APPROVED only) and the weekly review dialog (Monday weekStart →
 * the batch DRAFT → APPROVED flip that gates billing). Time entries are
 * the primary resource (crm.contracts.manage + crm.service_contracts —
 * the time surface rides the contracts entitlement) — 403 renders the
 * forbidden state; the projects/SERVICE-items/contracts/users pools
 * degrade to empty. Time feeds billing ONLY (§6).
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import { CrmTime } from "../../../../components/crm-time";
import { RetryButton } from "../../../../components/retry-button";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type {
  ItemRow,
  ProjectRow,
  ServiceContractReadRow,
  TenantUserRow,
  TimeEntryRow,
} from "../../../../lib/api-types";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function CrmTimePage({
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

  const [entries, projects, items, contracts, users] = await Promise.all([
    fetchApi<readonly TimeEntryRow[]>("crm/time-entries?limit=200"),
    // Supporting reads (all degrade to empty): the project (case) select,
    // the SERVICE fee items, the contract select (rate resolution) and the
    // fee-earner select.
    fetchApi<readonly ProjectRow[]>("accounting/projects"),
    fetchApi<readonly ItemRow[]>("items/items?limit=100"),
    fetchApi<readonly ServiceContractReadRow[]>("crm/contracts?limit=200"),
    fetchApi<readonly TenantUserRow[]>("identity/users"),
  ]);
  if (!entries.ok && entries.status === 401) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!entries.ok) {
    const forbidden = entries.status === 403 || entries.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden
            ? d.errorsForbidden
            : localizedApiError(d, entries.error, entries.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    content = (
      <CrmTime
        locale={localeValue}
        initialRows={entries.data}
        projects={projects.ok ? projects.data : []}
        serviceItems={(items.ok ? items.data : []).filter((item) => item.kind === "SERVICE")}
        contracts={contracts.ok ? contracts.data : []}
        users={users.ok ? users.data : []}
      />
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="crm/time" title={d.crmTimeTitle}>
      {content}
    </AppShell>
  );
}
