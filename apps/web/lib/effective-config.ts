/**
 * PHASE-015 T11 (task 3-a) — effective-config server fetch + the shell's
 * presentation merge (BR-039: the server resolves, the client renders).
 *
 * `fetchEffectiveConfig` is the shell-side read of
 * `GET /api/v1/configuration/effective-config` (a SESSION route — every
 * authenticated member). It is FAIL-OPEN for presentation only: on any
 * failure the shell renders exactly the core navigation it renders today
 * (the offline rule — "effective-config reads may be cached for display
 * only"; every enforcing route re-checks server-side regardless).
 *
 * `mergeNavigation` appends the template-derived L9 groups (ui.navigation_tree)
 * AFTER the core registry groups and applies the effective terminology map
 * to every label (`terminology[id] ?? core label`). Unentitled items never
 * arrive (the payload prunes them server-side); items the payload marks
 * `phase_gated` stay visible and are labeled "coming with PHASE-0NN"
 * instead of hidden.
 *
 * NOTE on the @erp/ui sidebar contract: `NavigationSidebar` renders every
 * item as a plain link and has no disabled/badge item variant (packages/ui
 * is frozen for this task), so a phase-gated item carries the coming-phase
 * badge text INLINE in its label and links to the Industry & templates
 * screen — the surface that shows exactly which capabilities arrive with
 * which phase. The packages/ui extension (a disabled+badged item variant)
 * is flagged for the next UI-owning task; nothing here fabricates an
 * enabled feature.
 */

import { NAV_ITEMS, type NavItem, type ResolvedNavigation } from "@erp/contracts";

import { fetchApi } from "./server-api";
import type {
  ConfigLocalizedText,
  DerivedNavItem,
  EffectiveConfig,
} from "./api-types";

/** The admin screen the drift offers and phase-gated items point at. */
export const TEMPLATES_ADMIN_ROUTE = "/settings/templates";

/** Registry lookup by nav item id (the derived targets use the id vocabulary). */
const NAV_ITEM_BY_ID: ReadonlyMap<string, NavItem> = new Map(
  NAV_ITEMS.map((item) => [item.id, item]),
);

/**
 * Targets that are industry REPORT keys (reporting/registry/industry — the
 * T10 entries `inventory.expiry_list`, `grocery.expiry_writeoff`,
 * `retail.imei_register`). They deep-link into the reports workspace's
 * `?report=` selection, which itself enforces permission and resolves
 * unpermitted keys to no selection — an honest, existing surface.
 */
const INDUSTRY_REPORT_TARGETS: ReadonlySet<string> = new Set([
  "inventory.expiry_list",
  "grocery.expiry_writeoff",
  "retail.imei_register",
  // PHASE-017 (T13): the seven industry reports — deep-link into the
  // reports workspace's ?report= selection.
  "automotive.job_card_profitability",
  "automotive.vehicle_service_history",
  "distribution.rep_settlement",
  "distribution.route_visit_compliance",
  "distribution.van_stock_balances",
  "sales.discount_management_effectiveness",
  "sales.commissions_due",
  // PHASE-018 (T41): the three manufacturing reports — deep-link into the
  // reports workspace's ?report= selection.
  "manufacturing.production_cost",
  "manufacturing.batch_genealogy",
  "manufacturing.qc_inspection_log",
  // PHASE-019 (T50): the two services reports — deep-link into the
  // reports workspace's ?report= selection.
  "services.contract_revenue_schedule",
  "services.time_billing_summary",
]);

/**
 * Manifest targets that have real web routes but no core NAV_ITEMS entry
 * (PHASE-017): the distribution screens ride the template-derived
 * navigation (the L9 groups — field/settle — only render for tenants whose
 * template carries them), and three targets alias EXISTING surfaces
 * (inventory.on_hand → stock on hand; pos.counter → the POS counter;
 * distribution.collections → treasury receipts — a collection IS a receipt).
 * PHASE-018 (T41): the four manufacturing targets alias the new screens the
 * same way (production/traceability L9 groups render them when the
 * food_manufacturing template is applied).
 * PHASE-019 (T50): the five crm/projects targets alias the new screens the
 * same way (the professional_services template's groups render registry-
 * driven when it is applied).
 */
const TARGET_ROUTE_ALIASES: ReadonlyMap<string, string> = new Map([
  ["distribution.routes", "/distribution/routes"],
  ["distribution.van_stock", "/distribution/van"],
  ["distribution.settlements", "/distribution/settlements"],
  ["distribution.collections", "/treasury/receipts"],
  ["inventory.on_hand", "/inventory/stock"],
  ["pos.counter", "/pos"],
  // PHASE-018 (T41): manufacturing manifest targets → the new screens.
  ["manufacturing.bom", "/manufacturing/boms"],
  ["manufacturing.orders", "/manufacturing/orders"],
  ["manufacturing.qc", "/manufacturing/qc"],
  ["manufacturing.genealogy", "/manufacturing/genealogy"],
  // PHASE-019 (T50): crm + projects manifest targets → the new screens.
  ["crm.pipeline", "/crm/pipeline"],
  ["crm.time", "/crm/time"],
  ["crm.contracts", "/crm/contracts"],
  ["crm.recurring_billing", "/crm/billing"],
  ["accounting.projects", "/accounting/projects"],
]);

/**
 * The effective config for the current session's active tenant, or undefined
 * on ANY failure (fail-open for presentation only — never an enforcement
 * input). Server-side only.
 */
export async function fetchEffectiveConfig(): Promise<EffectiveConfig | undefined> {
  const result = await fetchApi<EffectiveConfig>("configuration/effective-config");
  return result.ok ? result.data : undefined;
}

/** The applied template identity (L1), or null when the tenant runs template-less. */
export function appliedTemplateOf(
  config: EffectiveConfig | undefined,
): { key: string; version: string } | null {
  const l1 = config?.layers.l1_template;
  return l1 === null || l1 === undefined ? null : { key: l1.key, version: l1.version };
}

/**
 * Inline label suffixes for derived items without a live web surface —
 * BILINGUAL on purpose: nav payload labels carry both locales so a locale
 * switch renders without a refetch; the suffixes must do the same (the
 * shell builds them from BOTH dictionaries).
 */
export interface IndustryNavLabels {
  /** "قادم مع المرحلة 016 / coming with PHASE-016" for phase-gated items. */
  comingWithPhase: (phase: string) => ConfigLocalizedText;
  /** Honest current-fact note for entitled items whose web page does not exist yet. */
  notInWebApp: ConfigLocalizedText;
}

interface MergedNavItem {
  readonly id: string;
  readonly parentGroup: string;
  readonly label: ConfigLocalizedText;
  readonly icon: string;
  readonly route: string;
  readonly branchScoped: boolean;
  readonly archetype: string;
  readonly order: number;
}

interface MergedNavGroup {
  readonly id: string;
  readonly label: ConfigLocalizedText;
  readonly icon: string;
  readonly items: readonly MergedNavItem[];
}

/** terminology[id] ?? core label — the effective terminology resolution. */
function resolveLabel(
  terminology: Readonly<Record<string, ConfigLocalizedText>>,
  id: string,
  core: ConfigLocalizedText,
): ConfigLocalizedText {
  return terminology[id] ?? core;
}

/**
 * Resolve one derived item's target to a route + icon.
 *
 * - a registry nav-item id → that item's real route/icon;
 * - an industry report key → the reports workspace deep link;
 * - anything else has no web surface in this build: phase-gated items are
 *   labeled with their coming phase, others with the honest not-in-web-app
 *   note, and both link to the Industry & templates screen (the surface
 *   that explains what ships when).
 */
function resolveDerivedItem(
  item: DerivedNavItem,
  groupId: string,
  order: number,
  terminology: Readonly<Record<string, ConfigLocalizedText>>,
  labels: IndustryNavLabels,
): MergedNavItem {
  const registry = NAV_ITEM_BY_ID.get(item.target);
  const isReport = INDUSTRY_REPORT_TARGETS.has(item.target);
  const phaseGated = item.phase_gated !== undefined;
  let route: string;
  let icon: string;
  let label = resolveLabel(terminology, item.id, item.label);
  const alias = TARGET_ROUTE_ALIASES.get(item.target);
  if (registry !== undefined) {
    route = registry.route;
    icon = registry.icon;
  } else if (isReport) {
    route = `/reports?report=${encodeURIComponent(item.target)}`;
    icon = "bar-chart";
  } else if (alias !== undefined) {
    route = alias;
    icon = "map";
  } else {
    route = TEMPLATES_ADMIN_ROUTE;
    icon = "clock";
  }
  if (phaseGated) {
    const suffix = labels.comingWithPhase(item.phase_gated ?? "");
    label = { ar: `${label.ar} · ${suffix.ar}`, en: `${label.en} · ${suffix.en}` };
    icon = "clock";
  } else if (registry === undefined && !isReport && alias === undefined) {
    label = {
      ar: `${label.ar} · ${labels.notInWebApp.ar}`,
      en: `${label.en} · ${labels.notInWebApp.en}`,
    };
  }
  return {
    id: item.id,
    parentGroup: groupId,
    label,
    icon,
    route,
    branchScoped: false,
    archetype: "generic-detail",
    order,
  };
}

/**
 * Merge the template-derived navigation into the core registry payload.
 *
 * - no effective config, no applied template (L1 null — the derived tree is
 *   then just the platform-default mirror of the core groups), or no core
 *   payload ⇒ the core navigation passes through UNCHANGED (identical shell
 *   to today; the core fetch keeps its own failure behavior);
 * - a template is applied ⇒ its derived groups (already entitlement-pruned
 *   and ordered by the payload) render AFTER the core groups, with the
 *   terminology map applied to every label (core and derived).
 *
 * The merged groups use the derived group ids ("selling", "stock", …),
 * which are NOT members of the core `NavGroupId` union — the return value
 * is cast once at this documented boundary: `NavigationSidebar` and the
 * command menu only read `id` (React key), `label`, `route`, and `icon`,
 * so the structural contract holds. (packages/ui is frozen this phase; a
 * first-class sidebar group/item extension is tracked for the next task.)
 */
export function mergeNavigation(
  core: ResolvedNavigation | undefined,
  effective: EffectiveConfig | undefined,
  labels: IndustryNavLabels,
): ResolvedNavigation | undefined {
  if (core === undefined) {
    return undefined; // the core fetch already failed — today's degrade stands.
  }
  if (effective === undefined) {
    return core; // effective-config read failed — fail-open, identical shell.
  }
  const l1 = effective.layers.l1_template;
  if (l1 === null) {
    return core; // no template applied — identical shell to today.
  }
  const terminology = effective.ui.terminology;
  const templateGroups: MergedNavGroup[] = effective.ui.navigation_tree.map(
    (group, groupIndex) => ({
      id: group.id,
      label: resolveLabel(terminology, group.id, group.label),
      icon: "boxes",
      items: group.items.map((item, itemIndex) =>
        resolveDerivedItem(item, group.id, (group.order || groupIndex + 1) * 100 + itemIndex, terminology, labels),
      ),
    }),
  );
  const coreGroups: MergedNavGroup[] = core.groups.map((group) => ({
    id: group.id,
    label: resolveLabel(terminology, group.id, group.label),
    icon: group.icon,
    items: group.items.map((item) => ({
      id: item.id,
      parentGroup: item.parentGroup,
      label: resolveLabel(terminology, item.id, item.label),
      icon: item.icon,
      route: item.route,
      branchScoped: item.branchScoped,
      archetype: item.archetype,
      order: item.order,
    })),
  }));
  const merged = {
    groups: [...coreGroups, ...templateGroups],
    shortcuts: core.shortcuts,
  };
  return merged as unknown as ResolvedNavigation;
}
