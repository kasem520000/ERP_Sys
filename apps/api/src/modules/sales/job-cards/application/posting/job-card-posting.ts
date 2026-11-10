import { Injectable } from "@nestjs/common";
import { Decimal } from "@erp/domain-core";

import { PostingService } from "../../../../accounting/application/posting-service";
import type { JournalLineSpec, JournalSpec } from "../../../../accounting/domain/posting-engine/journal-spec";
import {
  planIssue,
  applyIssue,
  resolveInventoryAccount,
  stagePendingOverlay,
  type IssuePlan,
} from "../../../../inventory/application/movement-core";
import { ReservationService } from "../../../../inventory/application/reservation-service";
import { ownTenantBaseCurrency } from "../../../../../infra/settings/setting-reader";
import { SalesInvoiceService, POLICY_ACTOR_ID } from "../../../application/invoices";
import { CreditNoteService, type CreditNoteLineInput } from "../../../application/credit-notes";
import * as salesStore from "../../../infrastructure/sales.store";
import * as store from "../../../infrastructure/job-cards.store";
import { JobCardInputInvalidError, JobCardNotFoundError } from "../../domain/job-card-errors";
import type { JobCardPostingPort } from "../job-card-service";

/**
 * Job-card posting port (PHASE-017 T4-a; industry-workflows.md (b) steps 4/6/8)
 * — the ledger/stock side of the workshop document, implementing the seam
 * 3-a left open (`JobCardService.setPostingPort`). Two issue policies:
 *
 *   `reserve` — approve holds JOB_CARD reservations (no ledger); the invoice
 *     at completion is a with-goods (flow B) CREDIT invoice: its own post
 *     issues stock (COGS journal sales_invoice:cogs) and the port then
 *     CONSUMES the holds. The hold was an availability claim; the physical
 *     issue happens exactly once, at the invoice — consumed, never re-issued.
 *
 *   `issue_immediate` — approve issues parts NOW: one COGS journal
 *     (job_card:issue_parts, DR COGS · CR INVENTORY at issue cost) + stock
 *     moves sourced `job_card`; per-line issue snapshots stamped on the card
 *     lines. The invoice at completion is revenue-only (warehouseId NULL —
 *     exactly ONE COGS journal over the card's life, never a second); the
 *     card lines' issue snapshots are copied onto the invoice lines (W-3
 *     provenance, the createFromDelivery pattern) so warranty credit notes
 *     re-enter stock at the ORIGINAL issue cost.
 *
 * Revenue natures: the invoice settlement splits goods (STOCK/COMPOSITE item
 * lines → SALES_REVENUE) from labor (SERVICE item lines → SERVICE_REVENUE,
 * 4200) — see SalesInvoiceService.post; the split is the platform behavior,
 * not a job-card special case.
 *
 * Everything runs inside the caller's ambient tenant UoW (approve/invoice on
 * JobCardService) — a failure anywhere rolls the whole operation back
 * (INV-018, zero residue). Every journal flows through PostingService
 * (ADR-0007); every stock row through the movement core (MODULE_BOUNDARIES —
 * never a direct stock table write). INV-013 idempotency: re-running
 * issuePartsImmediate skips already-ISSUED lines (an all-issued re-run is a
 * pure no-op) and the posting engine's source key
 * (job_card:{cardId}:issue_parts) is exactly-once.
 */
@Injectable()
export class JobCardPosting implements JobCardPostingPort {
  constructor(
    private readonly posting: PostingService,
    private readonly invoices: SalesInvoiceService,
    private readonly creditNotes: CreditNoteService,
    private readonly reservations: ReservationService,
  ) {}

  // -- issue_immediate: parts out at approval ---------------------------------

  async issuePartsImmediate(cardId: string, actorId: string | null): Promise<void> {
    const card = await this.requireCard(cardId);
    const lines = await store.listJobCardLines(cardId);
    // Only live, not-yet-issued PARTS lines issue (INV-013: a re-run with
    // everything ISSUED is the no-op below; CANCELLED tombstones never
    // issue; LABOR lines are never stock lines).
    const pending = lines.filter(
      (line) =>
        line.lineType === "PARTS" &&
        line.status !== "CANCELLED" &&
        line.status !== "ISSUED" &&
        line.issueJournalId === null,
    );
    if (pending.length === 0) return; // idempotent re-run — zero effects

    const today = new Date().toISOString().slice(0, 10);
    const plans: { line: store.JobCardLineRow; plan: IssuePlan }[] = [];
    for (const line of pending) {
      const plan = await planIssue({
        itemId: line.itemId,
        warehouseId: card.warehouseId,
        qty: line.qty,
        movedAt: today,
        moveKind: "issue",
        sourceType: "job_card",
        sourceId: cardId,
        memo: `Job card ${card.cardNo ?? cardId} — parts issue (line ${line.lineNo})`,
        memoAr: `بطاقة عمل ${card.cardNo ?? cardId} — صرف قطع (سطر ${line.lineNo})`,
      });
      plans.push({ line, plan });
      stagePendingOverlay(plan); // later lines see the earlier pending issues
    }

    // ONE COGS journal for the whole approval (DR COGS · CR inventory at
    // issue cost) — the invoices.post shape, sourced to the job card.
    const accountingStore = await import("../../../../accounting/infrastructure/accounting.store");
    const cogsMapping = await accountingStore.findActivePurpose("COGS");
    if (cogsMapping === undefined) {
      const { purposeNotMapped } = await import(
        "../../../../accounting/domain/posting-engine/posting-errors"
      );
      throw purposeNotMapped({ purposeKey: "COGS" });
    }
    const inventoryByAccount = new Map<string, string>();
    let cogsTotal = new Decimal(0);
    for (const { plan } of plans) {
      const inventoryAccount = await resolveInventoryAccount(card.warehouseId);
      inventoryByAccount.set(
        inventoryAccount,
        new Decimal(inventoryByAccount.get(inventoryAccount) ?? "0")
          .plus(new Decimal(plan.valueAmount))
          .toFixed(4),
      );
      cogsTotal = cogsTotal.plus(new Decimal(plan.valueAmount));
    }
    const cogsLines: JournalLineSpec[] = [
      {
        accountId: cogsMapping.accountId,
        direction: "DEBIT",
        amount: cogsTotal.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4),
        memo: {
          en: `Job card ${card.cardNo ?? cardId} — parts issued at approval`,
          ar: `بطاقة عمل ${card.cardNo ?? cardId} — صرف القطع عند الموافقة`,
        },
      },
    ];
    for (const [accountId, amount] of [...inventoryByAccount.entries()].sort(([a], [b]) =>
      (a < b ? -1 : 1),
    )) {
      if (amount === "0.0000") continue;
      cogsLines.push({
        accountId,
        direction: "CREDIT",
        amount,
        memo: {
          en: `Job card ${card.cardNo ?? cardId} — stock issued to workshop`,
          ar: `بطاقة عمل ${card.cardNo ?? cardId} — صرف مخزون للورشة`,
        },
      });
    }
    const spec: JournalSpec = {
      source: { docType: "job_card", docId: cardId, operation: "issue_parts" },
      entryDate: today,
      description: {
        en: `Job card ${card.cardNo ?? cardId} — parts issue COGS entry`,
        ar: `بطاقة عمل ${card.cardNo ?? cardId} — قيد تكلفة صرف القطع`,
      },
      currency: await ownTenantBaseCurrency(),
      lines: cogsLines,
    };
    const result = await this.posting.post(spec, { postedBy: actorId });
    // A partial re-run (some lines ISSUED, some not — unreachable via the
    // service, defensive for direct port calls) replays the stored entry;
    // the fresh plans still apply against that same journal id.
    const journalId = result.journalEntryId;
    for (const { line, plan } of plans) {
      await applyIssue(plan, journalId);
      // Per-line issue snapshot (the W-3 provenance; 6dp unit, 4dp value).
      const unitCost = new Decimal(plan.qty).gt(0)
        ? new Decimal(plan.valueAmount).div(new Decimal(plan.qty)).toDecimalPlaces(6, Decimal.ROUND_HALF_UP)
        : new Decimal(0);
      await store.patchJobCardLine({
        id: line.id,
        status: "ISSUED",
        issueUnitCost: unitCost.toFixed(6),
        issueValue: new Decimal(plan.valueAmount).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4),
        issueJournalId: journalId,
      });
    }
  }

  // -- completion → invoice ----------------------------------------------------

  async invoiceCard(
    cardId: string,
    actorId: string | null,
  ): Promise<{
    invoiceId: string;
    invoiceNo: string | null;
    journalEntryId: string;
    cogsJournalEntryId: string | null;
  }> {
    const card = await this.requireCard(cardId);
    const lines = await store.listJobCardLines(cardId);
    const live = lines.filter((line) => line.status !== "CANCELLED");
    if (live.length === 0) {
      throw new JobCardInputInvalidError(`job card ${cardId} has no live lines to invoice`);
    }

    const today = new Date().toISOString().slice(0, 10);
    // PARTS bill qty × unit price; LABOR bills the estimated hours at the
    // per-hour rate (the card line's billing semantics — the 3-a contract).
    const invoiceLines = live.map((line) => ({
      itemId: line.itemId,
      accountId: null,
      deliveryLineId: null,
      description: line.description,
      descriptionAr: line.descriptionAr,
      qty: line.lineType === "PARTS" ? line.qty : (line.estimatedHours ?? line.qty),
      unitPrice: line.unitPrice,
      discountAmount: line.discountAmount,
      taxCodeId: line.taxCodeId,
      batchId: null,
      serialIds: null,
      note: line.note,
    }));

    // `reserve`: a with-goods (flow B) CREDIT invoice — stock issues + COGS
    // at the invoice's own post. `issue_immediate`: stock already left at
    // approval; the invoice is revenue-only (warehouseId NULL → no second
    // COGS journal over the card's life).
    const withGoods = card.partsIssueMode !== "issue_immediate";
    const created = await this.invoices.create({
      branchId: card.branchId,
      customerId: card.customerId,
      salesRepId: null,
      kind: "CREDIT",
      invoiceDate: today,
      dueDate: null, // BR-026: the customer's terms from the invoice date
      currencyCode: await ownTenantBaseCurrency(),
      exchangeRate: null,
      orderId: null,
      deliveryId: null,
      warehouseId: withGoods ? card.warehouseId : null,
      cashAccountId: null,
      jobCardId: cardId,
      vehicleId: card.vehicleId,
      note: `Job card ${card.cardNo ?? cardId}`,
      noteAr: `بطاقة عمل ${card.cardNo ?? cardId}`,
      actorId,
      lines: invoiceLines,
    });

    // Auto-approve by the POLICY actor + post in-transaction — exactly the
    // pos-sale-service path (approved_by carries the sentinel, never an
    // audit actor; the post + its audit carry the real user).
    let journalEntryId = created.postedJournalId;
    let cogsJournalEntryId = created.postedCogsJournalId;
    let invoiceNo = created.invoiceNo;
    if (created.status !== "POSTED") {
      await salesStore.updateSalesInvoiceStatus({
        id: created.id,
        status: "APPROVED",
        actorId: POLICY_ACTOR_ID,
      });
      const posted = await this.invoices.post(created.id, actorId ?? POLICY_ACTOR_ID);
      journalEntryId = posted.journalEntryId;
      cogsJournalEntryId = posted.cogsJournalEntryId;
      invoiceNo = posted.invoiceNo;
    }

    // Link card line ↔ invoice line: the port owns the mapping (the 3-a
    // contract). The invoice lines list in line_no order = the live card
    // lines in line_no order (built 1:1 above); verified defensively.
    const invoiceLineRows = await salesStore.listSalesInvoiceLines(created.id);
    if (invoiceLineRows.length !== live.length) {
      throw new JobCardInputInvalidError(
        `job card ${cardId}: invoice carried ${invoiceLineRows.length} lines for ${live.length} card lines — mapping refused`,
      );
    }
    for (let index = 0; index < live.length; index += 1) {
      const cardLine = live[index]!;
      const invoiceLine = invoiceLineRows[index]!;
      if (invoiceLine.itemId !== cardLine.itemId) {
        throw new JobCardInputInvalidError(
          `job card ${cardId} line ${cardLine.lineNo}: invoice line ${invoiceLine.lineNo} maps a different item — linkage refused`,
        );
      }
      await store.patchJobCardLine({ id: cardLine.id, invoiceLineId: invoiceLine.id });
      // issue_immediate: copy the card line's issue snapshot onto the
      // invoice line (W-3 provenance — the createFromDelivery pattern) so
      // warranty credit notes re-enter stock at the ORIGINAL issue cost.
      if (!withGoods && cardLine.lineType === "PARTS" && cardLine.issueUnitCost !== null) {
        await salesStore.markInvoiceLineIssued({
          lineId: invoiceLine.id,
          issueUnitCost: cardLine.issueUnitCost,
          issueValue: cardLine.issueValue ?? cardLine.issueUnitCost,
        });
      }
    }

    // `reserve`: consume the JOB_CARD holds. The invoice's post already
    // issued the physical stock (planIssue, source sales_invoice); the
    // consumption releases the availability hold at the moment the goods
    // actually leave — the hold is consumed at invoice, never re-issued.
    if (withGoods) {
      for (const line of live) {
        if (line.lineType !== "PARTS" || line.reservationId === null) continue;
        const reservation = await this.reservations.find(line.reservationId);
        if (reservation.status === "ACTIVE") {
          await this.reservations.consume(line.reservationId, actorId);
        }
      }
    }

    return {
      invoiceId: created.id,
      invoiceNo,
      journalEntryId: journalEntryId!,
      cogsJournalEntryId,
    };
  }

  // -- warranty corrections (workflow (b) step 8) --------------------------------

  /**
   * Warranty credit note against the card's posted invoice (BR-004 — the
   * reference is the invoice, never optional): the pos returnSale pattern —
   * original unit price/discount/tax/batch/serial mirrored from the invoice
   * lines, returnToStock only for STOCK-kind item lines (parts; labor is a
   * SERVICE item and never re-shelves), approved by the POLICY actor and
   * posted in-transaction. Stock re-enters at the ORIGINAL issue cost (W-3)
   * into the card's warehouse; the note carries job_card_id provenance.
   */
  async warrantyCreditNote(
    cardId: string,
    input: {
      invoiceId: string;
      lines: readonly { invoiceLineId: string; qty: string; reason?: string | null }[];
      note?: string | null;
      actorId: string | null;
    },
  ) {
    const card = await this.requireCard(cardId);
    const invoiceLines = await salesStore.listSalesInvoiceLines(input.invoiceId);
    const invoiceLineById = new Map(invoiceLines.map((line) => [line.id, line]));
    const itemsStore = await import("../../../../items/infrastructure/items.store");

    const resolved: CreditNoteLineInput[] = [];
    for (const line of input.lines) {
      const original = invoiceLineById.get(line.invoiceLineId);
      if (original === undefined) {
        throw new JobCardInputInvalidError(
          `invoice line ${line.invoiceLineId} is not on invoice ${input.invoiceId}`,
        );
      }
      // returnToStock: only STOCK-kind item lines re-shelve (parts). Labor
      // is a SERVICE item; account lines are never stock.
      let returnToStock = false;
      if (original.itemId !== null) {
        const item = await itemsStore.findItemById(original.itemId);
        returnToStock = item?.kind === "STOCK";
      }
      resolved.push({
        invoiceLineId: line.invoiceLineId,
        qty: line.qty,
        unitPrice: original.unitPrice,
        discountAmount: original.discountAmount,
        taxCodeId: original.taxCodeId,
        returnToStock,
        batchId: original.batchId,
        serialIds: original.serialIds,
        description: original.description,
        descriptionAr: original.descriptionAr,
        note: line.reason ?? "Warranty correction",
      });
    }

    const note = await this.creditNotes.create({
      branchId: card.branchId,
      salesRepId: null,
      invoiceId: input.invoiceId,
      noteDate: new Date().toISOString().slice(0, 10),
      jobCardId: cardId,
      note: input.note ?? `Warranty correction — job card ${card.cardNo ?? cardId}`,
      noteAr: null,
      actorId: input.actorId,
      lines: resolved,
    });
    await this.creditNotes.approve(note.id, POLICY_ACTOR_ID);
    const posted = await this.creditNotes.post(note.id, input.actorId ?? POLICY_ACTOR_ID, {
      // The card's warehouse: issue_immediate invoices carry warehouseId
      // NULL (stock left at approval), so the chain can't resolve it alone.
      reentryWarehouseId: card.warehouseId,
    });
    return posted;
  }

  // -- shared ---------------------------------------------------------------------

  private async requireCard(cardId: string): Promise<store.JobCardRow> {
    const card = await store.findJobCardById(cardId);
    if (card === undefined) throw new JobCardNotFoundError(cardId);
    return card;
  }
}
