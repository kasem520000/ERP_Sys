import { Decimal } from "@erp/domain-core";

/**
 * PHASE-051 (W-38 — T-11, 2026-11-25) THE BONDED TRANSITION FOLD (L-14,
 * D-08 — the plan's own unit-first law, the pure layer FIRST with the
 * property tests beside it, then the service that renders its verdicts
 * VERBATIM — zero parallel computation):
 *
 *   THE LADDER (the 0121 §4 stamp law's own fold): DRAFT → EXECUTED,
 *   TERMINAL. ONE act exists — `execute` — and an executed move never
 *   moves again (the register is the audit trail — S/I/U, NO DELETE).
 *   The execution stamp law (ck_bonded_warehouse_moves_executed_shape):
 *   an executed move carries its stamp, a draft carries none — MONOTONE
 *   EVIDENCE that never un-stamps.
 *
 *   THE MOVE-KIND SHAPES (G-66's own laws, the 0121 floors' caller-side
 *   face): an IN_BOND move DEPOSITS duty-suspended stock INTO a
 *   warehouse (the initial deposit's from is NULL — the goods enter
 *   the customs bond there; a within-bond transfer carries BOTH ends);
 *   a RELEASE move frees it FROM a warehouse (from is required — the
 *   bond ledger's arithmetic releases at the FROM side). The kind's
 *   own floors: IN_BOND requires to; RELEASE requires from; NEVER both
 *   null; the two kinds never share a shape.
 *
 *   THE NO-DUTY / DUTY MATRIX (the move kinds × the duty shapes — the
 *   plan's own wording): an IN_BOND move NEVER carries a duty figure,
 *   a recognition stamp, or a release entry (ck_in_bond_no_duty — moves
 *   inside the bond post NO duty, G-66's own floor); a RELEASE carries
 *   the recognition pair ATOMICALLY or NOT AT ALL (ck_release_shape —
 *   the empty pair is the zero-duty release's own honest shape: «the
 *   duties that exist flow; the duties that do not, do not» — the
 *   G-65 zero-duty completion's declared interpretation #6, extended
 *   to the release by the same law, recorded here at the claim site).
 *
 *   THE RELEASE DUTY (BR-107 — D-11: «the duty recognized is the
 *   declaration's own figure»): the release's per-line duty = the
 *   linked declaration's OWN line duty_amount × (released qty ÷
 *   declared qty), on Decimal (ADR-0009 — never a float), rounded to
 *   the ledger's 4dp (ROUND_HALF_UP — the posting engine's canonical
 *   scale). The tie is a FUNCTION, never a relation (the INV-036
 *   precedent's own law): every release line's item must be declared
 *   exactly once, every declared line item-bearing WITH a quantity
 *   (the ratio's own basis — a NULL quantity is the typed refusal,
 *   fail-closed), and the released quantity may NEVER exceed the
 *   declared minus the already-released (the over-release guard — the
 *   register's own arithmetic, the caller supplies the already-released
 *   figure from the bond ledger's own rows). Σ per-line = the move's
 *   duty_amount EXACTLY (the exact-Σ law — the Decimal sum of the
 *   per-line figures, never re-rounded).
 *
 *   THE LINE FLOORS (the 0121 §4 caller-side face): ≥ 1 line, every
 *   line an item + a POSITIVE quantity at the 6dp canonical scale, and
 *   NO same-item pairs (a duplicate item is the tie's own refusal —
 *   the function, never a relation).
 *
 *   PURE: no clock, no store, no SQL — the service renders this
 *   module's verdicts and figures VERBATIM (the execute act's duty
 *   amount and the register's line writes carry the fold's own
 *   output).
 */

// ── the ladder (the 0121 §4 status vocabulary) ───────────────────────────────

/** The 0121 status vocabulary (ck_bonded_warehouse_moves_status' list). */
export const BONDED_MOVE_STATUSES = ["DRAFT", "EXECUTED"] as const;
export type BondedMoveStatus = (typeof BONDED_MOVE_STATUSES)[number];

/** The lifecycle acts the service exposes (the fold's move vocabulary). */
export const BONDED_MOVES = ["execute"] as const;
export type BondedMove = (typeof BONDED_MOVES)[number];

/** The verdict shape every act renders (the lc-lifecycle precedent). */
export interface BondedMoveVerdict {
  readonly allowed: boolean;
  readonly to: BondedMoveStatus | null;
  readonly reason: string | null;
}

/** THE MOVE MATRIX — the total fold: DRAFT → EXECUTED, TERMINAL (the
 * 0121 stamp law's own shape; an executed move never moves again — the
 * register is the audit trail). */
export function nextBondedMove(
  status: BondedMoveStatus,
  move: BondedMove,
): BondedMoveVerdict {
  if (move !== "execute") {
    return { allowed: false, to: null, reason: `unknown move "${move}"` };
  }
  if (status === "DRAFT") {
    return { allowed: true, to: "EXECUTED", reason: null };
  }
  return {
    allowed: false,
    to: null,
    reason:
      "the move is EXECUTED — terminal (the execution stamp is monotone evidence that never un-stamps; the release's recognition is exactly-once, BR-107)",
  };
}

// ── the move-kind shape laws (G-66's own faces) ──────────────────────────────

/** The 0121 kind vocabulary (ck_bonded_warehouse_moves_kind's list). */
export const BONDED_MOVE_KINDS = ["IN_BOND", "RELEASE"] as const;
export type BondedMoveKind = (typeof BONDED_MOVE_KINDS)[number];

/** The fold's shape verdict — the reason names the field (the service
 * re-throws it typed as BONDED_LINE_INVALID / BONDED_MOVE_STATE). */
export interface BondedShapeVerdict {
  readonly valid: boolean;
  readonly field: string;
  readonly reason: string | null;
}

/** THE KIND SHAPES: IN_BOND requires to (the deposit's target); RELEASE
 * requires from (the bond ledger releases at the FROM side); never both
 * null; an IN_BOND release-shaped move and a RELEASE deposit-shaped
 * move are each refused (the kinds never share a shape). */
export function validateBondedMoveShape(input: {
  kind: string;
  fromWarehouseId: string | null;
  toWarehouseId: string | null;
}): BondedShapeVerdict {
  if (input.kind !== "IN_BOND" && input.kind !== "RELEASE") {
    return {
      valid: false,
      field: "moveKind",
      reason: `the move kind must be IN_BOND or RELEASE, got "${input.kind}" (the 0121 vocabulary)`,
    };
  }
  if (input.fromWarehouseId === null && input.toWarehouseId === null) {
    return {
      valid: false,
      field: "toWarehouseId",
      reason:
        "the move carries neither end — an IN_BOND move deposits INTO a warehouse and a RELEASE frees FROM one (never both null)",
    };
  }
  if (input.kind === "IN_BOND" && input.toWarehouseId === null) {
    return {
      valid: false,
      field: "toWarehouseId",
      reason: "an IN_BOND move requires its deposit target (toWarehouseId — the goods enter the customs bond there)",
    };
  }
  if (input.kind === "RELEASE" && input.fromWarehouseId === null) {
    return {
      valid: false,
      field: "fromWarehouseId",
      reason: "a RELEASE move requires its bond source (fromWarehouseId — the bond ledger releases at the FROM side)",
    };
  }
  return { valid: true, field: "lines", reason: null };
}

// ── the line floors (the 0121 §4 caller-side face) ───────────────────────────

/** The bonded move's line shape (the bond ledger's own arithmetic reads
 * itemId + qty; the deposit's unitCost rides the SAME row — the
 * tenant's own commercial figure, never invented). */
export interface BondedLineInput {
  readonly itemId: string;
  readonly qty: string;
  readonly unitCost?: string | null;
}

/** THE LINE FLOORS: ≥ 1 line; every line an item id + a POSITIVE finite
 * quantity (the 6dp canonical scale — the bond ledger's own); NO
 * same-item pairs (the tie is a function, never a relation); the
 * deposit's unitCost (when supplied) a non-negative finite decimal. */
export function validateBondedLines(
  lines: readonly BondedLineInput[],
): BondedShapeVerdict {
  if (lines.length === 0) {
    return { valid: false, field: "lines", reason: "a bonded move carries at least one line (the bond ledger is empty otherwise)" };
  }
  if (lines.length > 200) {
    return { valid: false, field: "lines", reason: `too many lines (${lines.length} — the 200-line ceiling, the register's own bound)` };
  }
  const seen = new Set<string>();
  for (const [index, line] of lines.entries()) {
    if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(line.itemId)) {
      return { valid: false, field: `lines[${index}].itemId`, reason: `a uuid is required, got "${line.itemId}"` };
    }
    const qty = parseDecimal(line.qty);
    if (qty === null || qty.lessThanOrEqualTo(0)) {
      return { valid: false, field: `lines[${index}].qty`, reason: `a positive finite decimal quantity is required, got "${line.qty}"` };
    }
    if (seen.has(line.itemId)) {
      return {
        valid: false,
        field: `lines[${index}].itemId`,
        reason: `the item ${line.itemId} appears twice — the move's line tie is a function, never a relation (merge the quantities or split the move)`,
      };
    }
    seen.add(line.itemId);
    if (line.unitCost !== undefined && line.unitCost !== null) {
      const cost = parseDecimal(line.unitCost);
      if (cost === null || cost.isNegative()) {
        return { valid: false, field: `lines[${index}].unitCost`, reason: `a non-negative finite decimal unit cost is required, got "${line.unitCost}"` };
      }
    }
  }
  return { valid: true, field: "lines", reason: null };
}

// ── the release duty (BR-107 — the declaration's own figure) ─────────────────

/** The declaration's own line, as the tie reads it (the W-37 register's
 * row — the duty_amount is the fold's own computed output). */
export interface DeclaredDutyLine {
  readonly itemId: string;
  readonly quantity: string;
  readonly dutyAmount: string;
}

/** The release line, as the tie demands it. */
export interface ReleaseDutyLine {
  readonly itemId: string;
  readonly qty: string;
}

/** The fold's release-duty output: the per-line figures (4dp) + the
 * EXACT total — or the typed refusal verdict naming the failing line. */
export interface ReleaseDutyVerdict {
  readonly lines: { readonly itemId: string; readonly qty: string; readonly dutyAmount: string }[] | null;
  readonly totalDuty: string | null;
  readonly field: string | null;
  readonly reason: string | null;
}

/** Parse a Decimal safely — null on the unparseable shape (the fold
 * NEVER throws; the verdict is the caller's). */
function parseDecimal(value: string): Decimal | null {
  try {
    const parsed = new Decimal(value);
    return parsed.isFinite() ? parsed : null;
  } catch {
    return null;
  }
}

/** THE RELEASE DUTY (BR-107): the per-line figure = the declaration's
 * OWN duty_amount × (released qty ÷ declared qty), 4dp ROUND_HALF_UP
 * (the ledger's canonical scale); Σ per-line = the move's duty_amount
 * EXACTLY. The tie's exactness laws: every declared line item-bearing
 * with a quantity (the ratio's basis — NULL is the typed refusal,
 * fail-closed); every release line's item declared (the coverage law);
 * every item declared at most once (the function, never a relation);
 * the released qty NEVER exceeding the declared minus the
 * already-released (the over-release guard — the caller supplies the
 * bond ledger's own Σ from the register's EXECUTED rows). */
export function computeReleaseDuty(input: {
  declared: readonly DeclaredDutyLine[];
  released: readonly ReleaseDutyLine[];
  alreadyReleasedByItem?: ReadonlyMap<string, string>;
}): ReleaseDutyVerdict {
  const declaredByItem = new Map<string, DeclaredDutyLine>();
  for (const line of input.declared) {
    if (declaredByItem.has(line.itemId)) {
      return {
        lines: null,
        totalDuty: null,
        field: "declaration.lines",
        reason: `the item ${line.itemId} is declared twice — the release tie is a function, never a relation (one line per item on the declaration)`,
      };
    }
    const qty = parseDecimal(line.quantity);
    if (qty === null || qty.lessThanOrEqualTo(0)) {
      return {
        lines: null,
        totalDuty: null,
        field: `declaration.lines[${line.itemId}].quantity`,
        reason: `the declaration's line for ${line.itemId} carries no positive quantity (got "${line.quantity}") — the released share cannot be computed (fail-closed)`,
      };
    }
    const duty = parseDecimal(line.dutyAmount);
    if (duty === null || duty.isNegative()) {
      return {
        lines: null,
        totalDuty: null,
        field: `declaration.lines[${line.itemId}].dutyAmount`,
        reason: `the declaration's duty figure for ${line.itemId} is not a non-negative finite decimal (got "${line.dutyAmount}")`,
      };
    }
    declaredByItem.set(line.itemId, line);
  }
  const already = input.alreadyReleasedByItem ?? new Map<string, string>();
  const output: { itemId: string; qty: string; dutyAmount: string }[] = [];
  let total = new Decimal(0);
  for (const [index, line] of input.released.entries()) {
    const declared = declaredByItem.get(line.itemId);
    if (declared === undefined) {
      return {
        lines: null,
        totalDuty: null,
        field: `lines[${index}].itemId`,
        reason: `the item ${line.itemId} is not declared on the linked declaration — the release's duty is the declaration's OWN figure (the coverage law; every released item must be declared)`,
      };
    }
    const releasedQty = parseDecimal(line.qty);
    if (releasedQty === null || releasedQty.lessThanOrEqualTo(0)) {
      return {
        lines: null,
        totalDuty: null,
        field: `lines[${index}].qty`,
        reason: `a positive finite decimal quantity is required, got "${line.qty}"`,
      };
    }
    const declaredQty = new Decimal(declared.quantity);
    const priorText = already.get(line.itemId) ?? "0";
    const prior = parseDecimal(priorText);
    if (prior === null || prior.isNegative()) {
      return {
        lines: null,
        totalDuty: null,
        field: `lines[${index}].itemId`,
        reason: `the already-released figure for ${line.itemId} is not a non-negative finite decimal (got "${priorText}") — the over-release guard's own basis is corrupt`,
      };
    }
    if (releasedQty.plus(prior).greaterThan(declaredQty)) {
      return {
        lines: null,
        totalDuty: null,
        field: `lines[${index}].qty`,
        reason: `the released quantity for ${line.itemId} (${line.qty} + already released ${prior.toFixed(6)}) exceeds the declared ${declared.quantity} — the register never recognizes more duty than the declaration's own figure (the over-release guard)`,
      };
    }
    // THE RATIO (the declaration's own figure at the released quantity):
    // duty_amount × (released ÷ declared), 4dp ROUND_HALF_UP.
    const share = new Decimal(declared.dutyAmount)
      .times(releasedQty.div(declaredQty))
      .toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
    output.push({
      itemId: line.itemId,
      qty: releasedQty.toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toFixed(6),
      dutyAmount: share.toFixed(4),
    });
    total = total.plus(share);
  }
  return {
    lines: output,
    totalDuty: total.toFixed(4),
    field: null,
    reason: null,
  };
}

/** The suspended-pool verdict the gate consumes (the bond ledger's own
 * arithmetic, rendered as the fold's pure face for the property tests:
 * Σ EXECUTED IN_BOND into the warehouse − Σ EXECUTED IN_BOND out of it
 * − Σ EXECUTED RELEASE out of it, clamped at zero — a free warehouse's
 * from-leg never drives the pool negative). */
export function suspendedPool(input: {
  inBondInto: string;
  inBondOutOf: string;
  releaseOutOf: string;
}): string {
  const into = parseDecimal(input.inBondInto) ?? new Decimal(0);
  const out = parseDecimal(input.inBondOutOf) ?? new Decimal(0);
  const released = parseDecimal(input.releaseOutOf) ?? new Decimal(0);
  const pool = into.minus(out).minus(released);
  return Decimal.max(pool, new Decimal(0)).toFixed(6);
}

/**
 * THE BASE ALLOCATION (D-21's FX ride at the released quantity — the
 * exact-Σ law's per-line face): converts the per-line declaration-
 * currency figures to BASE at the act's contract rate, each line at
 * 4dp ROUND_HALF_UP, with the REMAINDER ABSORBED so Σ allocated = the
 * converted total EXACTLY (never a drift): a POSITIVE remainder lands
 * on the LAST line (the revaluation service's own remainder
 * discipline, the FIFO allocation precedent's law); a NEGATIVE
 * remainder (the per-line conversions over-rounded against the total)
 * is subtracted from the LARGEST figures first — every figure stays
 * ≥ 0 while Σ stays EXACT. Identity (the figures pass through) when
 * the rate is undefined (the declaration's currency IS the base).
 */
export function allocateBaseAmounts(
  perLineAmounts: readonly string[],
  rate: string | undefined,
): string[] {
  if (perLineAmounts.length === 0) {
    return [];
  }
  if (rate === undefined) {
    return perLineAmounts.map((amount) => new Decimal(amount).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4));
  }
  const rateValue = new Decimal(rate);
  const figures = perLineAmounts.map((amount) =>
    new Decimal(amount)
      .times(rateValue)
      .toDecimalPlaces(4, Decimal.ROUND_HALF_UP),
  );
  // The total's own conversion (the journal's figure — exact).
  const totalSource = perLineAmounts.reduce(
    (sum, amount) => sum.plus(new Decimal(amount)),
    new Decimal(0),
  );
  const totalBase = totalSource.times(rateValue).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
  let diff = totalBase.minus(figures.reduce((sum, value) => sum.plus(value), new Decimal(0)));
  if (diff.greaterThan(0)) {
    // The remainder to the LAST line: Σ allocated ≡ the total EXACTLY.
    figures[figures.length - 1] = figures[figures.length - 1]!.plus(diff);
  } else if (diff.lessThan(0)) {
    // The over-rounded drift: subtract from the LARGEST figures first
    // — every figure stays ≥ 0 while Σ stays EXACT (the sub-quantum FX
    // edge's own honest allocation).
    diff = diff.neg();
    const order = figures
      .map((value, index) => ({ value, index }))
      .sort((a, b) => b.value.comparedTo(a.value));
    for (const slot of order) {
      if (diff.isZero()) {
        break;
      }
      const take = Decimal.min(slot.value, diff);
      figures[slot.index] = slot.value.minus(take);
      diff = diff.minus(take);
    }
  }
  return figures.map((value) => value.toFixed(4));
}
