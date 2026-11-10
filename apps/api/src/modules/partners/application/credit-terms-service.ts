import { Inject, Injectable } from "@nestjs/common";

import { AuditService } from "../../audit/api/audit";
import * as store from "../infrastructure/partners.store";
import {
  CreditTermsCodeTakenError,
  CreditTermsNotFoundError,
  SystemCreditTermsImmutableError,
} from "../domain/partner-errors";

/**
 * Credit-terms service (PHASE-006 §2.1; BR-026): net-N day codes with the
 * NET-7/15/30/60 system seeds read-only. BR-026 semantics — terms changes
 * affect NEW documents only; due dates of existing open items never move —
 * are structurally true at this phase (no documents exist; document
 * creation from PHASE-007/011/012 reads the terms AT CREATION time, which
 * this contract makes explicit) and are proven by the interface test.
 */

@Injectable()
export class CreditTermsService {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  async list(): Promise<store.CreditTermsRow[]> {
    return store.listCreditTerms();
  }

  async get(id: string): Promise<store.CreditTermsRow> {
    const terms = await store.findCreditTermsById(id);
    if (terms === undefined) {
      throw new CreditTermsNotFoundError(id);
    }
    return terms;
  }

  async create(
    actorId: string,
    input: { code: string; name: string; nameAr: string | null; days: number; description: string | null },
  ): Promise<store.CreditTermsRow> {
    const existing = await store.findCreditTermsByCode(input.code);
    if (existing !== undefined) {
      throw new CreditTermsCodeTakenError(input.code);
    }
    const terms = await store.insertCreditTerms(input);
    await this.audit.record({
      action: "credit_terms.created",
      entityType: "credit_terms",
      entityId: terms.id,
      actorId,
      after: { code: terms.code, days: terms.days },
    });
    return terms;
  }

  /**
   * Update custom terms; system seeds are immutable (risky-action audit
   * carries before/after — matrix §3.6 `partners.credit_terms.manage`).
   */
  async update(
    actorId: string,
    id: string,
    patch: { name?: string; nameAr?: string | null; days?: number; description?: string | null },
  ): Promise<store.CreditTermsRow> {
    const before = await store.findCreditTermsById(id);
    if (before === undefined) {
      throw new CreditTermsNotFoundError(id);
    }
    if (before.isSystem) {
      throw new SystemCreditTermsImmutableError(before.code);
    }
    const updated = await store.updateCreditTerms(id, patch);
    if (updated === undefined) {
      throw new CreditTermsNotFoundError(id);
    }
    await this.audit.record({
      action: "credit_terms.updated",
      entityType: "credit_terms",
      entityId: id,
      actorId,
      before: { days: before.days, name: before.name },
      after: { days: updated.days, name: updated.name },
    });
    return updated;
  }
}
