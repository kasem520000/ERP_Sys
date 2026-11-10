/**
 * P5-T12 — Authenticated app shell (server component). Resolves the
 * navigation payload server-side (GET /tenancy/navigation, envelope-
 * unwrapped by fetchApi) and renders the P6-T11a `ShellWithSearch` client
 * bridge — the @erp/ui `AppShell` plus the CommandMenu remote-search wiring
 * (debounced partner/item trigram search). On any navigation failure the
 * shell degrades to "no navigation" — the pages still enforce 401/403
 * themselves.
 *
 * Pages keep the PHASE-003 signature `AppShell({ locale, pagePath, title,
 * children })`: this component derives the sidebar active path, the
 * breadcrumbs (registry labels first, static dictionary fallbacks — plus the
 * P6-T11a dynamic-prefix rules for partners/:id and inventory/items/:id)
 * and the user menu (locale switch + logout).
 */
import type { JSX, ReactNode } from "react";

import { Breadcrumbs, Icon } from "./client-ui";
import type { Crumb } from "@erp/ui";
import type { ResolvedNavigation } from "@erp/contracts";

import { getDictionary, otherLocale, type Dictionary, type Locale } from "../i18n/dictionaries";
import type { DerivedEntitlements } from "../lib/api-types";
import { fetchEffectiveConfig, mergeNavigation } from "../lib/effective-config";
import { ReadOnlyProvider } from "../lib/read-only";
import { fetchApi } from "../lib/server-api";
import { formatMessage } from "../lib/messages";
import { LogoutButton } from "./logout-button";
import { NotificationBell } from "./notification-bell";
import { ShellWithSearch } from "./shell-with-search";

/** Registry routes are sidebar `route` values; pagePath is the URL segment. */
function activePathFor(pagePath: string): string {
  if (pagePath === "") {
    return "/";
  }
  if (pagePath === "platform/tenants" || pagePath.startsWith("platform/tenants/")) {
    return "/platform";
  }
  return `/${pagePath}`;
}

/** Static breadcrumb fallback for routes not (yet) in the nav registry. */
const FALLBACK_CRUMBS: Record<string, { group?: keyof Dictionary; label: keyof Dictionary }> = {
  users: { group: "navSettings", label: "navUsers" },
  roles: { group: "navSettings", label: "navRoles" },
  branches: { group: "navSettings", label: "navBranches" },
  settings: { group: "navSettings", label: "navSettings" },
  "settings/password": { group: "navSettings", label: "navPassword" },
  sessions: { group: "navSettings", label: "navSessions" },
  mfa: { group: "navSettings", label: "navMfa" },
  onboarding: { group: "navSettings", label: "navOnboarding" },
  "support-sessions": { group: "navSettings", label: "navSupport" },
  // -- PHASE-024 T8: the tenant audit review console (registry-driven; this
  // fallback covers nav-fetch failure — the support-sessions rule).
  audit: { group: "navSettings", label: "auditReviewTitle" },
  platform: { group: "navPlatformSection", label: "navPlatformConsole" },
  "platform/audit": { group: "navPlatformSection", label: "navPlatformAudit" },
  // -- PHASE-020 (T14): the sync admin surfaces. The nav registry
  // (packages/contracts NAV_ITEMS) is frozen this phase, so these ride the
  // audit-screen fallback mechanism (crumbs only; the sidebar stays
  // registry-driven).
  "platform/devices": { group: "navPlatformSection", label: "syncDevicesTitle" },
  "platform/sync-health": { group: "navPlatformSection", label: "syncHealthTitle" },
  "platform/sync-reconciliation": { group: "navPlatformSection", label: "syncReconciliationTitle" },
  // -- PHASE-025 (T9d): the SLO / error-budget dashboard (registry-driven;
  // this fallback covers nav-fetch failure — the support-sessions rule).
  "platform/slo": { group: "navPlatformSection", label: "sloTitle" },
  // -- P6-T11a master-data routes -------------------------------------------
  partners: { group: "navPartners", label: "navPartnersDirectory" },
  "partners/new": { group: "navPartners", label: "navPartnersNew" },
  "opening-balances": { group: "navPartners", label: "navOpeningBalances" },
  "inventory/items": { group: "navInventory", label: "navItems" },
  "inventory/items/new": { group: "navInventory", label: "navItemsNew" },
  "inventory/price-lists": { group: "navInventory", label: "navPriceLists" },
  "inventory/import": { group: "navInventory", label: "navImport" },
  // -- T14-UI treasury list routes (registry-driven when resolved; the new/
  // detail subroutes resolve via the dynamic-prefix rule below) ------------
  "treasury/accounts": { group: "navTreasury", label: "navTreasuryAccounts" },
  "treasury/receipts": { group: "navTreasury", label: "navTreasuryReceipts" },
  "treasury/receipts/new": { group: "navTreasury", label: "navTreasuryReceipts" },
  "treasury/payments": { group: "navTreasury", label: "navTreasuryPayments" },
  "treasury/payments/new": { group: "navTreasury", label: "navTreasuryPayments" },
  "treasury/expenses": { group: "navTreasury", label: "navTreasuryExpenses" },
  "treasury/transfers": { group: "navTreasury", label: "navTreasuryTransfers" },
  "treasury/shifts": { group: "navTreasury", label: "navTreasuryShifts" },
  "treasury/bank-rec": { group: "navTreasury", label: "navTreasuryBankRec" },
  // -- T-WEB (PHASE-013) report workspace (registry-driven when resolved) ----
  reports: { group: "navReports", label: "reportsNavWorkspace" },
  // -- PHASE-034 (T11): the consolidation surfaces (reports.consolidated …)
  // (registry-driven when the navigation payload grows the reports group's
  // consolidated item; these fallbacks cover nav-fetch failure for the
  // module's sub-surfaces — the support-sessions rule, crumbs only).
  consolidation: { group: "navReports", label: "navConsolidated" },
  "consolidation/groups": { group: "navReports", label: "consolidationGroupsNav" },
  "consolidation/eliminations": { group: "navReports", label: "consolidationEliminationsNav" },
  "consolidation/eliminations/new": { group: "navReports", label: "consolidationEliminationsNav" },
  "consolidation/runs": { group: "navReports", label: "consolidationRunsNav" },
  // -- T19-WEB (PHASE-014): dashboard / billing / notifications (registry-
  // driven when navigation resolves; fallback covers nav-fetch failure). The
  // dashboard entry mirrors home.dashboard's new /dashboard route. The
  // checkout flow page nests under billing (it launches from billing/pricing).
  dashboard: { group: "navHome", label: "navDashboard" },
  billing: { group: "navSettings", label: "billingTitle" },
  checkout: { group: "navSettings", label: "checkoutTitle" },
  notifications: { group: "navHome", label: "notificationsTitle" },
  // -- PHASE-015 T11 (3-a): the Industry & templates admin screen.
  "settings/templates": { group: "navSettings", label: "templatesTitle" },
  // -- PHASE-016 T10: the POS surfaces (registry-driven when the navigation
  // payload grows the pos group; fallback covers the in-between state).
  pos: { group: "posNavSection", label: "posNavCounter" },
  "pos/floor": { group: "posNavSection", label: "posNavFloor" },
  "pos/reconciliation": { group: "posNavSection", label: "posNavReconciliation" },
  "pos/terminals": { group: "posNavSection", label: "posNavTerminals" },
  // -- PHASE-017 (T6/T14): the automotive + distribution surfaces
  // (registry-driven when the sales/partners items resolve; the
  // distribution screens ride the template-derived groups — fallback covers
  // the in-between state).
  "job-cards": { group: "navSales", label: "jobCardsTitle" },
  vehicles: { group: "navPartners", label: "vehiclesTitle" },
  "sales/commissions": { group: "navSales", label: "commissionsTitle" },
  "distribution/routes": { group: "distributionNavSection", label: "distributionRoutesTitle" },
  "distribution/van": { group: "distributionNavSection", label: "distributionVanTitle" },
  "distribution/settlements": { group: "distributionNavSection", label: "distributionSettlementsTitle" },
  "distribution/tiers": { group: "distributionNavSection", label: "distributionTiersTitle" },
  // -- PHASE-018 (T41): the manufacturing screens. The manifest's own L9
  // groups are two (Production/الإنتاج for boms/orders/qc and
  // Traceability/التتبع for genealogy) and render registry-driven when the
  // food_manufacturing template is applied; this fallback collapses them
  // into ONE shared manufacturing section (crumbs only — the sidebar keeps
  // its derived groups).
  "manufacturing/boms": { group: "manufacturingNavSection", label: "mfgBomsTitle" },
  "manufacturing/orders": { group: "manufacturingNavSection", label: "mfgOrdersTitle" },
  "manufacturing/qc": { group: "manufacturingNavSection", label: "mfgQcTitle" },
  "manufacturing/genealogy": { group: "manufacturingNavSection", label: "mfgGenealogyTitle" },
  // -- PHASE-021 (T2-b): the Offline Console entry — always visible
  // (DR-P21-06; browser opens the honest ONLINE-ONLY console).
  offline: { group: "offlineNavSection", label: "offlineConsoleTitle" },
  // -- PHASE-019 (T50): the CRM screens + the projects dimension. The
  // professional_services template's own L9 groups render registry-driven
  // when it is applied; this fallback groups all seven crm routes under ONE
  // shared crm section (crumbs only — the sidebar keeps its derived groups),
  // the manufacturing decision-8 precedent. The projects row carries no
  // group label (the registry has no accounting-section crumb key; the
  // screen title alone is the honest leaf).
  "crm/pipeline": { group: "crmNavSection", label: "crmPipelineTitle" },
  "crm/tasks": { group: "crmNavSection", label: "crmTasksTitle" },
  "crm/contracts": { group: "crmNavSection", label: "crmContractsTitle" },
  "crm/billing": { group: "crmNavSection", label: "crmBillingTitle" },
  "crm/time": { group: "crmNavSection", label: "crmTimeTitle" },
  "crm/service-orders": { group: "crmNavSection", label: "crmServiceOrdersTitle" },
  "accounting/projects": { label: "accountingProjectsTitle" },
  // -- PHASE-026 (T13-UI): fixed assets & depreciation. The registry row
  // `accounting.fixed-assets` (contracts NAV_ITEMS) drives the sidebar; this
  // fallback covers nav-fetch failure for the module's sub-surfaces (the
  // support-sessions rule — crumbs only; the sidebar stays registry-driven).
  "fixed-assets": { group: "navAccounting", label: "navFixedAssets" },
  "fixed-assets/new": { group: "navAccounting", label: "navFixedAssets" },
  "fixed-assets/categories": { group: "navAccounting", label: "faCategoriesTitle" },
  "fixed-assets/depreciation": { group: "navAccounting", label: "faDepTitle" },
  "fixed-assets/disposals": { group: "navAccounting", label: "faDisposalsTitle" },
  "fixed-assets/reports": { group: "navAccounting", label: "faReportsTitle" },
  // -- PHASE-027 (wave F): cheques & notes + the PDC calendar (treasury)
  // and installment plans (sales). Registry rows (contracts NAV_ITEMS)
  // drive the sidebar; these fallbacks cover nav-fetch failure for the
  // module sub-surfaces (the support-sessions rule — crumbs only).
  "notes": { group: "navTreasury", label: "navChequesNotes" },
  "notes/new": { group: "navTreasury", label: "notesNewTitle" },
  "notes/calendar": { group: "navTreasury", label: "navPdcCalendar" },
  "notes/reports": { group: "navTreasury", label: "notesReportsTitle" },
  "installments": { group: "navSales", label: "navInstallmentPlans" },
  "installments/new": { group: "navSales", label: "instNewTitle" },
  "installments/reports": { group: "navSales", label: "instReportsTitle" },
  // -- PHASE-028 (T9): budgets (the period-column planning grid). The
  // registry row `accounting.budgets` (contracts NAV_ITEMS) drives the
  // sidebar; these fallbacks cover nav-fetch failure for the module's
  // sub-surfaces (the support-sessions rule — crumbs only; the sidebar
  // stays registry-driven).
  "budgeting": { group: "navAccounting", label: "navBudgets" },
  "budgeting/new": { group: "navAccounting", label: "budgetsNewTitle" },
  "budgeting/import": { group: "navAccounting", label: "budgetsImportTitle" },
  "budgeting/reports": { group: "navAccounting", label: "budgetReportsTitle" },
  // -- PHASE-029 (T11): the payroll module surfaces (the hr group 10). The
  // registry rows `hr.*` (contracts NAV_ITEMS) drive the sidebar; these
  // fallbacks cover nav-fetch failure for the module's sub-surfaces (the
  // same support-sessions rule — crumbs only).
  "payroll": { group: "navHr", label: "navPayrollEmployees" },
  "payroll/employees/new": { group: "navHr", label: "payEmployeeCreateTitle" },
  "payroll/structures": { group: "navHr", label: "navPayrollStructures" },
  "payroll/runs": { group: "navHr", label: "navPayrollRuns" },
  "payroll/runs/new": { group: "navHr", label: "payRunNew" },
  "payroll/loans": { group: "navHr", label: "navPayrollLoans" },
  "payroll/loans/new": { group: "navHr", label: "payLoanNew" },
  "payroll/reports": { group: "navHr", label: "payReportsTitle" },
};

/**
 * P6-T11a — detail routes carry dynamic ids (partners/:id, inventory/items/:id);
 * the exact map misses them, so dynamic-prefix rules resolve the GROUP and use
 * the page title (the record's localized name) as the leaf crumb.
 */
function fallbackCrumbsFor(
  pagePath: string,
  title: string,
  d: Dictionary,
): { groupLabel?: string; label: string } | undefined {
  if (pagePath.startsWith("partners/") && pagePath !== "partners/new") {
    return { groupLabel: d.navPartners, label: title };
  }
  if (pagePath.startsWith("inventory/items/") && pagePath !== "inventory/items/new") {
    return { groupLabel: d.navInventory, label: title };
  }
  // T14-UI — treasury detail routes (accounts/:id, receipts/:id, payments/:id).
  if (pagePath.startsWith("treasury/accounts/")) {
    return { groupLabel: d.navTreasury, label: d.navTreasuryAccounts };
  }
  if (pagePath.startsWith("treasury/receipts/")) {
    return { groupLabel: d.navTreasury, label: d.navTreasuryReceipts };
  }
  if (pagePath.startsWith("treasury/payments/")) {
    return { groupLabel: d.navTreasury, label: d.navTreasuryPayments };
  }
  // PHASE-026 (T13-UI) — fixed-asset detail/edit routes (fixed-assets/:id,
  // fixed-assets/:id/edit): the record title is the honest leaf crumb (the
  // inventory/items/:id rule; static module routes resolve via the exact map
  // above).
  if (
    pagePath.startsWith("fixed-assets/") &&
    pagePath !== "fixed-assets/new" &&
    pagePath !== "fixed-assets/categories" &&
    pagePath !== "fixed-assets/depreciation" &&
    pagePath !== "fixed-assets/disposals" &&
    pagePath !== "fixed-assets/reports"
  ) {
    return { groupLabel: d.navAccounting, label: d.navFixedAssets };
  }
  // PHASE-027 (wave F) — note detail routes (notes/:id): the module label is
  // the honest leaf crumb (the inventory/items/:id rule; static module
  // routes resolve via the exact map above).
  if (pagePath.startsWith("notes/") && pagePath !== "notes/new" && pagePath !== "notes/calendar" && pagePath !== "notes/reports") {
    return { groupLabel: d.navTreasury, label: d.navChequesNotes };
  }
  // PHASE-027 (wave F) — installment plan detail routes (installments/:id).
  if (pagePath.startsWith("installments/") && pagePath !== "installments/new" && pagePath !== "installments/reports") {
    return { groupLabel: d.navSales, label: d.navInstallmentPlans };
  }
  // PHASE-028 (T9) — budget detail routes (budgeting/:id): the module label
  // is the honest leaf crumb (the notes/[id] rule; static module routes
  // resolve via the exact map above).
  if (
    pagePath.startsWith("budgeting/") &&
    pagePath !== "budgeting/new" &&
    pagePath !== "budgeting/import" &&
    pagePath !== "budgeting/reports"
  ) {
    return { groupLabel: d.navAccounting, label: d.navBudgets };
  }
  // PHASE-029 (T11) — payroll detail routes (payroll/employees/:id,
  // payroll/structures/:id, payroll/runs/:id, payroll/loans/:id): the
  // module surface label is the honest leaf crumb (the budgeting/:id
  // rule; static module routes resolve via the exact map above).
  if (
    (pagePath.startsWith("payroll/employees/") && pagePath !== "payroll/employees/new") ||
    (pagePath.startsWith("payroll/structures/") && pagePath !== "payroll/structures") ||
    (pagePath.startsWith("payroll/runs/") && pagePath !== "payroll/runs/new") ||
    (pagePath.startsWith("payroll/loans/") && pagePath !== "payroll/loans/new")
  ) {
    return { groupLabel: d.navHr, label: d.navPayrollEmployees };
  }
  // PHASE-034 (T11) — consolidation group detail routes
  // (consolidation/groups/:id): the module label is the honest leaf crumb
  // (the inventory/items/:id rule; static module routes resolve via the exact
  // map above).
  if (
    pagePath.startsWith("consolidation/groups/") &&
    pagePath !== "consolidation/groups" &&
    !pagePath.startsWith("consolidation/groups/new")
  ) {
    return { groupLabel: d.navReports, label: d.consolidationGroupsNav };
  }
  return undefined;
}

/**
 * PHASE-016 T10 — the POS nav group. The registry (`packages/contracts`
 * NAV_ITEMS) is frozen for this task, so the shell appends the POS group
 * AFTER the merged core/template groups — the same documented cast boundary
 * mergeNavigation uses (the sidebar/command menu read id, label, route and
 * icon only). The registry entry replaces this when the contracts package
 * unfreezes; routes and ids match the registry vocabulary ("pos.*").
 */
function withPosNavigation(
  navigation: ResolvedNavigation | undefined,
  labels: Record<"section" | "counter" | "floor" | "reconciliation" | "terminals", { ar: string; en: string }>,
): ResolvedNavigation | undefined {
  if (navigation === undefined) {
    return undefined; // the core fetch already failed — today's degrade stands.
  }
  const posGroup = {
    id: "pos",
    label: labels.section,
    icon: "banknote",
    items: [
      {
        id: "pos.counter",
        parentGroup: "pos",
        label: labels.counter,
        icon: "receipt",
        route: "/pos",
        branchScoped: false,
        archetype: "point-of-sale",
        order: 1,
      },
      {
        id: "pos.floor",
        parentGroup: "pos",
        label: labels.floor,
        icon: "boxes",
        route: "/pos/floor",
        branchScoped: true,
        archetype: "point-of-sale",
        order: 2,
      },
      {
        id: "pos.reconciliation",
        parentGroup: "pos",
        label: labels.reconciliation,
        icon: "bar-chart",
        route: "/pos/reconciliation",
        branchScoped: true,
        archetype: "report",
        order: 3,
      },
      {
        id: "pos.terminals",
        parentGroup: "pos",
        label: labels.terminals,
        icon: "keyboard",
        route: "/pos/terminals",
        branchScoped: false,
        archetype: "settings",
        order: 4,
      },
    ],
  };
  return { ...navigation, groups: [...navigation.groups, posGroup] } as unknown as ResolvedNavigation;
}

/**
 * PHASE-021 T2-b — the Offline Console nav group (DR-P21-06: "Entry: nav
 * item + dashboard quick action"). The registry (`packages/contracts`
 * NAV_ITEMS) stays frozen this phase, so the shell appends the group
 * AFTER the POS group — the withPosNavigation precedent. ALWAYS VISIBLE
 * (no permission gate): in a browser the console opens in its honest
 * ONLINE-ONLY mode; in the shell it is the offline surface.
 */
function withOfflineNavigation(
  navigation: ResolvedNavigation | undefined,
  labels: { section: { ar: string; en: string }; console: { ar: string; en: string } },
): ResolvedNavigation | undefined {
  if (navigation === undefined) {
    return undefined; // the core fetch already failed — today's degrade stands.
  }
  const offlineGroup = {
    id: "offline",
    label: labels.section,
    icon: "cloud-off",
    items: [
      {
        id: "offline.console",
        parentGroup: "offline",
        label: labels.console,
        icon: "cloud-off",
        route: "/offline",
        branchScoped: false,
        archetype: "settings",
        order: 1,
      },
    ],
  };
  return { ...navigation, groups: [...navigation.groups, offlineGroup] } as unknown as ResolvedNavigation;
}

export async function AppShell({
  locale,
  pagePath,
  title,
  children,
}: {
  locale: Locale;
  pagePath: string;
  title: string;
  children: ReactNode;
}): Promise<JSX.Element> {
  const d = getDictionary(locale);
  const other = otherLocale(locale);
  const otherHref = `/${other}${pagePath === "" ? "" : `/${pagePath}`}`;
  const activePath = activePathFor(pagePath);

  // Server-resolved navigation (NAVIGATION_MODEL §2): groups + shortcuts,
  // permission/entitlement-filtered by the API. Failure ⇒ no navigation.
  // T19-WEB (PHASE-014): the derived entitlements payload resolves in
  // parallel — its subscription projection drives the read-only banner +
  // the ReadOnlyProvider context (SUBSCRIPTION §8; failure ⇒ writable, the
  // server re-enforces on every mutating route regardless).
  // PHASE-015 T11 (3-a): the effective config resolves in the same parallel
  // batch — an applied template's derived navigation groups merge AFTER the
  // core groups with the effective terminology applied to every label
  // (BR-039 derived-only payload; fail-open for presentation — a failed
  // fetch renders the identical core shell of today).
  const [navigationResult, entitlementsResult, effectiveResult] = await Promise.all([
    fetchApi<ResolvedNavigation>("tenancy/navigation"),
    fetchApi<DerivedEntitlements>("tenancy/entitlements"),
    fetchEffectiveConfig(),
  ]);
  const coreNavigation = navigationResult.ok ? navigationResult.data : undefined;
  // Bilingual suffix labels built from BOTH dictionaries (nav payload labels
  // carry ar + en so a locale switch needs no refetch — the suffixes match).
  const arDictionary = getDictionary("ar");
  const enDictionary = getDictionary("en");
  const navigation = withOfflineNavigation(
    withPosNavigation(
      mergeNavigation(coreNavigation, effectiveResult, {
        comingWithPhase: (phase) => ({
          ar: formatMessage(arDictionary.industryNavComingPhase, { phase: phase.replace(/^PHASE-/, "") }),
          en: formatMessage(enDictionary.industryNavComingPhase, { phase }),
        }),
        notInWebApp: {
          ar: arDictionary.industryNavNotInWebApp,
          en: enDictionary.industryNavNotInWebApp,
        },
      }),
      {
        section: { ar: arDictionary.posNavSection, en: enDictionary.posNavSection },
        counter: { ar: arDictionary.posNavCounter, en: enDictionary.posNavCounter },
        floor: { ar: arDictionary.posNavFloor, en: enDictionary.posNavFloor },
        reconciliation: { ar: arDictionary.posNavReconciliation, en: enDictionary.posNavReconciliation },
        terminals: { ar: arDictionary.posNavTerminals, en: enDictionary.posNavTerminals },
      },
    ),
    {
      section: { ar: arDictionary.offlineNavSection, en: enDictionary.offlineNavSection },
      console: { ar: arDictionary.offlineConsoleTitle, en: enDictionary.offlineConsoleTitle },
    },
  );
  const readOnly =
    entitlementsResult.ok && entitlementsResult.data.subscription !== null
      ? { readOnly: entitlementsResult.data.subscription.readOnly, graceEndsAt: entitlementsResult.data.subscription.graceEndsAt }
      : { readOnly: false, graceEndsAt: null };

  // Breadcrumbs: registry labels when the route is in the resolved payload,
  // static dictionary labels otherwise; tenant detail nests under console.
  const crumbs: Crumb[] = [{ label: d.navHome, href: `/${locale}` }];
  const registryItem = navigation?.groups
    .flatMap((group) => group.items.map((item) => ({ group, item })))
    .find(({ item }) => item.route === activePath);
  if (registryItem !== undefined) {
    const groupLabel = registryItem.group.label[locale];
    if (groupLabel !== registryItem.item.label[locale]) {
      crumbs.push({ label: groupLabel });
    }
    crumbs.push({ label: registryItem.item.label[locale] });
  } else if (pagePath.startsWith("platform/tenants/")) {
    crumbs.push({ label: d.navPlatformConsole, href: `/${locale}/platform` });
    crumbs.push({ label: title });
  } else {
    const exact = FALLBACK_CRUMBS[pagePath];
    if (exact !== undefined) {
      const groupLabel = exact.group !== undefined ? d[exact.group] : undefined;
      if (groupLabel !== undefined && groupLabel !== d[exact.label]) {
        crumbs.push({ label: groupLabel });
      }
      crumbs.push({ label: d[exact.label] });
    } else {
      const dynamic = fallbackCrumbsFor(pagePath, title, d);
      if (dynamic !== undefined) {
        if (dynamic.groupLabel !== undefined && dynamic.groupLabel !== dynamic.label) {
          crumbs.push({ label: dynamic.groupLabel });
        }
        crumbs.push({ label: dynamic.label });
      }
    }
  }

  const userMenu = (
    <div className="flex items-center gap-2">
      <a
        lang={other}
        hrefLang={other}
        href={otherHref}
        className="inline-flex items-center gap-1.5 rounded-md border border-default bg-surface-card px-2 py-1 text-sm text-gray-700 outline-none hover:border-strong"
      >
        <Icon name="languages" size={14} />
        <span>{d.switchLabel}</span>
      </a>
      <NotificationBell locale={locale} />
      <LogoutButton locale={locale} label={d.signOut} />
    </div>
  );

  // Read-only grace banner (PAGE_ARCHETYPES common rules: global banner slot
  // under the header; role="status" — a product state, never an error page).
  const readOnlyBanner = readOnly.readOnly ? (
    <div
      role="status"
      lang={locale}
      className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-warning-border bg-warning-bg px-3 py-2 text-sm text-warning-text"
    >
      <span>{d.readOnlyBanner}</span>
      <a
        href={`/${locale}/billing`}
        className="inline-flex min-h-11 items-center rounded-md border border-warning-border bg-surface-card px-3 text-sm font-medium text-gray-800 underline-offset-2 hover:underline"
      >
        {d.readOnlyPayNow}
      </a>
    </div>
  ) : null;

  return (
    <ShellWithSearch
      locale={locale}
      dir={locale === "ar" ? "rtl" : "ltr"}
      navigation={navigation}
      activePath={activePath}
      brand={{ name: d.appTitle }}
      strings={{
        skipToContent: d.shellSkipToContent,
        commandMenuLabel: d.shellCommandSearch,
        shortcutsTitle: d.shellShortcutsTitle,
        closeLabel: d.shellClose,
        moreLabel: d.shellMore,
      }}
      userMenu={userMenu}
    >
      <ReadOnlyProvider value={readOnly}>
        <div className="flex flex-col gap-6">
          {readOnlyBanner}
          <div className="flex flex-col gap-1">
            <h1 lang={locale} className="text-lg font-semibold text-gray-900">
              {title}
            </h1>
            {crumbs.length > 1 && <Breadcrumbs items={crumbs} />}
          </div>
          {children}
        </div>
      </ReadOnlyProvider>
    </ShellWithSearch>
  );
}
