import { Inject, Injectable } from "@nestjs/common";

import { AuditService } from "../../audit/api/audit";
import * as itemsStore from "../../items/infrastructure/items.store";
import * as partnersStore from "../../partners/infrastructure/partners.store";
import * as store from "../infrastructure/distribution.store";
import {
  TierCodeDuplicateError,
  TierInvalidError,
  TierNotFoundError,
  TierPriceListInvalidError,
} from "../domain/distribution-errors";

/**
 * Customer tier service (PHASE-017 T11; §2 item 8; BR-003): tiers assign a
 * SALE price list (plus a discount cap + visit frequency) to a group of
 * customers. At sale time the pricing seam resolves
 *
 *   customer's own list → TIER list → item base price → manual
 *
 * so a tier NEVER overrides an explicitly quoted price — the resolution
 * only produces defaults, and the approval staleness gate re-resolves
 * through this same tier level (sales/application/pricing.ts).
 *
 * The tiers themselves are distribution-owned rows (`customer_tiers`); the
 * per-partner assignment (partners.customer_tier_id) rides the partners
 * store's additive updatePartnerTier — the documented tier-slice exception
 * (partners owns partner rows; distribution owns the tier rows), the same
 * shape as the VAN-slice exception in the warehouse store.
 */

function isUniqueViolation(error: unknown): boolean {
  let candidate: unknown = error;
  for (let depth = 0; depth < 4 && candidate !== null && candidate !== undefined; depth += 1) {
    if (typeof candidate === "object" && (candidate as { code?: string }).code === "23505") {
      return true;
    }
    candidate = (candidate as { cause?: unknown }).cause;
  }
  return false;
}

@Injectable()
export class TierService {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  async find(id: string): Promise<store.TierRow> {
    const tier = await store.findTierById(id);
    if (tier === undefined) throw new TierNotFoundError(id);
    return tier;
  }

  async list(filter: { status?: string; limit?: number } = {}): Promise<store.TierRow[]> {
    return store.listTiers({ status: filter.status, limit: filter.limit ?? 200 });
  }

  /** A tier's price list must exist and be a SALE-kind list (BR-003 — only
   * SALE lists price customers; a PURCHASE list is a supplier construct). */
  private async requireSalePriceList(priceListId: string): Promise<itemsStore.PriceListRow> {
    const list = await itemsStore.findPriceListById(priceListId);
    if (list === undefined) {
      throw new TierPriceListInvalidError(`price list ${priceListId} does not exist in this tenant`);
    }
    if (list.kind !== "SALE") {
      throw new TierPriceListInvalidError(`price list ${priceListId} is a ${list.kind} list — tiers need a SALE list`);
    }
    return list;
  }

  async create(input: {
    code: string;
    name: string;
    nameAr?: string | null;
    priceListId?: string | null;
    discountCapPct?: string | null;
    visitFrequencyDays?: number | null;
    note?: string | null;
    noteAr?: string | null;
    actorId: string | null;
  }): Promise<store.TierRow> {
    const duplicate = await store.findTierByCode(input.code);
    if (duplicate !== undefined) throw new TierCodeDuplicateError(input.code);
    if (input.priceListId !== undefined && input.priceListId !== null) {
      await this.requireSalePriceList(input.priceListId);
    }
    if (input.discountCapPct !== undefined && input.discountCapPct !== null) {
      const cap = Number(input.discountCapPct);
      if (!Number.isFinite(cap) || cap < 0 || cap > 100) {
        throw new TierInvalidError(`discountCapPct must be within 0..100, got ${input.discountCapPct}`);
      }
    }
    if (input.visitFrequencyDays !== undefined && input.visitFrequencyDays !== null && input.visitFrequencyDays < 0) {
      throw new TierInvalidError(`visitFrequencyDays must be >= 0, got ${input.visitFrequencyDays}`);
    }
    let created: store.TierRow;
    try {
      created = await store.insertTier({
        code: input.code,
        name: input.name,
        nameAr: input.nameAr ?? null,
        priceListId: input.priceListId ?? null,
        discountCapPct: input.discountCapPct ?? null,
        visitFrequencyDays: input.visitFrequencyDays ?? null,
        note: input.note ?? null,
        noteAr: input.noteAr ?? null,
        createdBy: input.actorId,
      });
    } catch (error) {
      // uq_customer_tiers_tenant_code raced past the pre-check.
      if (isUniqueViolation(error)) throw new TierCodeDuplicateError(input.code);
      throw error;
    }
    await this.audit.record({
      action: "distribution.tier_created",
      entityType: "customer_tier",
      entityId: created.id,
      actorId: input.actorId ?? undefined,
      after: {
        code: created.code,
        name: created.name,
        priceListId: created.priceListId,
        discountCapPct: created.discountCapPct,
        visitFrequencyDays: created.visitFrequencyDays,
      },
    });
    return created;
  }

  /** Additive patch: undefined fields stay untouched, nullable fields may be
   * explicitly cleared with null (name/priceList/discount/frequency/status). */
  async update(
    id: string,
    patch: {
      name?: string;
      nameAr?: string | null;
      priceListId?: string | null;
      discountCapPct?: string | null;
      visitFrequencyDays?: number | null;
      status?: string;
      note?: string | null;
      noteAr?: string | null;
    },
    actorId: string | null,
  ): Promise<store.TierRow> {
    const before = await this.find(id);
    if (patch.priceListId !== undefined && patch.priceListId !== null) {
      await this.requireSalePriceList(patch.priceListId);
    }
    if (patch.discountCapPct !== undefined && patch.discountCapPct !== null) {
      const cap = Number(patch.discountCapPct);
      if (!Number.isFinite(cap) || cap < 0 || cap > 100) {
        throw new TierInvalidError(`discountCapPct must be within 0..100, got ${patch.discountCapPct}`);
      }
    }
    if (patch.visitFrequencyDays !== undefined && patch.visitFrequencyDays !== null && patch.visitFrequencyDays < 0) {
      throw new TierInvalidError(`visitFrequencyDays must be >= 0, got ${patch.visitFrequencyDays}`);
    }
    if (patch.status !== undefined && patch.status !== "ACTIVE" && patch.status !== "INACTIVE") {
      throw new TierInvalidError(`status must be ACTIVE or INACTIVE, got ${patch.status}`);
    }
    const updated = (await store.updateTier(id, patch))!;
    await this.audit.record({
      action: "distribution.tier_updated",
      entityType: "customer_tier",
      entityId: id,
      actorId: actorId ?? undefined,
      before: {
        name: before.name,
        priceListId: before.priceListId,
        discountCapPct: before.discountCapPct,
        visitFrequencyDays: before.visitFrequencyDays,
        status: before.status,
      },
      after: {
        name: updated.name,
        priceListId: updated.priceListId,
        discountCapPct: updated.discountCapPct,
        visitFrequencyDays: updated.visitFrequencyDays,
        status: updated.status,
      },
    });
    return updated;
  }

  /**
   * Assign (or clear, tierId=null) a customer's tier — writes
   * partners.customer_tier_id through the partners store's additive
   * updatePartnerTier (partners owns partners rows; the tier must exist and
   * be visible here — A7-identical not-found for unknown vs foreign ids).
   */
  async assignPartner(
    partnerId: string,
    input: { tierId: string | null; actorId: string | null },
  ): Promise<{ partnerId: string; tierId: string | null }> {
    const partner = await partnersStore.findPartnerById(partnerId);
    if (partner === undefined || partner.deletedAt !== null) {
      throw new (await import("../../partners/domain/partner-errors")).PartnerNotFoundError(partnerId);
    }
    if (input.tierId !== null) {
      await this.find(input.tierId); // TierNotFoundError for unknown/foreign ids
    }
    const before = await store.findPartnerTier(partnerId);
    await partnersStore.updatePartnerTier(partnerId, input.tierId);
    await this.audit.record({
      action: "distribution.tier_partner_assigned",
      entityType: "customer_tier",
      entityId: input.tierId ?? partnerId,
      actorId: input.actorId ?? undefined,
      before: { partnerId, tierId: before?.id ?? null, tierCode: before?.code ?? null },
      after: { partnerId, tierId: input.tierId },
    });
    return { partnerId, tierId: input.tierId };
  }

  /** Partners grouped by tier for the tier editor UI (service-level surface —
   * no registered route; reports/UI consume the service). */
  async listPartnerTiers(): Promise<store.PartnerTierGroupRow[]> {
    return store.listPartnerTiers();
  }
}
