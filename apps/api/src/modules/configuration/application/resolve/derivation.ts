import type { LocalizedText } from "@erp/contracts";

import {
  INTAKE_TARGET_PHASE,
  PHASE_GATED_INTAKE_KEYS,
  isPhaseGatedIntakeKey,
} from "../../domain/feature-catalog";
import type { DerivedNavGroup, DerivedNavItem, L1TemplateLayer } from "../../domain/layer-model";
import { parseLocalizedText } from "./terminology";

/**
 * L9 navigation derivation (CONFIGURATION_ENGINE §2 layer 9, §3 step 5;
 * PHASE-015 §2 item 7): the navigation tree is DERIVED, never stored as
 * truth — computed from the applied template's navigation_manifest, pruned
 * by L4 entitlements and L8 module flags. BR-039: the server resolves, the
 * client renders.
 *
 * Pruning rules:
 * - an item with NO feature_key is visible unless its target module is
 *   flag-disabled (L8);
 * - an item whose feature_key is ACTIVE in L4 is visible (L4 is the only
 *   source of feature truth);
 * - an item whose feature_key is a PHASE-GATED INTAKE KEY
 *   (CAPABILITY_MATRIX §3: `pos.table_service`, `pos.kitchen_display`)
 *   stays in the tree marked `phase_gated: "PHASE-016"` — the UI renders
 *   "coming with PHASE-016" instead of hiding (PHASE-015 §6 degraded-
 *   entitlement contract; no entitlement is grantable before the catalog
 *   intake, so these keys can never be "active");
 * - any other feature_key (known-but-unentitled, or unknown drift) HIDES —
 *   "menus hidden, defaults queued", never a broken screen (§7);
 * - groups with zero surviving items drop.
 *
 * L6 branch-scope note: manifest items carry no branch affinity yet (the
 * §3 schema has no branch field), so branch scope currently prunes nothing
 * at the item level — the resolved request_overlay exposes `branch_scope`
 * for the client, and branch-affine items will prune here when the schema
 * grows them. Route-permission pruning lands with the route-permission map.
 */

// The §3 intake set re-exported for the derivation surface (single import
// point for the engine's consumers).
export { PHASE_GATED_INTAKE_KEYS, INTAKE_TARGET_PHASE };

/**
 * The platform-default navigation (no template applied): the PHASE-005 core
 * set — home / sales / purchasing / inventory / accounting / treasury /
 * reports / settings, no feature-gated items (a template-less tenant runs
 * the plain ERP core).
 */
export const DEFAULT_NAVIGATION: readonly DerivedNavGroup[] = Object.freeze([
  Object.freeze({
    id: "home",
    label: Object.freeze({ en: "Home", ar: "الرئيسية" }),
    order: 1,
    items: Object.freeze([
      Object.freeze({
        id: "dashboard",
        label: Object.freeze({ en: "Dashboard", ar: "لوحة المعلومات" }),
        target: "home.dashboard",
      }),
    ]),
  }),
  Object.freeze({
    id: "sales",
    label: Object.freeze({ en: "Sales", ar: "المبيعات" }),
    order: 2,
    items: Object.freeze([
      Object.freeze({
        id: "invoices",
        label: Object.freeze({ en: "Sales invoices", ar: "فواتير البيع" }),
        target: "sales.invoices",
      }),
    ]),
  }),
  Object.freeze({
    id: "purchasing",
    label: Object.freeze({ en: "Purchasing", ar: "المشتريات" }),
    order: 3,
    items: Object.freeze([
      Object.freeze({
        id: "orders",
        label: Object.freeze({ en: "Purchase orders", ar: "أوامر الشراء" }),
        target: "purchasing.orders",
      }),
    ]),
  }),
  Object.freeze({
    id: "inventory",
    label: Object.freeze({ en: "Inventory", ar: "المخزون" }),
    order: 4,
    items: Object.freeze([
      Object.freeze({
        id: "stock",
        label: Object.freeze({ en: "Stock", ar: "المخزون" }),
        target: "inventory.stock",
      }),
    ]),
  }),
  Object.freeze({
    id: "accounting",
    label: Object.freeze({ en: "Accounting", ar: "الحسابات" }),
    order: 5,
    items: Object.freeze([
      Object.freeze({
        id: "journals",
        label: Object.freeze({ en: "Journal entries", ar: "قيود اليومية" }),
        target: "accounting.journals",
      }),
    ]),
  }),
  Object.freeze({
    id: "treasury",
    label: Object.freeze({ en: "Treasury", ar: "الخزينة" }),
    order: 6,
    items: Object.freeze([
      Object.freeze({
        id: "receipts",
        label: Object.freeze({ en: "Receipts & payments", ar: "سندات القبض والصرف" }),
        target: "treasury.receipts",
      }),
    ]),
  }),
  Object.freeze({
    id: "reports",
    label: Object.freeze({ en: "Reports", ar: "التقارير" }),
    order: 7,
    items: Object.freeze([
      Object.freeze({
        id: "reports",
        label: Object.freeze({ en: "Reports", ar: "التقارير" }),
        target: "reports",
      }),
    ]),
  }),
  Object.freeze({
    id: "settings",
    label: Object.freeze({ en: "Settings", ar: "الإعدادات" }),
    order: 8,
    items: Object.freeze([
      Object.freeze({
        id: "settings",
        label: Object.freeze({ en: "Settings", ar: "الإعدادات" }),
        target: "settings",
      }),
    ]),
  }),
]);

export interface NavigationDerivationInput {
  /** The applied template layer (null ⇒ platform-default navigation). */
  readonly template: L1TemplateLayer | null;
  /** L4 active feature keys (the only source of feature truth). */
  readonly activeEntitlements: ReadonlySet<string>;
  /** L8 module → enabled (a flag-disabled module hides its items). */
  readonly installedModules: Readonly<Record<string, boolean>>;
}

/** Module segment of a route target ("sales.credit_notes" → "sales"). */
function targetModule(target: string): string {
  const dot = target.indexOf(".");
  return dot > 0 ? target.slice(0, dot) : target;
}

function moduleEnabled(
  installed: Readonly<Record<string, boolean>>,
  module: string,
): boolean {
  return installed[module] === undefined || installed[module];
}

/**
 * Derive the tenant's navigation tree: template groups in `order` sequence
 * (ties keep manifest order — stable sort), items pruned per the rules
 * above, empty groups dropped. No template ⇒ DEFAULT_NAVIGATION.
 */
export function deriveNavigation(
  input: NavigationDerivationInput,
): readonly DerivedNavGroup[] {
  if (input.template === null) {
    return DEFAULT_NAVIGATION;
  }
  const groups = [...input.template.manifest.navigation_manifest.groups];
  groups.sort((left, right) => {
    const a = left.order ?? Number.MAX_SAFE_INTEGER;
    const b = right.order ?? Number.MAX_SAFE_INTEGER;
    return a - b; // Array#sort is stable: manifest order breaks ties.
  });
  const derived: DerivedNavGroup[] = [];
  for (const [index, group] of groups.entries()) {
    const items: DerivedNavItem[] = [];
    for (const item of group.items) {
      const label = parseLocalizedText(
        `template ${input.template.key} navigation`,
        item.id,
        item.label,
      );
      if (item.feature_key === undefined) {
        // Ungated item: visible unless its target module is flag-disabled.
        if (!moduleEnabled(input.installedModules, targetModule(item.target))) {
          continue;
        }
        items.push({ id: item.id, label, target: item.target });
        continue;
      }
      // L8 first: a deactivated module hides everything it owns.
      if (!moduleEnabled(input.installedModules, targetModule(item.feature_key))) {
        continue;
      }
      if (input.activeEntitlements.has(item.feature_key)) {
        items.push({ id: item.id, label, target: item.target, feature_key: item.feature_key });
        continue;
      }
      if (isPhaseGatedIntakeKey(item.feature_key)) {
        items.push({
          id: item.id,
          label,
          target: item.target,
          feature_key: item.feature_key,
          phase_gated: INTAKE_TARGET_PHASE,
        });
        continue;
      }
      // Known-but-unentitled (or drift): hidden — upgrade path, never a
      // broken screen (§7 "Template-vs-features").
    }
    if (items.length > 0) {
      derived.push({
        id: group.id,
        label: parseLocalizedText(
          `template ${input.template.key} navigation`,
          group.id,
          group.label,
        ),
        order: group.order ?? index + 1,
        items,
      });
    }
  }
  return derived;
}

/**
 * Derived menu emphasis (§5 `ui.emphasis`): the template's VISIBLE group
 * order — the navigation manifest is the template's own statement of what
 * matters first. A template-less tenant has no emphasis.
 */
export function deriveEmphasis(
  template: L1TemplateLayer | null,
  groups: readonly DerivedNavGroup[],
): readonly string[] {
  return template === null ? [] : groups.map((group) => group.id);
}

/** Group-id summary (§5 `ui.navigation`: the ordered visible group ids). */
export function navigationSummary(groups: readonly DerivedNavGroup[]): readonly string[] {
  return groups.map((group) => group.id);
}

/** Label type re-export for the derivation surface. */
export type { LocalizedText };
