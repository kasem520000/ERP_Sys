import { InvalidCustodyTransitionError } from "../domain/notes-errors";

/**
 * The custody state machine (PHASE-027 T2; BR-047 + register §C note_status):
 * custody moves are physical; the ledger moves only at money moments. This
 * is the LEGAL transition table — the single source both the services and
 * the transition-matrix test consume (illegal transitions → typed
 * INVALID_CUSTODY_TRANSITION).
 *
 * RECEIVED (a note we hold against our AR):
 *   IN_CUSTODY ──endorse──▶ ENDORSED_OUT   (no journal — BR-047)
 *   IN_CUSTODY ──deposit──▶ DEPOSITED      (no journal; stores cash_account_id)
 *   IN_CUSTODY/ENDORSED_OUT/DEPOSITED ──collect──▶ COLLECTED  (G-25 + treasury movement)
 *   IN_CUSTODY/ENDORSED_OUT/DEPOSITED ──dishonor─▶ DISHONORED (G-26 + exact AR restore)
 *   IN_CUSTODY/DEPOSITED ──discount──▶ DISCOUNTED (proceeds + explicit fee)
 *   IN_CUSTODY/ENDORSED_OUT/DEPOSITED ──return───▶ RETURNED  (restore, no reason/fee)
 *
 * ISSUED (a note we gave out against our AP — mirrored semantics, the shared
 * enum per register §C):
 *   IN_CUSTODY ──collect──▶ COLLECTED  (the paid-at-maturity mirror: DR NOTES_PAYABLE · CR CASH)
 *   IN_CUSTODY ──dishonor─▶ DISHONORED (restore the AP open item exactly)
 *   IN_CUSTODY ──return───▶ RETURNED   (restore the AP open item, no reason/fee)
 *
 * A note is created IN_CUSTODY by its G-24/G-27 entry; the resolved statuses
 * (COLLECTED/DISHONORED/DISCOUNTED/RETURNED) are terminal (INV-024: zero
 * NOTES_RECEIVABLE/PAYABLE balance there).
 */

export type NoteStatus =
  | "IN_CUSTODY"
  | "ENDORSED_OUT"
  | "DEPOSITED"
  | "COLLECTED"
  | "DISHONORED"
  | "DISCOUNTED"
  | "RETURNED";

export type CustodyEventKind =
  | "ENDORSE"
  | "DEPOSIT"
  | "COLLECT"
  | "DISHONOR"
  | "DISCOUNT"
  | "RETURN";

/** The status an event lands the note in. */
export const EVENT_TARGET: Readonly<Record<CustodyEventKind, NoteStatus>> = {
  ENDORSE: "ENDORSED_OUT",
  DEPOSIT: "DEPOSITED",
  COLLECT: "COLLECTED",
  DISHONOR: "DISHONORED",
  DISCOUNT: "DISCOUNTED",
  RETURN: "RETURNED",
};

/** Legal source statuses per (direction, event) — everything else 422s. */
export const LEGAL_TRANSITIONS: Readonly<
  Record<"RECEIVED" | "ISSUED", Partial<Record<CustodyEventKind, readonly NoteStatus[]>>>
> = {
  RECEIVED: {
    ENDORSE: ["IN_CUSTODY"],
    DEPOSIT: ["IN_CUSTODY"],
    COLLECT: ["IN_CUSTODY", "ENDORSED_OUT", "DEPOSITED"],
    DISHONOR: ["IN_CUSTODY", "ENDORSED_OUT", "DEPOSITED"],
    DISCOUNT: ["IN_CUSTODY", "DEPOSITED"],
    RETURN: ["IN_CUSTODY", "ENDORSED_OUT", "DEPOSITED"],
  },
  ISSUED: {
    COLLECT: ["IN_CUSTODY"],
    DISHONOR: ["IN_CUSTODY"],
    RETURN: ["IN_CUSTODY"],
  },
};

/** The terminal statuses (INV-024: zero note balance side). */
export const TERMINAL_STATUSES: readonly NoteStatus[] = [
  "COLLECTED",
  "DISHONORED",
  "DISCOUNTED",
  "RETURNED",
];

/** The live statuses (full note balance on the purpose side — RC-11 folds these). */
export const LIVE_STATUSES: readonly NoteStatus[] = ["IN_CUSTODY", "ENDORSED_OUT", "DEPOSITED"];

export function assertTransition(input: {
  noteId: string;
  direction: "RECEIVED" | "ISSUED";
  eventKind: CustodyEventKind;
  from: string;
}): NoteStatus {
  const legal = LEGAL_TRANSITIONS[input.direction][input.eventKind];
  if (legal === undefined || !legal.includes(input.from as NoteStatus)) {
    throw new InvalidCustodyTransitionError({
      noteId: input.noteId,
      eventKind: input.eventKind,
      from: input.from,
      direction: input.direction,
    });
  }
  return EVENT_TARGET[input.eventKind];
}
