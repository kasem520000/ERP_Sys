import { Inject, Injectable } from "@nestjs/common";
import { Decimal } from "@erp/domain-core";
import { generateUuidV7 } from "@erp/domain-core";

import { AuditService } from "../../audit/api/audit";
import { ownTenantBaseCurrency } from "../../../infra/settings/setting-reader";
import { PostingService } from "../../accounting/application/posting-service";
import { NumberingService } from "../../accounting/application/numbering-service";
import type { JournalLineSpec, JournalSpec } from "../../accounting/domain/posting-engine/journal-spec";
import * as store from "../infrastructure/inventory.store";
import * as policies from "../infrastructure/policies.store";
import {
  StockTransferEmptyError,
  StockTransferNotFoundError,
  StockTransferSameWarehouseError,
  StockTransferStateError,
  StockTransferPricingStateError,
  TransitExceptionStateError,
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

  /**
   * IN_TRANSIT → POSTED: the IN leg at the carried cost — or at the
   * transfer-pricing policy's price when one governs the pair (I-23, G-46:
   * the margin posts DR dest INVENTORY · CR 4990 TRANSFER_PRICING_
   * ADJUSTMENT, fail-closed until 4990 maps). Transit exceptions (I-22)
   * reduce the received qty per line and post the shrinkage leg (G-13's
   * shape: DR INVENTORY_SHRINKAGE · CR the destination inventory account
   * at the carried cost — restoring INV-010 for the value that left the
   * source and never arrived).
   */
  async receive(
    id: string,
    actorId: string | null,
    exceptions: { lineNo: number; exceptionKind: "DAMAGE" | "MISSING"; qty: string; note: string | null }[] = [],
  ) {
    const transfer = await this.find(id);
    if (transfer.status !== "IN_TRANSIT") {
      throw new StockTransferStateError(`transfer ${id} is ${transfer.status} — only IN_TRANSIT receives`);
    }
    const lines = await store.listTransferLines(id);
    const receiveDate = today();

    // Validate the exceptions against the lines (zero residue on a bad
    // one — the whole UoW rolls back).
    const exceptionQtyByLine = new Map<number, { damage: Decimal; missing: Decimal; notes: { kind: "DAMAGE" | "MISSING"; qty: string; note: string | null }[] }>();
    for (const exception of exceptions) {
      const line = lines.find((row) => row.lineNo === exception.lineNo);
      if (line === undefined) {
        throw new TransitExceptionStateError(`transfer ${id} has no line ${exception.lineNo}`);
      }
      if (!/^\d+(\.\d{1,6})?$/.test(exception.qty) || Number(exception.qty) <= 0) {
        throw new TransitExceptionStateError("an exception qty must be a positive decimal");
      }
      const entry = exceptionQtyByLine.get(exception.lineNo) ?? { damage: new Decimal(0), missing: new Decimal(0), notes: [] };
      if (exception.exceptionKind === "DAMAGE") entry.damage = entry.damage.plus(new Decimal(exception.qty));
      else entry.missing = entry.missing.plus(new Decimal(exception.qty));
      entry.notes.push({ kind: exception.exceptionKind, qty: exception.qty, note: exception.note });
      exceptionQtyByLine.set(exception.lineNo, entry);
    }
    for (const [lineNo, entry] of exceptionQtyByLine) {
      const line = lines.find((row) => row.lineNo === lineNo)!;
      if (entry.damage.plus(entry.missing).gt(new Decimal(line.qty))) {
        throw new TransitExceptionStateError(
          `line ${lineNo} exceptions (${entry.damage.plus(entry.missing).toFixed(6)}) exceed the line qty ${line.qty}`,
        );
      }
    }

    // The pricing policy of the pair (I-23): absent = the carried cost
    // (value conservation, G-15); present = the policy price + G-46's
    // explicit valuation-difference leg.
    const policy = await policies.findTransferPricingPolicy(
      transfer.fromWarehouseId,
      transfer.toWarehouseId,
    );

    // PLAN every IN leg, then APPLY with the dispatch journal id.
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

      const exceptionEntry = exceptionQtyByLine.get(line.lineNo);
      const exceptionQty = exceptionEntry
        ? exceptionEntry.damage.plus(exceptionEntry.missing)
        : new Decimal(0);
      const receiveQty = new Decimal(line.qty).minus(exceptionQty);

      // The policy price for the RECEIVED units (G-46).
      let unitCost = carriedCost;
      let marginTotal = new Decimal(0);
      if (policy !== undefined && receiveQty.gt(0)) {
        const policyPrice =
          policy.mode === "MARKUP"
            ? new Decimal(carriedCost)
                .times(new Decimal(1).plus(new Decimal(policy.markupPct!).div(100)))
                .toDecimalPlaces(6, Decimal.ROUND_HALF_UP)
            : new Decimal(policy.fixedPrice!).toDecimalPlaces(6, Decimal.ROUND_HALF_UP);
        unitCost = policyPrice.toFixed(6);
        const carriedReceivedValue = new Decimal(carriedCost).times(receiveQty);
        const policyReceivedValue = policyPrice.times(receiveQty);
        marginTotal = policyReceivedValue
          .minus(carriedReceivedValue)
          .toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
      }

      if (receiveQty.gt(0)) {
        const plan = await planReceipt({
          itemId: line.itemId,
          warehouseId: transfer.toWarehouseId,
          qty: receiveQty.toFixed(6),
          unitCost,
          movedAt: receiveDate,
          moveKind: "transfer_in",
          sourceType: "stock_transfer",
          sourceId: id,
        });
        await applyReceipt(plan, transfer.postedJournalId);
      }

      // G-46: the valuation-difference leg (only when the policy moved
      // the price — DR dest INVENTORY · CR TRANSFER_PRICING_ADJUSTMENT).
      if (marginTotal.abs().gt(0)) {
        const destAccount = await resolveInventoryAccount(transfer.toWarehouseId);
        const memoEn = `Transfer pricing — ${transfer.transferNo ?? id} line ${line.lineNo}`;
        const memoAr = `تسعير التحويلات — ${transfer.transferNo ?? id} سطر ${line.lineNo}`;
        const spec: JournalSpec = {
          source: { docType: "stock_transfer", docId: id, operation: `pricing_line_${line.lineNo}` },
          entryDate: receiveDate,
          description: { en: memoEn, ar: memoAr },
          currency: await ownTenantBaseCurrency(),
          lines: [
            {
              accountId: destAccount,
              direction: "DEBIT",
              amount: marginTotal.abs().toFixed(4),
              memo: { en: memoEn, ar: memoAr },
            },
            {
              purpose: "TRANSFER_PRICING_ADJUSTMENT",
              direction: "CREDIT",
              amount: marginTotal.abs().toFixed(4),
              memo: { en: memoEn, ar: memoAr },
            },
          ],
        };
        await this.posting.post(spec, { postedBy: actorId });
      }

      // I-22: the transit exceptions — the shrinkage leg at the carried
      // cost (restoring INV-010 for the value that never arrived) + the
      // exception records with their journal refs.
      if (exceptionEntry !== undefined) {
        for (const note of exceptionEntry.notes) {
          const qtyDecimal = new Decimal(note.qty);
          const lossValue = new Decimal(carriedCost)
            .times(qtyDecimal)
            .toDecimalPlaces(4, Decimal.ROUND_HALF_UP)
            .toFixed(4);
          // The exception's own id — the journal's exactly-once key (two
          // DAMAGE notes on one line each get their own journal).
          const exceptionId = generateUuidV7();
          let journalId: string | null = null;
          if (Number(lossValue) > 0) {
            const destAccount = await resolveInventoryAccount(transfer.toWarehouseId);
            const memoEn = `Transit ${note.kind.toLowerCase()} — ${transfer.transferNo ?? id} line ${line.lineNo}`;
            const memoAr =
              note.kind === "DAMAGE"
                ? `تلف أثناء النقل — ${transfer.transferNo ?? id} سطر ${line.lineNo}`
                : `فقدان أثناء النقل — ${transfer.transferNo ?? id} سطر ${line.lineNo}`;
            const spec: JournalSpec = {
              source: { docType: "transit_exception", docId: exceptionId, operation: "post" },
              entryDate: receiveDate,
              description: { en: memoEn, ar: memoAr },
              currency: await ownTenantBaseCurrency(),
              lines: [
                {
                  purpose: "INVENTORY_SHRINKAGE",
                  direction: "DEBIT",
                  amount: lossValue,
                  memo: { en: memoEn, ar: memoAr },
                },
                {
                  accountId: destAccount,
                  direction: "CREDIT",
                  amount: lossValue,
                  memo: { en: memoEn, ar: memoAr },
                },
              ],
            };
            const result = await this.posting.post(spec, { postedBy: actorId });
            journalId = result.journalEntryId;
          }
          await policies.insertTransitException({
            id: exceptionId,
            transferId: id,
            lineNo: line.lineNo,
            exceptionKind: note.kind,
            qty: note.qty,
            journalId,
            note: note.note,
            createdBy: actorId,
          });
        }
      }
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
      after: {
        transferNo: transfer.transferNo,
        receiveDate,
        exceptions: exceptions.length,
        pricingPolicy: policy === undefined ? "CARRIED_COST" : policy.mode,
      },
    });
    return this.find(id);
  }

  // -- transfer pricing policies (§2.13, I-23) --------------------------------------------

  async listPricingPolicies() {
    return policies.listTransferPricingPolicies(200);
  }

  async upsertPricingPolicy(input: {
    fromWarehouseId: string;
    toWarehouseId: string;
    mode: "MARKUP" | "FIXED";
    markupPct: string | null;
    fixedPrice: string | null;
    note: string | null;
    actorId: string | null;
  }) {
    if (input.fromWarehouseId === input.toWarehouseId) {
      throw new StockTransferSameWarehouseError();
    }
    if (input.mode === "MARKUP") {
      if (input.markupPct === null || Number(input.markupPct) < 0 || Number(input.markupPct) > 1000) {
        throw new StockTransferPricingStateError("MARKUP needs markup_pct in [0, 1000]");
      }
      if (input.fixedPrice !== null) {
        throw new StockTransferPricingStateError("MARKUP carries exactly its operand — fixed_price must be null");
      }
    } else {
      if (input.fixedPrice === null || Number(input.fixedPrice) < 0) {
        throw new StockTransferPricingStateError("FIXED needs a non-negative fixed_price");
      }
      if (input.markupPct !== null) {
        throw new StockTransferPricingStateError("FIXED carries exactly its operand — markup_pct must be null");
      }
    }
    const policy = await policies.upsertTransferPricingPolicy({ ...input, createdBy: input.actorId });
    await this.audit.record({
      action: "inventory.transfer_pricing_upserted",
      entityType: "transfer_pricing_policy",
      entityId: policy.id,
      actorId: input.actorId ?? undefined,
      after: { fromWarehouseId: policy.fromWarehouseId, toWarehouseId: policy.toWarehouseId, mode: policy.mode, markupPct: policy.markupPct, fixedPrice: policy.fixedPrice },
    });
    return policy;
  }

  async transitExceptions(transferId: string) {
    await this.find(transferId);
    return policies.listTransitExceptions(transferId);
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
