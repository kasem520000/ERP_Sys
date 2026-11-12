import { Inject, Injectable } from "@nestjs/common";
import { Decimal } from "@erp/domain-core";

import { AuditService } from "../../audit/api/audit";
import { PostingService } from "../../accounting/application/posting-service";
import type { JournalLineSpec, JournalSpec } from "../../accounting/domain/posting-engine/journal-spec";
import { resolveInventoryAccount } from "../../inventory/application/movement-core";
import { ownTenantBaseCurrency } from "../../../infra/settings/setting-reader";
import * as store from "../infrastructure/manufacturing.store";
import type { ItemStandardCostRow, WorkCenterRow } from "../infrastructure/manufacturing.store";
import {
  BomRequiredError,
  StandardCostActiveExistsError,
  StandardCostInvalidError,
  StandardCostMissingError,
  StandardCostNotFoundError,
  StandardCostNotDraftError,
  StandardCostVersionConflictError,
  StandardRevaluationZeroError,
} from "../domain/manufacturing-errors";

/**
 * Standard-cost service (PHASE-042 L2-12): the frozen per-item standard by
 * cost type — MANUAL drafts + the BOM/routing ROLL-UP, the BOM-discipline
 * activation (one ACTIVE per item, archives the previous in the same call),
 * the optional stock REVALUATION on activate, and the release-time freeze
 * seam (findActiveStandardCost — the production-order release stamps
 * std_unit_cost from it; PPV at receipt reads it through the purchasing
 * store).
 *
 * rollUp(itemId) — the documented DECISION (the phase's "KEEP IT SIMPLE"
 * shape): the low-level explosion over the item's ACTIVE BOM level 1 +
 * its ACTIVE routing, per UNIT of output:
 *   material = Σ level-1 gross qty × component.total_cost
 *     (gross = qtyPerOutput × (1 + scrap/100) ÷ (yield/100), round6 — the
 *     BomService level-1 formula verbatim). A component without an ACTIVE
 *     standard fails closed (StandardCostMissingError naming it) — the
 *     recursion happens because each component's total is ITSELF rolled up:
 *     callers roll components first (the low-level-code discipline).
 *   labor   = Σ routing ops (setup + run × 1) × var_rate  — 0 when the item
 *   overhead = Σ routing ops (setup + run × 1) × fixed_rate  has no routing
 *   (rate = the op override ?? the work center's rate — the freeze rule).
 * Source = ROLLED_UP with rolled_up_at = now; the row lands as a DRAFT.
 *
 * activate(id, {revaluateStock}) — effective_from defaults to today. With
 * revaluateStock: ONE batch revaluation journal over every warehouse holding
 * the item with qty > 0 (source item_standard_cost, operation "revaluate"):
 *   new > old: DR inventory account (new − old) × qty · CR STANDARD_REVALUATION
 *   new < old: DR STANDARD_REVALUATION · CR inventory (old − new) × qty
 * aggregated per resolved inventory account (resolveInventoryAccount — the
 * GRN precedent), 4dp exact. No stock ⇒ nothing participates ⇒ no journal
 * (the documented no-op); stock present but a zero net delta ⇒ the typed
 * StandardRevaluationZeroError (a zero-value journal cannot post).
 *
 * PPV at receipt (G-42's sibling) is integrated at the goods-receipt posting
 * path (purchasing/application/goods-receipts.ts, shape A — documented
 * there): standard items receive at the ACTIVE standard total with the
 * variance leg on the SAME G-07 journal; non-standard items keep the legacy
 * WAC shape byte-identical (the dual mode).
 */

const COST6_RE = /^\d+(\.\d{1,6})?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 23505 = unique_violation; unwraps driver causes (the bom-service helper). */
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

function round6(value: Decimal): Decimal {
  return value.toDecimalPlaces(6, Decimal.ROUND_HALF_UP);
}
function round4(value: Decimal): Decimal {
  return value.toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
}

export interface OverheadSubSplit {
  key: string;
  amount: string;
}

export interface CreateStandardCostInput {
  itemId: string;
  materialCost: string;
  laborCost: string;
  overheadCost: string;
  overheadSubSplits?: readonly OverheadSubSplit[] | null;
  effectiveFrom?: string | null;
  note?: string | null;
  noteAr?: string | null;
  actorId: string | null;
}

export interface RollUpResult {
  standard: ItemStandardCostRow;
  materialCost: string;
  laborCost: string;
  overheadCost: string;
}

@Injectable()
export class StandardCostService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    // NOTE: every param carries an explicit @Inject (the vitest/esbuild
    // pipeline does not emit design:paramtypes — the T-13 boot lesson).
    @Inject(PostingService) private readonly posting: PostingService,
  ) {}

  // -- reads -------------------------------------------------------------------

  async find(id: string): Promise<ItemStandardCostRow> {
    const standard = await store.findStandardCostById(id);
    if (standard === undefined) throw new StandardCostNotFoundError(id);
    return standard;
  }

  async getActive(itemId: string): Promise<ItemStandardCostRow | null> {
    return (await store.findActiveStandardCost(itemId)) ?? null;
  }

  async list(filter: { itemId?: string; limit: number }): Promise<ItemStandardCostRow[]> {
    return store.listStandardCosts(filter);
  }

  // -- createDraft (MANUAL; total = the typed sum — never a fourth number) ---------

  async createDraft(input: CreateStandardCostInput): Promise<ItemStandardCostRow> {
    const item = await store.findItemForBom(input.itemId);
    if (item === undefined || item.deletedAt !== null) {
      throw new StandardCostNotFoundError(`item ${input.itemId} does not exist in this tenant`);
    }
    const materialCost = this.canonicalCost(input.materialCost, "materialCost");
    const laborCost = this.canonicalCost(input.laborCost, "laborCost");
    const overheadCost = this.canonicalCost(input.overheadCost, "overheadCost");
    const totalCost = round6(
      new Decimal(materialCost).plus(new Decimal(laborCost)).plus(new Decimal(overheadCost)),
    ).toFixed(6);
    const overheadSubSplits = this.validateSubSplits(input.overheadSubSplits ?? null, overheadCost);
    if (input.effectiveFrom != null && !DATE_RE.test(input.effectiveFrom)) {
      throw new StandardCostInvalidError(`effectiveFrom must be an ISO date (YYYY-MM-DD): ${input.effectiveFrom}`);
    }
    const versions = await store.listStandardCostsForItem(input.itemId);
    const versionNo = versions.reduce((max, row) => Math.max(max, row.versionNo), 0) + 1;
    let created: ItemStandardCostRow;
    try {
      created = await store.insertItemStandardCost({
        itemId: input.itemId,
        versionNo,
        materialCost,
        laborCost,
        overheadCost,
        totalCost,
        overheadSubSplits,
        source: "MANUAL",
        rolledUpAt: null,
        effectiveFrom: input.effectiveFrom ?? null,
        note: input.note ?? null,
        noteAr: input.noteAr ?? null,
        actorId: input.actorId,
      });
    } catch (error) {
      // uq_item_standard_costs_tenant_item_version — a concurrent create.
      if (isUniqueViolation(error)) throw new StandardCostVersionConflictError(input.itemId, versionNo);
      throw error;
    }
    await this.audit.record({
      action: "manufacturing.standard_cost.created",
      entityType: "item_standard_cost",
      entityId: created.id,
      actorId: input.actorId ?? undefined,
      after: { itemId: input.itemId, versionNo, source: "MANUAL", materialCost, laborCost, overheadCost, totalCost },
    });
    return created;
  }

  // -- rollUp (the BOM + routing explosion → a new ROLLED_UP DRAFT) -------------------

  async rollUp(itemId: string, input: { actorId: string | null }): Promise<RollUpResult> {
    const item = await store.findItemForBom(itemId);
    if (item === undefined || item.deletedAt !== null) {
      throw new StandardCostNotFoundError(`item ${itemId} does not exist in this tenant`);
    }
    // The ACTIVE BOM is required (nothing to roll without a recipe).
    const bom = await store.findActiveBom(itemId);
    if (bom === undefined) throw new BomRequiredError(itemId);
    const bomLines = await store.listBomLines(bom.id);
    const yieldDivisor = new Decimal(bom.yieldPct).div(100);

    // material = Σ level-1 gross × component.total (the component's own
    // ACTIVE standard — itself rolled up by the caller; missing ⇒ named
    // fail-closed, the low-level-code discipline).
    let materialSum = new Decimal(0);
    const missing: string[] = [];
    for (const line of bomLines) {
      const componentStandard = await store.findActiveStandardCost(line.componentItemId);
      if (componentStandard === undefined) {
        missing.push(line.componentItemId);
        continue;
      }
      const gross = round6(
        new Decimal(line.qtyPerOutput)
          .times(new Decimal(line.scrapPct).plus(100).div(100))
          .div(yieldDivisor),
      );
      materialSum = materialSum.plus(gross.times(new Decimal(componentStandard.totalCost)));
    }
    if (missing.length > 0) throw new StandardCostMissingError(missing);
    const materialCost = round6(materialSum).toFixed(6);

    // labor/overhead = the ACTIVE routing's per-unit conversion × rates
    // (0 when the item has no routing — a purchased component's shape).
    let laborSum = new Decimal(0);
    let overheadSum = new Decimal(0);
    const routing = await store.findActiveRouting(itemId);
    if (routing !== undefined) {
      const operations = await store.listRoutingOperations(routing.id);
      for (const op of operations) {
        const workCenter: WorkCenterRow | undefined = await store.findWorkCenterById(op.workCenterId);
        const fixedRate = op.fixedCostRate ?? workCenter?.fixedCostRate ?? "0";
        const varRate = op.varCostRate ?? workCenter?.varCostRate ?? "0";
        const perUnitTime = new Decimal(op.setupTime).plus(new Decimal(op.runTime));
        laborSum = laborSum.plus(perUnitTime.times(new Decimal(varRate)));
        overheadSum = overheadSum.plus(perUnitTime.times(new Decimal(fixedRate)));
      }
    }
    const laborCost = round6(laborSum).toFixed(6);
    const overheadCost = round6(overheadSum).toFixed(6);
    const totalCost = round6(
      new Decimal(materialCost).plus(new Decimal(laborCost)).plus(new Decimal(overheadCost)),
    ).toFixed(6);

    const versions = await store.listStandardCostsForItem(itemId);
    const versionNo = versions.reduce((max, row) => Math.max(max, row.versionNo), 0) + 1;
    let created: ItemStandardCostRow;
    try {
      created = await store.insertItemStandardCost({
        itemId,
        versionNo,
        materialCost,
        laborCost,
        overheadCost,
        totalCost,
        overheadSubSplits: [],
        source: "ROLLED_UP",
        rolledUpAt: new Date().toISOString(),
        effectiveFrom: null,
        note: `rolled up from BOM v${bom.versionNo}${routing !== undefined ? ` + routing v${routing.versionNo}` : ""}`,
        noteAr: null,
        actorId: input.actorId,
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new StandardCostVersionConflictError(itemId, versionNo);
      throw error;
    }
    await this.audit.record({
      action: "manufacturing.standard_cost.rolled_up",
      entityType: "item_standard_cost",
      entityId: created.id,
      actorId: input.actorId ?? undefined,
      after: {
        itemId,
        versionNo,
        source: "ROLLED_UP",
        bomVersionNo: bom.versionNo,
        routingVersionNo: routing?.versionNo ?? null,
        materialCost,
        laborCost,
        overheadCost,
        totalCost,
      },
    });
    return { standard: created, materialCost, laborCost, overheadCost };
  }

  // -- activate (BOM discipline + the optional stock revaluation) ---------------------

  async activate(
    id: string,
    input: { revaluateStock?: boolean; effectiveFrom?: string | null; actorId: string | null },
  ): Promise<{ standard: ItemStandardCostRow; revaluationJournalId: string | null }> {
    const standard = await this.find(id);
    if (standard.status !== "DRAFT") {
      throw new StandardCostNotDraftError(`item standard cost ${id} is ${standard.status} — only DRAFT versions activate`);
    }
    const effectiveFrom =
      input.effectiveFrom !== undefined && input.effectiveFrom !== null ? input.effectiveFrom : this.today();
    if (!DATE_RE.test(effectiveFrom)) {
      throw new StandardCostInvalidError(`effectiveFrom must be an ISO date (YYYY-MM-DD): ${effectiveFrom}`);
    }
    // One-active invariant: capture the previous ACTIVE (the revaluation
    // baseline), archive it, then flip — the partial unique index never
    // trips on our own writes; the 23505 catch is the concurrent race.
    const previous = await store.findActiveStandardCost(standard.itemId);
    let archivedPrevious: { id: string; versionNo: number } | null = null;
    if (previous !== undefined && previous.id !== id) {
      await store.patchStandardCost({ id: previous.id, status: "ARCHIVED" });
      archivedPrevious = { id: previous.id, versionNo: previous.versionNo };
    }
    try {
      await store.patchStandardCost({ id, status: "ACTIVE", effectiveFrom });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new StandardCostActiveExistsError(standard.itemId, previous?.id ?? null);
      }
      throw error;
    }
    let revaluationJournalId: string | null = null;
    if (input.revaluateStock === true) {
      revaluationJournalId = await this.revaluateStock(standard, previous ?? null, input.actorId);
    }
    await this.audit.record({
      action: "manufacturing.standard_cost.activated",
      entityType: "item_standard_cost",
      entityId: id,
      actorId: input.actorId ?? undefined,
      after: {
        status: "ACTIVE",
        effectiveFrom,
        versionNo: standard.versionNo,
        totalCost: standard.totalCost,
        archivedPrevious,
        revaluateStock: input.revaluateStock === true,
        revaluationJournalId,
      },
    });
    return { standard: await this.find(id), revaluationJournalId };
  }

  // -- the revaluation batch (one journal; per-account legs) ---------------------------

  private async revaluateStock(
    standard: ItemStandardCostRow,
    previous: ItemStandardCostRow | null,
    actorId: string | null,
  ): Promise<string | null> {
    // Only warehouses with qty > 0 participate; no stock ⇒ no-op (the
    // documented zero-effect path); no PREVIOUS active standard ⇒ nothing
    // to revalue against (first activation — no-op).
    if (previous === null) return null;
    const positions = await store.listItemStockPositions(standard.itemId);
    if (positions.length === 0) return null;
    const delta = new Decimal(standard.totalCost).minus(new Decimal(previous.totalCost));
    if (delta.isZero()) {
      throw new StandardRevaluationZeroError(standard.itemId);
    }
    // Per-account aggregation (new − old) × qty at 4dp — one batch journal.
    const byAccount = new Map<string, Decimal>();
    for (const position of positions) {
      const accountId = await resolveInventoryAccount(position.warehouseId);
      const leg = new Decimal(position.qty).times(delta);
      byAccount.set(accountId, (byAccount.get(accountId) ?? new Decimal(0)).plus(leg));
    }
    const lines: JournalLineSpec[] = [];
    const up = delta.greaterThan(0);
    for (const [accountId, amountDecimal] of [...byAccount.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
      const amount = round4(amountDecimal.abs()).toFixed(4);
      if (amount === "0.0000") continue;
      lines.push({
        accountId,
        direction: up ? "DEBIT" : "CREDIT",
        amount,
        memo: {
          en: `Standard revaluation — item ${standard.itemId} to ${standard.totalCost}/unit`,
          ar: `إعادة تقييم معيارية — الصنف ${standard.itemId} إلى ${standard.totalCost}/وحدة`,
        },
      });
    }
    // The counter leg is the EXACT typed sum of the posted line amounts —
    // never an independently rounded total (a skipped zero leg cannot strand
    // a residue; the engine's DR=CR check is the final floor).
    const total = lines
      .reduce((sum, line) => sum.plus(new Decimal(line.amount)), new Decimal(0))
      .toFixed(4);
    if (lines.length === 0 || total === "0.0000") {
      throw new StandardRevaluationZeroError(standard.itemId);
    }
    lines.push({
      purpose: "STANDARD_REVALUATION",
      direction: up ? "CREDIT" : "DEBIT",
      amount: total,
      memo: {
        en: `Standard revaluation — item ${standard.itemId} (${up ? "increase" : "decrease"} ${total})`,
        ar: `إعادة تقييم معيارية — الصنف ${standard.itemId} (${up ? "زيادة" : "نقص"} ${total})`,
      },
    });
    const spec: JournalSpec = {
      source: { docType: "item_standard_cost", docId: standard.id, operation: "revaluate" },
      entryDate: this.today(),
      description: {
        en: `Standard cost revaluation — item ${standard.itemId} v${standard.versionNo}`,
        ar: `إعادة تقييم التكلفة المعيارية — الصنف ${standard.itemId} v${standard.versionNo}`,
      },
      currency: await ownTenantBaseCurrency(),
      lines,
    };
    const posted = await this.posting.post(spec, { postedBy: actorId });
    return posted.journalEntryId;
  }

  // -- validation helpers ---------------------------------------------------------------

  /** numeric(19,6) per-unit cost: ≥ 0. */
  private canonicalCost(raw: string, what: string): string {
    if (!COST6_RE.test(raw)) {
      throw new StandardCostInvalidError(`${what} must be a non-negative decimal (≤ 6dp): ${raw}`);
    }
    return new Decimal(raw).toFixed(6);
  }

  /** The sub-splits decompose the overhead: [{key, amount}] with the typed
   * sum EXACTLY the overhead cost (the 0066 CHECK pins array-ness only —
   * the service pins the element shape + the sum, the 0064 precedent). */
  private validateSubSplits(raw: readonly OverheadSubSplit[] | null, overheadCost: string): OverheadSubSplit[] {
    if (raw === null) return [];
    const validated: OverheadSubSplit[] = [];
    let sum = new Decimal(0);
    const seen = new Set<string>();
    for (const split of raw) {
      const key = (split.key ?? "").trim();
      if (key === "" || key.length > 40 || seen.has(key)) {
        throw new StandardCostInvalidError(`overhead sub-split keys are unique, 1..40 chars — got ${String(split.key)}`);
      }
      seen.add(key);
      if (!COST6_RE.test(split.amount) || new Decimal(split.amount).lessThan(0)) {
        throw new StandardCostInvalidError(`overhead sub-split ${key} amount must be a non-negative decimal (≤ 6dp): ${split.amount}`);
      }
      validated.push({ key, amount: new Decimal(split.amount).toFixed(6) });
      sum = sum.plus(new Decimal(split.amount));
    }
    if (validated.length > 0 && sum.toFixed(6) !== new Decimal(overheadCost).toFixed(6)) {
      throw new StandardCostInvalidError(
        `the overhead sub-splits sum to ${sum.toFixed(6)} but overheadCost is ${overheadCost} — the splits decompose the overhead exactly`,
      );
    }
    return validated;
  }

  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }
}
