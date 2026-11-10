import { sql } from "drizzle-orm";

import { type TenantDb } from "../../../infra/db/client";
import { requireTenantContext } from "../../../infra/db/tenant-context";
import { EVENT_TARGET, type CustodyEventKind, type NoteStatus } from "./custody-machine";

/**
 * The AS-OF notes register read (PHASE-027 wave E — the reporting substrate
 * behind `notes.maturity-calendar` / `notes.aging`): a pure, read-only SQL
 * reconstruction of the register AT a date, executed inside the ambient
 * tenant transaction. The live `notes.status` column holds the CURRENT
 * custody state only — it can never answer "what was live at asOf" — so the
 * as-of state is rebuilt from DATED source rows (the fixed-assets
 * reconstruction precedent):
 *
 *   population   notes rows WHERE created_at::date <= asOf (the register as
 *                it existed at asOf — later-created notes never appear);
 *   status       the LATEST custody event with event_date <= asOf determines
 *                the as-of status (its EVENT_TARGET landing state); a note
 *                with no event yet at asOf was IN_CUSTODY (the G-24/G-27
 *                creation state). RECLASSIFY never changes custody (BR-047 —
 *                metadata-only) so it never determines the as-of status.
 *                event_date is the ECONOMIC date (the anchor statements
 *                render by — the append-only log is the truth, so an event
 *                recorded later but dated <= asOf counts at asOf).
 *
 * Same (asOf) ⇒ byte-identical rows: the read derives everything from dated
 * rows, never from mutable current-state snapshots (INV-024's custody ==
 * journal effects makes the reconstruction exact — a resolved-as-of note
 * carries zero NOTES_RECEIVABLE/PAYABLE balance at asOf).
 */

/** One as-of register row (raw note fields + the reconstructed as-of status). */
export interface NotesAsOfRow {
  id: string;
  kind: "CHEQUE" | "PROMISSORY_NOTE";
  direction: "RECEIVED" | "ISSUED";
  partnerId: string;
  number: string | null;
  issuingBank: string | null;
  amount: string;
  currency: string;
  exchangeRate: string;
  issueDate: string | null;
  maturityDate: string;
  /** The CURRENT custody state (contrast/debug only — never the as-of answer). */
  status: string;
  /** The reconstructed as-of status (the latest custody event <= asOf). */
  statusAsOf: NoteStatus;
  sourceType: string | null;
  sourceId: string | null;
  journalEntryId: string | null;
  note: string | null;
  noteAr: string | null;
  createdAt: string;
}

function tenantTx(): TenantDb {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("notes as-of read requires an ambient tenant scope");
  }
  return context.tx;
}

/**
 * The as-of register: every note created <= asOf with its as-of status
 * reconstructed from the custody log (LEFT JOIN LATERAL the latest custody
 * event <= asOf per note — the deterministic date anchor; see the header).
 * Ordered by (maturity_date, id) exactly like the store's register reads.
 */
export async function notesAsOf(input: { asOf: string; limit: number }): Promise<NotesAsOfRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT n.id, n.kind, n.direction, n.partner_id AS "partnerId", n.number,
      n.issuing_bank AS "issuingBank", n.amount::text AS amount, n.currency,
      n.exchange_rate::text AS "exchangeRate", n.issue_date::text AS "issueDate",
      n.maturity_date::text AS "maturityDate", n.status,
      n.source_type AS "sourceType", n.source_id AS "sourceId",
      n.journal_entry_id AS "journalEntryId", n.note, n.note_ar AS "noteAr",
      n.created_at::text AS "createdAt", le.event_kind AS "lastEventKind"
    FROM notes n
    LEFT JOIN LATERAL (
      SELECT e.event_kind
      FROM note_events e
      WHERE e.note_id = n.id
        AND e.event_date <= ${input.asOf}
        AND e.event_kind <> 'RECLASSIFY'
      ORDER BY e.event_date DESC, e.created_at DESC, e.id DESC
      LIMIT 1
    ) le ON true
    WHERE n.created_at::date <= ${input.asOf}
    ORDER BY n.maturity_date, n.id
    LIMIT ${input.limit}
  `);
  const parsed = rows.rows as unknown as Array<Omit<NotesAsOfRow, "statusAsOf"> & {
    lastEventKind: string | null;
  }>;
  // The LATERAL already picked the latest custody event <= asOf, so its
  // EVENT_TARGET IS the as-of status — the same fold `asOfStatusOf` walks
  // over the full event list (kept in one place: the custody machine).
  return parsed.map((row) => {
    const target =
      row.lastEventKind === null ? undefined : EVENT_TARGET[row.lastEventKind as CustodyEventKind];
    const { lastEventKind: _lastEventKind, ...note } = row;
    return { ...note, statusAsOf: target ?? "IN_CUSTODY" };
  });
}

/**
 * The pure as-of status fold (exported for the reporting queries + specs):
 * walk the note's custody events chronologically — the LAST custody event's
 * landing state wins; RECLASSIFY never changes custody (BR-047); no event at
 * all ⇒ IN_CUSTODY (the G-24/G-27 creation state). Callers pass the events
 * with event_date <= asOf (the SQL read pre-filters); events of other notes
 * are skipped defensively so the fold is safe over a mixed list.
 */
export function asOfStatusOf(
  note: Pick<NotesAsOfRow, "id">,
  events: readonly { noteId: string; eventKind: string; eventDate: string }[],
): NoteStatus {
  let status: NoteStatus = "IN_CUSTODY";
  for (const event of events) {
    if (event.noteId !== note.id) continue;
    const target = EVENT_TARGET[event.eventKind as CustodyEventKind];
    if (target !== undefined) {
      status = target;
    }
  }
  return status;
}
