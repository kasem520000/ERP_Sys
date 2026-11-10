/**
 * P4-T12a — /{locale}/platform/tenants/[id] (platform admin): tenant detail —
 * profile card, plan + change-plan form, entitlements (grant/revoke),
 * memberships table, branches list, suspend/restore panel (reason required)
 * and the support-session console (open/close + enumerated read-data views).
 * Cross-tenant reads happen server-side through the BFF's internal fetch;
 * every mutation goes through the BFF proxy from the client panels.
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { Badge, ErrorState } from "../../../../../components/client-ui";

import { AppShell } from "../../../../../components/app-shell";
import { BranchesTable } from "../../../../../components/branches-table";
import { Card } from "../../../../../components/card";
import { DefList } from "../../../../../components/def-list";
import { LinkButton } from "../../../../../components/link-button";
import { ErrorNotice } from "../../../../../components/notices";
import { PlatformEntitlementsPanel } from "../../../../../components/platform-entitlements-panel";
import { PlatformLifecyclePanel } from "../../../../../components/platform-lifecycle-panel";
import { PlatformBillingPanel } from "../../../../../components/platform-billing-panel";
import { PlatformMembershipsTable } from "../../../../../components/platform-memberships-table";
import { PlatformPlanForm } from "../../../../../components/platform-plan-form";
import { PlatformSupportConsole } from "../../../../../components/platform-support-console";
import { RetryButton } from "../../../../../components/retry-button";
import { getDictionary, isLocale, type Locale } from "../../../../../i18n/dictionaries";
import type { ConsoleTenantDetail, SupportSessionRow } from "../../../../../lib/api-types";
import { formatDateTime, localizedApiError, localizedStatus, localizedName, statusTone } from "../../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../../lib/server-api";

export default async function PlatformTenantDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}): Promise<JSX.Element> {
  const { locale, id } = await params;
  if (!isLocale(locale)) {
    notFound();
  }
  const localeValue = locale as Locale;
  const d = getDictionary(localeValue);

  await requireSessionToken(localeValue);

  const detail = await fetchApi<ConsoleTenantDetail>(`platform/tenants/${id}`);
  if (!detail.ok && detail.status === 401) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!detail.ok) {
    const forbidden = detail.status === 403 || detail.error.code === "FORBIDDEN";
    content = forbidden ? (
      <ErrorState title={d.platformNoAccess} />
    ) : (
      <ErrorState
        title={localizedApiError(d, detail.error, detail.retryAfterSeconds)}
        retry={<RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    const tenant = detail.data;
    const sessions = await fetchApi<readonly SupportSessionRow[]>(
      `platform/tenants/${id}/support-sessions`,
    );

    content = (
      <div className="flex flex-col gap-6">
        <div>
          <LinkButton href={`/${locale}/platform`} variant="ghost">
            {d.platformBackToConsole}
          </LinkButton>
        </div>

        <Card title={d.platformProfileTitle} ariaLabel={d.platformProfileTitle}>
          <DefList
            items={[
              {
                term: d.platformColTenant,
                children: (
                  <span className="flex flex-wrap items-center gap-2">
                    {localizedName(tenant.name, tenant.nameAr, localeValue)}
                    {tenant.isPlatformTenant && <Badge tone="primary">{d.platformTenantBadge}</Badge>}
                  </span>
                ),
              },
              {
                term: d.usersColStatus,
                children: (
                  <Badge tone={statusTone(tenant.status)}>{localizedStatus(d, tenant.status)}</Badge>
                ),
              },
              { term: d.platformColCountry, children: <span className="font-mono">{tenant.countryCode}</span> },
              { term: d.registerCurrencyLabel, children: <span className="font-mono">{tenant.baseCurrency}</span> },
              {
                term: d.registerTemplateLabel,
                children: (
                  <span className="font-mono">{tenant.industryTemplateKey ?? "—"}</span>
                ),
              },
              { term: d.platformColCreated, children: formatDateTime(tenant.createdAt, localeValue) },
            ]}
          />
        </Card>

        {!tenant.isPlatformTenant && (
          <>
            <Card title={d.platformLifecycleTitle} ariaLabel={d.platformLifecycleTitle}>
              <PlatformLifecyclePanel locale={localeValue} tenantId={tenant.id} status={tenant.status} />
            </Card>
            {/* T19-WEB (PHASE-014): the billing panel (manual-invoicing
                fallback, suspend/restore, daily pass — matrix §3.10). */}
            <PlatformBillingPanel locale={localeValue} tenantId={tenant.id} />
          </>
        )}

        <Card title={d.platformPlanTitle} ariaLabel={d.platformPlanTitle}>
          <DefList
            items={[
              {
                term: d.platformPlanCurrentLabel,
                children:
                  tenant.plan === null
                    ? d.platformPlanNone
                    : `${localizedName(tenant.plan.name, tenant.plan.nameAr, localeValue)} (${tenant.plan.key})`,
              },
              ...(tenant.subscription !== null
                ? [
                    {
                      term: d.usersColStatus,
                      children: (
                        <span className="flex flex-wrap items-center gap-2">
                          <Badge tone={statusTone(tenant.subscription.status)}>
                            {localizedStatus(d, tenant.subscription.status)}
                          </Badge>
                          <span className="text-xs text-gray-600">
                            {formatDateTime(tenant.subscription.periodStart, localeValue)} →{" "}
                            {formatDateTime(tenant.subscription.periodEnd, localeValue)}
                          </span>
                        </span>
                      ),
                    },
                  ]
                : []),
            ]}
          />
          <div className="mt-4 border-t border-subtle pt-4">
            <h3 className="mb-3 text-sm font-semibold text-gray-900">{d.platformPlanAssignTitle}</h3>
            <PlatformPlanForm locale={localeValue} tenantId={tenant.id} currentPlanKey={tenant.plan?.key ?? null} />
          </div>
        </Card>

        <PlatformEntitlementsPanel
          locale={localeValue}
          tenantId={tenant.id}
          entitlements={tenant.entitlements}
        />

        <section aria-label={d.platformMembershipsTitle} className="flex flex-col gap-2">
          <h2 className="text-md font-semibold text-gray-900">{d.platformMembershipsTitle}</h2>
          <PlatformMembershipsTable locale={localeValue} rows={tenant.memberships} />
        </section>

        <section aria-label={d.platformBranchesTitle} className="flex flex-col gap-2">
          <h2 className="text-md font-semibold text-gray-900">{d.platformBranchesTitle}</h2>
          <BranchesTable locale={localeValue} rows={tenant.branches} interactive={false} />
        </section>

        {sessions.ok ? (
          <PlatformSupportConsole locale={localeValue} tenantId={tenant.id} sessions={sessions.data} />
        ) : (
          sessions.status !== 403 && (
            <ErrorNotice>
              {localizedApiError(d, sessions.error, sessions.retryAfterSeconds)}
            </ErrorNotice>
          )
        )}
      </div>
    );
  }

  return (
    <AppShell locale={localeValue} pagePath={`platform/tenants/${id}`} title={d.platformConsoleTitle}>
      {content}
    </AppShell>
  );
}
