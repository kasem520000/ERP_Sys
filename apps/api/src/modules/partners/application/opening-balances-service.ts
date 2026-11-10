import { Inject, Injectable } from "@nestjs/common";

import { AuditService } from "../../audit/api/audit";
import { ownTenantBaseCurrency } from "../../../infra/settings/setting-reader";
import * as store from "../infrastructure/partners.store";
import {
  OpeningBalanceDraftError,
  OpeningBalanceDraftExistsError,
  PartnerNotFoundError,
} from "../domain/partner-errors";
import { getItemForOpeningBalance } from "../../items/api/items";

/**
 * Opening-balance DRAFT capture (PHASE-006 §2.5/T7; G-16 subledger source,
 * INV-009 per-partner seam): data entry + validation + attachment support
 * ONLY. No posting — the OPENING period and posting engine are PHASE-007;
 * stock drafts post in PHASE-010. The schema's `status = 'DRAFT'` CHECK is
 * the zero-posting boundary at the database layer, and the CI proof asserts
 * no journal tables exist after this suite runs.
 *
 * Sign conventions (future-postability validation, PHASE-006 §4):
 * - PARTNER: amount is the signed open balance from the tenant's
 *   perspective — CUSTOMER drafts are positive (AR debit: customer owes
 *   us), SUPPLIER drafts negative (AP credit: we owe them), BOTH accepts
 *   either sign.
 * - ACCOUNT: signed opening balance; PHASE-007's balanced-entry check
 *   (drafts + partner + stock → OPENING_EQUITY) consumes these.
 * - STOCK: qty > 0 + unit_cost >= 0; value emerges at PHASE-010 posting.
 * Currency must be the tenant base currency at this phase.
 */

export type OpeningBalanceKind = "PARTNER" | "ACCOUNT" | "STOCK";

export interface CreateOpeningBalanceInput {
  kind: OpeningBalanceKind;
  partnerId?: string;
  accountId?: string;
  itemId?: string;
  amount?: string;
  qty?: string;
  unitCost?: string;
  note?: string | null;
}

@Injectable()
export class OpeningBalancesService {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  async list(kind: string | undefined, cursor: string | undefined, limit: number) {
    return store.listOpeningBalanceDocs(kind, cursor, limit);
  }

  async get(id: string): Promise<store.OpeningBalanceDocRow> {
    const doc = await store.findOpeningBalanceDocById(id);
    if (doc === undefined) {
      throw new OpeningBalanceDraftError(`opening balance draft ${id} does not exist`);
    }
    return doc;
  }

  async create(actorId: string, input: CreateOpeningBalanceInput): Promise<store.OpeningBalanceDocRow> {
    const baseCurrency = await ownTenantBaseCurrency();
    const validated = await this.validateDraft(input, {
      requireTarget: true,
    });
    const doc = await store.insertOpeningBalanceDoc({
      kind: validated.kind,
      partnerId: validated.partnerId,
      accountId: validated.accountId,
      itemId: validated.itemId,
      qty: validated.qty,
      unitCost: validated.unitCost,
      amount: validated.amount,
      currencyCode: baseCurrency,
      note: validated.note,
    });
    if (doc.kind === "PARTNER" && doc.partnerId !== null) {
      await store.recomputePartnerBalance(doc.partnerId);
    }
    await this.audit.record({
      action: "opening_balance.draft_created",
      entityType: "opening_balance_doc",
      entityId: doc.id,
      actorId,
      after: { kind: doc.kind, amount: doc.amount, qty: doc.qty, unit_cost: doc.unitCost },
    });
    return doc;
  }

  async update(
    actorId: string,
    id: string,
    patch: { amount?: string; qty?: string; unitCost?: string; note?: string | null; version?: number },
  ): Promise<store.OpeningBalanceDocRow> {
    const before = await store.findOpeningBalanceDocById(id);
    if (before === undefined) {
      throw new OpeningBalanceDraftError(`opening balance draft ${id} does not exist`);
    }
    const merged: CreateOpeningBalanceInput = {
      kind: before.kind,
      partnerId: before.partnerId ?? undefined,
      accountId: before.accountId ?? undefined,
      itemId: before.itemId ?? undefined,
      amount: patch.amount ?? before.amount ?? undefined,
      qty: patch.qty ?? before.qty ?? undefined,
      unitCost: patch.unitCost ?? before.unitCost ?? undefined,
      note: patch.note ?? before.note,
    };
    const validated = await this.validateDraft(merged, {
      requireTarget: false,
    });
    const updated = await store.updateOpeningBalanceDoc(id, {
      amount: validated.amount,
      qty: validated.qty,
      unitCost: validated.unitCost,
      note: validated.note,
      version: patch.version,
    });
    if (updated === undefined) {
      throw new OpeningBalanceDraftError(`opening balance draft ${id} does not exist`);
    }
    if (updated.kind === "PARTNER" && updated.partnerId !== null) {
      await store.recomputePartnerBalance(updated.partnerId);
    }
    await this.audit.record({
      action: "opening_balance.draft_updated",
      entityType: "opening_balance_doc",
      entityId: id,
      actorId,
      before: { amount: before.amount, qty: before.qty, unit_cost: before.unitCost },
      after: { amount: updated.amount, qty: updated.qty, unit_cost: updated.unitCost },
    });
    return updated;
  }

  /**
   * Draft validation matrix (acceptance 5): kind/target shape, sign
   * conventions per kind, nonzero amounts, currency = tenant base.
   * Duplicate DRAFT-per-target is a service-level rule mirroring the
   * schema's partial unique indexes (typed reason, no existence leak).
   */
  private async validateDraft(
    input: CreateOpeningBalanceInput,
    options: { requireTarget: boolean },
  ): Promise<
    Required<Pick<CreateOpeningBalanceInput, "kind" | "note">> & {
      partnerId: string | null;
      accountId: string | null;
      itemId: string | null;
      qty: string | null;
      unitCost: string | null;
      amount: string | null;
    }
  > {
    const shape = {
      kind: input.kind,
      partnerId: null as string | null,
      accountId: null as string | null,
      itemId: null as string | null,
      qty: null as string | null,
      unitCost: null as string | null,
      amount: null as string | null,
      note: input.note ?? null,
    };
    if (input.kind === "PARTNER") {
      const partnerId = input.partnerId;
      if (partnerId === undefined) {
        throw new OpeningBalanceDraftError("partner opening balance requires partnerId");
      }
      const partner = await store.findPartnerById(partnerId);
      if (partner === undefined || partner.deletedAt !== null) {
        throw new PartnerNotFoundError(partnerId);
      }
      const amount = requireAmount(input.amount);
      if (Number(amount) === 0) {
        throw new OpeningBalanceDraftError("opening balance amount must be nonzero");
      }
      if (partner.kind === "CUSTOMER" && Number(amount) < 0) {
        throw new OpeningBalanceDraftError(
          "customer opening balance must be positive (AR debit — the customer owes the tenant)",
        );
      }
      if (partner.kind === "SUPPLIER" && Number(amount) > 0) {
        throw new OpeningBalanceDraftError(
          "supplier opening balance must be negative (AP credit — the tenant owes the supplier)",
        );
      }
      if (options.requireTarget) {
        const existing = await store.findOpeningBalanceDocForPartner(partnerId);
        if (existing !== undefined) {
          throw new OpeningBalanceDraftExistsError(`partner ${partner.code}`);
        }
      }
      shape.partnerId = partnerId;
      shape.amount = amount;
      return shape;
    }
    if (input.kind === "ACCOUNT") {
      const accountId = input.accountId;
      if (accountId === undefined) {
        throw new OpeningBalanceDraftError("account opening balance requires accountId");
      }
      const account = await store.accountExists(accountId);
      if (account === false) {
        throw new OpeningBalanceDraftError(`account ${accountId} does not exist in this tenant`);
      }
      const amount = requireAmount(input.amount);
      if (Number(amount) === 0) {
        throw new OpeningBalanceDraftError("opening balance amount must be nonzero");
      }
      if (options.requireTarget) {
        const existing = await store.findOpeningBalanceDocForAccount(accountId);
        if (existing !== undefined) {
          throw new OpeningBalanceDraftExistsError(`account ${accountId}`);
        }
      }
      shape.accountId = accountId;
      shape.amount = amount;
      return shape;
    }
    // STOCK
    const itemId = input.itemId;
    if (itemId === undefined) {
      throw new OpeningBalanceDraftError("stock opening balance requires itemId");
    }
    const item = await getItemForOpeningBalance(itemId);
    if (item === undefined) {
      throw new OpeningBalanceDraftError(`item ${itemId} does not exist in this tenant`);
    }
    if (item.kind !== "STOCK") {
      throw new OpeningBalanceDraftError("stock opening balance requires a STOCK item");
    }
    const qty = input.qty;
    const unitCost = input.unitCost;
    if (qty === undefined || Number(qty) <= 0) {
      throw new OpeningBalanceDraftError("stock opening balance requires qty > 0");
    }
    if (unitCost === undefined || Number(unitCost) < 0) {
      throw new OpeningBalanceDraftError("stock opening balance requires unitCost >= 0");
    }
    if (options.requireTarget) {
      const existing = await store.findOpeningBalanceDocForItem(itemId);
      if (existing !== undefined) {
        throw new OpeningBalanceDraftExistsError(`item ${item.sku}`);
      }
    }
    shape.itemId = itemId;
    shape.qty = qty;
    shape.unitCost = unitCost;
    return shape;
  }
}

function requireAmount(amount: string | undefined): string {
  if (amount === undefined || amount.trim() === "" || Number.isNaN(Number(amount))) {
    throw new OpeningBalanceDraftError("opening balance requires a numeric amount");
  }
  return amount.trim();
}
