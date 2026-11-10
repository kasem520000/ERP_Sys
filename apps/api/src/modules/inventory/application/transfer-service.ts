import { Inject, Injectable } from "@nestjs/common";
import { Decimal } from "@erp/domain-core";
import { generateUuidV7 } from "@erp/domain-core";

import { AuditService } from "../../audit/api/audit";
import { ownTenantBaseCurrency } from "../../../infra/settings/setting-reader";
import { PostingService } from "../../accounting/application/posting-service";
import { NumberingService } from "../../accounting/application/numbering-service";
import type { JournalLineSpec, JournalSpec } from "../../accounting/domain/posting-engine/journal-spec";
import * as store from "../infrastructure/inventory.store";
import {
  StockTransferEmptyError,
  StockTransferNotFoundError,
  StockTransferSameWarehouseError,
  StockTransferStateError,
} from "../domain/inventory-errors";
import {
  applyIssue,
  applyReceipt,
  planIssue,
  planReceipt,
  requirePositiveQty,
  resolveInventoryAccount,
} from "./movement-core";

/**
 * Stock transfers (PHASE-010 T7; §2.9; BR-016; G-15): DRAFT → IN_TRANSIT →
 * POSTED two-leg documents.
 *
 * Dispatch (DRAFT→IN_TRANSIT) writes the OUT leg at the source's current
 * valuation (WAC average / FIFO layer consumption) and takes the official
 * TRN number; receive (IN_TRANSIT→POSTED) writes the IN leg carrying the
 * SAME cost — value is conserved across warehouses.
 *
 * Journal policy (G-15 + the policy-none case): a journal exists ONLY
 * when the source and destination warehouses resolve DISTINCT GL
 * inventory accounts — DR dest · CR src; when they map the same account
 * (the default single-INVENTORY-account tenant), the legs post NO
 * journal and the move rows carry posted_journal_id = NULL (explicitly
 * asserted by the tests + the INV-010 reconciliation construction).
 *
 * IN_TRANSIT stock is visible but never sellable/reservable (BR-016):
 * it left the source (qty already down) and has not entered the
 * destination — the availability service nets it out.
 */
@Injectable()
export class TransferService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    private readonly posting: PostingService,
    private readonly numbering: NumberingService,
  ) {}

  async list(filter: { status?: string; warehouseId?: string; limit: number }) {
    return store.listTransfers(filter);
  }

  async find(id: string) {
    const transfer = await store.findTransferById(id);
    if (transfer === undefined) throw new StockTransferNotFoundError(id);
    return transfer;
  }

  async lines(id: string) {
    await this.find(id);
    return store.listTransferLines(id);
  }

  async create(input: {
    fromWarehouseId: string;
    toWarehouseId: string;
    lines: { itemId: string; qty: string }[];
    note: string | null;
    noteAr: string | null;
    actorId: string | null;
  }) {
    if (input.fromWarehouseId === input.toWarehouseId) {
      throw new StockTransferSameWarehouseError();
    }
    const seen = new Set<string>();
    let lineNo = 0;
    for (const line of input.lines) {
      if (seen.has(line.itemId)) {
        throw new StockTransferStateError("one line per item per transfer");
      }
      seen.add(line.itemId);
      requirePositiveQty(line.qty, "transfer line qty");
      void lineNo++;
    }
    const id = generateUuidV7();
    await store.insertTransfer({
      id,
      fromWarehouseId: input.fromWarehouseId,
      toWarehouseId: input.toWarehouseId,
      note: input.note,
      noteAr: input.noteAr,
      createdBy: input.actorId,
    });
    lineNo = 0;
    for (const line of input.lines) {
      await store.insertTransferLine({
        transferId: id,
        lineNo: ++lineNo,
        itemId: line.itemId,
        qty: line.qty,
      });
    }
    await this.audit.record({
      action: "inventory.transfer_created",
      entityType: "stock_transfer",
      entityId: id,
      actorId: input.actorId ?? undefined,
      after: {
        fromWarehouseId: input.fromWarehouseId,
        toWarehouseId: input.toWarehouseId,
        lines: input.lines.length,
      },
    });
    return this.find(id);
  }

  /** DRAFT → IN_TRANSIT: the OUT leg at the source's current valuation. */
  async dispatch(id: string, actorId: string | null) {
    const transfer = await this.find(id);
    if (transfer.status !== "DRAFT") {
      throw new StockTransferStateError(`transfer ${id} is ${transfer.status} — only DRAFT dispatches`);
    }
    const lines = await store.listTransferLines(id);
    if (lines.length === 0) throw new StockTransferEmptyError();

    const dispatchDate = today();

    // PLAN every OUT leg first (no writes): valuation under the locks, so
    // the journal quantum is known before any economic effect posts.
    const outPlans: Awaited<ReturnType<typeof planIssue>>[] = [];
    for (const line of lines) {
      outPlans.push(
        await planIssue({
          itemId: line.itemId,
          warehouseId: transfer.fromWarehouseId,
          qty: line.qty,
          movedAt: dispatchDate,
          moveKind: "transfer_out",
          sourceType: "stock_transfer",
          sourceId: id,
          allowNegative: false, // in-transit stock left the building — no negative crossing
        }),
      );
    }
    const carried = outPlans.map((plan, index) => ({
      itemId: lines[index]!.itemId,
      qty: lines[index]!.qty,
      value: plan.valueAmount,
    }));

    // Journal policy (G-15): only when the warehouses resolve distinct
    // accounts. The legs carry the SAME total value — DR dest · CR src.
    const sourceAccount = await resolveInventoryAccount(transfer.fromWarehouseId);
    const destAccount = await resolveInventoryAccount(transfer.toWarehouseId);
    let journalEntryId: string | null = null;
    if (sourceAccount !== destAccount) {
      const total = carried
        .reduce((sum, row) => sum.plus(new Decimal(row.value)), new Decimal(0))
        .toDecimalPlaces(4, Decimal.ROUND_HALF_UP)
        .toFixed(4);
      const journalLines: JournalLineSpec[] = [
        {
          accountId: destAccount,
          direction: "DEBIT",
          amount: total,
          memo: { en: `Transfer in ${id}`, ar: `تحويل وارد ${id}` },
        },
        {
          accountId: sourceAccount,
          direction: "CREDIT",
          amount: total,
          memo: { en: `Transfer out ${id}`, ar: `تحويل صادر ${id}` },
        },
      ];
      const spec: JournalSpec = {
        source: { docType: "stock_transfer", docId: id, operation: "post" },
        entryDate: dispatchDate,
        description: {
          en: `Stock transfer ${transfer.fromWarehouseCode} → ${transfer.toWarehouseCode}`,
          ar: `تحويل مخزون ${transfer.fromWarehouseCode} → ${transfer.toWarehouseCode}`,
        },
        currency: await ownTenantBaseCurrency(),
        lines: journalLines,
      };
      const result = await this.posting.post(spec, { postedBy: actorId });
      if (!result.idempotentReplay) {
        journalEntryId = result.journalEntryId;
      }
    }
    // Policy-none (same account): NO journal at all — the move rows land
    // with posted_journal_id NULL and the INV-010 check nets the legs.

    // APPLY (idempotent state flips first — exactly-once legs):
    const acquired = await this.numbering.reserve({
      docType: "stock_transfer",
      branchId: null,
      periodKey: dispatchDate.slice(0, 4),
      format: "TRN-{YYYY}-{SEQ:6}",
      prefix: "TRN",
      year: dispatchDate.slice(0, 4),
    });
    const flipped = await store.markTransferDispatched({
      id,
      transferNo: acquired.number,
      dispatchDate,
      dispatchedBy: actorId,
    });
    if (!flipped) {
      throw new StockTransferStateError(`transfer ${id} dispatch raced — state changed underfoot`);
    }
    for (const plan of outPlans) {
      await applyIssue(plan, journalEntryId);
    }
    if (journalEntryId !== null) {
      await store.markTransferJournal(id, journalEntryId);
    }

    await this.audit.record({
      action: "inventory.transfer_dispatched",
      entityType: "stock_transfer",
      entityId: id,
      actorId: actorId ?? undefined,
      after: {
        transferNo: acquired.number,
        fromWarehouseCode: transfer.fromWarehouseCode,
        toWarehouseCode: transfer.toWarehouseCode,
        lines: lines.length,
        journalPolicy: sourceAccount !== destAccount ? "G15_DISTINCT_ACCOUNTS" : "POLICY_NONE",
      },
    });
    return this.find(id);
  }

  /** IN_TRANSIT → POSTED: the IN leg at the carried (same) cost. */
  async receive(id: string, actorId: string | null) {
    const transfer = await this.find(id);
    if (transfer.status !== "IN_TRANSIT") {
      throw new StockTransferStateError(`transfer ${id} is ${transfer.status} — only IN_TRANSIT receives`);
    }
    const lines = await store.listTransferLines(id);
    const receiveDate = today();

    // PLAN every IN leg at the carried cost (value conservation —
    // INVENTORY_ACCOUNTING §2), then APPLY with the dispatch journal id.
    for (const line of lines) {
      const outMoves = await store.listStockMoves({
        sourceType: "stock_transfer",
        sourceId: id,
        itemId: line.itemId,
        limit: 50,
      });
      const outRows = outMoves.filter((m) => m.warehouseId === transfer.fromWarehouseId);
      const carriedValue = outRows.reduce(
        (sum, m) => sum.plus(new Decimal(m.valueAmount)),
        new Decimal(0),
      );
      const carriedQty = outRows.reduce((sum, m) => sum.plus(new Decimal(m.qty)), new Decimal(0));
      const carriedCost = carriedQty.isZero()
        ? "0.000000"
        : carriedValue.div(carriedQty).toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toFixed(6);

      const plan = await planReceipt({
        itemId: line.itemId,
        warehouseId: transfer.toWarehouseId,
        qty: line.qty,
        unitCost: carriedCost,
        movedAt: receiveDate,
        moveKind: "transfer_in",
        sourceType: "stock_transfer",
        sourceId: id,
      });
      await applyReceipt(plan, transfer.postedJournalId);
    }
    const flipped = await store.markTransferReceived({
      id,
      receiveDate,
      receivedBy: actorId,
      postedJournalId: null,
    });
    if (!flipped) {
      throw new StockTransferStateError(`transfer ${id} receive raced — state changed underfoot`);
    }
    await this.audit.record({
      action: "inventory.transfer_received",
      entityType: "stock_transfer",
      entityId: id,
      actorId: actorId ?? undefined,
      after: { transferNo: transfer.transferNo, receiveDate },
    });
    return this.find(id);
  }

  async cancel(id: string, actorId: string | null) {
    const transfer = await this.find(id);
    if (transfer.status !== "DRAFT") {
      throw new StockTransferStateError(`only DRAFT transfers cancel — ${id} is ${transfer.status}`);
    }
    await store.cancelTransfer(id);
    await this.audit.record({
      action: "inventory.transfer_cancelled",
      entityType: "stock_transfer",
      entityId: id,
      actorId: actorId ?? undefined,
    });
  }
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
