import { Decimal } from "@erp/domain-core";

/**
 * PHASE-043 (T-03, M-07/M-08/M-09): the PURE BOM-graph planning kernel —
 * low-level codes, cycle detection, phantom flattening, and
 * alternative-material substitution resolution. No DB, no services: every
 * input arrives as plain graph data (the store reads it once and hands it
 * over), every output is plain data for the engine snapshot. Determinism
 * law (the module README note): same graph + same demand ⇒ same output,
 * always — sort orders are explicit, never incidental.
 *
 * House math (ADR-0009): Decimal throughout, canonical 6dp half-up — the
 * same quantum the frozen order snapshot and BomService.explode use, so
 * the engine's explosion lines reconcile line-by-line with the order
 * snapshot (gross = round6(planned × qtyPerOutput × (1 + scrap/100) ÷
 * (yield/100))).
 */

/** Canonical 6dp, half-up. */
export function round6(value: Decimal): Decimal {
  return value.toDecimalPlaces(6, Decimal.ROUND_HALF_UP);
}

/** The planning shape of one BOM version's component line. */
export interface BomGraphLine {
  lineId: string;
  componentItemId: string;
  /** Per unit of parent output, the component's base uom. */
  qtyPerOutput: string;
  scrapPct: string;
  /** PHASE-043 (M-08): a phantom never gets its own supply suggestion —
   * its OWN components are demanded in its place (flattening). */
  phantomFlag: boolean;
}

/** The planning shape of one BOM version (its header facts + lines). */
export interface BomGraphNode {
  bomId: string;
  itemId: string;
  yieldPct: string;
  lines: readonly BomGraphLine[];
}

/** The whole graph the engine works on, item-keyed (one node per item —
 * the ACTIVE version; the what-if DRAFT path is not the engine's). */
export interface BomGraph {
  /** itemId → the item's ACTIVE BOM node. */
  readonly nodes: ReadonlyMap<string, BomGraphNode>;
}

/** The minimal structural shape the low-level walk consumes — the engine
 * passes the BOM graph UNION the substitution edges (primary →
 * substitute), whose nodes need only the component edges. */
export interface LeveledGraph {
  readonly nodes: ReadonlyMap<string, { lines: ReadonlyArray<{ componentItemId: string }> }>;
}

/** An ordered substitute for a BOM line (M-09). */
export interface BomSubstitute {
  substituteItemId: string;
  priority: number;
}

/** Substitutions keyed by bom line id, priority-ascending. */
export type Substitutions = ReadonlyMap<string, readonly BomSubstitute[]>;

/** A cyclic recipe graph — the typed planning kernel rejection (the same
 * shape BomCycleError carries at the service layer; the kernel throws this
 * so pure tests assert it without the service). */
export class BomGraphCycleError extends Error {
  constructor(readonly chain: readonly string[]) {
    super(`the recipe chain revisits an item — circular bills of materials (${chain.join(" → ")})`);
    this.name = "BomGraphCycleError";
  }
}

/** The explosion depth cap (the BomService precedent — 16 levels). */
export const MAX_EXPLOSION_DEPTH = 16;

/**
 * Low-level codes (M-07) — the classic MAX-DEPTH leveling: llc(item) is
 * the deepest level at which the item occurs over every BOM path from
 * any root (finished goods = 0, their components ≥ 1, a raw used at
 * depth 1 in one recipe and depth 3 in another = 3). Processing by
 * ascending code nets every parent BEFORE its components — the parent's
 * planned orders generate the component demand the component's netting
 * then sees (the top-down MRP discipline; the cost rollup's bottom-up
 * height-from-leaves is a DIFFERENT leveling — do not conflate them).
 *
 * The graph is the BOM edges UNION the substitution edges hanging off
 * the PRIMARY component (primary → substitute: the substitute's planning
 * demand originates at the primary's netting, so the substitute must
 * carry a strictly deeper code). Cycle-safe: a cycle fails the whole
 * computation with the typed chain error; the memoized recursion
 * terminates because every resolved item leaves the frontier.
 */
export function computeLowLevelCodes(graph: LeveledGraph): Map<string, number> {
  const codes = new Map<string, number>();
  const resolving = new Set<string>();
  /** component → the items whose recipes (or substitution records)
   * reference it — the dependency parents. */
  const parents = new Map<string, string[]>();
  const known = new Set<string>(graph.nodes.keys());
  for (const [itemId, node] of graph.nodes) {
    for (const line of node.lines) {
      const list = parents.get(line.componentItemId) ?? [];
      list.push(itemId);
      parents.set(line.componentItemId, list);
      known.add(line.componentItemId);
    }
  }

  const resolve = (itemId: string, path: readonly string[]): number => {
    const memoized = codes.get(itemId);
    if (memoized !== undefined) return memoized;
    if (resolving.has(itemId)) {
      throw new BomGraphCycleError([...path, itemId]);
    }
    resolving.add(itemId);
    let code = 0;
    for (const parent of parents.get(itemId) ?? []) {
      code = Math.max(code, resolve(parent, [...path, itemId]) + 1);
    }
    resolving.delete(itemId);
    codes.set(itemId, code);
    return code;
  };

  for (const itemId of known) resolve(itemId, []);
  return codes;
}

/** One exploded component demand (the flattened, substitution-resolved
 * requirement an item contributes to one parent's planned order). */
export interface ExplodedDemand {
  /** The item whose supply must cover this line (the substitute when a
   * substitution fired — M-09: the substituted net lands on the
   * SUBSTITUTE's demand, never silently). */
  itemId: string;
  /** The original component the parent's recipe named (== itemId unless
   * substituted). */
  recipeItemId: string;
  /** The parent whose planned order generated this demand; null at the
   * root level (the direct demand input). */
  parentItemId: string | null;
  /** The phantom chain the demand passed through (empty when none). */
  viaPhantoms: readonly string[];
  qty: string;
  /** True when a substitution fired for (a part of) this line. */
  substituted: boolean;
}

/**
 * Explode one parent's planned order quantity through the graph — the
 * multi-level, phantom-flattening, substitution-resolving walk.
 *
 * Phantom flattening (M-08): a phantom component never becomes demand of
 * its own; its OWN components are demanded instead, scaled by the
 * phantom's per-unit quantity (Σ component demand is preserved by
 * construction — acceptance criterion 2's conservation property the spec
 * pins: flattening redistributes, it never invents or destroys).
 *
 * Substitution (M-09): the caller pre-resolves the substitution splits
 * (resolveSubstitutions) against the primary items' supply projections
 * and hands them in; this walk only RECORDS the records the caller
 * resolved (every substituted net lands on the demand line, never
 * silently).
 *
 * The two explosion modes (the 043-audit item-2 fix):
 * - TRANSITIVE (the default — the pure-kernel contract the property tests
 *   pin): the walk recurses into non-phantom components that have their
 *   own recipes, producing the FULL multi-level demand list from one
 *   call.
 * - SINGLE_LEVEL (`singleLevel: true` — the ENGINE's mode): the walk
 *   recurses through PHANTOMS only (a phantom owns no MO — its components
 *   are the parent's direct demand, however deep the phantom chain); a
 *   non-phantom component's own recipe is NOT exploded here — the engine's
 *   leveled walk plans that component itself at its own low-level-code
 *   turn, and ITS make order explodes ITS components at ITS release bucket
 *   (the time-phased per-level discipline). Pre-fix the engine called the
 *   transitive walk AND re-exploded per level — a manufactured
 *   intermediate's components were demanded TWICE (once at the root's
 *   release bucket through the transitive recursion, once at the
 *   intermediate's own release bucket through its walk turn), a latent
 *   double count that the scope bug had masked (the dropped components
 *   were never planned at all).
 */
export function explodeDemand(input: {
  graph: BomGraph;
  rootItemId: string;
  rootQty: string;
  /** The resolved substitution splits keyed `${parentItemId}:${lineId}` —
   * produced by resolveSubstitutions; absent = no substitution. */
  resolvedSubstitutions: ReadonlyMap<string, SubstitutionSplit>;
  /** Engine mode: explode immediate components (phantom-flattened) only —
   * the leveled walk owns the deeper levels. Default false (transitive). */
  singleLevel?: boolean;
}): ExplodedDemand[] {
  const demands: ExplodedDemand[] = [];
  const root = new Decimal(input.rootQty);

  const walk = (
    parentQty: Decimal,
    node: BomGraphNode,
    depth: number,
    path: readonly string[],
    viaPhantoms: readonly string[],
  ): void => {
    if (depth > MAX_EXPLOSION_DEPTH) {
      throw new Error(`explosion exceeds the ${MAX_EXPLOSION_DEPTH}-level depth cap`);
    }
    const yieldDivisor = new Decimal(node.yieldPct).div(100);
    for (const line of node.lines) {
      if (path.includes(line.componentItemId)) {
        throw new BomGraphCycleError([...path, line.componentItemId]);
      }
      const gross = round6(
        parentQty
          .times(new Decimal(line.qtyPerOutput))
          .times(new Decimal(line.scrapPct).plus(100).div(100))
          .div(yieldDivisor),
      );
      if (line.phantomFlag) {
        // Phantom flattening: demand the phantom's OWN components instead.
        const phantomNode = input.graph.nodes.get(line.componentItemId);
        if (phantomNode !== undefined) {
          walk(
            gross,
            phantomNode,
            depth + 1,
            [...path, line.componentItemId],
            [...viaPhantoms, line.componentItemId],
          );
        }
        // A phantom with no ACTIVE BOM demands nothing (a dangling phantom
        // is data-readiness debt the panel + exceptions report surface).
        continue;
      }
      const key = `${node.itemId}:${line.lineId}`;
      const split = input.resolvedSubstitutions.get(key);
      const primaryQty = split === undefined ? gross : new Decimal(split.primaryQty);
      if (primaryQty.greaterThan(0)) {
        demands.push({
          itemId: line.componentItemId,
          recipeItemId: line.componentItemId,
          parentItemId: node.itemId,
          viaPhantoms,
          qty: primaryQty.toFixed(6),
          substituted: false,
        });
      }
      if (split !== undefined) {
        for (const leg of split.substituteLegs) {
          demands.push({
            itemId: leg.substituteItemId,
            recipeItemId: line.componentItemId,
            parentItemId: node.itemId,
            viaPhantoms,
            qty: leg.qty,
            substituted: true,
          });
        }
      }
      // Recurse into non-phantom components that have their own recipes —
      // substitution never recurses (the substitute's OWN recipe is not
      // the parent's business; the primary component's chain is). In
      // SINGLE_LEVEL mode this recursion is the ENGINE's boundary: the
      // leveled walk explodes the component's own recipe at its own turn
      // (per-level time phasing) — recursing here too would demand the
      // deep components twice.
      const childNode = input.graph.nodes.get(line.componentItemId);
      if (
        input.singleLevel !== true &&
        childNode !== undefined &&
        primaryQty.greaterThan(0)
      ) {
        walk(
          primaryQty,
          childNode,
          depth + 1,
          [...path, line.componentItemId],
          viaPhantoms,
        );
      }
    }
  };

  const rootNode = input.graph.nodes.get(input.rootItemId);
  if (rootNode !== undefined) {
    walk(round6(root), rootNode, 1, [input.rootItemId], []);
  }
  return demands;
}

/** One substituted leg: `qty` of `substituteItemId` covers the primary's
 * shortfall. */
export interface SubstitutionLeg {
  substituteItemId: string;
  qty: string;
}

/** The resolved split of one BOM line's gross across the primary and its
 * ordered substitutes (M-09). */
export interface SubstitutionSplit {
  /** The primary component's retained quantity (≤ the line gross). */
  primaryQty: string;
  /** The substitute legs, priority order (the earliest substitute fills
   * first). */
  substituteLegs: readonly SubstitutionLeg[];
}

/**
 * Resolve one line's substitution split: cover `uncoveredQty` (the part
 * the primary item's supply projection cannot serve) with the ordered
 * substitutes — priority order, no overfill (a substitute never covers
 * more than the uncovered remainder, and the remainder is capped at the
 * line gross). Returns undefined when nothing needs substituting.
 */
export function resolveSubstitutions(input: {
  lineGrossQty: string;
  /** What the primary item cannot cover (0 ≤ uncovered ≤ gross, clamped). */
  uncoveredQty: string;
  substitutes: readonly BomSubstitute[];
}): SubstitutionSplit | undefined {
  const gross = new Decimal(input.lineGrossQty);
  let uncovered = new Decimal(input.uncoveredQty);
  if (uncovered.isNegative()) uncovered = new Decimal(0);
  if (uncovered.greaterThan(gross)) uncovered = gross;
  if (uncovered.lessThanOrEqualTo(0) || input.substitutes.length === 0) {
    return undefined;
  }
  const legs: SubstitutionLeg[] = [];
  for (const substitute of [...input.substitutes].sort((a, b) => a.priority - b.priority)) {
    if (uncovered.lessThanOrEqualTo(0)) break;
    const take = uncovered; // the whole remainder to this priority
    legs.push({ substituteItemId: substitute.substituteItemId, qty: round6(take).toFixed(6) });
    uncovered = uncovered.minus(take);
  }
  const primary = gross.minus(
    legs.reduce((sum, leg) => sum.plus(new Decimal(leg.qty)), new Decimal(0)),
  );
  return {
    primaryQty: round6(primary).toFixed(6),
    substituteLegs: legs,
  };
}

/**
 * Flatten a demands list to per-item totals (the conservation check the
 * spec pins: Σ before = Σ after flattening — the phantom's demand
 * disappears, its components' demand appears, the grand total over
 * NON-phantom items is preserved).
 */
export function totalByItem(demands: readonly ExplodedDemand[]): Map<string, string> {
  const totals = new Map<string, Decimal>();
  for (const demand of demands) {
    const current = totals.get(demand.itemId) ?? new Decimal(0);
    totals.set(demand.itemId, current.plus(new Decimal(demand.qty)));
  }
  const out = new Map<string, string>();
  for (const [itemId, total] of totals) out.set(itemId, round6(total).toFixed(6));
  return out;
}
