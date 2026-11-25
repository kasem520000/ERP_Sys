import { Inject, Injectable } from "@nestjs/common";

import { AuditService } from "../../audit/api/audit";

import * as store from "../infrastructure/trade.store";
import {
  driveDocumentStatus,
  isShipmentMilestone,
  type DriveVerdict,
  type ShipmentMilestone,
} from "../domain/tracking-fold";
import {
  BlRecordNotFoundError,
  DeclarationLinkNotFoundError,
  TrackingEventInvalidError,
} from "../domain/trade-errors";

/**
 * PHASE-051 (W-36 — T-13, 2026-11-25) THE SHIPMENT TRACKING ENGINE
 * (L-11, D-14): the carrier milestone log — the append-only event
 * store anchored on the bill of lading (THE SHIPMENT'S IDENTITY) —
 * whose events DRIVE the document statuses through THE PURE FOLD
 * rendered VERBATIM (zero parallel computation: the fold decides,
 * the CAS stamps execute).
 *
 *   THE APPEND: the event records (the carrier's facts are the truth —
 *   the late-arriving milestones included; the log is append-only:
 *   S/I/U, NO DELETE); the milestone vocabulary is the typed
 *   pre-check (D-14's unknown-event refusal — the 0122 CHECK is the
 *   DB's authority of last resort); the optional declaration link
 *   probes with the typed 404 (the read-only documented contract —
 *   the declarations ENGINE is W-37's own wave).
 *
 *   THE DRIVE (acceptance #7's engine arms): the event drives the
 *   linked bills of lading (the anchor), the packing lists under it,
 *   and the event's OWN linked declaration — each through the SAME
 *   fold verdict (the total status × event matrix): an ADVANCE moves
 *   the rung with the race-safe CAS (the from-rung pinned — a raced
 *   status never regresses); the idempotent diagonal and the
 *   regressing events NEVER move the document (the monotone ladder —
 *   an event never regresses a document's status; the event still
 *   records, the refusal is the DRIVE's, never the log's). The
 *   documents' `shipment_status` columns are the fold's OWN OUTPUT —
 *   no other write path exists (the transport service exposes no
 *   status write; the W-39 board reads the same columns).
 *
 *   ONE ambient transaction per act (INV-018): the event, the CAS
 *   stamps and the audit record commit together or not at all. NO
 *   journal, NO ledger effect (the tracking events are logistics
 *   evidence — the non-ledger-document law's trade face; the
 *   reservations law rides it).
 */

@Injectable()
export class TrackingService {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  // ── the event log (the reads) ─────────────────────────────────────────

  async listEvents(filter: { billOfLadingId?: string; declarationId?: string }): Promise<store.TrackingEventRow[]> {
    return store.listTrackingEvents({
      billOfLadingId: filter.billOfLadingId,
      declarationId: filter.declarationId,
      limit: 200,
    });
  }

  // ── the append + THE DRIVE (the fold rendered VERBATIM) ───────────────

  async appendEvent(input: {
    billOfLadingId: string;
    milestone: string;
    eventAt: string;
    carrierRef?: string | null;
    location?: string | null;
    declarationId?: string | null;
    note?: string | null;
    noteAr?: string | null;
    actorId: string | null;
  }): Promise<{
    event: store.TrackingEventRow;
    /** The drive's own summary — the fold's verdicts, per document. */
    drive: {
      bl: { from: ShipmentMilestone; to: ShipmentMilestone | null; outcome: string };
      packingLists: { id: string; plNo: string; from: ShipmentMilestone; to: ShipmentMilestone | null; outcome: string }[];
      declaration: { id: string; from: ShipmentMilestone; to: ShipmentMilestone | null; outcome: string } | null;
    };
  }> {
    // The anchor (the shipment's identity — the typed 404).
    const bl = await store.findBlById(input.billOfLadingId);
    if (bl === undefined) {
      throw new BlRecordNotFoundError({ blId: input.billOfLadingId });
    }
    // THE MILESTONE VOCABULARY (D-14's unknown-event typed refusal —
    // the caller's face of the 0122 CHECK).
    if (!isShipmentMilestone(input.milestone)) {
      throw new TrackingEventInvalidError({
        field: "milestone",
        reason: `the carrier ladder is BOOKED/DEPARTED/ARRIVED/CLEARED/DELIVERED, got "${input.milestone}"`,
      });
    }
    // The event's own timestamp (the carrier's fact — recorded as
    // reported; an ISO datetime is required).
    if (!/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(input.eventAt)) {
      throw new TrackingEventInvalidError({
        field: "eventAt",
        reason: `an ISO datetime is required, got "${input.eventAt}"`,
      });
    }
    for (const [field, value] of [
      ["carrierRef", input.carrierRef ?? null],
      ["location", input.location ?? null],
    ] as const) {
      if (value !== null && (value.trim().length === 0 || value.length > 200)) {
        throw new TrackingEventInvalidError({ field, reason: "1…200 chars are required when present" });
      }
    }
    // The optional declaration link (the typed 404 — the read-only
    // documented contract).
    let declaration: { id: string; shipmentStatus: string } | null = null;
    if (input.declarationId !== undefined && input.declarationId !== null) {
      const probed = await store.findDeclarationShipmentStatus(input.declarationId);
      if (probed === undefined) {
        throw new DeclarationLinkNotFoundError({
          declarationId: input.declarationId,
          blId: bl.id,
        });
      }
      declaration = probed;
    }

    // THE APPEND (the log is the truth — the event records).
    const event = await store.insertTrackingEvent({
      billOfLadingId: bl.id,
      declarationId: declaration?.id ?? null,
      milestone: input.milestone,
      eventAt: input.eventAt,
      carrierRef: input.carrierRef?.trim() || null,
      location: input.location?.trim() || null,
      note: input.note ?? null,
      noteAr: input.noteAr ?? null,
      actorId: input.actorId,
    });

    // THE DRIVE (the fold's verdicts rendered VERBATIM — the anchor
    // B/L, the packing lists under it, the event's own declaration).
    const driveBl = (current: string): DriveVerdict => driveDocumentStatus(current, event.milestone);
    const blVerdict = driveBl(bl.shipmentStatus);
    if (blVerdict.outcome === "ADVANCE") {
      await store.advanceBlShipmentStatus({
        id: bl.id,
        from: blVerdict.from,
        to: blVerdict.to!,
      });
    }
    const packingLists = await store.listPackingLists({ billOfLadingId: bl.id, limit: 100 });
    const packingDrives: {
      id: string;
      plNo: string;
      from: ShipmentMilestone;
      to: ShipmentMilestone | null;
      outcome: string;
    }[] = [];
    for (const packing of packingLists) {
      const verdict = driveBl(packing.shipmentStatus);
      if (verdict.outcome === "ADVANCE") {
        await store.advancePackingListShipmentStatus({
          id: packing.id,
          from: verdict.from,
          to: verdict.to!,
        });
      }
      packingDrives.push({
        id: packing.id,
        plNo: packing.plNo,
        from: verdict.from,
        to: verdict.to,
        outcome: verdict.outcome,
      });
    }
    let declarationDrive: { id: string; from: ShipmentMilestone; to: ShipmentMilestone | null; outcome: string } | null = null;
    if (declaration !== null) {
      const verdict = driveBl(declaration.shipmentStatus);
      if (verdict.outcome === "ADVANCE") {
        await store.advanceDeclarationShipmentStatus({
          id: declaration.id,
          from: verdict.from,
          to: verdict.to!,
        });
      }
      declarationDrive = {
        id: declaration.id,
        from: verdict.from,
        to: verdict.to,
        outcome: verdict.outcome,
      };
    }

    await this.audit.record({
      action: "trade.tracking_event_recorded",
      entityType: "shipment_tracking_events",
      entityId: event.id,
      actorId: input.actorId ?? undefined,
      after: {
        billOfLadingId: event.billOfLadingId,
        milestone: event.milestone,
        eventAt: event.eventAt,
        declarationId: event.declarationId,
        drive: {
          bl: { from: blVerdict.from, to: blVerdict.to, outcome: blVerdict.outcome },
          packingLists: packingDrives.map((row) => ({ id: row.id, to: row.to, outcome: row.outcome })),
          declaration: declarationDrive === null ? null : { id: declarationDrive.id, to: declarationDrive.to, outcome: declarationDrive.outcome },
        },
      },
    });
    return {
      event,
      drive: {
        bl: { from: blVerdict.from, to: blVerdict.to, outcome: blVerdict.outcome },
        packingLists: packingDrives,
        declaration: declarationDrive,
      },
    };
  }
}
