import { Inject, Injectable } from "@nestjs/common";
import { Decimal } from "@erp/domain-core";

import { AuditService } from "../../audit/api/audit";
import { ownTenantBaseCurrency } from "../../../infra/settings/setting-reader";
import { PostingService } from "../../accounting/application/posting-service";
import type { JournalLineSpec, JournalSpec } from "../../accounting/domain/posting-engine/journal-spec";
import { listOpeningBalanceDocsForPosting } from "../../partners/infrastructure/partners.store";
import * as store from "../infrastructure/inventory.store";
import { StockAdjustmentStateError } from "../domain/inventory-errors";
import * as journal from "../../accounting/infrastructure/journal.store";
import { applyReceipt, planReceipt, resolveInventoryAccount } from "./movement-core";

/**
 * Opening stock posting (PHASE-010 T6; §2.8; G-16's stock leg): consumes
 * the PHASE-006 `opening_balance_docs` STOCK drafts (deliberately left
 * DRAFT by PHASE-007 — "stock drafts post in PHASE-010") and posts them
 * through the OPENING period into the caller's chosen warehouse:
 * per-item stock layers/moves + ONE journal — DR INVENTORY (per-item
 * detail) · CR OPENING_EQUITY — balanced pair-by-pair.
 *
 * Idempotency: the journal's INV-013 key is (opening_stock, warehouseId,
 * post) — each warehouse posts its opening stock exactly once; drafts
 * flip to POSTED in the same transaction, so a replay is a no-op that
 * reports the stored entry (and a second warehouse finds no DRAFT rows
 * left — fail-closed).
 */
@Injectable()
export class OpeningStockService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    private readonly posting: PostingService,
  ) {}

  async listDrafts() {
    const docs = await listOpeningBalanceDocsForPosting("STOCK");
    return docs.filter((doc) => doc.status === "DRAFT");
  }

  async post(input: { warehouseId: string; actorId: string | null }) {
    const warehouse = await store.findWarehouseById(input.warehouseId);
    if (warehouse === undefined || !warehouse.isActive) {
      throw new StockAdjustmentStateError(
        `warehouse ${input.warehouseId} does not exist or is inactive`,
      );
    }
    const period = await store.findOpeningPeriod();
    if (period === undefined) {
      throw new StockAdjustmentStateError("no OPEN fiscal period found — create the fiscal year first");
    }
    // INV-013 replay short-circuit: a stored entry for this warehouse
    // converges without needing the (now POSTED) drafts.
    const stored = await journal.findEntryBySourceKey("opening_stock", input.warehouseId, "post");
    if (stored !== undefined) {
      return {
        journalEntryId: stored.id,
        entryNo: stored.entryNo,
        items: 0,
        total: "0.0000",
        idempotentReplay: true,
      };
    }
    const drafts = (await listOpeningBalanceDocsForPosting("STOCK")).filter(
      (doc) => doc.status === "DRAFT",
    );
    if (drafts.length === 0) {
      throw new StockAdjustmentStateError("no DRAFT stock opening balances to post");
    }
    const base = await ownTenantBaseCurrency();
    for (const doc of drafts) {
      if (doc.currencyCode !== base) {
        throw new StockAdjustmentStateError(
          `opening stock ${doc.id} is in ${doc.currencyCode}; only the base currency ${base} is postable`,
        );
      }
    }

    // PLAN every draft receipt (no writes): layers/avg deltas compose via
    // the pending overlay; the journal quantum is known before posting.
    const inventoryAccount = await resolveInventoryAccount(input.warehouseId);
    const lines: JournalLineSpec[] = [];
    const plans: { plan: Awaited<ReturnType<typeof planReceipt>>; docId: string }[] = [];
    let total = new Decimal(0);
    for (const doc of drafts) {
      const plan = await planReceipt({
        itemId: doc.itemId!,
        warehouseId: input.warehouseId,
        qty: doc.qty!,
        unitCost: doc.unitCost!,
        movedAt: period.startDate,
        moveKind: "receipt",
        sourceType: "opening_balance_doc",
        sourceId: doc.id,
        reason: "OPENING",
      });
      plans.push({ plan, docId: doc.id });
      lines.push({
        accountId: inventoryAccount,
        direction: "DEBIT",
        amount: plan.valueAmount,
        itemId: doc.itemId!,
        memo: {
          en: `Opening stock — ${doc.id.slice(0, 8)}`,
          ar: `مخزون افتتاحي — ${doc.id.slice(0, 8)}`,
        },
      });
      total = total.plus(new Decimal(plan.valueAmount));
    }
    lines.push({
      purpose: "OPENING_EQUITY",
      direction: "CREDIT",
      amount: total.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4),
      memo: { en: "Opening stock balances", ar: "أرصدة المخزون الافتتاحية" },
    });

    const spec: JournalSpec = {
      source: { docType: "opening_stock", docId: input.warehouseId, operation: "post" },
      entryDate: period.startDate,
      fiscalPeriodId: period.id,
      description: {
        en: `Opening stock into ${warehouse.code}`,
        ar: `مخزون افتتاحي إلى ${warehouse.code}`,
      },
      currency: base,
      lines,
    };
    const result = await this.posting.post(spec, { postedBy: input.actorId });
    if (!result.idempotentReplay) {
      for (const row of plans) {
        await applyReceipt(row.plan, result.journalEntryId);
      }
      for (const doc of drafts) {
        await store.markOpeningDocPosted(doc.id);
      }
    }
    await this.audit.record({
      action: "inventory.opening_stock_posted",
      entityType: "warehouse",
      entityId: input.warehouseId,
      actorId: input.actorId ?? undefined,
      after: {
        journalEntryId: result.journalEntryId,
        entryNo: result.entryNo,
        items: drafts.length,
        total: total.toFixed(4),
        fiscalPeriodId: period.id,
      },
    });
    return {
      journalEntryId: result.journalEntryId,
      entryNo: result.entryNo,
      items: drafts.length,
      total: total.toFixed(4),
      idempotentReplay: result.idempotentReplay,
    };
  }
}
