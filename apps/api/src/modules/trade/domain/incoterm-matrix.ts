/**
 * PHASE-051 (W-35 — T-08, 2026-11-25) THE INCOTERM MATRIX FOLD (L-03,
 * D-10/D-16 — the plan's own unit-first law: the pure layer FIRST, the
 * property tests beside it, then the service and the order gates that
 * render its verdicts VERBATIM — zero parallel computation):
 *
 *   THE OWNERSHIP MATRIX AS REGISTRY DATA (the 0120 floor's own shape):
 *   every incoterm row carries FIVE booleans — the main carriage, the
 *   insurance, the export clearance, the import clearance and the
 *   import duty, each on the SELLER's side — and the risk-hint matrix
 *   renders from the ROW'S OWN DATA, AR/EN, never from a parallel
 *   dictionary in the code (the D-13 bi() law's data discipline: the
 *   registry is the one source; a tenant's own row renders its own
 *   hints).
 *
 *   THE MANDATE TRIGGER (BR-106's activation rule — the owner's ruling
 *   (ج) at the approval dispatch, carried VERBATIM): with the `trade`
 *   flag enabled, an order whose currency differs from the tenant's
 *   base currency OR that carries the explicit import/export marker
 *   must post WITH an incoterm. The fold evaluates the TRIGGER's two
 *   arms purely; the flag itself is the caller's own probe (the
 *   entitlement plane, never a pure fold's business); the typed
 *   refusal at the order's own posting names the order and the
 *   missing field (the service's rendering — never this fold's).
 *
 *   PURE: no clock, no store, no SQL — the registry service, the order
 *   gates and the W-39 selector render this module's verdicts
 *   VERBATIM.
 */

/** The 0120 ownership matrix's own five booleans (the seller side). */
export interface IncotermOwnership {
  readonly carriageBySeller: boolean;
  readonly insuranceBySeller: boolean;
  readonly exportClearanceBySeller: boolean;
  readonly importClearanceBySeller: boolean;
  readonly importDutyBySeller: boolean;
}

/** The registry row's identity + names (the render's own data). */
export interface IncotermRowShape extends IncotermOwnership {
  readonly code: string;
  readonly name: string;
  readonly nameAr: string;
}

/** The rendered risk-hint matrix — AR/EN lines from the row's own data. */
export interface IncotermMatrixHints {
  readonly en: readonly string[];
  readonly ar: readonly string[];
}

interface MatrixAxis {
  readonly key: keyof IncotermOwnership;
  readonly en: { seller: string; buyer: string };
  readonly ar: { seller: string; buyer: string };
}

/**
 * The five axes (the 0120 column set's own order — carriage ·
 * insurance · export clearance · import clearance · import duty; the
 * seller side is the boolean, the buyer side its negation).
 */
const AXES: readonly MatrixAxis[] = [
  {
    key: "carriageBySeller",
    en: { seller: "Main carriage: the SELLER arranges it", buyer: "Main carriage: the BUYER arranges it" },
    ar: { seller: "النقل الرئيسي: البائع يرتّبه", buyer: "النقل الرئيسي: المشتري يرتّبه" },
  },
  {
    key: "insuranceBySeller",
    en: { seller: "Insurance: the SELLER procures it", buyer: "Insurance: the BUYER procures it" },
    ar: { seller: "التأمين: البائع يوفّره", buyer: "التأمين: المشتري يوفّره" },
  },
  {
    key: "exportClearanceBySeller",
    en: { seller: "Export clearance: the SELLER's obligation", buyer: "Export clearance: the BUYER's obligation" },
    ar: { seller: "تخليص التصدير: التزام البائع", buyer: "تخليص التصدير: التزام المشتري" },
  },
  {
    key: "importClearanceBySeller",
    en: { seller: "Import clearance: the SELLER's obligation", buyer: "Import clearance: the BUYER's obligation" },
    ar: { seller: "تخليص الاستيراد: التزام البائع", buyer: "تخليص الاستيراد: التزام المشتري" },
  },
  {
    key: "importDutyBySeller",
    en: { seller: "Import duty: the SELLER bears it", buyer: "Import duty: the BUYER bears it" },
    ar: { seller: "رسوم الاستيراد: يتحمّلها البائع", buyer: "رسوم الاستيراد: يتحمّلها المشتري" },
  },
];

/**
 * THE RISK-HINT MATRIX (D-10: the matrix renders from the registry
 * row's OWN data, AR/EN): five lines — one per ownership axis — each
 * naming the side that owns the obligation. The W-39 selector renders
 * these lines at selection time VERBATIM; the finance reconciliation
 * and the landed-cost surfaces read the same lines (the carriage and
 * duty axes are the landed-cost ownership's own hints).
 */
export function renderIncotermMatrix(row: IncotermRowShape): IncotermMatrixHints {
  const en: string[] = [];
  const ar: string[] = [];
  for (const axis of AXES) {
    const seller = row[axis.key];
    en.push(seller ? axis.en.seller : axis.en.buyer);
    ar.push(seller ? axis.ar.seller : axis.ar.buyer);
  }
  return { en, ar };
}

/** The explicit import/export marker (the 0124 order column's vocabulary). */
export type TradeDirection = "IMPORT" | "EXPORT";

/** The mandate trigger's input (BR-106's own three facts). */
export interface IncotermMandateInput {
  readonly currency: string;
  readonly baseCurrency: string;
  readonly tradeDirection: TradeDirection | null;
}

/** The mandate trigger's verdict (the arms named — the refusal renders them). */
export interface IncotermMandateVerdict {
  readonly triggered: boolean;
  readonly arms: readonly string[];
}

/**
 * THE MANDATE TRIGGER FOLD (BR-106's activation rule — the owner's
 * ruling (ج) VERBATIM: «currency ≠ base currency, or the order carries
 * the import/export tag»): the currency arm fires on any difference
 * (a foreign-currency order is a trade order); the marker arm fires on
 * the explicit tag (a base-currency order can still be a trade order —
 * cross-border trade in the settlement currency). Either arm
 * triggers; the arms are NAMED in the verdict so the refusal and the
 * matrix render them (the owner's own diagnostic shape).
 */
export function incotermMandateVerdict(input: IncotermMandateInput): IncotermMandateVerdict {
  const arms: string[] = [];
  if (input.currency !== input.baseCurrency) {
    arms.push(`CURRENCY: ${input.currency} differs from the base ${input.baseCurrency}`);
  }
  if (input.tradeDirection !== null) {
    arms.push(`MARKER: the order carries the explicit ${input.tradeDirection} tag`);
  }
  return { triggered: arms.length > 0, arms };
}

/** True when the order must post WITH an incoterm (the trigger's own boolean). */
export function incotermMandateTriggered(input: IncotermMandateInput): boolean {
  return incotermMandateVerdict(input).triggered;
}
