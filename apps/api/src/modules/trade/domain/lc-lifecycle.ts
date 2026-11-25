/**
 * PHASE-051 (W-34 — T-05, 2026-11-25) THE LC LIFECYCLE FOLD (L-01, D-05 —
 * the plan's own unit-first law: the pure layer FIRST, the property tests
 * beside it, then the service that renders its verdicts VERBATIM — zero
 * parallel computation):
 *
 *   THE LADDER (the 0119 status vocabulary, the bank's own register):
 *   DRAFT → ISSUED (the issue act — G-64's margin deposit) → RETIRED (the
 *   settlement — G-64's reversal) | EXPIRED (time's own rung — the
 *   trade-expiry-sweep's DB-clock transition) | CANCELLED (the tenant's
 *   withdrawal). RETIRED and CANCELLED are TERMINAL: no move leaves them
 *   (the register is the audit trail — S/I/U, NO DELETE). EXPIRED is NOT
 *   terminal in the banking sense: an expired instrument still exists at
 *   the bank — it RETIRES late (the settlement after expiry, the margin's
 *   own exit) or is CANCELLED when it carries no live margin deposit.
 *
 *   THE MARGIN EXIT LAW (D-05's own shape, the declared W-34
 *   interpretation recorded at the claim site): the margin deposit's ONLY
 *   exit is the retirement pair — DR the bank · CR LC_MARGIN_DEPOSIT on
 *   the (lc, retirement) single-use key. CANCELLATION therefore refuses
 *   on a live margin stamp (the tenant retires the instrument instead —
 *   the 0119 ck_letters_of_credit_margin_shape floor's own reading: a
 *   CANCELLED row never carries the stamp); a zero-margin instrument
 *   cancels freely from every live rung.
 *
 *   THE AMENDMENT WINDOWS: amendments ride the LIVE ISSUED instrument
 *   only (a DRAFT register row has nothing to amend at the bank; an
 *   EXPIRED instrument's extension is the bank's revalidation, not a
 *   register amendment — the honest boundary). Each amendment carries
 *   EXACTLY ONE typed dimension (the 0119 typed-change law): VALUE the
 *   from/to amount pair · VALIDITY the expiry from/to pair · DOCUMENTS
 *   the note · OTHER the summary — and an amendment MUST change
 *   something.
 *
 *   THE CHECKLIST STATES (the bank's documents discipline, the 0119
 *   floors): presented ⇒ presented_at; verified ⇒ presented AND
 *   verified_at — an unpresented document is never verified. The stamps
 *   are MONOTONE: presentation and verification never regress (the
 *   register is evidence — a re-presented document is a NEW discrepancy
 *   note, never a cleared stamp). The discrepancy notes are freely
 *   recordable (the bank's own record — updated as discrepancies
 *   resolve); the checklist acts ride the ISSUED instrument only.
 *
 *   THE FEE WINDOWS (T-06 — the financial-charges discipline's own
 *   floor): fees ride the LIVE instrument the bank holds — ISSUED and
 *   EXPIRED (an expired instrument still accrues custody charges; a
 *   DRAFT row has no instrument at the bank yet; RETIRED/CANCELLED are
 *   closed).
 *
 *   PURE: no clock, no store, no SQL — the service and the sweep render
 *   this module's verdicts VERBATIM.
 */

/** The 0119 status vocabulary (ck_letters_of_credit_status' own list). */
export const LC_STATUSES = [
  "DRAFT",
  "ISSUED",
  "RETIRED",
  "EXPIRED",
  "CANCELLED",
] as const;
export type LcStatus = (typeof LC_STATUSES)[number];

/** The lifecycle acts the service exposes (the fold's move vocabulary). */
export const LC_MOVES = [
  "issue",
  "amend",
  "checklist",
  "fee",
  "retire",
  "cancel",
  "expire",
] as const;
export type LcMove = (typeof LC_MOVES)[number];

/** The verdict shape every act renders (the ncr-lifecycle precedent). */
export interface LcMoveVerdict {
  readonly allowed: boolean;
  readonly to: LcStatus | null;
  readonly reason: string | null;
}

const ALLOWED: ReadonlyMap<`${LcStatus}:${LcMove}`, LcStatus> = new Map([
  ["DRAFT:issue", "ISSUED"],
  ["DRAFT:cancel", "CANCELLED"],
  ["ISSUED:amend", "ISSUED"],
  ["ISSUED:checklist", "ISSUED"],
  ["ISSUED:fee", "ISSUED"],
  ["ISSUED:retire", "RETIRED"],
  ["ISSUED:cancel", "CANCELLED"],
  ["ISSUED:expire", "EXPIRED"],
  ["EXPIRED:checklist", "EXPIRED"],
  ["EXPIRED:fee", "EXPIRED"],
  ["EXPIRED:retire", "RETIRED"],
]);

/**
 * THE MOVE MATRIX — the total fold (every status × move has a verdict;
 * the property test walks the full product). The ladder is monotone past
 * its terminals: no move leaves RETIRED or CANCELLED.
 */
export function nextLcMove(status: LcStatus, move: LcMove): LcMoveVerdict {
  const to = ALLOWED.get(`${status}:${move}`);
  if (to !== undefined) {
    return { allowed: true, to, reason: null };
  }
  const reason =
    status === "RETIRED" || status === "CANCELLED"
      ? `the LC is ${status} — the register is terminal (the audit trail is never rewritten)`
      : `a ${move} act rides the live instrument — an LC in ${status} carries no ${move} window`;
  return { allowed: false, to: null, reason };
}

/** True when the status carries a live margin deposit stamp (the exit law). */
export function hasLiveMargin(status: LcStatus): boolean {
  // The 0119 margin floor: the stamp exists only past DRAFT and never on
  // CANCELLED — the live carriers are ISSUED and EXPIRED.
  return status === "ISSUED" || status === "EXPIRED";
}

// ── the amendments (the typed-change law, 0119's own floors) ────────────────

/** The 0119 typed vocabulary (ck_lc_amendments_type's own list). */
export const AMENDMENT_CHANGE_TYPES = ["VALUE", "VALIDITY", "DOCUMENTS", "OTHER"] as const;
export type LcAmendmentChangeType = (typeof AMENDMENT_CHANGE_TYPES)[number];

export interface AmendmentTypedShape {
  readonly changeType: LcAmendmentChangeType;
  readonly valueFrom: string | null;
  readonly valueTo: string | null;
  readonly expiryFrom: string | null;
  readonly expiryTo: string | null;
  readonly documentsNote: string | null;
  readonly summary: string | null;
}

/** The typed-change law's verdict (an amendment must change something). */
export interface AmendmentShapeVerdict {
  readonly valid: boolean;
  readonly reason: string | null;
}

/**
 * THE TYPED-CHANGE LAW (0119's four floors, one fold): a VALUE amendment
 * carries its from/to pair, a VALIDITY amendment its expiry pair, a
 * DOCUMENTS amendment its note — an amendment must change something (an
 * OTHER amendment carries its summary). The fold validates the SHAPE;
 * the freshness (to ≠ from) is the service's own read against the live
 * row — this fold never sees the register.
 */
export function amendmentTypedShapeValid(shape: AmendmentTypedShape): AmendmentShapeVerdict {
  if (!AMENDMENT_CHANGE_TYPES.includes(shape.changeType)) {
    return {
      valid: false,
      reason: `changeType must be one of ${AMENDMENT_CHANGE_TYPES.join("/")}: ${shape.changeType}`,
    };
  }
  if (shape.changeType === "VALUE") {
    if (shape.valueFrom === null || shape.valueTo === null) {
      return { valid: false, reason: "a VALUE amendment carries its from/to amount pair" };
    }
  }
  if (shape.changeType === "VALIDITY") {
    if (shape.expiryFrom === null || shape.expiryTo === null) {
      return { valid: false, reason: "a VALIDITY amendment carries its expiry from/to pair" };
    }
  }
  if (shape.changeType === "DOCUMENTS" && shape.documentsNote === null) {
    return { valid: false, reason: "a DOCUMENTS amendment carries its note" };
  }
  if (shape.changeType === "OTHER" && shape.summary === null) {
    return { valid: false, reason: "an OTHER amendment carries its summary" };
  }
  return { valid: true, reason: null };
}

/** The G-64 margin adjustment's plan (the same pair both directions). */
export interface MarginAdjustmentPlan {
  readonly direction: "INCREASE" | "DECREASE" | "NONE";
  /** The ABSOLUTE delta (≥ 0, 4dp) the pair posts. */
  readonly delta: string;
}

/**
 * THE MARGIN ADJUSTMENT FOLD (D-05: "an amendment that changes the margin
 * adjusts through the same pair on its own single-use key"): an increase
 * deposits more (DR LC_MARGIN_DEPOSIT · CR the bank), a decrease releases
 * part (DR the bank · CR LC_MARGIN_DEPOSIT) — the pair is symmetric, the
 * direction is the sign. A null newMargin carries NO adjustment (the
 * amendment touched another dimension).
 */
export function marginAdjustmentPlan(
  currentMargin: string,
  newMargin: string | null,
): MarginAdjustmentPlan {
  if (newMargin === null) {
    return { direction: "NONE", delta: "0.0000" };
  }
  const current = Number.parseFloat(currentMargin);
  const next = Number.parseFloat(newMargin);
  if (!Number.isFinite(current) || !Number.isFinite(next)) {
    return { direction: "NONE", delta: "0.0000" };
  }
  const diff = next - current;
  if (diff === 0) {
    return { direction: "NONE", delta: "0.0000" };
  }
  const abs = Math.abs(diff);
  // The 4dp canonical string (ADR-0009's half-up at the boundary — the
  // raw |diff| rounded to the money scale; the property test pins the
  // exactness at 4dp).
  const delta = abs.toFixed(4);
  return { direction: diff > 0 ? "INCREASE" : "DECREASE", delta };
}

// ── the checklist (the bank's documents discipline) ────────────────────────

export interface ChecklistState {
  readonly presented: boolean;
  readonly verified: boolean;
}

export interface ChecklistTransitionVerdict {
  readonly allowed: boolean;
  readonly reason: string | null;
}

/**
 * THE CHECKLIST MONOTONE LAW (the 0119 floors' own fold): presentation
 * and verification never regress (the stamps are evidence); a
 * verification presupposes presentation. The discrepancy notes are
 * freely recordable — the note is the bank's living record, not a stamp.
 */
export function checklistTransitionValid(
  current: ChecklistState,
  next: ChecklistState,
): ChecklistTransitionVerdict {
  if (next.verified && !next.presented) {
    return {
      allowed: false,
      reason: "an unpresented document is never verified (the 0119 checklist floor)",
    };
  }
  if (current.presented && !next.presented) {
    return {
      allowed: false,
      reason: "presentation never regresses — the checklist stamps are evidence",
    };
  }
  if (current.verified && !next.verified) {
    return {
      allowed: false,
      reason: "verification never regresses — the checklist stamps are evidence",
    };
  }
  return { allowed: true, reason: null };
}
