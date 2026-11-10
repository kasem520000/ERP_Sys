/**
 * /{locale}/crm/tasks — tasks & activities (PHASE-019 T50, MASTER-PLAN
 * §14): the follow-up list (OPEN → DONE/CANCELLED) with create/edit/
 * complete/cancel, the per-related activity timeline (fetched client-side
 * for the selected task's related record) and the log-activity dialog.
 * Tasks are the primary resource (crm.tasks.manage + crm.tasks_activities)
 * — 403 renders the forbidden state; the users/leads/partners/contracts/
 * service-orders pools (assignee + related-target selects) degrade to
 * empty. No money, no ledger effects (§3).
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import { CrmTasks } from "../../../../components/crm-tasks";
import { RetryButton } from "../../../../components/retry-button";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type {
  CrmTaskRow,
  LeadRow,
  PartnerRow,
  ServiceContractReadRow,
  ServiceOrderRow,
  TenantUserRow,
} from "../../../../lib/api-types";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function CrmTasksPage({
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

  const [tasks, users, leads, partners, contracts, serviceOrders] = await Promise.all([
    fetchApi<readonly CrmTaskRow[]>("crm/tasks?limit=200"),
    // Supporting reads (all degrade to empty): the assignee select + the
    // related-target pools per related type (LEAD/PARTNER/CONTRACT/
    // SERVICE_ORDER — a task must anchor to one of them).
    fetchApi<readonly TenantUserRow[]>("identity/users"),
    fetchApi<readonly LeadRow[]>("crm/leads?limit=200"),
    fetchApi<readonly PartnerRow[]>("partners/partners?limit=100"),
    fetchApi<readonly ServiceContractReadRow[]>("crm/contracts?limit=200"),
    fetchApi<readonly ServiceOrderRow[]>("crm/service-orders?limit=200"),
  ]);
  if (!tasks.ok && tasks.status === 401) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!tasks.ok) {
    const forbidden = tasks.status === 403 || tasks.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden
            ? d.errorsForbidden
            : localizedApiError(d, tasks.error, tasks.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    content = (
      <CrmTasks
        locale={localeValue}
        initialRows={tasks.data}
        users={users.ok ? users.data : []}
        leads={leads.ok ? leads.data : []}
        partners={partners.ok ? partners.data : []}
        contracts={contracts.ok ? contracts.data : []}
        serviceOrders={serviceOrders.ok ? serviceOrders.data : []}
      />
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="crm/tasks" title={d.crmTasksTitle}>
      {content}
    </AppShell>
  );
}
