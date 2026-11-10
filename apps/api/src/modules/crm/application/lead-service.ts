import { Inject, Injectable } from "@nestjs/common";

import { AuditService } from "../../audit/api/audit";
import { PartnerService } from "../../partners/application/partner-service";
import * as store from "../infrastructure/crm.store";
import {
  LeadConvertedError,
  LeadInputInvalidError,
  LeadLostReasonRequiredError,
  LeadMergeTargetRequiredError,
  LeadNotFoundError,
} from "../domain/crm-errors";

/**
 * Lead service (PHASE-019 T45; MASTER-PLAN §2): the intake pipeline
 * NEW → QUALIFIED → CONVERTED / LOST. Leads are not legal documents — no
 * numbering series, no ledger effects ever; conversion links a partner
 * forever (provenance) and freezes the lead (PUT/qualify/lose/convert on a
 * CONVERTED lead → typed LEAD_CONVERTED).
 *
 * NEW_PARTNER conversion delegates to PartnerService (BR-025 auto code
 * P-xxxxxx) carrying the lead's contact data; MERGE validates an existing
 * target partner. Both land in audit `crm.lead.converted` with the mode +
 * partnerId in the after-state.
 */

/** The guarded operations run while NEW/QUALIFIED only (§2 transitions). */
const MUTABLE_STATUSES = new Set(["NEW", "QUALIFIED"]);

export interface CreateLeadInput {
  name: string;
  nameAr: string | null;
  phone: string | null;
  email: string | null;
  company: string | null;
  source: string;
  ownerUserId: string | null;
  note: string | null;
  noteAr: string | null;
  actorId: string | null;
}

export interface LeadPatch {
  name?: string;
  nameAr?: string | null;
  phone?: string | null;
  email?: string | null;
  company?: string | null;
  source?: string;
  ownerUserId?: string | null;
  note?: string | null;
  noteAr?: string | null;
}

export interface ConvertLeadInput {
  mode: "NEW_PARTNER" | "MERGE";
  /** MERGE only: the existing partner to link (zod enforces presence). */
  partnerId?: string;
  /** NEW_PARTNER only: the created partner's kind (CUSTOMER|BOTH). */
  kind: "CUSTOMER" | "BOTH";
  /** Always a real user — PartnerService.create/addContact audit it. */
  actorId: string;
}

@Injectable()
export class LeadService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(PartnerService) private readonly partners: PartnerService,
  ) {}

  async create(input: CreateLeadInput): Promise<store.LeadRow> {
    if (input.name.trim().length === 0) {
      throw new LeadInputInvalidError("lead name is required (1..200 characters)");
    }
    const lead = await store.insertLead({
      name: input.name.trim(),
      nameAr: input.nameAr,
      phone: input.phone,
      email: input.email,
      company: input.company,
      source: input.source,
      ownerUserId: input.ownerUserId,
      note: input.note,
      noteAr: input.noteAr,
      actorId: input.actorId,
    });
    await this.audit.record({
      action: "crm.lead.created",
      entityType: "lead",
      entityId: lead.id,
      actorId: input.actorId ?? undefined,
      after: { name: lead.name, source: lead.source, status: lead.status },
    });
    return lead;
  }

  async list(filter: { status?: string; ownerUserId?: string; limit: number }): Promise<store.LeadRow[]> {
    return store.listLeads(filter);
  }

  async find(id: string): Promise<store.LeadRow> {
    const lead = await store.findLeadById(id);
    if (lead === undefined) throw new LeadNotFoundError(id);
    return lead;
  }

  /** Field edits while NEW/QUALIFIED (status moves only through the
   * qualify/lose/convert transitions — §2). */
  async update(id: string, patch: LeadPatch, actorId: string | null): Promise<store.LeadRow> {
    const before = await this.find(id);
    this.assertMutable(before);
    await store.patchLead({ id, ...patch });
    const after = await this.find(id);
    await this.audit.record({
      action: "crm.lead.updated",
      entityType: "lead",
      entityId: id,
      actorId: actorId ?? undefined,
      before: { name: before.name, phone: before.phone, email: before.email, source: before.source },
      after: { name: after.name, phone: after.phone, email: after.email, source: after.source },
    });
    return after;
  }

  /** NEW → QUALIFIED. A QUALIFIED lead re-qualifying is the legal replay
   * (INV-013): the stored row returns unchanged. */
  async qualify(id: string, actorId: string | null): Promise<store.LeadRow> {
    const lead = await this.find(id);
    if (lead.status === "QUALIFIED") {
      return lead;
    }
    this.assertMutable(lead);
    await store.patchLead({ id, status: "QUALIFIED" });
    const after = await this.find(id);
    await this.audit.record({
      action: "crm.lead.qualified",
      entityType: "lead",
      entityId: id,
      actorId: actorId ?? undefined,
      before: { status: lead.status },
      after: { status: after.status },
    });
    return after;
  }

  /** NEW/QUALIFIED → LOST with a reason (1..200 — the DDL CHECK's mirror). */
  async lose(id: string, reason: string, actorId: string | null): Promise<store.LeadRow> {
    if (reason.trim().length < 1 || reason.trim().length > 200) {
      throw new LeadLostReasonRequiredError();
    }
    const lead = await this.find(id);
    this.assertMutable(lead);
    await store.setLeadLost(id, reason.trim());
    const after = await this.find(id);
    await this.audit.record({
      action: "crm.lead.lost",
      entityType: "lead",
      entityId: id,
      actorId: actorId ?? undefined,
      before: { status: lead.status },
      after: { status: after.status, reason: reason.trim() },
    });
    return after;
  }

  /**
   * The conversion (§2): NEW_PARTNER creates the partner through
   * PartnerService (BR-025 auto code; the lead's name/nameAr identify it,
   * phone/email ride as the primary contact when present); MERGE links the
   * given existing partner (validated: present, not archived, customer-ish
   * CUSTOMER|BOTH — a supplier-only partner is not a sales conversion
   * target). Both → status CONVERTED + partnerId + convertedAt + audit
   * `crm.lead.converted`. The partner link is forever (provenance); the
   * lead becomes immutable.
   */
  async convert(id: string, input: ConvertLeadInput): Promise<store.LeadRow> {
    const lead = await this.find(id);
    this.assertMutable(lead);
    let partnerId: string;
    if (input.mode === "NEW_PARTNER") {
      const partner = await this.partners.create(input.actorId, {
        kind: input.kind,
        name: lead.name,
        nameAr: lead.nameAr,
        taxNumber: null,
        creditLimit: null,
        creditTermsId: null,
        priceListId: null,
      });
      if (lead.phone !== null || lead.email !== null) {
        await this.partners.addContact(input.actorId, partner.id, {
          name: lead.name,
          phone: lead.phone,
          email: lead.email,
          role: null,
          isPrimary: true,
        });
      }
      partnerId = partner.id;
    } else {
      const partnerIdInput = input.partnerId?.trim() ?? "";
      if (partnerIdInput === "") {
        throw new LeadMergeTargetRequiredError("(missing)");
      }
      const target = await store.findPartnerForCrm(partnerIdInput);
      if (target === undefined || target.deletedAt !== null) {
        throw new LeadMergeTargetRequiredError(partnerIdInput);
      }
      if (target.kind !== "CUSTOMER" && target.kind !== "BOTH") {
        throw new LeadMergeTargetRequiredError(partnerIdInput);
      }
      partnerId = target.id;
    }
    await store.setLeadConverted(id, partnerId);
    const after = await this.find(id);
    await this.audit.record({
      action: "crm.lead.converted",
      entityType: "lead",
      entityId: id,
      actorId: input.actorId ?? undefined,
      before: { status: lead.status },
      after: { status: after.status, mode: input.mode, partnerId, convertedAt: after.convertedAt },
    });
    return after;
  }

  /**
   * The CRM dashboard summary (§11 row 17 / §13): pipeline counts by status,
   * follow-up counts (OPEN tasks due today / overdue), ACTIVE contracts
   * expiring within 30 days, and PLANNED billing entries billing within 7
   * days. Operational counts, read-only, no report-contract coupling.
   */
  async dashboardSummary(): Promise<{
    pipeline: { NEW: number; QUALIFIED: number; CONVERTED: number; LOST: number };
    followUpsDueToday: number;
    followUpsOverdue: number;
    contractsExpiringIn30d: number;
    upcomingBillingEntries: number;
  }> {
    const [pipeline, followUps, contractsExpiring, upcomingBilling] = await Promise.all([
      store.countLeadsByStatus(),
      store.countFollowUps(),
      store.countActiveContractsExpiringWithin(30),
      store.countPlannedBillingEntriesWithin(7),
    ]);
    return {
      pipeline,
      followUpsDueToday: followUps.dueToday,
      followUpsOverdue: followUps.overdue,
      contractsExpiringIn30d: contractsExpiring,
      upcomingBillingEntries: upcomingBilling,
    };
  }

  /** The §2 guard: PUT/qualify/lose/convert run while NEW/QUALIFIED only —
   * a CONVERTED lead is immutable forever; a LOST lead is likewise closed
   * (the message names the actual status; the code is the contract). */
  private assertMutable(lead: store.LeadRow): void {
    if (lead.status === "CONVERTED") {
      throw new LeadConvertedError(
        `lead ${lead.id} is CONVERTED and immutable — the partner link is permanent provenance`,
        { leadId: lead.id, status: lead.status },
      );
    }
    if (!MUTABLE_STATUSES.has(lead.status)) {
      throw new LeadConvertedError(
        `lead ${lead.id} is ${lead.status} — only NEW/QUALIFIED leads accept this operation`,
        { leadId: lead.id, status: lead.status },
      );
    }
  }
}
