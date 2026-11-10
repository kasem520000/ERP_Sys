/**
 * PHASE-022 T-P22-2-e · the screen registry (MASTER-PLAN §1 DR-P22-11: every
 * screen is registered in the navigation registry; `check:mobile-shell`
 * (task 4-a) validates registry completeness + imports + logical props +
 * token usage + a11y props + ≥44px targets against THIS shape).
 *
 * The registry entry carries the DR-P22-11 NAME (the key 2-b's
 * FINANCIAL_SCREENS policy and the native navigation glue use), the title
 * key (the catalog string the header renders), the a11y label key (what
 * the screen is announced as), the area (fieldsales here; 3-b appends
 * companion/personal/reconciliation), and the financial flag (mirrors 2-b's
 * FINANCIAL_SCREENS — the FLAG_SECURE policy input).
 *
 * The `component` field stores the precise, compile-time-checked props type
 * through the {@link screenEntry} generic; the registry's homogeneous
 * component type is the navigation-props shape (dynamic params — the typed
 * navigation glue lives in native/App.tsx, the desktop shell precedent).
 */
import type { ComponentType, ReactNode } from "react";

import type { Dictionary } from "../i18n";
import { RouteVisitsScreen } from "./RouteVisitsScreen";
import { VanSaleCaptureScreen } from "./VanSaleCaptureScreen";
import { CollectionScreen } from "./CollectionScreen";
import { VanLoadUnloadScreen } from "./VanLoadUnloadScreen";
import { ReturnsScreen } from "./ReturnsScreen";
import { CountLinesScreen } from "./CountLinesScreen";
import { DashboardScreen } from "./DashboardScreen";
import { StatementScreen } from "./StatementScreen";
import { InvoicesScreen } from "./InvoicesScreen";
import { PersonalHomeScreen } from "./PersonalHomeScreen";
import { ParkedRejectionsScreen } from "./ParkedRejectionsScreen";
import type {
  RouteVisitsScreenProps,
  VanSaleCaptureScreenProps,
  CollectionScreenProps,
  VanLoadUnloadScreenProps,
  ReturnsScreenProps,
  CountLinesScreenProps,
  DashboardScreenProps,
  StatementScreenProps,
  InvoicesScreenProps,
  PersonalHomeScreenProps,
  ParkedRejectionsScreenProps,
} from "./screens-props";

/** The screen areas (3-b appends companion / personal / reconciliation). */
export type ScreenArea = "fieldsales" | "companion" | "personal" | "reconciliation";

/** The registry's homogeneous component type (navigation params are dynamic). */
export type ScreenComponent = ComponentType<Record<string, unknown>>;

/** One registered screen (DR-P22-11). */
export interface ScreenRegistryEntry {
  /** The DR-P22-11 screen name (the FINANCIAL_SCREENS + navigation key). */
  readonly name: string;
  /** The catalog key the screen's title renders. */
  readonly titleKey: keyof Dictionary;
  /** The catalog key the screen is announced as (a11y). */
  readonly a11yLabelKey: keyof Dictionary;
  /** The screen's area (the tab-bar grouping). */
  readonly area: ScreenArea;
  /** Whether the screen is on 2-b's FINANCIAL_SCREENS list (FLAG_SECURE). */
  readonly financial: boolean;
  /** The RN screen component (typed at the entry site, stored homogeneously). */
  readonly component: ScreenComponent;
}

/**
 * Construct one registry entry — the generic `P` captures the component's
 * OWN props type at compile time (a mismatch between the component and its
 * declared interface is a type error HERE), then the stored field widens to
 * the registry's navigation-props type (the single documented cast; typed
 * navigation glue is the native shell's job).
 */
export function screenEntry<P extends object>(input: {
  name: string;
  titleKey: keyof Dictionary;
  a11yLabelKey: keyof Dictionary;
  area: ScreenArea;
  financial: boolean;
  component: ComponentType<P>;
}): ScreenRegistryEntry {
  return {
    name: input.name,
    titleKey: input.titleKey,
    a11yLabelKey: input.a11yLabelKey,
    area: input.area,
    financial: input.financial,
    component: input.component as unknown as ScreenComponent,
  };
}

/** The field-sales screens (this wave — DR-P22-11's field set). */
export const FIELD_SCREENS: readonly ScreenRegistryEntry[] = [
  screenEntry({
    name: "RouteVisits",
    titleKey: "routesTitle",
    a11yLabelKey: "routesTitle",
    area: "fieldsales",
    financial: false,
    component: RouteVisitsScreen as ComponentType<RouteVisitsScreenProps>,
  }),
  screenEntry({
    name: "VanSaleCapture",
    titleKey: "vanSaleTitle",
    a11yLabelKey: "vanSaleTitle",
    area: "fieldsales",
    financial: true,
    component: VanSaleCaptureScreen as ComponentType<VanSaleCaptureScreenProps>,
  }),
  screenEntry({
    name: "Collection",
    titleKey: "collectionTitle",
    a11yLabelKey: "collectionTitle",
    area: "fieldsales",
    financial: true,
    component: CollectionScreen as ComponentType<CollectionScreenProps>,
  }),
  screenEntry({
    name: "VanLoadUnload",
    titleKey: "vanLoadTitle",
    a11yLabelKey: "vanLoadTitle",
    area: "fieldsales",
    financial: true,
    component: VanLoadUnloadScreen as ComponentType<VanLoadUnloadScreenProps>,
  }),
  screenEntry({
    name: "ReturnsDraft",
    titleKey: "returnsTitle",
    a11yLabelKey: "returnsTitle",
    area: "fieldsales",
    financial: true,
    component: ReturnsScreen as ComponentType<ReturnsScreenProps>,
  }),
  screenEntry({
    name: "CountLines",
    titleKey: "countTitle",
    a11yLabelKey: "countTitle",
    area: "fieldsales",
    financial: false,
    component: CountLinesScreen as ComponentType<CountLinesScreenProps>,
  }),
];

/** The companion screens (3-b — MASTER-PLAN §8 "Companion"; the financial
 * flags mirror 2-b's FINANCIAL_SCREENS list exactly: Statements/InvoiceList
 * are money surfaces, the dashboard chrome is not). */
export const COMPANION_SCREENS: readonly ScreenRegistryEntry[] = [
  screenEntry({
    name: "Dashboard",
    titleKey: "homeTitle",
    a11yLabelKey: "homeTitle",
    area: "companion",
    financial: false,
    component: DashboardScreen as ComponentType<DashboardScreenProps>,
  }),
  screenEntry({
    name: "Statements",
    titleKey: "statementsTitle",
    a11yLabelKey: "statementsTitle",
    area: "companion",
    financial: true,
    component: StatementScreen as ComponentType<StatementScreenProps>,
  }),
  screenEntry({
    name: "InvoiceList",
    titleKey: "invoicesTitle",
    a11yLabelKey: "invoicesTitle",
    area: "companion",
    financial: true,
    component: InvoicesScreen as ComponentType<InvoicesScreenProps>,
  }),
];

/** The personal screens (3-b — READ-ONLY class, zero write affordances). */
export const PERSONAL_SCREENS: readonly ScreenRegistryEntry[] = [
  screenEntry({
    name: "PersonalHome",
    titleKey: "personalTitle",
    a11yLabelKey: "personalTitle",
    area: "personal",
    financial: true,
    component: PersonalHomeScreen as ComponentType<PersonalHomeScreenProps>,
  }),
];

/** The reconciliation screens (3-b — CONFLICT_RESOLUTION §3). */
export const RECONCILIATION_SCREENS: readonly ScreenRegistryEntry[] = [
  screenEntry({
    name: "ParkedRejections",
    titleKey: "parkedTitle",
    a11yLabelKey: "parkedTitle",
    area: "reconciliation",
    financial: false,
    component: ParkedRejectionsScreen as ComponentType<ParkedRejectionsScreenProps>,
  }),
];

/** The full registry (the field + companion + personal + rejection areas). */
export const SCREEN_REGISTRY: readonly ScreenRegistryEntry[] = [
  ...FIELD_SCREENS,
  ...COMPANION_SCREENS,
  ...PERSONAL_SCREENS,
  ...RECONCILIATION_SCREENS,
];

/** The registered screen names (the navigation-glue key set). */
export function screenNames(): string[] {
  return SCREEN_REGISTRY.map((entry) => entry.name);
}

/** Look up one entry by name (the router's resolver). */
export function screenByName(name: string): ScreenRegistryEntry | undefined {
  return SCREEN_REGISTRY.find((entry) => entry.name === name);
}

/** The FINANCIAL_SCREENS membership view (2-b's secure-screen policy input). */
export function financialScreenNames(): string[] {
  return SCREEN_REGISTRY.filter((entry) => entry.financial).map((entry) => entry.name);
}

export type {
  RouteVisitsScreenProps,
  VanSaleCaptureScreenProps,
  CollectionScreenProps,
  VanLoadUnloadScreenProps,
  ReturnsScreenProps,
  CountLinesScreenProps,
  DashboardScreenProps,
  StatementScreenProps,
  InvoicesScreenProps,
  PersonalHomeScreenProps,
  ParkedRejectionsScreenProps,
} from "./screens-props";

export type ScreenRenderFn = () => ReactNode;
