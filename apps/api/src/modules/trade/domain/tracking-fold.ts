/**
 * PHASE-051 (W-36 — T-13, 2026-11-25) THE SHIPMENT TRACKING FOLD (L-11,
 * D-14 — the plan's own unit-first law, the pure layer FIRST with the
 * property tests beside it, then the service that renders its verdicts
 * VERBATIM — zero parallel computation):
 *
 *   THE MILESTONE VOCABULARY (the 0122 carrier ladder): booked →
 *   departed → arrived → cleared → delivered — the shipment's own
 *   monotone ladder, ranks 0…4. Every driven document carries its own
 *   `shipment_status` rung (the bills of lading · the packing lists ·
 *   the customs declarations — the 0120/0121 driven columns, all
 *   defaulting to BOOKED): the fold drives them all with ONE law.
 *
 *   THE MONOTONE LADDER (D-14's own wording: «an event never regresses
 *   a document's status»): an event STRICTLY ABOVE the document's
 *   current rung ADVANCES it; an event ON the current rung is the
 *   idempotent re-assert (the event records — the carrier's repeated
 *   milestone is a real fact — the status stays, a NOOP); an event
 *   BELOW the current rung is REFUSED as a drive (the event still
 *   records in the append-only log — the carrier's late-arriving facts
 *   are the truth — but the document's status NEVER moves backward;
 *   the 0122 comment's own law: "this table is only the append-only
 *   log", the monotone law lives HERE).
 *
 *   THE UNKNOWN-EVENT TYPED REFUSAL (D-14's own demand): a milestone
 *   outside the vocabulary refuses the whole act — the typed
 *   `TRACKING_EVENT_INVALID` at the service floor (the 0122 CHECK is
 *   the DB's authority of last resort; the fold's verdict is the
 *   caller's). An unknown CURRENT status likewise refuses (the
 *   vocabulary floor never silently passes).
 *
 *   PURE: no clock, no store, no SQL — the service renders this
 *   module's verdicts VERBATIM (the drive's CAS writes carry the
 *   fold's own from/to pair; the board and the W-39 surface read the
 *   same verdicts' effects).
 */

/** The 0122 milestone vocabulary (ck_shipment_tracking_events_milestone's list). */
export const SHIPMENT_MILESTONES = [
  "BOOKED",
  "DEPARTED",
  "ARRIVED",
  "CLEARED",
  "DELIVERED",
] as const;
export type ShipmentMilestone = (typeof SHIPMENT_MILESTONES)[number];

/** The monotone ladder's ranks (BOOKED = 0 … DELIVERED = 4). */
export const MILESTONE_RANKS: Readonly<Record<ShipmentMilestone, number>> = Object.freeze({
  BOOKED: 0,
  DEPARTED: 1,
  ARRIVED: 2,
  CLEARED: 3,
  DELIVERED: 4,
});

/** The rank of a milestone value — null when outside the vocabulary. */
export function milestoneRank(value: string): number | null {
  const rank = (MILESTONE_RANKS as Record<string, number | undefined>)[value];
  return rank === undefined ? null : rank;
}

/** The drive's outcome class (the fold's own verdict shape). */
export type DriveOutcome = "ADVANCE" | "NOOP" | "REFUSED";

export interface DriveVerdict {
  readonly outcome: DriveOutcome;
  /** The document's status BEFORE the event (the CAS write's pin). */
  readonly from: ShipmentMilestone;
  /** The document's status AFTER the event — null on NOOP/REFUSED (the
   * document never moves; null on the unknown shapes too). */
  readonly to: ShipmentMilestone | null;
  readonly reason: string | null;
}

/**
 * THE TOTAL STATUS × EVENT MATRIX — every (document rung × milestone)
 * pair carries a verdict (the property test walks the full product):
 * strictly above → ADVANCE (the CAS moves the rung to the event's);
 * the diagonal → NOOP (the idempotent re-assert); strictly below →
 * REFUSED (the monotone ladder — the status never regresses); unknown
 * shapes on either side → the typed vocabulary refusal.
 */
export function driveDocumentStatus(current: string, event: string): DriveVerdict {
  const currentRank = milestoneRank(current);
  const eventRank = milestoneRank(event);
  if (currentRank === null) {
    return {
      outcome: "REFUSED",
      from: "BOOKED",
      to: null,
      reason: `the document's status "${current}" is outside the carrier ladder ${SHIPMENT_MILESTONES.join("/")} (the vocabulary floor never silently passes)`,
    };
  }
  if (eventRank === null) {
    return {
      outcome: "REFUSED",
      from: current as ShipmentMilestone,
      to: null,
      reason: `the milestone "${event}" is outside the carrier ladder ${SHIPMENT_MILESTONES.join("/")} (the unknown-event typed refusal — D-14's own demand)`,
    };
  }
  if (eventRank > currentRank) {
    return { outcome: "ADVANCE", from: current as ShipmentMilestone, to: event as ShipmentMilestone, reason: null };
  }
  if (eventRank === currentRank) {
    return {
      outcome: "NOOP",
      from: current as ShipmentMilestone,
      to: null,
      reason: `the ${event} event re-asserts the document's own rung — the event records, the status stays (the idempotent diagonal)`,
    };
  }
  return {
    outcome: "REFUSED",
    from: current as ShipmentMilestone,
    to: null,
    reason: `the monotone ladder — a ${event} event never regresses a ${current} document's status (the event records in the append-only log, the drive is refused)`,
  };
}

/** True when the milestone is inside the vocabulary (the service's
 * typed pre-check — the 0122 CHECK's caller-side face). */
export function isShipmentMilestone(value: string): value is ShipmentMilestone {
  return milestoneRank(value) !== null;
}
