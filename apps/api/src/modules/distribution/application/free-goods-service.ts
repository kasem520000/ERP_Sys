import { Inject, Injectable } from "@nestjs/common";

import { Decimal } from "@erp/domain-core";

import { AuditService } from "../../audit/api/audit";
import * as itemsStore from "../../items/infrastructure/items.store";
import * as store from "../infrastructure/distribution.store";
import {
  FreeGoodsRuleCodeDuplicateError,
  FreeGoodsRuleInvalidError,
  FreeGoodsRuleNotFoundError,
} from "../domain/distribution-errors";

/**
 * Free goods service (PHASE-017 T11; §2 item 9; BR-008): rule-based
 * buy-X-get-Y promotions scoped per customer tier with validity windows
 * and per-order free caps. The rules NEVER post anything themselves — at
 * sale time `evaluate` computes the free quantities and the caller (van /
 * POS sale flow) appends them as ZERO-PRICE lines carrying the rule's
 * reason code (`appendFocLines` is that convenience); the invoice then
 * issues stock and posts COGS through the ordinary path while the revenue
 * side stays zero (BR-008: free goods are zero-price lines with a reason,
 * never negative lines or memo-only adjustments).
 *
 * The quantity math is pure and property-testable: for each rule whose BUY
 * item appears in the sale lines (quantities aggregated per item),
 *
 *   multiples = perMultiple ? floor(lineQty / buyQty) : (lineQty >= buyQty ? 1 : 0)
 *   free      = multiples × getQty      (capped by maxFreePerOrder)
 *
 * Tier scoping: a rule with tierId=null applies to every customer; a rule
 * with a tier applies only when the customer's assigned tier matches.
 */

/** One computed free-goods line (the caller maps it onto a zero-price
 * document line with focReasonCode = reasonCode). */
export interface FreeGoodsLine {
  itemId: string;
  /** Canonical 6-dp quantity. */
  qty: string;
  reasonCode: string;
  ruleCode: string;
}

/** The zero-price draft `appendFocLines` appends (invoice-line shaped). */
export interface FocLineDraft {
  itemId: string;
  qty: string;
  /** Always "0.000000" — BR-008 zero-price. */
  unitPrice: string;
  focReasonCode: string;
  ruleCode: string;
}

const QTY_RE = /^\d+(\.\d{1,6})?$/;

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
export class FreeGoodsService {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  async find(id: string): Promise<store.FreeGoodsRuleRow> {
    const rule = await store.findFreeGoodsRuleById(id);
    if (rule === undefined) throw new FreeGoodsRuleNotFoundError(id);
    return rule;
  }

  async list(filter: { status?: string; tierId?: string; limit?: number } = {}): Promise<store.FreeGoodsRuleRow[]> {
    return store.listFreeGoodsRules({
      status: filter.status,
      tierId: filter.tierId,
      limit: filter.limit ?? 200,
    });
  }

  private async requireItem(itemId: string, label: string): Promise<void> {
    const item = await itemsStore.findItemById(itemId);
    if (item === undefined || item.deletedAt !== null) {
      throw new FreeGoodsRuleInvalidError(`${label} item ${itemId} does not exist in this tenant`);
    }
  }

  /** Shared create/update validation (the update path validates only the
   * provided fields against the merged before-state). */
  private async validateRuleData(input: {
    buyItemId?: string;
    buyQty?: string;
    getItemId?: string;
    getQty?: string;
    tierId?: string | null;
    reasonCode?: string;
    validFrom?: string | null;
    validTo?: string | null;
    maxFreePerOrder?: string | null;
  }): Promise<void> {
    if (input.buyItemId !== undefined) await this.requireItem(input.buyItemId, "buy");
    if (input.getItemId !== undefined) await this.requireItem(input.getItemId, "get");
    if (input.buyQty !== undefined && (!QTY_RE.test(input.buyQty) || Number(input.buyQty) <= 0)) {
      throw new FreeGoodsRuleInvalidError(`buyQty must be a positive decimal (≤ 6dp), got ${input.buyQty}`);
    }
    if (input.getQty !== undefined && (!QTY_RE.test(input.getQty) || Number(input.getQty) <= 0)) {
      throw new FreeGoodsRuleInvalidError(`getQty must be a positive decimal (≤ 6dp), got ${input.getQty}`);
    }
    if (input.maxFreePerOrder !== undefined && input.maxFreePerOrder !== null) {
      if (!QTY_RE.test(input.maxFreePerOrder) || Number(input.maxFreePerOrder) < 0) {
        throw new FreeGoodsRuleInvalidError(
          `maxFreePerOrder must be a non-negative decimal (≤ 6dp), got ${input.maxFreePerOrder}`,
        );
      }
    }
    if (input.tierId !== undefined && input.tierId !== null) {
      const tier = await store.findTierById(input.tierId);
      if (tier === undefined) {
        throw new FreeGoodsRuleInvalidError(`tier ${input.tierId} does not exist in this tenant`);
      }
    }
    if (input.reasonCode !== undefined) {
      const reason = input.reasonCode.trim();
      if (reason.length === 0 || reason.length > 30) {
        throw new FreeGoodsRuleInvalidError(
          `reasonCode is required (BR-008) and must be 1..30 non-space characters, got "${input.reasonCode}"`,
        );
      }
    }
    if (
      input.validFrom !== undefined &&
      input.validTo !== undefined &&
      input.validFrom !== null &&
      input.validTo !== null &&
      input.validTo < input.validFrom
    ) {
      throw new FreeGoodsRuleInvalidError(
        `validity window is inverted: valid_to ${input.validTo} precedes valid_from ${input.validFrom}`,
      );
    }
  }

  async create(input: {
    code: string;
    name: string;
    nameAr?: string | null;
    buyItemId: string;
    buyQty: string;
    getItemId: string;
    getQty: string;
    perMultiple?: boolean;
    maxFreePerOrder?: string | null;
    tierId?: string | null;
    reasonCode: string;
    validFrom?: string | null;
    validTo?: string | null;
    note?: string | null;
    noteAr?: string | null;
    actorId: string | null;
  }): Promise<store.FreeGoodsRuleRow> {
    const duplicate = await store.findFreeGoodsRuleByCode(input.code);
    if (duplicate !== undefined) throw new FreeGoodsRuleCodeDuplicateError(input.code);
    await this.validateRuleData(input);
    let created: store.FreeGoodsRuleRow;
    try {
      created = await store.insertFreeGoodsRule({
        code: input.code,
        name: input.name,
        nameAr: input.nameAr ?? null,
        buyItemId: input.buyItemId,
        buyQty: input.buyQty,
        getItemId: input.getItemId,
        getQty: input.getQty,
        perMultiple: input.perMultiple ?? true,
        maxFreePerOrder: input.maxFreePerOrder ?? null,
        tierId: input.tierId ?? null,
        reasonCode: input.reasonCode,
        validFrom: input.validFrom ?? null,
        validTo: input.validTo ?? null,
        note: input.note ?? null,
        noteAr: input.noteAr ?? null,
        createdBy: input.actorId,
      });
    } catch (error) {
      // uq_free_goods_rules_tenant_code raced past the pre-check.
      if (isUniqueViolation(error)) throw new FreeGoodsRuleCodeDuplicateError(input.code);
      throw error;
    }
    await this.audit.record({
      action: "distribution.free_goods_rule_created",
      entityType: "free_goods_rule",
      entityId: created.id,
      actorId: input.actorId ?? undefined,
      after: {
        code: created.code,
        name: created.name,
        buyItemId: created.buyItemId,
        buyQty: created.buyQty,
        getItemId: created.getItemId,
        getQty: created.getQty,
        perMultiple: created.perMultiple,
        maxFreePerOrder: created.maxFreePerOrder,
        tierId: created.tierId,
        reasonCode: created.reasonCode,
        validFrom: created.validFrom,
        validTo: created.validTo,
      },
    });
    return created;
  }

  /** Additive patch: undefined fields stay untouched, nullable fields may be
   * explicitly cleared with null; the validity window is validated against
   * the merged before-state. */
  async update(
    id: string,
    patch: {
      name?: string;
      nameAr?: string | null;
      buyItemId?: string;
      buyQty?: string;
      getItemId?: string;
      getQty?: string;
      perMultiple?: boolean;
      maxFreePerOrder?: string | null;
      tierId?: string | null;
      reasonCode?: string;
      validFrom?: string | null;
      validTo?: string | null;
      status?: string;
      note?: string | null;
      noteAr?: string | null;
    },
    actorId: string | null,
  ): Promise<store.FreeGoodsRuleRow> {
    const before = await this.find(id);
    if (patch.status !== undefined && patch.status !== "ACTIVE" && patch.status !== "INACTIVE") {
      throw new FreeGoodsRuleInvalidError(`status must be ACTIVE or INACTIVE, got ${patch.status}`);
    }
    await this.validateRuleData({
      buyItemId: patch.buyItemId,
      buyQty: patch.buyQty,
      getItemId: patch.getItemId,
      getQty: patch.getQty,
      tierId: patch.tierId,
      reasonCode: patch.reasonCode,
      validFrom: patch.validFrom !== undefined ? patch.validFrom : before.validFrom,
      validTo: patch.validTo !== undefined ? patch.validTo : before.validTo,
      maxFreePerOrder: patch.maxFreePerOrder,
    });
    const updated = (await store.updateFreeGoodsRule(id, patch))!;
    await this.audit.record({
      action: "distribution.free_goods_rule_updated",
      entityType: "free_goods_rule",
      entityId: id,
      actorId: actorId ?? undefined,
      before: {
        name: before.name,
        buyQty: before.buyQty,
        getQty: before.getQty,
        perMultiple: before.perMultiple,
        maxFreePerOrder: before.maxFreePerOrder,
        tierId: before.tierId,
        reasonCode: before.reasonCode,
        validFrom: before.validFrom,
        validTo: before.validTo,
        status: before.status,
      },
      after: {
        name: updated.name,
        buyQty: updated.buyQty,
        getQty: updated.getQty,
        perMultiple: updated.perMultiple,
        maxFreePerOrder: updated.maxFreePerOrder,
        tierId: updated.tierId,
        reasonCode: updated.reasonCode,
        validFrom: updated.validFrom,
        validTo: updated.validTo,
        status: updated.status,
      },
    });
    return updated;
  }

  /**
   * The rule engine: free goods for a sale (pure quantity math over the
   * active, window-valid rules; no writes, no journals). `customerId` may
   * be null (walk-in) — tier-scoped rules then never fire. Sale-line
   * quantities are aggregated per item before the per-rule math.
   */
  async evaluate(input: {
    customerId: string | null;
    lines: readonly { itemId: string; qty: string }[];
    date: string;
  }): Promise<FreeGoodsLine[]> {
    const rules = await store.activeFreeGoodsRules(input.date);
    if (rules.length === 0) return [];

    const customerTier =
      input.customerId !== null ? await store.findPartnerTier(input.customerId) : undefined;

    const qtyByItem = new Map<string, Decimal>();
    for (const line of input.lines) {
      if (!QTY_RE.test(line.qty) || Number(line.qty) <= 0) continue;
      qtyByItem.set(line.itemId, (qtyByItem.get(line.itemId) ?? new Decimal(0)).plus(new Decimal(line.qty)));
    }

    const result: FreeGoodsLine[] = [];
    for (const rule of rules) {
      // Tier scoping: tierId null = every customer; else exact tier match.
      if (rule.tierId !== null) {
        if (customerTier === undefined || customerTier.id !== rule.tierId) continue;
      }
      const bought = qtyByItem.get(rule.buyItemId);
      if (bought === undefined) continue; // the BUY item must appear in the sale
      const buyQty = new Decimal(rule.buyQty);
      const multiples = rule.perMultiple
        ? bought.div(buyQty).floor()
        : bought.greaterThanOrEqualTo(buyQty)
          ? new Decimal(1)
          : new Decimal(0);
      let free = multiples.times(new Decimal(rule.getQty));
      if (rule.maxFreePerOrder !== null) {
        const cap = new Decimal(rule.maxFreePerOrder);
        if (free.greaterThan(cap)) free = cap;
      }
      if (free.lessThanOrEqualTo(0)) continue;
      result.push({
        itemId: rule.getItemId,
        qty: free.toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toFixed(6),
        reasonCode: rule.reasonCode,
        ruleCode: rule.code,
      });
    }
    return result;
  }

  /**
   * Sale-time convenience for the van/POS flow: evaluates the rules for the
   * (customer, lines, date) and returns the merged array — the original
   * lines untouched, followed by one zero-price FOC draft per computed free
   * line (unitPrice "0.000000", focReasonCode from the rule). The caller
   * maps FocLineDraft onto its document-line shape; invoices then issue
   * stock and post COGS for them exactly as for any other item line
   * (BR-008: zero revenue, stock + COGS still move).
   */
  async appendFocLines<L extends { itemId: string | null; qty: string }>(
    customerId: string | null,
    lines: readonly L[],
    date: string,
  ): Promise<Array<L | FocLineDraft>> {
    const foc = await this.evaluate({
      customerId,
      lines: lines
        .filter((line): line is L & { itemId: string } => line.itemId !== null)
        .map((line) => ({ itemId: line.itemId, qty: line.qty })),
      date,
    });
    const drafts: FocLineDraft[] = foc.map((line) => ({
      itemId: line.itemId,
      qty: line.qty,
      unitPrice: "0.000000",
      focReasonCode: line.reasonCode,
      ruleCode: line.ruleCode,
    }));
    return drafts.length === 0 ? [...lines] : [...lines, ...drafts];
  }
}
