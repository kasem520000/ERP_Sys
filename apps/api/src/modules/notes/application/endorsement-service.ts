import { Inject, Injectable } from "@nestjs/common";

import { AuditService } from "../../audit/api/audit";
import { invalidatePdcCalendar } from "./pdc-calendar-queries";
import { assertTransition } from "./custody-machine";
import {
  findNoteById,
  insertNoteEvent,
  updateNoteStatus,
  type NoteEventRow,
  type NoteRow,
} from "../infrastructure/notes.store";
import { NoteAlreadyResolvedError, NoteNotFoundError } from "../domain/notes-errors";

/**
 * PHASE-027 T6 — endorsement (BR-047): IN_CUSTODY → ENDORSED_OUT moves
 * CUSTODY ONLY — zero journal rows may appear (the golden ledger-delta test
 * asserts the zero). The note stays our NOTES_RECEIVABLE balance until the
 * chain resolves by COLLECT / DISHONOR / RETURN, recorded when known.
 */
@Injectable()
export class EndorsementService {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  async endorse(input: {
    noteId: string;
    eventDate: string;
    endorsee?: string | null;
    memo?: string | null;
    memoAr?: string | null;
    actorId: string | null;
  }): Promise<{ note: NoteRow; event: NoteEventRow }> {
    const note = await findNoteById(input.noteId);
    if (note === undefined) {
      throw new NoteNotFoundError(input.noteId);
    }
    if (note.status === "ENDORSED_OUT") {
      throw new NoteAlreadyResolvedError({ noteId: note.id, eventKind: "ENDORSE", status: note.status });
    }
    assertTransition({ noteId: note.id, direction: note.direction, eventKind: "ENDORSE", from: note.status });
    const updated = (await updateNoteStatus(note.id, "ENDORSED_OUT")) ?? note;
    // No journal (BR-047 — journal_entry_id is NULL; the shape CHECK enforces
    // it at the row level too).
    const event = await insertNoteEvent({
      noteId: note.id,
      eventKind: "ENDORSE",
      eventDate: input.eventDate,
      refs: { endorsee: input.endorsee ?? null },
      journalEntryId: null,
      memo: input.memo ?? null,
      memoAr: input.memoAr ?? null,
      createdBy: input.actorId,
    });
    await this.audit.record({
      action: "notes.note_endorsed",
      entityType: "note",
      entityId: note.id,
      actorId: input.actorId ?? undefined,
      before: { status: note.status },
      after: { status: "ENDORSED_OUT", endorsee: input.endorsee ?? null },
    });
    invalidatePdcCalendar();
    return { note: updated, event };
  }
}
