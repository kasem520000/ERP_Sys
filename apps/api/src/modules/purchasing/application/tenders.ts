import { Inject, Injectable } from "@nestjs/common";

import { AuditService } from "../../audit/api/audit";
import { NumberingService } from "../../accounting/application/numbering-service";
import * as collab from "../infrastructure/collaboration.store";
import { TenderIntakeNotFoundError } from "../domain/sourcing-errors";

/**
 * Tender intake service (PHASE-038 T-09; P-14/DF-52/DF-53): public-tender
 * INTAKE records — the announcing authority, the deadline, our recorded
 * decision, and the government supplier-registration fields (stored
 * verbatim, never guessed). Intake records ONLY: no bidding-workflow
 * claims of any kind (the honesty discipline — the DB never bids, never
 * contacts an authority, never certifies eligibility).
 */

export const TENDER_INTAKE_NUMBER_FORMAT = {
  prefix: "TND",
  format: "TND-{YYYY}-{SEQ:6}",
  docType: "tender_intake",
} as const;

@Injectable()
export class TenderIntakeService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    private readonly numbering: NumberingService,
  ) {}

  async list(filter: { status?: string; ourDecision?: string; limit: number }) {
    return collab.listTenderIntakes(filter);
  }

  async find(id: string) {
    const intake = await collab.findTenderIntakeById(id);
    if (intake === undefined) throw new TenderIntakeNotFoundError(id);
    return intake;
  }

  async create(input: {
    title: string;
    titleAr: string | null;
    announcingAuthority: string;
    tenderRefNo: string | null;
    publishedAt: string | null;
    submissionDeadline: string | null;
    estimatedValue: string | null;
    currencyCode: string | null;
    govRegistrationNo: string | null;
    govRegistrationExpiry: string | null;
    classificationCode: string | null;
    sourceUrl: string | null;
    note: string | null;
    noteAr: string | null;
    actorId: string | null;
  }) {
    const year = new Date().toISOString().slice(0, 4);
    const acquired = await this.numbering.reserve({
      docType: TENDER_INTAKE_NUMBER_FORMAT.docType,
      branchId: null,
      periodKey: year,
      format: TENDER_INTAKE_NUMBER_FORMAT.format,
      prefix: TENDER_INTAKE_NUMBER_FORMAT.prefix,
      year,
    });
    const id = await collab.insertTenderIntake({ ...input, intakeNo: acquired.number });
    await this.numbering.bind(TENDER_INTAKE_NUMBER_FORMAT.docType, acquired.number, id);
    await this.audit.record({
      action: "purchasing.tender_intake_created",
      entityType: "tender_intake",
      entityId: id,
      actorId: input.actorId ?? undefined,
      after: { intakeNo: acquired.number, authority: input.announcingAuthority },
    });
    return this.find(id);
  }

  async update(id: string, input: {
    title?: string;
    titleAr?: string | null;
    announcingAuthority?: string;
    tenderRefNo?: string | null;
    publishedAt?: string | null;
    submissionDeadline?: string | null;
    estimatedValue?: string | null;
    currencyCode?: string | null;
    govRegistrationNo?: string | null;
    govRegistrationExpiry?: string | null;
    classificationCode?: string | null;
    sourceUrl?: string | null;
    note?: string | null;
    noteAr?: string | null;
    actorId: string | null;
  }) {
    await this.find(id);
    await collab.updateTenderIntake(id, input);
    await this.audit.record({
      action: "purchasing.tender_intake_updated",
      entityType: "tender_intake",
      entityId: id,
      actorId: input.actorId ?? undefined,
    });
    return this.find(id);
  }

  /** Record OUR decision on the opportunity (nothing auto-bids — the
   * decision is a human record). */
  async decide(id: string, input: { ourDecision: string; note: string | null; actorId: string | null }) {
    const intake = await this.find(id);
    if (intake.status === "CLOSED") {
      throw new TenderIntakeNotFoundError("(closed-intake)");
    }
    if (!["PENDING", "WILL_BID", "DECLINED", "WON", "LOST"].includes(input.ourDecision)) {
      throw new TenderIntakeNotFoundError("(decision)");
    }
    await collab.updateTenderIntake(id, {
      ourDecision: input.ourDecision,
      decidedAt: new Date().toISOString(),
      decisionNote: input.note,
    });
    await this.audit.record({
      action: "purchasing.tender_decision_recorded",
      entityType: "tender_intake",
      entityId: id,
      actorId: input.actorId ?? undefined,
      after: { ourDecision: input.ourDecision },
    });
    return this.find(id);
  }

  async close(id: string, actorId: string | null) {
    await this.find(id);
    await collab.updateTenderIntake(id, { status: "CLOSED" });
    await this.audit.record({
      action: "purchasing.tender_intake_closed",
      entityType: "tender_intake",
      entityId: id,
      actorId: actorId ?? undefined,
    });
    return this.find(id);
  }
}
