import { Inject, Injectable } from "@nestjs/common";

import { AuditService } from "../../audit/api/audit";
import * as store from "../infrastructure/distribution.store";
import {
  VisitDocumentNotFoundError,
  VisitNotFoundError,
  VisitStateError,
} from "../domain/distribution-errors";

/**
 * Visit service (PHASE-017 T7): the visit board + the PLANNED →
 * COMPLETED/SKIPPED/MISSED lifecycle. Actuals are recorded from sales
 * documents (the completion links) or explicit check-ins — planning data
 * only, no operation here posts anything (CAPABILITY_MATRIX §2.4).
 *
 * The conditional UPDATEs in the store are the exactly-once anchors: a
 * double check-in, a completion of a finished visit, or a re-skip all
 * return false and surface as typed VisitStateError.
 */

@Injectable()
export class VisitService {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  /** The visit board — customer + route names joined for the UI. */
  async list(filter: { date?: string; routeId?: string; status?: string; limit?: number } = {}) {
    return store.listVisits({
      date: filter.date,
      routeId: filter.routeId,
      status: filter.status,
      limit: filter.limit ?? 200,
    });
  }

  async find(id: string) {
    const visit = await store.findVisitById(id);
    if (visit === undefined) throw new VisitNotFoundError(id);
    return visit;
  }

  /** Explicit check-in (PLANNED only; double check-in is a typed state
   * error). The rep stamp is the rep who actually showed up, when known. */
  async checkIn(
    visitId: string,
    input: { salesRepId?: string | null; note?: string | null; actorId: string | null },
  ) {
    const visit = await this.find(visitId);
    const flipped = await store.checkInVisit(visitId, {
      salesRepId: input.salesRepId ?? null,
      note: input.note ?? null,
    });
    if (!flipped) {
      if (visit.checkedInAt !== null) {
        throw new VisitStateError(`visit ${visitId} is already checked in`);
      }
      throw new VisitStateError(`visit ${visitId} is ${visit.status} — only PLANNED visits check in`);
    }
    const checkedIn = (await store.findVisitById(visitId))!;
    await this.audit.record({
      action: "distribution.visit_checked_in",
      entityType: "visit",
      entityId: visitId,
      actorId: input.actorId ?? undefined,
      after: { plannedDate: checkedIn.plannedDate, salesRepId: checkedIn.salesRepId },
    });
    return checkedIn;
  }

  /** Completion: stamps checked_out_at + COMPLETED, optionally linking the
   * sales documents that evidence the visit (each id EXISTS-validated). */
  async complete(
    visitId: string,
    input: {
      salesInvoiceId?: string | null;
      creditNoteId?: string | null;
      receiptId?: string | null;
      note?: string | null;
      actorId: string | null;
    },
  ) {
    const visit = await this.find(visitId);
    if (input.salesInvoiceId !== undefined && input.salesInvoiceId !== null) {
      const exists = await store.salesInvoiceExists(input.salesInvoiceId);
      if (!exists) throw new VisitDocumentNotFoundError("salesInvoiceId", input.salesInvoiceId);
    }
    if (input.creditNoteId !== undefined && input.creditNoteId !== null) {
      const exists = await store.creditNoteExists(input.creditNoteId);
      if (!exists) throw new VisitDocumentNotFoundError("creditNoteId", input.creditNoteId);
    }
    if (input.receiptId !== undefined && input.receiptId !== null) {
      const exists = await store.receiptExists(input.receiptId);
      if (!exists) throw new VisitDocumentNotFoundError("receiptId", input.receiptId);
    }
    const flipped = await store.completeVisit(visitId, {
      salesInvoiceId: input.salesInvoiceId ?? null,
      creditNoteId: input.creditNoteId ?? null,
      receiptId: input.receiptId ?? null,
      note: input.note ?? null,
    });
    if (!flipped) {
      throw new VisitStateError(`visit ${visitId} is ${visit.status} — only PLANNED visits complete`);
    }
    const completed = (await store.findVisitById(visitId))!;
    await this.audit.record({
      action: "distribution.visit_completed",
      entityType: "visit",
      entityId: visitId,
      actorId: input.actorId ?? undefined,
      after: {
        plannedDate: completed.plannedDate,
        salesInvoiceId: completed.salesInvoiceId,
        creditNoteId: completed.creditNoteId,
        receiptId: completed.receiptId,
      },
    });
    return completed;
  }

  /** Explicit skip (PLANNED → SKIPPED) — the rep chose not to work the stop. */
  async skip(visitId: string, input: { note?: string | null; actorId: string | null }) {
    const visit = await this.find(visitId);
    const flipped = await store.skipVisit(visitId, input.note ?? null);
    if (!flipped) {
      throw new VisitStateError(`visit ${visitId} is ${visit.status} — only PLANNED visits skip`);
    }
    const skipped = (await store.findVisitById(visitId))!;
    await this.audit.record({
      action: "distribution.visit_skipped",
      entityType: "visit",
      entityId: visitId,
      actorId: input.actorId ?? undefined,
      after: { plannedDate: skipped.plannedDate, note: skipped.note },
    });
    return skipped;
  }

  /**
   * Report-hygiene sweep (compliance): every PLANNED visit strictly before
   * `date` that never got a check-in flips to MISSED, so the visit board
   * and the route_visit_compliance report carry closed days. Batch audited
   * (one event anchored on the first flipped row — the sweep pattern).
   */
  async markMissedVisits(date: string) {
    const flippedIds = await store.markVisitsMissed(date);
    if (flippedIds.length > 0) {
      await this.audit.record({
        action: "distribution.visits_marked_missed",
        entityType: "visit",
        entityId: flippedIds[0]!,
        after: { beforeDate: date, missed: flippedIds.length, visitIds: flippedIds },
      });
    }
    return { beforeDate: date, missed: flippedIds.length, visitIds: flippedIds };
  }
}
