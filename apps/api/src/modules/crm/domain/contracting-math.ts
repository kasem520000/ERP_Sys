/**
 * PHASE-048 (W-11 — Projects & Contracting: the contracting core) — the
 * PURE W-11 math (T-10 + T-11 + T-12), the D-08/D-09/D-10 laws: the
 * BR-092 retention fold (the hold % comes from the contract — tenant
 * DATA per contract, never a global constant; the certificate's
 * retention/net pair derived with ONE rounding and the 0103 arithmetic
 * floor `retention + net = gross` holding BY CONSTRUCTION), the BR-093
 * billing-ceiling check (cumulative billing never exceeds the approved
 * contract value including approved change orders — the typed refusal's
 * figures, NO silent truncation), the customer-advance amortization
 * plan (the G-33 supplier-advance DISBURSE/APPLY mirror on the customer
 * side — the oldest-first fold over the advances' remaining balances),
 * and the G-56 release gates (the schedule's taking-over and
 * defect-liability dates). No clock, no store, no I/O (the W-9/W-10
 * unit-first precedents); all money/percent math is EXACT
 * scaled-integer arithmetic (BigInt minor units — ADR-0009).
 *
 * THE LAWS PINNED HERE:
 *
 * - BR-092 (the retention % from the contract): `certificateAmounts`
 *   folds gross × hold% with ONE half-up rounding at the 4-dp money
 *   value — retention + net = gross IDENTICALLY (the 0103 CHECK's own
 *   law, so the engine can never write a certificate that violates its
 *   own table). The % NEVER comes from a global constant: the customer
 *   certificates read the retention register's hold_percent (the
 *   contract's commercial spine — the 0103 side law), the subcontract
 *   certificates read the agreement's retention_percent (D-08).
 *
 * - BR-093 (the cumulative billing ceiling): `billingCeilingCheck`
 *   compares Σ the approved certificates' gross + THIS certificate's
 *   gross against the effective contract value (the register's
 *   contract value + Σ the APPROVED change-order price deltas — W-10's
 *   one-law read: the gate is the ONLY re-planning path). The boundary
 *   cumulative = ceiling is LEGAL (billing exactly the contract). An
 *   excess is the caller's typed refusal carrying the figures — never
 *   a silent truncation of the requested amount.
 *
 * - THE ADVANCE AMORTIZATION (the G-33 mirror): `advanceApplication-
 *   Plan` folds the applicable amount oldest-first (certificate_date,
 *   then id, at the service — the fold itself takes the ordered list)
 *   across the advances' remaining balances (gross − applied); the
 *   applied total NEVER exceeds the certificate's net nor any
 *   advance's remaining. An empty advance list applies NOTHING (the
 *   honest shape — no apply journal at all).
 *
 * - THE G-56 RELEASE GATES (the documented schedule law): the release
 *   requires the taking-over date SET and ELAPSED; when the
 *   defect-liability date is contracted (non-null) it must ALSO be
 *   elapsed — the retention exists to secure the defect-liability
 *   period, so releasing before it would defeat its purpose (the
 *   single-date 0103 shape releases the WHOLE accrued balance at
 *   once — no tranche split, the register's own recorded design).
 */

// ── the exact scaled-integer core (the W-9/W-10 helpers' shape, local) ────

/** Parse a canonical decimal string to minor units at the given scale. */
function toMinor(value: string, scale: number, what: string): bigint {
  const negative = value.startsWith("-");
  const [whole = "0", frac = ""] = value.replace("-", "").split(".");
  if (frac.length > scale) {
    throw new Error(`${what}: more than ${scale} decimal digits: ${value}`);
  }
  const minor = BigInt(whole + frac.padEnd(scale, "0"));
  return negative ? -minor : minor;
}

/** Render minor units as a canonical decimal string at the scale. */
function fromMinor(minor: bigint, scale: number): string {
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  const pow = 10n ** BigInt(scale);
  const whole = abs / pow;
  const frac = (abs % pow).toString().padStart(scale, "0");
  return `${negative ? "-" : ""}${whole.toString()}.${frac}`;
}

/** Half-up rounding of numerator/denominator to minor units at the
 * given scale (a tie rounds UP — ADR-0009's convention). */
function roundDivHalfUp(numerator: bigint, denominator: bigint, scale: number): bigint {
  if (denominator === 0n) throw new Error("roundDivHalfUp: zero denominator");
  const pow = 10n ** BigInt(scale);
  const scaled = numerator * pow;
  const quotient = scaled / denominator;
  const remainder = scaled % denominator;
  const bump = remainder * 2n >= denominator ? 1n : 0n;
  return quotient + bump;
}

const MONEY_SCALE = 4;
const PCT_SCALE = 2;

/** Σ money strings, EXACT (no rounding — the inputs are already 4-dp). */
export function sumMoney4(values: readonly string[]): string {
  let total = 0n;
  for (const value of values) {
    total += toMinor(value, MONEY_SCALE, "money");
  }
  return fromMinor(total, MONEY_SCALE);
}

// ── BR-092: the retention fold (the % from the contract) ───────────────────

/** The certificate's derived pair — retention (ONE half-up rounding at
 * the 4-dp money value) and net (the exact residual), so
 * `retention + net = gross` holds BY CONSTRUCTION (the 0103 arithmetic
 * floor; the table's own CHECK can never fire on an engine write).
 *
 * Hand-computed scale algebra (the W-9 lesson): gross_m4 × pct_m2 sits
 * at scale 10⁶; retention_m4 = round(gross_m4 × pct_m2 / 10⁴) — ONE
 * rounding, half-up.
 *   gross 10,000.0000 × hold 10.00% → 1,000.0000 / 9,000.0000
 *   gross  9,999.9999 × hold  7.50% → 749.99999925 → 750.0000 / 9,249.9999
 */
export function certificateAmounts(
  gross: string,
  holdPercent: string,
): { retention: string; net: string } {
  const grossM4 = toMinor(gross, MONEY_SCALE, "gross");
  if (grossM4 < 0n) throw new Error(`gross must be non-negative: ${gross}`);
  const pctM2 = toMinor(holdPercent, PCT_SCALE, "holdPercent");
  if (pctM2 < 0n || pctM2 > 100n * 100n) {
    throw new Error(`holdPercent must be within [0, 100]: ${holdPercent}`);
  }
  const retentionM4 = roundDivHalfUp(grossM4 * pctM2, 10_000n, 0);
  const netM4 = grossM4 - retentionM4;
  return { retention: fromMinor(retentionM4, MONEY_SCALE), net: fromMinor(netM4, MONEY_SCALE) };
}

// ── BR-093: the cumulative billing ceiling check ───────────────────────────

/** The ceiling check's verdict — the figures the typed refusal carries
 * (never a silent truncation: `overage` is the exact excess). */
export interface BillingCeilingVerdict {
  readonly exceeded: boolean;
  /** alreadyBilled + thisGross (the cumulative AFTER this certificate). */
  readonly cumulativeAfter: string;
  /** 0 when within the ceiling; the exact excess when exceeded. */
  readonly overage: string;
}

/** Cumulative billing never exceeds the approved contract value
 * including approved change orders (the effective contract value is
 * W-10's one-law read: the register + Σ the APPROVED price deltas).
 * The boundary cumulative = ceiling is LEGAL. */
export function billingCeilingCheck(
  alreadyBilled: string,
  thisGross: string,
  ceiling: string,
): BillingCeilingVerdict {
  const billed = toMinor(alreadyBilled, MONEY_SCALE, "alreadyBilled");
  const gross = toMinor(thisGross, MONEY_SCALE, "thisGross");
  const cap = toMinor(ceiling, MONEY_SCALE, "ceiling");
  const cumulative = billed + gross;
  const overage = cumulative > cap ? cumulative - cap : 0n;
  return {
    exceeded: overage > 0n,
    cumulativeAfter: fromMinor(cumulative, MONEY_SCALE),
    overage: fromMinor(overage, MONEY_SCALE),
  };
}

// ── the customer-advance amortization plan (the G-33 mirror) ───────────────

/** One advance certificate's remaining balance (the service orders the
 * list oldest-first: certificate_date, then id). */
export interface AdvanceBalanceInput {
  readonly id: string;
  /** The ADVANCE certificate's gross (the advance amount). */
  readonly gross: string;
  /** The already-applied amount (0104's stamp column). */
  readonly applied: string;
}

/** One slice of the plan — how much THIS advance absorbs. */
export interface AdvanceApplicationSlice {
  readonly id: string;
  readonly apply: string;
}

/** The oldest-first amortization fold: the applicable amount never
 * exceeds the certificate's net nor any advance's remaining; an empty
 * or exhausted advance list applies NOTHING (the honest shape).
 *   advances A(20,000; applied 5,000) + B(8,000; applied 0):
 *     amount 12,000 → A 12,000 · B 0        (total 12,000)
 *     amount 20,000 → A 15,000 · B 5,000    (total 20,000)
 *     amount 30,000 → A 15,000 · B 8,000    (total 23,000, unapplied 7,000)
 */
export function advanceApplicationPlan(
  advances: readonly AdvanceBalanceInput[],
  amount: string,
): {
  readonly slices: readonly AdvanceApplicationSlice[];
  readonly totalApplied: string;
  /** The certificate's net the advances could NOT absorb. */
  readonly unapplied: string;
} {
  let remaining = toMinor(amount, MONEY_SCALE, "amount");
  if (remaining < 0n) throw new Error(`amount must be non-negative: ${amount}`);
  const slices: AdvanceApplicationSlice[] = [];
  let totalApplied = 0n;
  for (const advance of advances) {
    if (remaining === 0n) break;
    const gross = toMinor(advance.gross, MONEY_SCALE, "advance.gross");
    const applied = toMinor(advance.applied, MONEY_SCALE, "advance.applied");
    const available = gross - applied;
    if (available <= 0n) continue;
    const take = available < remaining ? available : remaining;
    slices.push({ id: advance.id, apply: fromMinor(take, MONEY_SCALE) });
    totalApplied += take;
    remaining -= take;
  }
  return {
    slices,
    totalApplied: fromMinor(totalApplied, MONEY_SCALE),
    unapplied: fromMinor(remaining, MONEY_SCALE),
  };
}

// ── G-56: the release gates (the schedule's documented law) ────────────────

/** What blocks a release — null when the gates are satisfied. */
export type ReleaseBlocker =
  | "TAKING_OVER_MISSING"
  | "TAKING_OVER_NOT_ELAPSED"
  | "DEFECT_LIABILITY_NOT_ELAPSED";

/** The release gates: the taking-over date must be SET and ELAPSED; a
 * contracted defect-liability date (non-null) must ALSO be elapsed —
 * the retention secures the defect-liability period, so the release
 * waits for it (the single-date 0103 shape releases the whole accrued
 * balance at once; a tenant that contracts no DLP releases on the
 * taking-over alone — their own schedule choice, tenant data). */
export function releaseGatesSatisfied(input: {
  today: string;
  takingOverDate: string | null;
  defectLiabilityDate: string | null;
}): { satisfied: boolean; blocker: ReleaseBlocker | null } {
  if (input.takingOverDate === null) {
    return { satisfied: false, blocker: "TAKING_OVER_MISSING" };
  }
  if (input.takingOverDate > input.today) {
    return { satisfied: false, blocker: "TAKING_OVER_NOT_ELAPSED" };
  }
  if (input.defectLiabilityDate !== null && input.defectLiabilityDate > input.today) {
    return { satisfied: false, blocker: "DEFECT_LIABILITY_NOT_ELAPSED" };
  }
  return { satisfied: true, blocker: null };
}
