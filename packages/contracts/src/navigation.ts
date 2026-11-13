/**
 * @erp/contracts — navigation payload (PHASE-005 T8; NAVIGATION_MODEL §2).
 *
 * The NavItem registry is BINDING data: sidebar, command menu, mobile tabs
 * and the shortcut registry all consume it — never hard-coded listeners in
 * screens. Resolution is SERVER-ONLY (BR-039): an item renders iff
 * entitlement(featureKey) AND permission(user, branch) resolve true; the
 * client renders the derived payload and never decides visibility. Routes
 * without grants are opaque (404-equivalent — no feature-existence leak).
 *
 * Registry scope at PHASE-005: groups ship in binding order (1–10, the v2.0
 * set — the phase doc's "9" predates the HR & Payroll expansion group).
 * Items whose consuming phases have not shipped yet (sales invoices →
 * PHASE-013, journal entries → PHASE-007, payroll → PHASE-029, …) land with
 * their phases, which add their items + catalog entries in the same PR
 * (DESIGN_SYSTEM §4.3 / NAVIGATION_MODEL handoff rule). Groups with zero
 * visible children never render — that is the rule working as designed.
 */

export interface Bilingual {
  ar: string;
  en: string;
}

export type NavGroupId =
  | "home"
  | "sales"
  | "purchasing"
  | "inventory"
  | "manufacturing"
  | "accounting"
  | "treasury"
  | "reports"
  | "partners"
  | "settings"
  | "hr";

export type ArchetypeId =
  | "dashboard"
  | "list-search"
  | "create-edit"
  | "wizard"
  | "document-detail"
  | "transaction-entry"
  | "report"
  | "settings"
  | "point-of-sale"
  | "generic-detail"
  | "onboarding";

export const ARCHETYPE_IDS: readonly ArchetypeId[] = [
  "dashboard",
  "list-search",
  "create-edit",
  "wizard",
  "document-detail",
  "transaction-entry",
  "report",
  "settings",
  "point-of-sale",
  "generic-detail",
  "onboarding",
];

export const NAV_GROUP_IDS: readonly NavGroupId[] = [
  "home",
  "sales",
  "purchasing",
  "inventory",
  "manufacturing",
  "accounting",
  "treasury",
  "reports",
  "partners",
  "settings",
  "hr",
];

export function isArchetypeId(value: string): value is ArchetypeId {
  return (ARCHETYPE_IDS as readonly string[]).includes(value);
}

export function isNavGroupId(value: string): value is NavGroupId {
  return (NAV_GROUP_IDS as readonly string[]).includes(value);
}

export interface NavItem {
  /** Stable id ('sales.invoices') — shortcuts & deep links key on it. */
  id: string;
  parentGroup: NavGroupId;
  label: Bilingual;
  /** Registry icon name (Lucide vocabulary via @erp/ui's icons registry). */
  icon: string;
  /** Locale-agnostic route; locale lives in the URL prefix. */
  route: string;
  /** Entitlement key (module.feature_name); absent = core, always present. */
  featureKey?: string;
  /** Minimum permission to see the item (module.entity.action). */
  permission?: string;
  branchScoped: boolean;
  archetype: ArchetypeId;
  shortcut?: string;
  order: number;
}

export interface NavGroup {
  id: NavGroupId;
  label: Bilingual;
  icon: string;
}

export interface ResolvedNavGroup {
  id: NavGroupId;
  label: Bilingual;
  icon: string;
  items: NavItem[];
}

export interface ResolvedNavigation {
  groups: ResolvedNavGroup[];
  shortcuts: Record<string, NavItem>;
}

/** Sidebar groups — BINDING order (NAVIGATION_MODEL §1, v2.0 10-group set;
 * PHASE-042 T-13 adds the manufacturing execution group after inventory —
 * production consumes what inventory stocks). */
export const NAV_GROUPS: readonly NavGroup[] = [
  { id: "home", label: { ar: "الرئيسية", en: "Home" }, icon: "home" },
  { id: "sales", label: { ar: "المبيعات", en: "Sales" }, icon: "receipt" },
  { id: "purchasing", label: { ar: "المشتريات", en: "Purchasing" }, icon: "truck" },
  { id: "inventory", label: { ar: "المخزون", en: "Inventory" }, icon: "boxes" },
  {
    id: "manufacturing",
    label: { ar: "الإنتاج والتصنيع", en: "Manufacturing" },
    icon: "layers",
  },
  { id: "accounting", label: { ar: "المحاسبة", en: "Accounting" }, icon: "ledger" },
  { id: "treasury", label: { ar: "الخزينة", en: "Treasury" }, icon: "banknote" },
  { id: "reports", label: { ar: "التقارير", en: "Reports" }, icon: "bar-chart" },
  { id: "partners", label: { ar: "الجهات", en: "Partners" }, icon: "users" },
  { id: "settings", label: { ar: "الإعدادات", en: "Settings" }, icon: "settings" },
  { id: "hr", label: { ar: "الموظفون والرواتب", en: "HR & Payroll" }, icon: "users-round" },
];

/**
 * Registry — shipped items (routes that exist today): PHASE-005 admin
 * surfaces + PHASE-006 master data (partners/inventory groups). Business
 * items join their phases (see module doc). Feature keys are the exact
 * FEATURE_CATALOG strings; permissions the exact seeded matrix keys.
 */
export const NAV_ITEMS: readonly NavItem[] = [
  // home group — T19-WEB (PHASE-014): the owner/CEO dashboard moved to its
  // own /dashboard route (PAGE_ARCHETYPES §1, NAVIGATION_MODEL §5 landing
  // pages) and is now entitlement-gated (reporting.dashboards, FEATURE_CATALOG
  // §reporting) + permission-gated (the workspace runs reporting.reports.run
  // reports); "/" stays the home tiles page and redirects entitled users to
  // /dashboard server-side. The notifications inbox is the second home item —
  // self-plane (SESSION_ROUTES, matrix carries no key), so it renders for
  // every member and is never feature-gated.
  {
    id: "home.dashboard",
    parentGroup: "home",
    label: { ar: "لوحة المعلومات", en: "Dashboard" },
    icon: "home",
    route: "/dashboard",
    featureKey: "reporting.dashboards",
    permission: "reporting.reports.run",
    branchScoped: false,
    archetype: "dashboard",
    shortcut: "g h",
    order: 10,
  },
  {
    id: "notifications.inbox",
    parentGroup: "home",
    label: { ar: "الإشعارات", en: "Notifications" },
    icon: "inbox",
    route: "/notifications",
    branchScoped: false,
    archetype: "list-search",
    order: 20,
  },
  // sales group — PHASE-012 (T13-UI): the quote-to-cash chain. Quotes and
  // orders share ONE workspace (/sales/quotes); deliveries, invoices and
  // credit notes are separate transaction-entry screens; /sales/ar carries
  // the aging/statement/open-items views (the receipts money leg rides the
  // treasury group's existing surface). Feature keys are the exact
  // FEATURE_CATALOG §9 strings; permissions the exact seeded matrix keys the
  // sales controller enforces on every route (matrix §3.2).
  {
    id: "sales.quotes",
    parentGroup: "sales",
    label: { ar: "عروض الأسعار وأوامر البيع", en: "Quotations & orders" },
    icon: "file-text",
    route: "/sales/quotes",
    featureKey: "sales.quotations",
    permission: "sales.quotations.view",
    branchScoped: false,
    archetype: "transaction-entry",
    order: 10,
  },
  {
    id: "sales.deliveries",
    parentGroup: "sales",
    label: { ar: "سندات التسليم", en: "Delivery notes" },
    icon: "boxes",
    route: "/sales/deliveries",
    featureKey: "sales.deliveries",
    permission: "sales.deliveries.view",
    branchScoped: false,
    archetype: "transaction-entry",
    order: 20,
  },
  {
    id: "sales.invoices",
    parentGroup: "sales",
    label: { ar: "فواتير البيع", en: "Sales invoices" },
    icon: "receipt",
    route: "/sales/invoices",
    featureKey: "sales.invoices",
    permission: "sales.invoices.view",
    branchScoped: false,
    archetype: "transaction-entry",
    order: 30,
  },
  {
    id: "sales.credit_notes",
    parentGroup: "sales",
    label: { ar: "الإشعارات الدائنة", en: "Credit notes" },
    icon: "file-minus",
    route: "/sales/credit-notes",
    featureKey: "sales.credit_notes",
    permission: "sales.credit_notes.view",
    branchScoped: false,
    archetype: "transaction-entry",
    order: 40,
  },
  {
    id: "sales.ar",
    parentGroup: "sales",
    label: { ar: "حسابات العملاء", en: "Receivables" },
    icon: "ledger",
    route: "/sales/ar",
    featureKey: "sales.receivables_aging",
    permission: "sales.invoices.view",
    branchScoped: false,
    archetype: "list-search",
    order: 50,
  },
  // PHASE-027 (wave F): installment plans — the v2.0 registry row
  // `sales.installment-plans` (NAVIGATION_MODEL §1.1): featureKey the
  // FEATURE_CATALOG `installments.plans` string; permission the exact
  // seeded §3.13 viewer key. Plan creation runs as the §9 wizard under the
  // module route (the fixed-assets one-item-many-screens shape).
  {
    id: "sales.installment-plans",
    parentGroup: "sales",
    label: { ar: "خطة الأقساط", en: "Installment plans" },
    icon: "wallet-cards",
    route: "/installments",
    featureKey: "installments.plans",
    permission: "installments.plans.view",
    branchScoped: false,
    archetype: "list-search",
    order: 40,
  },
  // PHASE-017 (T6): the workshop job-card workspace — a sales-module
  // document (بطاقة عمل); pruned for tenants without the feature key.
  {
    id: "sales.job_cards",
    parentGroup: "sales",
    label: { ar: "بطاقات العمل", en: "Job cards" },
    icon: "wrench",
    route: "/job-cards",
    featureKey: "sales.job_cards",
    permission: "sales.job_cards.manage",
    branchScoped: false,
    archetype: "transaction-entry",
    order: 55,
  },
  // PHASE-017 (T12): commission runs + per-rep rules.
  {
    id: "sales.commissions",
    parentGroup: "sales",
    label: { ar: "العمولات", en: "Commissions" },
    icon: "percent",
    route: "/sales/commissions",
    featureKey: "sales.commissions",
    permission: "sales.commissions.manage",
    branchScoped: false,
    archetype: "list-search",
    order: 60,
  },
  // PHASE-039 returns & collections rows (matrix §3.2/§3.3; the seeded
  // 0055/0056/0059 keys): the customer RMA + warranty workspace (the
  // warranties ride the returns screen as its second tab) and the dunning
  // engine's collections workspace (letters/policies/actions/credit
  // reviews/agencies).
  {
    id: "sales.returns",
    parentGroup: "sales",
    label: { ar: "مرتجعات البيع", en: "Sales returns" },
    icon: "undo-2",
    route: "/sales/returns",
    featureKey: "sales.rma",
    permission: "sales.rma.read",
    branchScoped: false,
    archetype: "transaction-entry",
    order: 70,
  },
  {
    id: "sales.dunning",
    parentGroup: "sales",
    label: { ar: "التحصيل والمطالبات", en: "Collections & dunning" },
    icon: "hourglass",
    route: "/sales/dunning",
    featureKey: "sales.dunning",
    permission: "sales.dunning.manage",
    branchScoped: false,
    archetype: "transaction-entry",
    order: 80,
  },
  // settings group — the PHASE-003/004 admin surfaces (real routes today)
  {
    id: "settings.users",
    parentGroup: "settings",
    label: { ar: "المستخدمون", en: "Users" },
    icon: "users",
    route: "/users",
    featureKey: "platform.users_roles",
    permission: "identity.users.view",
    branchScoped: false,
    archetype: "list-search",
    order: 10,
  },
  {
    id: "settings.roles",
    parentGroup: "settings",
    label: { ar: "الأدوار", en: "Roles" },
    icon: "shield",
    route: "/roles",
    featureKey: "platform.users_roles",
    permission: "identity.users.view",
    branchScoped: false,
    archetype: "list-search",
    order: 20,
  },
  {
    id: "settings.branches",
    parentGroup: "settings",
    label: { ar: "الفروع", en: "Branches" },
    icon: "building",
    route: "/branches",
    featureKey: "platform.branches",
    permission: "tenancy.branches.manage",
    branchScoped: false,
    archetype: "list-search",
    order: 30,
  },
  {
    id: "settings.tenant",
    parentGroup: "settings",
    label: { ar: "إعدادات المنشأة", en: "Workspace settings" },
    icon: "settings",
    route: "/settings",
    permission: "tenancy.settings.manage",
    branchScoped: false,
    archetype: "settings",
    order: 40,
  },
  {
    id: "settings.sessions",
    parentGroup: "settings",
    label: { ar: "الجلسات", en: "Sessions" },
    icon: "lock",
    route: "/sessions",
    permission: "identity.sessions.revoke",
    branchScoped: false,
    archetype: "list-search",
    order: 50,
  },
  {
    id: "settings.mfa",
    parentGroup: "settings",
    label: { ar: "التحقق بخطوتين", en: "Two-factor auth" },
    icon: "shield",
    route: "/mfa",
    permission: "identity.mfa.manage",
    branchScoped: false,
    archetype: "settings",
    order: 60,
  },
  {
    id: "settings.support",
    parentGroup: "settings",
    label: { ar: "جلسات الدعم", en: "Support sessions" },
    icon: "mail",
    route: "/support-sessions",
    permission: "tenancy.settings.manage",
    branchScoped: false,
    archetype: "list-search",
    order: 70,
  },
  // PHASE-024 T8: the tenant-admin audit review console — permission-gated
  // only (no featureKey), the settings.support/platform.audit declaration
  // rule; the cross-tenant console stays at platform/audit.
  {
    id: "settings.audit",
    parentGroup: "settings",
    label: { ar: "سجل التدقيق", en: "Audit review" },
    icon: "file-text",
    route: "/audit",
    permission: "audit.view",
    branchScoped: false,
    archetype: "list-search",
    order: 75,
  },
  // PHASE-040 T-08 (§2.8): the data import & migration hub — the seven-kind
  // toolkit wizard (COA, opening balances, fixed assets, employees, price
  // lists, contracts, budget grids), saved mappings, and the IN-26
  // QuickBooks/Odoo/Excel-generic adapter templates. The plan gate is
  // migration 0060 §8's platform.data_migration grant (business +
  // enterprise — the 0051 tier-4 precedent); the permission is the seeded
  // configuration.imports.manage (matrix §3.18).
  {
    id: "settings.imports",
    parentGroup: "settings",
    label: { ar: "استيراد البيانات والترحيل", en: "Data import & migration" },
    icon: "file-up",
    route: "/settings/imports",
    featureKey: "platform.data_migration",
    permission: "configuration.imports.manage",
    branchScoped: false,
    archetype: "wizard",
    order: 80,
  },
  // PHASE-041 T-10 (§2.2/§2.8): the communications hub — the settings back
  // office (message templates channel×locale×module + provider selection/
  // credentials/market senders + the tenant-default preference matrix).
  // The route rides communication.templates.manage (matrix §3.19) under the
  // ALL-plans communication.outbound feature (the SANDBOX defaults show
  // honestly on every plan; paid provider selections fail closed
  // server-side). The unified inbox is the second home item — a workspace
  // surface (UX-14/IN-16) gated by communication.inbox.read.
  {
    id: "settings.communication",
    parentGroup: "settings",
    label: { ar: "مركز الاتصالات", en: "Communications" },
    icon: "send",
    route: "/settings/communication",
    featureKey: "communication.outbound",
    permission: "communication.templates.manage",
    branchScoped: false,
    archetype: "settings",
    order: 85,
  },
  {
    id: "communication.inbox",
    parentGroup: "home",
    label: { ar: "صندوق الاتصالات الموحد", en: "Communications inbox" },
    icon: "inbox",
    route: "/communication/inbox",
    permission: "communication.inbox.read",
    branchScoped: false,
    archetype: "list-search",
    order: 30,
  },
  // partners group — PHASE-006 master data (T11): partner directory + the
  // opening-balance DRAFT capture console. Feature keys are the exact
  // FEATURE_CATALOG strings; permissions the exact seeded matrix keys.
  {
    id: "partners.directory",
    parentGroup: "partners",
    label: { ar: "دليل الجهات", en: "Partner directory" },
    icon: "users",
    route: "/partners",
    featureKey: "partners.directory",
    permission: "partners.view",
    branchScoped: false,
    archetype: "list-search",
    shortcut: "g p",
    order: 10,
  },
  {
    id: "partners.opening_balances",
    parentGroup: "partners",
    label: { ar: "الأرصدة الافتتاحية", en: "Opening balances" },
    icon: "ledger",
    route: "/opening-balances",
    featureKey: "partners.directory",
    permission: "partners.view",
    branchScoped: false,
    archetype: "list-search",
    order: 20,
  },
  // PHASE-017 (T5): the per-partner vehicle registry (سجل المركبات).
  {
    id: "partners.vehicles",
    parentGroup: "partners",
    label: { ar: "المركبات", en: "Vehicles" },
    icon: "car",
    route: "/vehicles",
    featureKey: "partners.directory",
    permission: "partners.vehicles.manage",
    branchScoped: false,
    archetype: "list-search",
    order: 30,
  },
  // inventory group — PHASE-006 master data (T11): item master + price lists
  // + bulk import/export. Sub-routes (/new, /[id]) launch from the lists.
  {
    id: "items.item_master",
    parentGroup: "inventory",
    label: { ar: "الأصناف", en: "Items" },
    icon: "boxes",
    route: "/inventory/items",
    featureKey: "items.item_master",
    permission: "items.view",
    branchScoped: false,
    archetype: "list-search",
    shortcut: "g i",
    order: 10,
  },
  {
    id: "items.price_lists",
    parentGroup: "inventory",
    label: { ar: "قوائم الأسعار", en: "Price lists" },
    icon: "banknote",
    route: "/inventory/price-lists",
    featureKey: "items.price_lists",
    permission: "items.view",
    branchScoped: false,
    archetype: "list-search",
    order: 20,
  },
  {
    id: "items.import_export",
    parentGroup: "inventory",
    label: { ar: "استيراد وتصدير", en: "Import & export" },
    icon: "file-check",
    route: "/inventory/import",
    featureKey: "items.import_export",
    permission: "items.import.run",
    branchScoped: false,
    archetype: "wizard",
    order: 30,
  },
  // inventory group — PHASE-010 (T14-UI): warehousing + the stock ledger
  // surfaces. Feature keys are the exact FEATURE_CATALOG strings
  // (inventory.*); permissions the exact seeded matrix keys the inventory
  // controller enforces on every route (matrix §3.5).
  {
    id: "inventory.warehouses",
    parentGroup: "inventory",
    label: { ar: "المستودعات", en: "Warehouses" },
    icon: "building",
    route: "/inventory/warehouses",
    featureKey: "inventory.multi_warehouse",
    permission: "inventory.stock.view",
    branchScoped: false,
    archetype: "list-search",
    order: 40,
  },
  {
    id: "inventory.stock",
    parentGroup: "inventory",
    label: { ar: "الأرصدة المتوفرة", en: "Stock on hand" },
    icon: "boxes",
    route: "/inventory/stock",
    featureKey: "inventory.stock_ledger",
    permission: "inventory.stock.view",
    branchScoped: false,
    archetype: "list-search",
    order: 50,
  },
  {
    id: "inventory.moves",
    parentGroup: "inventory",
    label: { ar: "حركات المخزون", en: "Stock movements" },
    icon: "arrow-left-right",
    route: "/inventory/moves",
    featureKey: "inventory.stock_ledger",
    permission: "inventory.moves.view",
    branchScoped: false,
    archetype: "list-search",
    order: 60,
  },
  {
    id: "inventory.transfers",
    parentGroup: "inventory",
    label: { ar: "تحويلات المخزون", en: "Stock transfers" },
    icon: "truck",
    route: "/inventory/transfers",
    featureKey: "inventory.stock_transfers",
    permission: "inventory.transfers.view",
    branchScoped: false,
    archetype: "list-search",
    order: 70,
  },
  {
    id: "inventory.counts",
    parentGroup: "inventory",
    label: { ar: "جرد المخزون", en: "Stock counting" },
    icon: "check",
    route: "/inventory/counting",
    featureKey: "inventory.stock_counts",
    permission: "inventory.counts.view",
    branchScoped: false,
    archetype: "wizard",
    order: 80,
  },
  // PHASE-035 (T-02/T-03): the batch/expiry and serial surfaces (audit
  // EVAL-F-1) — the backing API (GET/POST /inventory/batches, /serials)
  // shipped in PHASE-010/018 but no screen ever registered, so tracking
  // tenants reached batches/serials only as columns on the movements list.
  // Feature keys = the exact FEATURE_CATALOG capabilities (batch_tracking /
  // serial_tracking — business+enterprise); permissions = the exact seeded
  // keys the controller enforces on the list routes (inventory.moves.view;
  // the manage actions stay inventory.tracking.manage inside the screens).
  {
    id: "inventory.batches",
    parentGroup: "inventory",
    label: { ar: "الدفعات والصلاحية", en: "Batches & expiry" },
    icon: "calendar-clock",
    route: "/inventory/batches",
    featureKey: "inventory.batch_tracking",
    permission: "inventory.moves.view",
    branchScoped: false,
    archetype: "list-search",
    order: 90,
  },
  {
    id: "inventory.serials",
    parentGroup: "inventory",
    label: { ar: "الأرقام التسلسلية", en: "Serial numbers" },
    icon: "barcode",
    route: "/inventory/serials",
    featureKey: "inventory.serial_tracking",
    permission: "inventory.moves.view",
    branchScoped: false,
    archetype: "list-search",
    order: 100,
  },
  // PHASE-035 (T-04): the inventory-adjustments read surface (audit
  // EVAL-F-2): a dedicated list over the existing adjustment journal flow
  // (previously reachable only through stock counts). READ surface only —
  // posting stays in the count wizard (design intent preserved; the phase
  // doc records it). Rides the stock-ledger capability like stock/moves;
  // permission = the seeded key the list route enforces.
  {
    id: "inventory.adjustments",
    parentGroup: "inventory",
    label: { ar: "تسويات المخزون", en: "Stock adjustments" },
    icon: "arrow-left-right",
    route: "/inventory/adjustments",
    featureKey: "inventory.stock_ledger",
    permission: "inventory.stock.view",
    branchScoped: false,
    archetype: "list-search",
    order: 110,
  },
  // PHASE-044 (T-16): the WMS surfaces (§2.17) — the location tree, the
  // pick waves, the cycle-count workspace, ABC, and the quarantine board.
  // Feature keys = the exact FEATURE_CATALOG strings seeded in 0071 §3
  // (business + enterprise; the distribution/wholesale templates require
  // them by default); permissions = the exact seeded matrix keys the wms
  // controller enforces on every route (0071 §1).
  {
    id: "inventory.locations",
    parentGroup: "inventory",
    label: { ar: "مواقع المستودع", en: "Warehouse locations" },
    icon: "map-pin",
    route: "/inventory/locations",
    featureKey: "inventory.wms",
    permission: "inventory.wms.locations",
    branchScoped: false,
    archetype: "list-search",
    order: 120,
  },
  {
    id: "inventory.pick_waves",
    parentGroup: "inventory",
    label: { ar: "موجات الانتقاء", en: "Pick waves" },
    icon: "route",
    route: "/inventory/pick-waves",
    featureKey: "inventory.picking",
    permission: "inventory.wms.picking",
    branchScoped: false,
    archetype: "list-search",
    order: 130,
  },
  {
    id: "inventory.cycle_counts",
    parentGroup: "inventory",
    label: { ar: "الجرد الدوري", en: "Cycle counts" },
    icon: "calendar-check",
    route: "/inventory/cycle-counts",
    featureKey: "inventory.cycle_counts",
    permission: "inventory.cycle_counts",
    branchScoped: false,
    archetype: "wizard",
    order: 140,
  },
  {
    id: "inventory.abc",
    parentGroup: "inventory",
    label: { ar: "تصنيف ABC", en: "ABC classification" },
    icon: "bar-chart",
    route: "/inventory/abc",
    featureKey: "inventory.abc",
    permission: "inventory.abc",
    branchScoped: false,
    archetype: "report",
    order: 150,
  },
  {
    id: "inventory.quarantine",
    parentGroup: "inventory",
    label: { ar: "لوحة الحجر الصحي", en: "Quarantine board" },
    icon: "shield",
    route: "/inventory/quarantine",
    featureKey: "inventory.quarantine",
    permission: "inventory.quarantine",
    branchScoped: false,
    archetype: "list-search",
    order: 160,
  },
  // accounting group — PHASE-007 surfaces (matrix §3.1; archetype ids per
  // PAGE_ARCHETYPES; permission = the exact seeded keys).
  {
    id: "accounting.chart_of_accounts",
    parentGroup: "accounting",
    label: { ar: "دليل الحسابات", en: "Chart of accounts" },
    icon: "list-ordered",
    route: "/accounting/accounts",
    featureKey: "accounting.chart_of_accounts",
    permission: "accounting.accounts.view",
    branchScoped: false,
    archetype: "create-edit",
    order: 10,
  },
  {
    id: "accounting.journal_entries",
    parentGroup: "accounting",
    label: { ar: "قيود اليومية", en: "Journal entries" },
    icon: "file-text",
    route: "/accounting/journals",
    featureKey: "accounting.journal_entries",
    permission: "accounting.journal_entries.view",
    branchScoped: false,
    archetype: "transaction-entry",
    shortcut: "g j",
    order: 20,
  },
  {
    id: "accounting.general_ledger",
    parentGroup: "accounting",
    label: { ar: "دفتر الأستاذ العام", en: "General ledger" },
    icon: "book-check",
    route: "/accounting/gl",
    featureKey: "accounting.general_ledger",
    permission: "accounting.journal_entries.view",
    branchScoped: false,
    archetype: "list-search",
    order: 30,
  },
  {
    id: "accounting.fiscal_calendar",
    parentGroup: "accounting",
    label: { ar: "الفترات المالية", en: "Fiscal calendar" },
    icon: "calendar",
    route: "/accounting/periods",
    featureKey: "accounting.fiscal_calendar",
    permission: "accounting.journal_entries.view",
    branchScoped: false,
    archetype: "list-search",
    order: 40,
  },
  {
    id: "accounting.approvals",
    parentGroup: "accounting",
    label: { ar: "الاعتمادات", en: "Approvals" },
    icon: "circle-check",
    route: "/accounting/approvals",
    featureKey: "accounting.approvals",
    permission: "accounting.journal_entries.approve",
    branchScoped: false,
    archetype: "list-search",
    order: 50,
  },
  {
    id: "accounting.exchange_rates",
    parentGroup: "accounting",
    label: { ar: "أسعار الصرف", en: "Exchange rates" },
    icon: "banknote",
    route: "/accounting/rates",
    featureKey: "accounting.multi_currency",
    permission: "accounting.journal_entries.view",
    branchScoped: false,
    archetype: "list-search",
    order: 60,
  },
  // PHASE-026 (T13-UI): fixed assets & depreciation. The v2.0 registry row
  // `accounting.fixed-assets` (NAVIGATION_MODEL §1.1): featureKey is the
  // FEATURE_CATALOG §19 `fixed_assets.register` string; permission the exact
  // seeded §3.11 viewer key. One top-level item — the sub-surfaces
  // (categories, depreciation runs, disposals, reports) are in-screen tabs
  // under the module route, the manufacturing decision-8 precedent.
  {
    id: "accounting.fixed-assets",
    parentGroup: "accounting",
    label: { ar: "الأصول الثابتة", en: "Fixed assets" },
    icon: "building",
    route: "/fixed-assets",
    featureKey: "fixed_assets.register",
    permission: "fixed_assets.assets.view",
    branchScoped: false,
    archetype: "list-search",
    order: 70,
  },
  // PHASE-028 (T9): budgets — the period-column planning grid. The v2.0
  // registry row `accounting.budgets` (NAVIGATION_MODEL §1.1; ED-12):
  // featureKey the exact FEATURE_CATALOG `budgeting.budgets` string;
  // permission the exact seeded §3.13 viewer key. The register / workspace /
  // import / reports surfaces navigate through the module route tree (the
  // fixed-assets one-item-many-screens decision-8 precedent).
  {
    id: "accounting.budgets",
    parentGroup: "accounting",
    label: { ar: "الموازنات", en: "Budgets" },
    icon: "bar-chart",
    route: "/budgeting",
    featureKey: "budgeting.budgets",
    permission: "budgeting.budgets.view",
    branchScoped: false,
    archetype: "list-search",
    order: 80,
  },
  // purchasing group — PHASE-011 (T13-UI): the procure-to-pay chain.
  // Feature keys are the exact FEATURE_CATALOG §9 strings; permissions the
  // exact seeded matrix keys the purchasing controller enforces (matrix
  // §3.3). Payments ride the treasury group's existing surface.
  {
    id: "purchasing.orders",
    parentGroup: "purchasing",
    label: { ar: "أوامر الشراء", en: "Purchase orders" },
    icon: "truck",
    route: "/purchasing/orders",
    featureKey: "purchasing.orders",
    permission: "purchasing.purchase_orders.view",
    branchScoped: false,
    archetype: "transaction-entry",
    shortcut: "g o",
    order: 10,
  },
  // PHASE-038 sourcing rows (matrix §3.16; FEATURE_CATALOG §9 additions —
  // the tier-4 financial-depth grants): the negotiation loop in front of
  // the PO + the collaboration layer.
  {
    id: "purchasing.rfqs",
    parentGroup: "purchasing",
    label: { ar: "طلبات عروض الأسعار", en: "RFQs & sourcing" },
    icon: "file-check",
    route: "/purchasing/rfq",
    featureKey: "purchasing.rfqs",
    permission: "purchasing.rfqs.read",
    branchScoped: false,
    archetype: "transaction-entry",
    order: 15,
  },
  {
    id: "purchasing.blanket_orders",
    parentGroup: "purchasing",
    label: { ar: "الاتفاقيات الإطارية", en: "Blanket agreements" },
    icon: "book-check",
    route: "/purchasing/blanket-orders",
    featureKey: "purchasing.blanket_orders",
    permission: "purchasing.rfqs.read",
    branchScoped: false,
    archetype: "list-search",
    order: 16,
  },
  // manufacturing group — PHASE-042 (T-13; matrix §3.20): the manufacturing
  // execution surfaces. Until now these screens rode the industry manifests
  // + FALLBACK_CRUMBS; the routing/work-center/costing phase promotes them
  // to first-class registry rows. Feature keys are the exact 0066 §8
  // plan-grant strings (manufacturing.work_centers / manufacturing.routing /
  // manufacturing.shopfloor / manufacturing.downtime /
  // manufacturing.standard_costs); permissions mirror the route-permissions
  // rows the five controllers enforce verbatim.
  {
    id: "manufacturing.work_centers",
    parentGroup: "manufacturing",
    label: { ar: "مراكز العمل", en: "Work centers" },
    icon: "building",
    route: "/manufacturing/work-centers",
    featureKey: "manufacturing.work_centers",
    permission: "manufacturing.work_centers.manage",
    branchScoped: false,
    archetype: "list-search",
    order: 10,
  },
  {
    id: "manufacturing.routings",
    parentGroup: "manufacturing",
    label: { ar: "مسارات الإنتاج", en: "Routings" },
    icon: "list-ordered",
    route: "/manufacturing/routings",
    featureKey: "manufacturing.routing",
    permission: "manufacturing.routings.manage",
    branchScoped: false,
    archetype: "create-edit",
    order: 20,
  },
  {
    id: "manufacturing.shopfloor",
    parentGroup: "manufacturing",
    label: { ar: "طرفية أرضية المصنع", en: "Shop-floor terminal" },
    icon: "barcode",
    route: "/manufacturing/shopfloor",
    featureKey: "manufacturing.shopfloor",
    permission: "manufacturing.shopfloor.execute",
    branchScoped: false,
    archetype: "point-of-sale",
    order: 30,
  },
  {
    id: "manufacturing.downtime",
    parentGroup: "manufacturing",
    label: { ar: "سجل التوقفات", en: "Downtime log" },
    icon: "hourglass",
    route: "/manufacturing/downtime",
    featureKey: "manufacturing.downtime",
    permission: "manufacturing.downtime.log",
    branchScoped: false,
    archetype: "list-search",
    order: 40,
  },
  {
    id: "manufacturing.standard_costs",
    parentGroup: "manufacturing",
    label: { ar: "التكاليف المعيارية", en: "Standard costs" },
    icon: "banknote",
    route: "/manufacturing/standard-costs",
    featureKey: "manufacturing.standard_costs",
    permission: "manufacturing.standard_costs.manage",
    branchScoped: false,
    archetype: "list-search",
    order: 50,
  },
  // PHASE-043 (T-15; matrix §3.20): the planning surfaces — the MRP engine
  // + suggestions board (manufacturing.mrp) and the master production
  // schedule (manufacturing.mps). Feature keys are the exact 0066 §8
  // plan-grant strings; permissions mirror the route-permissions rows the
  // mrp/mps controllers enforce verbatim. The frozen-fence override key
  // manufacturing.mps.frozen_edit stays DATA-DEPENDENT (resolved per
  // request by the service — never a static row here).
  {
    id: "manufacturing.mrp",
    parentGroup: "manufacturing",
    label: { ar: "تخطيط الاحتياجات", en: "MRP" },
    icon: "calendar-clock",
    route: "/manufacturing/mrp",
    featureKey: "manufacturing.mrp",
    permission: "manufacturing.mrp",
    branchScoped: false,
    archetype: "list-search",
    order: 60,
  },
  {
    id: "manufacturing.mps",
    parentGroup: "manufacturing",
    label: { ar: "الجدول الزمني للإنتاج", en: "Master schedule" },
    icon: "calendar-check",
    route: "/manufacturing/mps",
    featureKey: "manufacturing.mps",
    permission: "manufacturing.mps",
    branchScoped: false,
    archetype: "list-search",
    order: 70,
  },
  {
    id: "purchasing.supplier_scorecards",
    parentGroup: "purchasing",
    label: { ar: "تقييم الموردين", en: "Supplier scorecards" },
    icon: "bar-chart",
    route: "/purchasing/supplier-scorecards",
    featureKey: "purchasing.supplier_scorecards",
    permission: "purchasing.rfqs.read",
    branchScoped: false,
    archetype: "list-search",
    order: 17,
  },
  {
    id: "purchasing.capex",
    parentGroup: "purchasing",
    label: { ar: "الشراء الرأسمالي", en: "CAPEX requests" },
    icon: "landmark",
    route: "/purchasing/capex-requests",
    featureKey: "purchasing.capex_requests",
    permission: "purchasing.capex.read",
    branchScoped: false,
    archetype: "transaction-entry",
    order: 18,
  },
  {
    id: "purchasing.goods_receipts",
    parentGroup: "purchasing",
    label: { ar: "سندات الاستلام", en: "Goods receipts" },
    icon: "boxes",
    route: "/purchasing/receipts",
    featureKey: "purchasing.goods_receipts",
    permission: "purchasing.goods_receipts.view",
    branchScoped: false,
    archetype: "transaction-entry",
    order: 20,
  },
  {
    id: "purchasing.supplier_invoices",
    parentGroup: "purchasing",
    label: { ar: "فواتير الموردين", en: "Supplier invoices" },
    icon: "file-text",
    route: "/purchasing/invoices",
    featureKey: "purchasing.supplier_invoices",
    permission: "purchasing.supplier_invoices.view",
    branchScoped: false,
    archetype: "transaction-entry",
    order: 30,
  },
  {
    id: "purchasing.debit_notes",
    parentGroup: "purchasing",
    label: { ar: "الإشعارات المدينة", en: "Debit notes" },
    icon: "file-minus",
    route: "/purchasing/debit-notes",
    featureKey: "purchasing.debit_notes",
    permission: "purchasing.debit_notes.view",
    branchScoped: false,
    archetype: "transaction-entry",
    order: 40,
  },
  // PHASE-039 supplier returns (matrix §3.3; the seeded 0059 keys): the RTV
  // authorizations REQUESTED → approve → ship → credit (G-38).
  {
    id: "purchasing.returns",
    parentGroup: "purchasing",
    label: { ar: "مرتجعات الموردين", en: "Supplier returns" },
    icon: "corner-up-left",
    route: "/purchasing/returns",
    featureKey: "purchasing.rma",
    permission: "purchasing.rma.read",
    branchScoped: false,
    archetype: "transaction-entry",
    order: 45,
  },
  {
    id: "purchasing.ap",
    parentGroup: "purchasing",
    label: { ar: "حسابات الموردين", en: "Payables" },
    icon: "ledger",
    route: "/purchasing/ap",
    featureKey: "purchasing.supplier_invoices",
    permission: "purchasing.supplier_invoices.view",
    branchScoped: false,
    archetype: "list-search",
    order: 50,
  },
  // treasury group — PHASE-008 surfaces (matrix §3.4; archetype ids per
  // PAGE_ARCHETYPES; feature keys are the exact FEATURE_CATALOG strings,
  // permissions the exact seeded matrix keys — the treasury controller
  // enforces the same keys on every route).
  {
    id: "treasury.accounts",
    parentGroup: "treasury",
    label: { ar: "الحسابات النقدية", en: "Cash accounts" },
    icon: "banknote",
    route: "/treasury/accounts",
    featureKey: "treasury.accounts",
    permission: "treasury.accounts.view",
    branchScoped: false,
    archetype: "list-search",
    order: 10,
  },
  {
    id: "treasury.receipts",
    parentGroup: "treasury",
    label: { ar: "سندات القبض", en: "Receipts" },
    icon: "receipt",
    route: "/treasury/receipts",
    featureKey: "treasury.receipts_disbursements",
    permission: "sales.receipts.view",
    branchScoped: false,
    archetype: "transaction-entry",
    shortcut: "g r",
    order: 20,
  },
  {
    id: "treasury.payments",
    parentGroup: "treasury",
    label: { ar: "سندات الصرف", en: "Payments" },
    icon: "send",
    route: "/treasury/payments",
    featureKey: "treasury.receipts_disbursements",
    permission: "purchasing.payments.view",
    branchScoped: false,
    archetype: "transaction-entry",
    order: 30,
  },
  {
    id: "treasury.expenses",
    parentGroup: "treasury",
    label: { ar: "المصروفات", en: "Expenses" },
    icon: "file-check",
    route: "/treasury/expenses",
    featureKey: "treasury.expenses",
    permission: "treasury.expenses.view",
    branchScoped: false,
    archetype: "list-search",
    order: 40,
  },
  {
    id: "treasury.transfers",
    parentGroup: "treasury",
    label: { ar: "التحويلات النقدية", en: "Cash transfers" },
    icon: "arrow-left-right",
    route: "/treasury/transfers",
    featureKey: "treasury.cash_transfers",
    permission: "treasury.transfers.create",
    branchScoped: false,
    archetype: "list-search",
    order: 50,
  },
  {
    id: "treasury.shifts",
    parentGroup: "treasury",
    label: { ar: "ورديات الصندوق", en: "Cashier shifts" },
    icon: "clock",
    route: "/treasury/shifts",
    featureKey: "treasury.cashier_shifts",
    permission: "treasury.shifts.manage",
    branchScoped: false,
    archetype: "list-search",
    order: 60,
  },
  {
    id: "treasury.bank_reconciliation",
    parentGroup: "treasury",
    label: { ar: "التسوية البنكية", en: "Bank reconciliation" },
    icon: "landmark",
    route: "/treasury/bank-rec",
    featureKey: "treasury.bank_reconciliation",
    permission: "treasury.bank_reconciliation.manage",
    branchScoped: false,
    archetype: "wizard",
    order: 70,
  },
  // PHASE-027 (wave F): cheques & notes + the PDC maturity calendar — the
  // v2.0 registry rows `treasury.cheques-notes` / `treasury.pdc-calendar`
  // (NAVIGATION_MODEL §1.1): featureKeys the exact FEATURE_CATALOG
  // `notes.received` / `notes.pdc_calendar` strings; permissions the exact
  // seeded §3.12 viewer key. The register/detail/calendar/reports surfaces
  // navigate through the in-page tab strip (one-item-many-screens, the
  // fixed-assets decision-8 precedent).
  {
    id: "treasury.cheques-notes",
    parentGroup: "treasury",
    label: { ar: "الشيكات والأوراق التجارية", en: "Cheques & notes" },
    icon: "receipt-text",
    route: "/notes",
    featureKey: "notes.received",
    permission: "notes.notes.view",
    branchScoped: false,
    archetype: "list-search",
    order: 45,
  },
  {
    id: "treasury.pdc-calendar",
    parentGroup: "treasury",
    label: { ar: "تقويم الاستحقاق", en: "Maturity calendar" },
    icon: "calendar-clock",
    route: "/notes/calendar",
    featureKey: "notes.pdc_calendar",
    permission: "notes.notes.view",
    branchScoped: false,
    archetype: "dashboard",
    order: 46,
  },
  // settings group — PHASE-009 tax surfaces (T15-UI): the tax engine's
  // admin screens. Permission-gated only (no featureKey — the tax engine is
  // core); the codes/registrations managers need their manage keys while the
  // packs viewer rides the returns-view family (apply is gated in-screen by
  // tax.codes.manage).
  {
    id: "settings.tax_codes",
    parentGroup: "settings",
    label: { ar: "الرموز الضريبية", en: "Tax codes" },
    icon: "receipt",
    route: "/settings/tax/codes",
    permission: "tax.codes.manage",
    branchScoped: false,
    archetype: "settings",
    order: 100,
  },
  {
    id: "settings.tax_registrations",
    parentGroup: "settings",
    label: { ar: "التسجيلات الضريبية", en: "Tax registrations" },
    icon: "shield",
    route: "/settings/tax/registrations",
    permission: "tax.registrations.manage",
    branchScoped: false,
    archetype: "settings",
    order: 110,
  },
  {
    id: "settings.tax_packs",
    parentGroup: "settings",
    label: { ar: "حزم الولايات القضائية", en: "Jurisdiction packs" },
    icon: "landmark",
    route: "/settings/tax/packs",
    permission: "tax.returns.view",
    branchScoped: false,
    archetype: "settings",
    order: 120,
  },
  // settings group — WEB-036 (PHASE-036): the custom-fields extensibility
  // manager (/settings/custom-fields: definitions, picklists, form layouts).
  // The plan gate is migration 0049's platform.custom_fields grant
  // (business + enterprise); the read key is the seeded matrix's
  // configuration.custom_fields.read (matrix §3.8 — accountant + owner; the
  // in-screen writes gate on configuration.custom_fields.manage).
  {
    id: "settings.custom_fields",
    parentGroup: "settings",
    label: { ar: "الحقول المخصصة", en: "Custom fields" },
    icon: "layers",
    route: "/settings/custom-fields",
    featureKey: "platform.custom_fields",
    permission: "configuration.custom_fields.read",
    branchScoped: false,
    archetype: "settings",
    order: 125,
  },
  // settings group — T19-WEB (PHASE-014): the owner billing home (plan card,
  // usage meters, billing history, trial countdown). NAVIGATION_MODEL §1 lists
  // "subscription" under settings; NO featureKey on purpose — billing must
  // stay reachable to pay (the resolving action in read-only grace and
  // suspension-adjacent states); permission is the exact seeded matrix key
  // (tenancy.subscription.manage, migration 0004 §3.9).
  {
    id: "billing.home",
    parentGroup: "settings",
    label: { ar: "الفواتير والاشتراك", en: "Billing & subscription" },
    icon: "banknote",
    route: "/billing",
    permission: "tenancy.subscription.manage",
    branchScoped: false,
    archetype: "dashboard",
    order: 130,
  },
  // reports group — PHASE-013 (T-WEB): the report workspace (archetype §7)
  // over the report-contract registry — the catalog, run/poll surface, saved
  // parameter views (client-side), exports and print preview. The workspace
  // itself needs reporting.reports.run; the per-report catalog rows are
  // permission-filtered against each snapshot row's requiredPermission, and
  // the export buttons additionally need reporting.reports.export (gated
  // in-workspace). Permission-gated only (no featureKey — the workspace
  // degrades to its honest error states per surface).
  {
    id: "reports.workspace",
    parentGroup: "reports",
    label: { ar: "تقارير المنشأة", en: "Reports" },
    icon: "bar-chart",
    route: "/reports",
    permission: "reporting.reports.run",
    branchScoped: false,
    archetype: "report",
    order: 5,
  },
  // reports group — PHASE-009 (T15-UI): the VAT return workspace is the
  // group's first shipped item (tax.vat_return in REPORT_CATALOG).
  {
    id: "reports.vat_return",
    parentGroup: "reports",
    label: { ar: "الإقرار الضريبي", en: "VAT return" },
    icon: "file-check",
    route: "/reports/vat-return",
    permission: "tax.returns.view",
    branchScoped: false,
    archetype: "list-search",
    order: 10,
  },
  // PHASE-035 (T-05): the consolidated-statements entry (audit EVAL-F-3) —
  // the five PHASE-034 /consolidation pages shipped reachable only via the
  // rental_logistics template's injected nav, so a template-less tenant
  // never saw القوائم الموحدة. CORE item (template-independent) per
  // NAVIGATION_MODEL §1.1: featureKey = the granted consolidation.reports
  // capability (0041 §plan-grants), permission = the seeded
  // consolidation.reports.view the pages enforce.
  {
    id: "reports.consolidated",
    parentGroup: "reports",
    label: { ar: "القوائم الموحدة", en: "Consolidated statements" },
    icon: "layers",
    route: "/consolidation",
    featureKey: "consolidation.reports",
    permission: "consolidation.reports.view",
    branchScoped: false,
    archetype: "report",
    order: 15,
  },
  // platform plane (ops tenant only): PERMISSION-gated only, no featureKey —
  // entitlements are a tenant-plane concept (matrix §3.10; the same rule the
  // FeatureEntitlementsGuard applies to platform routes).
  {
    id: "platform.console",
    parentGroup: "settings",
    label: { ar: "منصة العمليات", en: "Platform console" },
    icon: "building",
    route: "/platform",
    permission: "platform.tenants.view",
    branchScoped: false,
    archetype: "list-search",
    order: 80,
  },
  {
    id: "platform.audit",
    parentGroup: "settings",
    label: { ar: "سجل المنصة", en: "Platform audit" },
    icon: "file-text",
    route: "/platform/audit",
    permission: "platform.audit.view",
    branchScoped: false,
    archetype: "list-search",
    order: 90,
  },
  {
    id: "platform.devices",
    parentGroup: "settings",
    label: { ar: "الأجهزة", en: "Devices" },
    icon: "shield",
    route: "/platform/devices",
    permission: "identity.devices.manage",
    featureKey: "offline.device_management",
    branchScoped: false,
    archetype: "list-search",
    order: 92,
  },
  {
    id: "platform.sync-health",
    parentGroup: "settings",
    label: { ar: "صحة المزامنة", en: "Sync health" },
    icon: "bar-chart",
    route: "/platform/sync-health",
    permission: "sync.settings.manage",
    featureKey: "offline.sync_protocol",
    branchScoped: false,
    archetype: "report",
    order: 94,
  },
  {
    id: "platform.sync-reconciliation",
    parentGroup: "settings",
    label: { ar: "تسوية المزامنة", en: "Sync reconciliation" },
    icon: "arrow-left-right",
    route: "/platform/sync-reconciliation",
    permission: "sync.devices.revoke",
    featureKey: "offline.sync_protocol",
    branchScoped: false,
    archetype: "list-search",
    order: 96,
  },
  // PHASE-025 T9d: the SLO / error-budget dashboard (MONITORING §5 — the
  // six finalized SLOs + SLOBurn alerts from the in-process substrate).
  // Platform plane, permission-gated only (no featureKey — the matrix
  // §3.10 rule): platform.audit.view, the same existing key the
  // GET /api/v1/platform/slo route requires.
  {
    id: "platform.slo",
    parentGroup: "settings",
    label: { ar: "مؤشرات مستوى الخدمة", en: "Service SLOs" },
    icon: "bar-chart",
    route: "/platform/slo",
    permission: "platform.audit.view",
    branchScoped: false,
    archetype: "report",
    order: 98,
  },
  // PHASE-029 (T11): the payroll module fills the pre-registered `hr` group
  // (NAVIGATION_MODEL §1 group 10 — الموظفون والرواتب / HR & Payroll; the
  // group row shipped at PHASE-013 with zero items, waiting for this
  // phase). Four items — employees (PII-restricted reads), salary
  // structures, payroll runs, employee loans — featureKeys the exact
  // FEATURE_CATALOG §22 strings; permissions the exact seeded §3.14 keys
  // (payroll.employees.view is the sensitivity-critical restricted read).
  {
    id: "hr.employees",
    parentGroup: "hr",
    label: { ar: "الموظفون", en: "Employees" },
    icon: "users",
    route: "/payroll",
    featureKey: "payroll.employees",
    permission: "payroll.employees.view",
    branchScoped: true,
    archetype: "list-search",
    order: 10,
  },
  {
    id: "hr.salary_structures",
    parentGroup: "hr",
    label: { ar: "هياكل الرواتب", en: "Salary structures" },
    icon: "layers",
    route: "/payroll/structures",
    featureKey: "payroll.salary_structures",
    permission: "payroll.employees.view",
    branchScoped: false,
    archetype: "settings",
    order: 20,
  },
  {
    id: "hr.runs",
    parentGroup: "hr",
    label: { ar: "مسيرات الرواتب", en: "Payroll runs" },
    icon: "file-text",
    route: "/payroll/runs",
    featureKey: "payroll.runs",
    permission: "payroll.runs.view",
    branchScoped: false,
    archetype: "transaction-entry",
    order: 30,
  },
  {
    id: "hr.loans",
    parentGroup: "hr",
    label: { ar: "سلف الموظفين", en: "Employee loans" },
    icon: "wallet-cards",
    route: "/payroll/loans",
    featureKey: "payroll.loans",
    permission: "payroll.employees.view",
    branchScoped: false,
    archetype: "list-search",
    order: 40,
  },
];

/**
 * Pure server-side resolver — the single implementation consumed by the API
 * endpoint (entitlements service + session permissions feed it). Group
 * visibility = entitlement AND ≥1 visible child; groups NEVER render empty;
 * order is the binding group order, items ordered by `order`.
 */
export function resolveNavigation(
  items: readonly NavItem[],
  session: {
    /** Active feature keys for the tenant (derived BR-039 payload). */
    featureKeys: ReadonlySet<string>;
    /** Resolved permission keys for the current user. */
    permissions: ReadonlySet<string>;
  },
): ResolvedNavigation {
  const shortcuts: Record<string, NavItem> = {};
  const groups: ResolvedNavGroup[] = [];
  for (const group of NAV_GROUPS) {
    const visible = items
      .filter((item) => {
        if (item.parentGroup !== group.id) return false;
        if (item.featureKey !== undefined && !session.featureKeys.has(item.featureKey)) return false;
        if (item.permission !== undefined && !session.permissions.has(item.permission)) return false;
        return true;
      })
      .sort((a, b) => a.order - b.order);
    // never an empty group (§2 binding rule)
    if (visible.length === 0) continue;
    for (const item of visible) {
      if (item.shortcut !== undefined) shortcuts[item.shortcut] = item;
    }
    groups.push({ id: group.id, label: group.label, icon: group.icon, items: visible });
  }
  return { groups, shortcuts };
}
