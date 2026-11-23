import { Decimal, DomainError } from "@erp/domain-core";

/**
 * PHASE-050 (W-27 — T-10, 2026-11-23) THE SUPPLIER QUALITY SCORE FOLD —
 * the PURE rolling-score arithmetic (the unit-first law; the plan §4's
 * own arm). THIS fold is the ONLY score computation in the module: the
 * service reads the owning engines' rows (the SUPPLIER-source NCRs, the
 * goods-receipt FAIL inspections, the POSTED GRN window), hands the
 * four counts to this fold, and stores its output VERBATIM — and the
 * 038 scorecards READ those rows through the documented feed contract
 * (D-13: the consumer reads, never re-computes — zero parallel
 * computation on either side of the contract).
 *
 * THE PINNED FORMULA (documented weights, Decimal throughout — red line
 * 4; the stored column is numeric(5,2), the fold rounds ONLY at the
 * surface, 2dp ROUND_HALF_UP):
 *
 *   · THE UNMEASURABLE SHAPE (total deliveries = 0 — the 038
 *     scorecard's own law: an unmeasured supplier is not a provably
 *     good one; the score is evidence, never decoration): both legs 0,
 *     score 0.00.
 *   · defect leg = 100 − min(100, (ncrCount + rejectionCount) × 100 /
 *     totalDeliveries) — every SUPPLIER-source NCR and every
 *     goods-receipt FAIL inspection drags the leg at the delivery
 *     volume's own rate, floored at 0.
 *   · delivery leg = onTimeDeliveries × 100 / totalDeliveries — the
 *     038 window read's own on-time law (receipt_date ≤ the PO's
 *     expected date), 0 when the volume is zero.
 *   · score = 0.60 × defect leg + 0.40 × delivery leg (the documented
 *     weights — quality evidence outweighs punctuality 3:2), clamped
 *     to [0, 100] by construction.
 */

/** The documented blend weights (defect : delivery) — pinned 2dp exact. */
export const SUPPLIER_SCORE_WEIGHTS = { defect: "0.60", delivery: "0.40" } as const;

export interface SupplierScoreInputs {
  ncrCount: number;
  rejectionCount: number;
  onTimeDeliveries: number;
  totalDeliveries: number;
}

export interface SupplierScoreFold {
  /** The stored score — numeric(5,2)'s own domain, 2dp ROUND_HALF_UP. */
  score: string;
  /** The defect leg at 6dp (the decomposition is the evidence). */
  defectLeg: string;
  /** The delivery leg at 6dp. */
  deliveryLeg: string;
  /** The unmeasurable shape's own flag (total deliveries = 0). */
  unmeasured: boolean;
}

const ROUNDING = Decimal.ROUND_HALF_UP;

/** THE FOLD: four counts → the pinned blend. Total over the declared
 * domain — negative counts or on-time above total are the caller's input
 * floor (the 0115 CHECK's own shape, refused typed at the service). */
export function foldSupplierQualityScore(inputs: SupplierScoreInputs): SupplierScoreFold {
  if (
    inputs.ncrCount < 0 ||
    inputs.rejectionCount < 0 ||
    inputs.onTimeDeliveries < 0 ||
    inputs.totalDeliveries < 0 ||
    inputs.onTimeDeliveries > inputs.totalDeliveries
  ) {
    throw new SupplierScoreInputsInvalidError(inputs);
  }
  if (inputs.totalDeliveries === 0) {
    // THE UNMEASURABLE SHAPE — no delivery evidence, no score.
    return { score: "0.00", defectLeg: "0.000000", deliveryLeg: "0.000000", unmeasured: true };
  }
  const total = new Decimal(inputs.totalDeliveries);
  const defectEvents = new Decimal(inputs.ncrCount + inputs.rejectionCount);
  const drag = Decimal.min(defectEvents.times(100).div(total), new Decimal(100));
  const defectLeg = new Decimal(100).minus(drag);
  const deliveryLeg = new Decimal(inputs.onTimeDeliveries).times(100).div(total);
  const score = new Decimal(SUPPLIER_SCORE_WEIGHTS.defect)
    .times(defectLeg)
    .plus(new Decimal(SUPPLIER_SCORE_WEIGHTS.delivery).times(deliveryLeg))
    .toDecimalPlaces(2, ROUNDING)
    .toFixed(2);
  return {
    score,
    defectLeg: defectLeg.toDecimalPlaces(6, ROUNDING).toFixed(6),
    deliveryLeg: deliveryLeg.toDecimalPlaces(6, ROUNDING).toFixed(6),
    unmeasured: false,
  };
}

// ── the fold's own typed input floor (the quality taxonomy's family) ────────

/** The fold's own input floor (the 0115 counts CHECK's service face —
 * negative counts or on-time above total are structurally impossible
 * through the service reads; the fold refuses them BY NAME anyway). */
export class SupplierScoreInputsInvalidError extends DomainError {
  constructor(inputs: SupplierScoreInputs) {
    super(
      "SUPPLIER_SCORE_INPUTS_INVALID",
      `the score inputs are outside the fold's domain (ncr ${inputs.ncrCount} · rejections ${inputs.rejectionCount} · on-time ${inputs.onTimeDeliveries} of ${inputs.totalDeliveries} — counts are non-negative and on-time never exceeds total, the 0115 CHECK's own shape)`,
      { ...inputs },
    );
  }
}
