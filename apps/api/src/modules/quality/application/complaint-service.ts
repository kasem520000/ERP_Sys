/**
 * PHASE-050 (W-28 — T-12, 2026-11-23) THE COMPLAINTS SERVICE — Q-08:
 * customer complaint intake (channel, severity, item/batch reference),
 * triage, the NCR link, resolution and feedback. The lifecycle rides
 * the pure fold (complaint-lifecycle.ts — the service's decision
 * surface, the 0114 CHECKs the authority); every transition is ONE
 * guarded CAS in the store. THE INTAKE NOTIFICATION: every complaint's
 * landing records an inbox row (category 'quality' — the calibration
 * sweep's own channel, 0118's widening) so the quality desk sees the
 * intake beside its alerts.
 */
import { Inject, Injectable } from "@nestjs/common";

import { NumberingService } from "../../accounting/application/numbering-service";
import { AuditService } from "../../audit/api/audit";
import { InboxService } from "../../notifications/application/inbox-service";

import {
  COMPLAINT_CHANNELS,
  COMPLAINT_SEVERITIES,
  complaintNcrLinkWindow,
  nextComplaintMove,
} from "../domain/complaint-lifecycle";
import {
  ComplaintNotFoundError,
  ComplaintStateError,
  NcrRecordNotFoundError,
  QualityInputInvalidError,
} from "../domain/quality-errors";
import * as store from "../infrastructure/quality.store";

/** Official complaint numbers (INV-021/ADR-0006; the treasury
 * {PREFIX}-{YYYY}-{SEQ:6} convention — the NCR precedent). */
export const COMPLAINT_NUMBER_FORMAT = {
  prefix: "CMP",
  format: "CMP-{YYYY}-{SEQ:6}",
  docType: "complaint",
} as const;

function requireUuid(value: string, what: string): string {
  if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(value)) {
    throw new QualityInputInvalidError({ field: what, reason: "a uuid is required" });
  }
  return value;
}

export interface CreateComplaintInput {
  channel: string;
  severity: string;
  customerId: string;
  itemId?: string | null;
  batchId?: string | null;
  subject: string;
  details?: string | null;
  detailsAr?: string | null;
  note?: string | null;
  noteAr?: string | null;
  actorId: string | null;
}

@Injectable()
export class ComplaintService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(NumberingService) private readonly numbering: NumberingService,
    @Inject(InboxService) private readonly inbox: InboxService,
  ) {}

  async create(input: CreateComplaintInput): Promise<store.ComplaintRow> {
    if (!(COMPLAINT_CHANNELS as readonly string[]).includes(input.channel)) {
      throw new QualityInputInvalidError({
        field: "channel",
        reason: `channel must be one of ${COMPLAINT_CHANNELS.join("/")}: ${input.channel}`,
      });
    }
    const severity = input.severity ?? "MEDIUM";
    if (!(COMPLAINT_SEVERITIES as readonly string[]).includes(severity)) {
      throw new QualityInputInvalidError({
        field: "severity",
        reason: `severity must be one of ${COMPLAINT_SEVERITIES.join("/")}: ${severity}`,
      });
    }
    requireUuid(input.customerId, "customerId");
    if (input.itemId != null && input.itemId !== "") requireUuid(input.itemId, "itemId");
    if (input.batchId != null && input.batchId !== "") requireUuid(input.batchId, "batchId");
    if (input.subject.trim().length === 0 || input.subject.length > 500) {
      throw new QualityInputInvalidError({
        field: "subject",
        reason: "the complaint subject is required (1…500 chars)",
      });
    }
    const year = String(new Date().getUTCFullYear());
    const acquired = await this.numbering.reserve({
      docType: COMPLAINT_NUMBER_FORMAT.docType,
      branchId: null,
      periodKey: year,
      format: COMPLAINT_NUMBER_FORMAT.format,
      prefix: COMPLAINT_NUMBER_FORMAT.prefix,
      year,
    });
    const row = await store.insertComplaint({
      complaintNo: acquired.number,
      channel: input.channel,
      severity,
      customerId: input.customerId,
      itemId: input.itemId || null,
      batchId: input.batchId || null,
      subject: input.subject,
      details: input.details ?? null,
      detailsAr: input.detailsAr ?? null,
      note: input.note ?? null,
      noteAr: input.noteAr ?? null,
      createdBy: input.actorId,
    });
    await this.numbering.bind(COMPLAINT_NUMBER_FORMAT.docType, acquired.number, row.id);
    await this.audit.record({
      action: "quality.complaint_created",
      entityType: "complaint",
      entityId: row.id,
      actorId: input.actorId ?? undefined,
      after: { complaintNo: row.complaintNo, channel: row.channel, severity: row.severity },
    });
    // THE INTAKE NOTIFICATION (the phase doc's own arm): the quality
    // desk sees every landing beside its alerts — the calibration
    // sweep's own channel, the structural dedupe on the complaint's own
    // number (one row per complaint, re-landing converges).
    const target = await this.inbox.ownerTarget();
    if (target !== null) {
      await this.inbox.record({
        category: "quality",
        severity: severity === "CRITICAL" || severity === "HIGH" ? "critical" : "warning",
        title: {
          en: `Complaint ${row.complaintNo} — ${input.subject}`,
          ar: `شكوى ${row.complaintNo} — ${input.subject}`,
        },
        body: {
          en: `A ${severity} complaint landed through ${input.channel}.`,
          ar: `وردت شكوى بدرجة ${severity} عبر ${input.channel}.`,
        },
        actionLabel: { ar: "مراجعة الشكوى", en: "Review complaint" },
        actionUrl: "/quality/complaints",
        dedupeKey: `quality:complaint:${row.complaintNo}`,
        userId: target.userId,
      });
    }
    return row;
  }

  async list(filter: {
    status?: string;
    customerId?: string;
    ncrId?: string;
    limit?: number;
  }): Promise<store.ComplaintRow[]> {
    return store.listComplaints({
      status: filter.status,
      customerId: filter.customerId,
      ncrId: filter.ncrId,
      limit: filter.limit ?? 200,
    });
  }

  async find(id: string): Promise<store.ComplaintRow> {
    const row = await store.findComplaintById(requireUuid(id, "id"));
    if (row === undefined) throw new ComplaintNotFoundError({ complaintId: id });
    return row;
  }

  /** The triage act: NEW → TRIAGED; the NCR link may land in the same
   * act (the fold's own window — the triage carries the first link). */
  async triage(input: {
    complaintId: string;
    ncrId?: string | null;
    actorId: string | null;
  }): Promise<store.ComplaintRow> {
    const current = await this.find(input.complaintId);
    const verdict = nextComplaintMove(current.status as "NEW", "triage");
    if (!verdict.allowed) {
      throw new ComplaintStateError({
        complaintId: input.complaintId,
        status: current.status,
        reason: verdict.reason ?? "the triage move is not available on this rung",
      });
    }
    let ncrId: string | null = null;
    if (input.ncrId !== undefined && input.ncrId !== null && input.ncrId !== "") {
      ncrId = requireUuid(input.ncrId, "ncrId");
      if ((await store.findNcrById(ncrId)) === undefined) {
        throw new NcrRecordNotFoundError({ ncrId });
      }
    }
    const row = await store.stampComplaintTriage({
      id: input.complaintId,
      ncrId,
      updatedBy: input.actorId,
    });
    if (row === undefined) {
      throw new ComplaintStateError({
        complaintId: input.complaintId,
        status: current.status,
        reason: "the triage stamp raced — reload and retry",
      });
    }
    await this.audit.record({
      action: "quality.complaint_triaged",
      entityType: "complaint",
      entityId: row.id,
      actorId: input.actorId ?? undefined,
      after: { status: row.status, ncrId: row.ncrId },
    });
    return row;
  }

  /** The link act: TRIAGED/IN_PROGRESS only (the fold's window); the
   * link's typed pre-check through the register's OWN row. */
  async linkNcr(input: {
    complaintId: string;
    ncrId: string;
    actorId: string | null;
  }): Promise<store.ComplaintRow> {
    const current = await this.find(input.complaintId);
    const window = complaintNcrLinkWindow(current.status as "NEW");
    if (!window.open) {
      throw new ComplaintStateError({
        complaintId: input.complaintId,
        status: current.status,
        reason: window.reason ?? "the NCR link window is closed",
      });
    }
    requireUuid(input.ncrId, "ncrId");
    const ncr = await store.findNcrById(input.ncrId);
    if (ncr === undefined) throw new NcrRecordNotFoundError({ ncrId: input.ncrId });
    const row = await store.linkComplaintNcr({
      id: input.complaintId,
      ncrId: input.ncrId,
      updatedBy: input.actorId,
    });
    if (row === undefined) {
      throw new ComplaintStateError({
        complaintId: input.complaintId,
        status: current.status,
        reason: "the link raced — the register already carries its NCR",
      });
    }
    await this.audit.record({
      action: "quality.complaint_ncr_linked",
      entityType: "complaint",
      entityId: row.id,
      actorId: input.actorId ?? undefined,
      after: { ncrId: row.ncrId, ncrNo: ncr.ncrNo },
    });
    return row;
  }

  async progress(input: {
    complaintId: string;
    actorId: string | null;
  }): Promise<store.ComplaintRow> {
    const current = await this.find(input.complaintId);
    const verdict = nextComplaintMove(current.status as "NEW", "progress");
    if (!verdict.allowed) {
      throw new ComplaintStateError({
        complaintId: input.complaintId,
        status: current.status,
        reason: verdict.reason ?? "the progress move is not available on this rung",
      });
    }
    const row = await store.stampComplaintProgress({
      id: input.complaintId,
      updatedBy: input.actorId,
    });
    if (row === undefined) {
      throw new ComplaintStateError({
        complaintId: input.complaintId,
        status: current.status,
        reason: "the progress stamp raced — reload and retry",
      });
    }
    await this.audit.record({
      action: "quality.complaint_progressed",
      entityType: "complaint",
      entityId: row.id,
      actorId: input.actorId ?? undefined,
      after: { status: row.status },
    });
    return row;
  }

  /** The resolve act: the resolution pair lands together (the 0114
   * CHECK's own shape — never one without the other). */
  async resolve(input: {
    complaintId: string;
    resolution: string;
    actorId: string | null;
  }): Promise<store.ComplaintRow> {
    if (input.resolution.trim().length === 0 || input.resolution.length > 2000) {
      throw new QualityInputInvalidError({
        field: "resolution",
        reason: "the resolution is required (1…2000 chars)",
      });
    }
    const current = await this.find(input.complaintId);
    const verdict = nextComplaintMove(current.status as "NEW", "resolve");
    if (!verdict.allowed) {
      throw new ComplaintStateError({
        complaintId: input.complaintId,
        status: current.status,
        reason: verdict.reason ?? "the resolve move is not available on this rung",
      });
    }
    const row = await store.stampComplaintResolution({
      id: input.complaintId,
      resolution: input.resolution,
      updatedBy: input.actorId,
    });
    if (row === undefined) {
      throw new ComplaintStateError({
        complaintId: input.complaintId,
        status: current.status,
        reason: "the resolution stamp raced — reload and retry",
      });
    }
    await this.audit.record({
      action: "quality.complaint_resolved",
      entityType: "complaint",
      entityId: row.id,
      actorId: input.actorId ?? undefined,
      after: { status: row.status, resolution: row.resolution },
    });
    return row;
  }

  async close(input: { complaintId: string; actorId: string | null }): Promise<store.ComplaintRow> {
    const current = await this.find(input.complaintId);
    const verdict = nextComplaintMove(current.status as "NEW", "close");
    if (!verdict.allowed) {
      throw new ComplaintStateError({
        complaintId: input.complaintId,
        status: current.status,
        reason: verdict.reason ?? "the close move is not available on this rung",
      });
    }
    const row = await store.stampComplaintClosed({
      id: input.complaintId,
      updatedBy: input.actorId,
    });
    if (row === undefined) {
      throw new ComplaintStateError({
        complaintId: input.complaintId,
        status: current.status,
        reason: "the close stamp raced — reload and retry",
      });
    }
    await this.audit.record({
      action: "quality.complaint_closed",
      entityType: "complaint",
      entityId: row.id,
      actorId: input.actorId ?? undefined,
      after: { status: row.status },
    });
    return row;
  }
}
