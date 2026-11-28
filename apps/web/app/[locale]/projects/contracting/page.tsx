/**
 * /{locale}/projects/contracting — the projects contracting screen
 * (PHASE-048 W-13 T-15, matrix §3.26; archetype list-search): the project
 * selector + the progress certificates (with the BR-093 ceiling card) +
 * the retention ledger + the change orders (with the re-baselined
 * ceilings) + the subcontracts with the selected agreement's
 * certificates. Every figure is an ENGINE OUTPUT rendered verbatim
 * (zero parallel computation; display-only rounding). The change-orders
 * tab rides its own key (projects.change_order.view) and degrades to
 * the honest no-permission notice; typed refusals render with their
 * full payloads — never a generic error. The first project's surfaces
 * load server-side (the mrp-page rule); switching re-fetches through
 * the BFF.
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import {
  ProjectsContractingBoard,
  type ContractingSurfaces,
} from "../../../../components/projects-contracting-board";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type {
  ChangeOrderCeiling,
  ChangeOrderRow,
  ContractingBillingState,
  CurrentSession,
  ProgressCertificateRow,
  ProjectPoolRow,
  RetentionAccountRow,
  SubcontractAgreementRow,
} from "../../../../lib/api-types";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function ProjectsContractingPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ doc?: string }>;
}): Promise<JSX.Element> {
  const { locale } = await params;
  const { doc } = await searchParams;
  if (!isLocale(locale)) {
    notFound();
  }
  const localeValue = locale as Locale;
  const d = getDictionary(localeValue);

  await requireSessionToken(localeValue);

  // The contracting plane's own pool (T-15's route — the same one-store
  // read the WBS board rides, on THIS plane's viewer key).
  const projects = await fetchApi<readonly ProjectPoolRow[]>("projects/contracting/pool");
  if (!projects.ok && projects.status === 401) {
    redirect(`/${locale}/login`);
  }

  // The active tenant's own name (the print letterhead — the session's
  // own read; a failed read degrades to the honest generic name, the
  // pdf-print precedent — never a fabricated tenant).
  const session = await fetchApi<CurrentSession>("identity/sessions/current");
  const tenantName =
    session.ok && session.data.activeTenantId !== null
      ? (session.data.memberships.find(
          (membership) => membership.tenantId === session.data.activeTenantId,
        )?.tenantName ?? "ERP")
      : "ERP";

  let content: JSX.Element;
  if (!projects.ok) {
    const forbidden = projects.status === 403 || projects.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={forbidden ? d.errorsForbidden : localizedApiError(d, projects.error)}
      />
    );
  } else {
    // The first project's six surfaces load server-side (the mrp-page
    // rule); each degrades to its own honest notice on 403 (the
    // change-orders pair rides its own key) and to the typed-refusal
    // panel on a typed engine refusal.
    const first = projects.data[0] ?? null;
    const emptySurfaces: ContractingSurfaces = {
      billing: null,
      billingError: null,
      certificates: null,
      certificatesError: null,
      retention: null,
      retentionError: null,
      changeOrders: null,
      changeOrdersError: null,
      ceiling: null,
      ceilingError: null,
      subcontracts: null,
      subcontractsError: null,
    };
    let surfaces: ContractingSurfaces = emptySurfaces;
    if (first !== null) {
      const [billing, certificates, retention, changeOrders, ceiling, subcontracts] =
        await Promise.all([
          fetchApi<ContractingBillingState>(`projects/${first.id}/billing`),
          fetchApi<ProgressCertificateRow[]>(`projects/${first.id}/certificates`),
          fetchApi<RetentionAccountRow[]>(`projects/${first.id}/retention`),
          fetchApi<ChangeOrderRow[]>(`projects/${first.id}/change-orders`),
          fetchApi<ChangeOrderCeiling>(`projects/${first.id}/change-orders/ceiling`),
          fetchApi<SubcontractAgreementRow[]>(`projects/${first.id}/subcontracts`),
        ]);
      surfaces = {
        billing: billing.ok ? billing.data : null,
        billingError: billing.ok ? null : billing.error,
        certificates: certificates.ok ? certificates.data : null,
        certificatesError: certificates.ok ? null : certificates.error,
        retention: retention.ok ? retention.data : null,
        retentionError: retention.ok ? null : retention.error,
        changeOrders: changeOrders.ok ? changeOrders.data : null,
        changeOrdersError: changeOrders.ok ? null : changeOrders.error,
        ceiling: ceiling.ok ? ceiling.data : null,
        ceilingError: ceiling.ok ? null : ceiling.error,
        subcontracts: subcontracts.ok ? subcontracts.data : null,
        subcontractsError: subcontracts.ok ? null : subcontracts.error,
      };
    }
    content = (
      <ProjectsContractingBoard
        locale={localeValue}
        initialProjects={projects.data}
        initialProjectId={first?.id ?? null}
        initialSurfaces={surfaces}
        tenantName={tenantName}
        initialChainDocId={doc ?? null}
      />
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="projects/contracting" title={d.projectsContractingTitle}>
      {content}
    </AppShell>
  );
}
