import { Inject, Injectable } from "@nestjs/common";

import { AuditService } from "../../audit/api/audit";
import { NumberingService } from "../../accounting/application/numbering-service";
import * as store from "../infrastructure/sourcing.store";
import {
  RfqDuePassedError,
  RfqNotFoundError,
  RfqStateError,
} from "../domain/sourcing-errors";

/**
 * RFQ lifecycle service (PHASE-038 T-02; H-11/P-01; BR-063): the sourcing
 * round runs DRAFT → ISSUED → QUOTED → AWARDED → CLOSED (CANCELLED off
 * DRAFT/ISSUED) — the DB CHECKs pin the stamp shapes, this service owns
 * the transition legality. The official number reserves at ISSUE (the
 * BR-029 boundary-transition discipline — POs reserve at issue, PRs at
 * approval). QUOTED flips automatically on the first quote (the quotes
 * service calls the transition hook); awarding is the award service's
 * surface; close is the terminal administrative hop.
 */

export const RFQ_NUMBER_FORMAT = {
  prefix: "RFQ",
  format: "RFQ-{YYYY}-{SEQ:6}",
  docType: "rfq",
} as const;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

@Injectable()
export class RfqService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    private readonly numbering: NumberingService,
  ) {}

  async list(filter: { status?: string; branchId?: string; limit: number }) {
    return store.listRfqs(filter);
  }

  async find(id: string) {
    const rfq = await store.findRfqById(id);
    if (rfq === undefined) throw new RfqNotFoundError(id);
    return rfq;
  }

  async findWithLines(id: string) {
    const rfq = await this.find(id);
    return { ...rfq, lines: await store.listRfqLines(id) };
  }

  async create(input: {
    branchId: string;
    title: string;
    titleAr: string | null;
    mode: string;
    currencyCode: string;
    dueAt: string | null;
    invitedSuppliers: readonly string[];
    lines: readonly { itemId: string; qty: string; targetPrice: string | null; note: string | null }[];
    note: string | null;
    noteAr: string | null;
    actorId: string | null;
  }) {
    if (input.lines.length === 0) {
      throw new RfqStateError("an RFQ must carry at least one requested line");
    }
    if (input.mode !== "OPEN" && input.mode !== "INVITED") {
      throw new RfqStateError(`RFQ mode must be OPEN or INVITED (got ${input.mode})`);
    }
    if (input.mode === "INVITED" && input.invitedSuppliers.length === 0) {
      throw new RfqStateError("an INVITED RFQ must carry at least one invited supplier");
    }
    for (const line of input.lines) {
      if (line.targetPrice !== null && Number.isNaN(Number(line.targetPrice))) {
        throw new RfqStateError(`RFQ line target price must be a decimal: ${line.targetPrice}`);
      }
    }
    const rfqId = await store.insertRfq({
      branchId: input.branchId,
      title: input.title,
      titleAr: input.titleAr,
      mode: input.mode,
      currencyCode: input.currencyCode,
      dueAt: input.dueAt,
      invitedSuppliers: [...input.invitedSuppliers],
      note: input.note,
      noteAr: input.noteAr,
      actorId: input.actorId,
    });
    await store.insertRfqLines(rfqId, input.lines);
    await this.audit.record({
      action: "purchasing.rfq_created",
      entityType: "rfq",
      entityId: rfqId,
      actorId: input.actorId ?? undefined,
      after: {
        title: input.title,
        mode: input.mode,
        lines: input.lines.length,
        invited: input.invitedSuppliers.length,
      },
    });
    return this.findWithLines(rfqId);
  }

  async update(id: string, input: {
    title?: string;
    titleAr?: string | null;
    mode?: string;
    dueAt?: string | null;
    invitedSuppliers?: readonly string[];
    note?: string | null;
    noteAr?: string | null;
    lines?: readonly { itemId: string; qty: string; targetPrice: string | null; note: string | null }[];
    actorId: string | null;
  }) {
    const rfq = await this.find(id);
    if (rfq.status !== "DRAFT") {
      throw new RfqStateError(
        `RFQ ${id} is ${rfq.status} — only DRAFT rounds can be edited (issued rounds are frozen history)`,
      );
    }
    if (input.mode === "INVITED" && input.invitedSuppliers !== undefined && input.invitedSuppliers.length === 0) {
      throw new RfqStateError("an INVITED RFQ must carry at least one invited supplier");
    }
    await store.updateRfq(id, {
      title: input.title,
      titleAr: input.titleAr,
      mode: input.mode,
      dueAt: input.dueAt,
      invitedSuppliers: input.invitedSuppliers,
      note: input.note,
      noteAr: input.noteAr,
      actorId: input.actorId,
    });
    if (input.lines !== undefined) {
      if (input.lines.length === 0) {
        throw new RfqStateError("an RFQ must carry at least one requested line");
      }
      await store.deleteRfqLines(id);
      await store.insertRfqLines(id, input.lines);
    }
    await this.audit.record({
      action: "purchasing.rfq_updated",
      entityType: "rfq",
      entityId: id,
      actorId: input.actorId ?? undefined,
      after: { linesReplaced: input.lines !== undefined },
    });
    return this.findWithLines(id);
  }

  /** Issue: DRAFT → ISSUED (the official number reserves here). */
  async issue(id: string, actorId: string | null) {
    const rfq = await this.find(id);
    if (rfq.status !== "DRAFT") {
      throw new RfqStateError(`RFQ ${id} is ${rfq.status} — only DRAFT rounds can issue`);
    }
    const year = new Date().toISOString().slice(0, 4);
    const acquired = await this.numbering.reserve({
      docType: RFQ_NUMBER_FORMAT.docType,
      branchId: rfq.branchId,
      periodKey: year,
      format: RFQ_NUMBER_FORMAT.format,
      prefix: RFQ_NUMBER_FORMAT.prefix,
      year,
    });
    const issuedAt = new Date().toISOString();
    await store.updateRfq(id, {
      status: "ISSUED",
      rfqNo: acquired.number,
      issuedAt,
      issuedBy: actorId,
      actorId,
    });
    await this.numbering.bind(RFQ_NUMBER_FORMAT.docType, acquired.number, id);
    await this.audit.record({
      action: "purchasing.rfq_issued",
      entityType: "rfq",
      entityId: id,
      actorId: actorId ?? undefined,
      after: { rfqNo: acquired.number, mode: rfq.mode, dueAt: rfq.dueAt },
    });
    return this.find(id);
  }

  /** The quotes-service hook: the FIRST submitted quote flips ISSUED →
   * QUOTED (idempotent — later quotes keep the round QUOTED). */
  async markQuotedOnFirstQuote(id: string): Promise<void> {
    const rfq = await store.findRfqById(id);
    if (rfq === undefined) throw new RfqNotFoundError(id);
    if (rfq.status !== "ISSUED") return;
    await store.updateRfq(id, { quotedAt: new Date().toISOString(), status: "QUOTED" });
    await this.audit.record({
      action: "purchasing.rfq_quoted",
      entityType: "rfq",
      entityId: id,
      after: { via: "first_quote" },
    });
  }

  /**
   * The award-service hook: QUOTED → AWARDED (BR-063 — awarding closes
   * the round for quote activity; the explicit close hop below remains
   * the terminal administrative state).
   */
  async markAwarded(id: string, actorId: string | null): Promise<void> {
    const rfq = await this.find(id);
    if (rfq.status !== "QUOTED" && rfq.status !== "ISSUED") {
      throw new RfqStateError(
        `RFQ ${id} is ${rfq.status} — only ISSUED/QUOTED rounds can award (BR-063: one award per round)`,
      );
    }
    await store.updateRfq(id, {
      status: "AWARDED",
      awardedAt: new Date().toISOString(),
      awardedBy: actorId,
      actorId,
    });
    await this.audit.record({
      action: "purchasing.rfq_awarded",
      entityType: "rfq",
      entityId: id,
      actorId: actorId ?? undefined,
    });
  }

  /** Close: AWARDED → CLOSED (the terminal administrative hop). */
  async close(id: string, actorId: string | null) {
    const rfq = await this.find(id);
    if (rfq.status !== "AWARDED") {
      throw new RfqStateError(
        `RFQ ${id} is ${rfq.status} — only AWARDED rounds close (BR-063: the award happens first)`,
      );
    }
    await store.updateRfq(id, {
      status: "CLOSED",
      closedAt: new Date().toISOString(),
      closedBy: actorId,
      actorId,
    });
    await this.audit.record({
      action: "purchasing.rfq_closed",
      entityType: "rfq",
      entityId: id,
      actorId: actorId ?? undefined,
    });
    return this.find(id);
  }

  async cancel(id: string, reason: string, actorId: string | null) {
    const rfq = await this.find(id);
    if (rfq.status !== "DRAFT" && rfq.status !== "ISSUED" && rfq.status !== "QUOTED") {
      throw new RfqStateError(
        `RFQ ${id} is ${rfq.status} — cancellable only from DRAFT/ISSUED/QUOTED (an awarded round is closed history)`,
      );
    }
    await store.updateRfq(id, {
      status: "CANCELLED",
      cancelReason: reason,
      actorId,
    });
    const live = await store.findLiveComparisonByRfq(id);
    if (live !== undefined && live.status === "PREPARED") {
      await store.cancelComparison(live.id);
    }
    await this.audit.record({
      action: "purchasing.rfq_cancelled",
      entityType: "rfq",
      entityId: id,
      actorId: actorId ?? undefined,
      after: { reason },
    });
    return this.find(id);
  }

  /**
   * The response-eligibility guard the quote surfaces share: the round
   * must be ISSUED/QUOTED and (when the due date is set) the due must be
   * in the future. The supplier-eligibility half (INVITED mode's list)
   * lives in the quotes service — it needs the supplier identity.
   */
  assertOpenForResponses(rfq: store.RfqRow): void {
    if (rfq.status !== "ISSUED" && rfq.status !== "QUOTED") {
      throw new RfqStateError(
        `RFQ ${rfq.id} is ${rfq.status} — quotes land on ISSUED/QUOTED rounds only`,
      );
    }
    if (rfq.dueAt !== null && new Date(rfq.dueAt).getTime() < Date.now()) {
      throw new RfqDuePassedError({ rfqId: rfq.id, dueAt: rfq.dueAt });
    }
  }

  assertDate(value: string, field: string): void {
    if (!DATE_RE.test(value)) {
      throw new RfqStateError(`${field} must be an ISO date (yyyy-mm-dd): ${value}`);
    }
  }
}
