/**
 * PHASE-051 (W-35 — T-07, 2026-11-25) THE DOCUMENTARY COLLECTIONS FOLD
 * (L-02, the plan's own unit-first law: the pure layer FIRST, the
 * property tests beside it, then the service that renders its verdicts
 * VERBATIM — zero parallel computation):
 *
 *   THE LADDER (the 0119 status vocabulary, the collecting bank's own
 *   register): OPEN → PRESENTED (the documents handed to the drawee's
 *   bank) → ACCEPTED (the usance act — the drawee's signed undertaking)
 *   → PAID (the settlement — the money lands) | CANCELLED (the tenant's
 *   withdrawal before the presentation). PAID and CANCELLED are
 *   TERMINAL: no move leaves them (the register is the audit trail —
 *   S/I/U, NO DELETE).
 *
 *   THE TERMS GATE (the D/P vs D/A settlement windows — the phase doc's
 *   own pair): a DOCUMENTS-AGAINST-PAYMENT collection pays AT SIGHT —
 *   the presentation leads DIRECTLY to the settlement (it never
 *   accepts; there is no draft to accept); a DOCUMENTS-AGAINST-
 *   ACCEPTANCE collection is a USANCE instrument — the acceptance
 *   PRECEDES the settlement (the drawee's undertaking to pay at
 *   maturity), and the register carries its maturity date from birth
 *   (the 0119 usance floor: a D/A row with a NULL due_date never
 *   inserts). The settlement itself is the bank's own fact — the fold
 *   records no maturity gate on the settle act (an early settlement is
 *   a real banking event: the drawee may pay before maturity; the
 *   register records the fact with its reference — the declared
 *   interpretation, recorded here at the claim site).
 *
 *   THE STAMP LAW'S EXIT (the 0119 XOR floors' own reading — the
 *   margin-exit law's sibling derivation): the presentation stamp
 *   exists only on PRESENTED-or-later rows and the floor makes a
 *   CANCELLED row carry NO stamps — so the register's stamps are
 *   MONOTONE EVIDENCE that never un-stamp. The cancellation window is
 *   therefore OPEN ONLY: a presented collection is inside the banking
 *   channel and its exit is the settlement (a refused presentation is
 *   the bank's own fact, recorded on the notes — the register's
 *   five-rung vocabulary is 0119's own floor, never widened here); an
 *   accepted collection carries the drawee's signed undertaking — its
 *   only exit is the settlement.
 *
 *   THE SETTLEMENT PAIR (the 0119 XOR floor): settled_at and
 *   settlement_ref exist TOGETHER on the paid paths and are absent
 *   TOGETHER everywhere else — the settlement linkage records the
 *   treasury fact (the reference names it; the money itself lands
 *   through the EXISTING receipts discipline — the matrix's own
 *   wording; the register carries NO GL entry, the non-ledger-document
 *   law's trade face).
 *
 *   PURE: no clock, no store, no SQL — the service renders this
 *   module's verdicts VERBATIM.
 */

/** The 0119 status vocabulary (ck_documentary_collections_status' list). */
export const COLLECTION_STATUSES = [
  "OPEN",
  "PRESENTED",
  "ACCEPTED",
  "PAID",
  "CANCELLED",
] as const;
export type CollectionStatus = (typeof COLLECTION_STATUSES)[number];

/** The 0119 terms vocabulary (ck_documentary_collections_terms' list). */
export const COLLECTION_TERMS = ["D/P", "D/A"] as const;
export type CollectionTerms = (typeof COLLECTION_TERMS)[number];

/** The lifecycle acts the service exposes (the fold's move vocabulary). */
export const COLLECTION_MOVES = [
  "present",
  "accept",
  "settle",
  "cancel",
] as const;
export type CollectionMove = (typeof COLLECTION_MOVES)[number];

/** The verdict shape every act renders (the lc-lifecycle precedent). */
export interface CollectionMoveVerdict {
  readonly allowed: boolean;
  readonly to: CollectionStatus | null;
  readonly reason: string | null;
}

/**
 * THE MOVE MATRIX — the total fold (every status × move × terms carries
 * a verdict; the property test walks the full product). The terms gate
 * the two usance acts: `accept` rides D/A only, and `settle` enters
 * from PRESENTED on D/P (at sight) but from ACCEPTED on D/A (the
 * acceptance precedes the payment).
 */
export function nextCollectionMove(
  status: CollectionStatus,
  move: CollectionMove,
  terms: CollectionTerms,
): CollectionMoveVerdict {
  // The terms-free spine first (the presentation and the OPEN cancel).
  if (status === "OPEN" && move === "present") {
    return { allowed: true, to: "PRESENTED", reason: null };
  }
  if (status === "OPEN" && move === "cancel") {
    return { allowed: true, to: "CANCELLED", reason: null };
  }
  if (status === "PAID" || status === "CANCELLED") {
    return {
      allowed: false,
      to: null,
      reason: `the collection is ${status} — the register is terminal (the audit trail is never rewritten)`,
    };
  }
  // The terms-gated usance acts (the D/P vs D/A settlement windows).
  if (move === "accept") {
    if (status !== "PRESENTED") {
      return {
        allowed: false,
        to: null,
        reason: `the presentation precedes the acceptance — a collection in ${status} carries no acceptance window`,
      };
    }
    if (terms !== "D/A") {
      return {
        allowed: false,
        to: null,
        reason:
          "a documents-against-payment collection pays at sight — it never accepts (there is no draft to accept)",
      };
    }
    return { allowed: true, to: "ACCEPTED", reason: null };
  }
  if (move === "settle") {
    if (status === "PRESENTED" && terms === "D/P") {
      return { allowed: true, to: "PAID", reason: null };
    }
    if (status === "PRESENTED" && terms === "D/A") {
      return {
        allowed: false,
        to: null,
        reason:
          "a usance collection accepts before it settles — the drawee's acceptance precedes the payment",
      };
    }
    if (status === "ACCEPTED") {
      // The acceptance path only exists on D/A (the terms gate above),
      // so ACCEPTED ⇒ D/A by construction.
      return { allowed: true, to: "PAID", reason: null };
    }
    return {
      allowed: false,
      to: null,
      reason: `the presentation precedes the settlement — a collection in ${status} carries no settlement window`,
    };
  }
  if (move === "present") {
    return {
      allowed: false,
      to: null,
      reason: `the collection is already ${status} — the presentation stamp exists only on its own rung`,
    };
  }
  // move === "cancel" on PRESENTED or ACCEPTED — the stamp law's exit.
  return {
    allowed: false,
    to: null,
    reason:
      status === "PRESENTED"
        ? "the presentation is evidence — the register's stamps never regress; a presented collection's exit is the settlement"
        : "the acceptance is the drawee's signed undertaking — an accepted collection's only exit is the settlement",
  };
}

/** The usance floor's verdict (an amendment-shaped law, rendered at create). */
export interface CollectionUsanceVerdict {
  readonly valid: boolean;
  readonly reason: string | null;
}

/**
 * THE USANCE FLOOR (the 0119 constraint's own fold): a
 * documents-against-acceptance collection is a TIME collection — it
 * carries its maturity date from birth; a documents-against-payment
 * collection pays at sight and its due_date stays free (an optional
 * expected-presentation hint, never a maturity).
 */
export function collectionUsanceValid(
  terms: CollectionTerms,
  dueDate: string | null,
): CollectionUsanceVerdict {
  if (terms === "D/A" && (dueDate === null || dueDate === "")) {
    return {
      valid: false,
      reason: "a documents-against-acceptance collection is a time collection — it carries its maturity date (the 0119 usance floor)",
    };
  }
  return { valid: true, reason: null };
}

/** The settlement pair's verdict (the 0119 XOR floor's own fold). */
export interface SettlementPairVerdict {
  readonly valid: boolean;
  readonly reason: string | null;
}

/**
 * THE SETTLEMENT PAIR LAW: settled_at and settlement_ref exist TOGETHER
 * — the settlement act demands its reference (the linkage that names
 * the treasury fact); neither lands alone.
 */
export function settlementPairValid(
  settledAt: string | null,
  settlementRef: string | null,
): SettlementPairVerdict {
  if ((settledAt === null) !== (settlementRef === null)) {
    return {
      valid: false,
      reason: "the settlement linkage is a pair — settled_at and settlement_ref land together (the 0119 XOR floor)",
    };
  }
  return { valid: true, reason: null };
}

/**
 * THE SETTLEMENT WINDOW (the phase doc's own D/P vs D/A pair, as data):
 * the statuses from which the settle act may enter, per terms — D/P
 * settles from PRESENTED (at sight); D/A settles from ACCEPTED (the
 * maturity). The service's settle act and the board's aging surfaces
 * read this shape VERBATIM.
 */
export function settlementWindow(terms: CollectionTerms): readonly CollectionStatus[] {
  return terms === "D/P" ? ["PRESENTED"] : ["ACCEPTED"];
}
