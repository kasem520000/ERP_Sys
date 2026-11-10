import { Inject, Injectable } from "@nestjs/common";

import { AuditService } from "../../audit/api/audit";
import * as store from "../infrastructure/partners.store";
import { TierNotFoundError } from "../../distribution/domain/distribution-errors";
import {
  CreditTermsNotFoundError,
  PartnerArchivedError,
  PartnerCodeTakenError,
  PartnerInvalidTransitionError,
  PartnerKindChangeForbiddenError,
  PartnerNotFoundError,
  PriceListNotFoundError,
} from "../domain/partner-errors";

/**
 * Partner directory service (PHASE-006 §2.1/T3; BR-025): unified
 * customer/supplier/both records with tenant-wide auto-numbered codes by
 * default, manual unique codes opt-in, kind changes only while the partner
 * has no postings, soft-delete archive, contacts + addresses, and trigram
 * search across AR+EN names (T10).
 */

export interface CreatePartnerInput {
  kind: "CUSTOMER" | "SUPPLIER" | "BOTH";
  code?: string;
  name: string;
  nameAr: string | null;
  taxNumber: string | null;
  creditLimit: string | null;
  creditTermsId: string | null;
  priceListId: string | null;
}

@Injectable()
export class PartnerService {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  async list(
    filter: store.PartnerListFilter,
    cursor: string | undefined,
    limit: number,
  ): Promise<store.PartnerListPage> {
    return store.listPartners(filter, cursor, limit);
  }

  async get(partnerId: string): Promise<store.PartnerRow> {
    const partner = await store.findPartnerById(partnerId);
    if (partner === undefined || partner.deletedAt !== null) {
      throw new PartnerNotFoundError(partnerId);
    }
    return partner;
  }

  async create(actorId: string, input: CreatePartnerInput): Promise<store.PartnerRow> {
    // BR-025: codes auto-number tenant-wide by default (partners.code_autogenerate
    // posture — manual codes must be unique).
    const code = input.code ?? (await store.nextPartnerCode());
    const existing = await store.findPartnerByCode(code);
    if (existing !== undefined) {
      throw new PartnerCodeTakenError(code);
    }
    if (input.creditTermsId !== null) {
      const terms = await store.findCreditTermsById(input.creditTermsId);
      if (terms === undefined) {
        throw new CreditTermsNotFoundError(input.creditTermsId);
      }
    }
    if (input.priceListId !== null) {
      const listExists = await store.priceListExists(input.priceListId);
      if (listExists === false) {
        throw new PriceListNotFoundError(input.priceListId);
      }
    }
    const partner = await store.insertPartner({
      kind: input.kind,
      code,
      name: input.name,
      nameAr: input.nameAr,
      taxNumber: input.taxNumber,
      creditLimit: input.creditLimit,
      creditTermsId: input.creditTermsId,
      priceListId: input.priceListId,
    });
    await this.audit.record({
      action: "partner.created",
      entityType: "partner",
      entityId: partner.id,
      actorId,
      after: { code: partner.code, name: partner.name, kind: partner.kind },
    });
    return partner;
  }

  async update(
    actorId: string,
    partnerId: string,
    patch: {
      name?: string;
      nameAr?: string | null;
      taxNumber?: string | null;
      creditLimit?: string | null;
      creditTermsId?: string | null;
      priceListId?: string | null;
      /** PHASE-017 (0025): the customer-tier assignment (BR-003 level 2).
       * Rides the ordinary partner PATCH; the tier row itself must exist
       * (distribution owns customer_tiers — TierNotFoundError for unknown
       * vs foreign ids, the A7-identical shape). */
      customerTierId?: string | null;
      status?: string;
      version?: number;
    },
  ): Promise<store.PartnerRow> {
    const before = await store.findPartnerById(partnerId);
    if (before === undefined || before.deletedAt !== null) {
      throw new PartnerNotFoundError(partnerId);
    }
    if (patch.creditTermsId !== undefined && patch.creditTermsId !== null) {
      const terms = await store.findCreditTermsById(patch.creditTermsId);
      if (terms === undefined) {
        throw new CreditTermsNotFoundError(patch.creditTermsId);
      }
    }
    if (patch.priceListId !== undefined && patch.priceListId !== null) {
      const listExists = await store.priceListExists(patch.priceListId);
      if (listExists === false) {
        throw new PriceListNotFoundError(patch.priceListId);
      }
    }
    if (patch.customerTierId !== undefined && patch.customerTierId !== null) {
      const tierExists = await store.customerTierExists(patch.customerTierId);
      if (tierExists === false) {
        throw new TierNotFoundError(patch.customerTierId);
      }
    }
    if (
      patch.status !== undefined &&
      patch.status !== "ACTIVE" &&
      patch.status !== "INACTIVE"
    ) {
      throw new PartnerInvalidTransitionError(before.status, patch.status);
    }
    const updated = await store.updatePartner(partnerId, patch);
    if (updated === undefined) {
      throw new PartnerNotFoundError(partnerId);
    }
    await this.audit.record({
      action: "partner.updated",
      entityType: "partner",
      entityId: partnerId,
      actorId,
      before: {
        name: before.name,
        credit_limit: before.creditLimit,
        credit_terms_id: before.creditTermsId,
        price_list_id: before.priceListId,
        customer_tier_id: before.customerTierId,
        status: before.status,
      },
      after: {
        name: updated.name,
        credit_limit: updated.creditLimit,
        credit_terms_id: updated.creditTermsId,
        price_list_id: updated.priceListId,
        customer_tier_id: updated.customerTierId,
        status: updated.status,
      },
    });
    return updated;
  }

  /** BR-025: kind changes only while the partner has no postings. */
  async changeKind(actorId: string, partnerId: string, kind: "CUSTOMER" | "SUPPLIER" | "BOTH"): Promise<store.PartnerRow> {
    const before = await store.findPartnerById(partnerId);
    if (before === undefined || before.deletedAt !== null) {
      throw new PartnerNotFoundError(partnerId);
    }
    const postings = await store.countPartnerPostings(partnerId);
    if (postings > 0) {
      throw new PartnerKindChangeForbiddenError();
    }
    const updated = await store.updatePartnerKind(partnerId, kind);
    if (updated === undefined) {
      throw new PartnerNotFoundError(partnerId);
    }
    await this.audit.record({
      action: "partner.kind_changed",
      entityType: "partner",
      entityId: partnerId,
      actorId,
      before: { kind: before.kind },
      after: { kind: updated.kind },
    });
    return updated;
  }

  async archive(actorId: string, partnerId: string): Promise<store.PartnerRow> {
    const before = await store.findPartnerById(partnerId);
    if (before === undefined) {
      throw new PartnerNotFoundError(partnerId);
    }
    if (before.deletedAt !== null) {
      throw new PartnerArchivedError(partnerId);
    }
    const archived = await store.archivePartner(partnerId);
    if (archived === undefined) {
      throw new PartnerNotFoundError(partnerId);
    }
    await this.audit.record({
      action: "partner.archived",
      entityType: "partner",
      entityId: partnerId,
      actorId,
      before: { status: before.status },
      after: { status: archived.status, deleted: true },
    });
    return archived;
  }

  // -- contacts + addresses ---------------------------------------------------

  async addContact(
    actorId: string,
    partnerId: string,
    input: { name: string; phone: string | null; email: string | null; role: string | null; isPrimary: boolean },
  ): Promise<store.PartnerContactRow> {
    await this.get(partnerId);
    const contact = await store.insertPartnerContact({ partnerId, ...input });
    await this.audit.record({
      action: "partner.contact_added",
      entityType: "partner",
      entityId: partnerId,
      actorId,
      after: { contact_id: contact.id, name: contact.name },
    });
    return contact;
  }

  async listContacts(partnerId: string): Promise<store.PartnerContactRow[]> {
    await this.get(partnerId);
    return store.listPartnerContacts(partnerId);
  }

  async addAddress(
    actorId: string,
    partnerId: string,
    input: { type: string; line1: string; line2: string | null; city: string | null; countryCode: string | null },
  ): Promise<store.PartnerAddressRow> {
    await this.get(partnerId);
    const address = await store.insertPartnerAddress({ partnerId, ...input });
    await this.audit.record({
      action: "partner.address_added",
      entityType: "partner",
      entityId: partnerId,
      actorId,
      after: { address_id: address.id, type: address.type },
    });
    return address;
  }

  async listAddresses(partnerId: string): Promise<store.PartnerAddressRow[]> {
    await this.get(partnerId);
    return store.listPartnerAddresses(partnerId);
  }

  // -- search (T10; CommandMenu + PartnerPicker surface) -----------------------

  async search(q: string): Promise<store.PartnerRow[]> {
    return store.searchPartners(q);
  }

  // -- balances (draft-honest read model surface) ------------------------------

  async balance(partnerId: string): Promise<store.PartnerBalanceRow> {
    await this.get(partnerId);
    const row = await store.findPartnerBalance(partnerId);
    return row ?? { partnerId, openBalance: "0", draftBalance: "0", overdueAmount: "0" };
  }
}
