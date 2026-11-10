import { Inject, Injectable } from "@nestjs/common";
import { Decimal } from "@erp/domain-core";

import { PostingService } from "../../accounting/application/posting-service";
import type { JournalLineSpec, JournalSpec } from "../../accounting/domain/posting-engine/journal-spec";
import {
  planIssue,
  applyIssue,
  resolveInventoryAccount,
  stagePendingOverlay,
  type IssuePlan,
} from "../../inventory/application/movement-core";
import { ReservationService } from "../../inventory/application/reservation-service";
import { ownTenantBaseCurrency } from "../../../infra/settings/setting-reader";
import { SalesInvoiceService, POLICY_ACTOR_ID } from "../../sales/application/invoices";
import * as salesStore from "../../sales/infrastructure/sales.store";
import * as store from "../infrastructure/crm.store";
import { ServiceOrderInputInvalidError, ServiceOrderNotFoundError } from "../domain/crm-errors";
import type { ServiceOrderPostingPort } from "./service-order-service";

/**
 * Service-order posting port (PHASE-019 T48; MASTER-PLAN §7 + §1 row 6) —
 * the ledger/stock side of the document, implementing the seam the service
 * left open (`ServiceOrderService.setPostingPort`). The job-card posting
 * (PHASE-017 T4-a) generalized; two issue policies (chosen at APPROVAL —
 * 0027's service_orders carries no parts_issue_mode column; the persisted
 * line stamps carry the choice forward):
 *
 *   `reserve` — approve holds SERVICE_ORDER reservations (no ledger); the
 *     invoice at completion is a with-goods (flow B) CREDIT invoice: its
 *     own post issues stock (COGS journal sales_invoice:cogs) and the port
 *     then CONSUMES the holds. The hold was an availability claim; the
 *     physical issue happens exactly once, at the invoice.
 *
 *   `issue_immediate` — approve issues parts NOW: one COGS journal
 *     (service_order:issue_parts, DR COGS · CR INVENTORY at issue cost) +
 *     stock moves sourced `service_order`; per-line issue snapshots stamped
 *     on the order lines. The invoice at completion is revenue-only
 *     (warehouseId NULL — exactly ONE COGS journal over the order's life);
 *     the order lines' issue snapshots are copied onto the invoice lines
 *     (W-3 provenance) so credit notes re-enter stock at the ORIGINAL
 *     issue cost.
 *
 * Revenue natures are the platform split (the job-card T4 comment): SERVICE
 * item lines → SERVICE_REVENUE (4200), STOCK item lines (parts) →
 * SALES_REVENUE — resolved by the invoice chain itself, never forked here.
 * SO lines carry no tax/discount columns (0027): the invoice lines resolve
 * their tax code from the ITEM row (the T47 billing-run precedent — the
 * source-of-truth row carries it) and bill undiscounted. Contract linkage
 * is provenance only: contractId rides the invoice row; it never alters a
 * journal (§7 — no posting-rule fork, CAPABILITY_MATRIX §2.6).
 *
 * Everything runs inside the caller's ambient tenant UoW (approve/invoice on
 * ServiceOrderService) — a failure anywhere rolls the whole operation back
 * (INV-018, zero residue). Every journal flows through PostingService
 * (ADR-0007); every stock row through the movement core. INV-013
 * idempotency: re-running issuePartsImmediate skips already-ISSUED lines
 * (an all-issued re-run is a pure no-op) and the posting engine's source
 * key (service_order:{orderId}:issue_parts) is exactly-once.
 */
@Injectable()
export class ServiceOrderPosting implements ServiceOrderPostingPort {
  // NOTE: every param carries an explicit @Inject — the vitest/esbuild
  // pipeline does not emit design:paramtypes (the JobCardService
  // silent-undefined precedent, the ContractService note). PostingService is
  // exported by AccountingModule; SalesInvoiceService by SalesModule;
  // ReservationService by InventoryModule (all imported by CrmModule).
  constructor(
    @Inject(PostingService) private readonly posting: PostingService,
    @Inject(SalesInvoiceService) private readonly invoices: SalesInvoiceService,
    @Inject(ReservationService) private readonly reservations: ReservationService,
  ) {}

  // -- issue_immediate: parts out at approval ---------------------------------

  async issuePartsImmediate(orderId: string, actorId: string | null): Promise<void> {
    const order = await this.requireOrder(orderId);
    const lines = await store.listServiceOrderLines(orderId);
    // Only live, not-yet-issued PARTS lines issue (INV-013: a re-run with
    // everything ISSUED is the no-op below; VOID tombstones never issue;
    // SERVICE lines are never stock lines).
    const pending = lines.filter(
      (line) =>
        line.lineType === "PARTS" &&
        line.status !== "VOID" &&
        line.status !== "ISSUED" &&
        line.issueJournalId === null,
    );
    if (pending.length === 0) return; // idempotent re-run — zero effects

    const today = new Date().toISOString().slice(0, 10);
    const plans: { line: store.ServiceOrderLineRow; plan: IssuePlan }[] = [];
    for (const line of pending) {
      const plan = await planIssue({
        itemId: line.itemId,
        warehouseId: order.warehouseId,
        qty: line.qty,
        movedAt: today,
        moveKind: "issue",
        sourceType: "service_order",
        sourceId: orderId,
        memo: `Service order ${order.orderNo ?? orderId} — parts issue (line ${line.lineNo})`,
        memoAr: `أمر خدمة ${order.orderNo ?? orderId} — صرف قطع (سطر ${line.lineNo})`,
      });
      plans.push({ line, plan });
      stagePendingOverlay(plan); // later lines see the earlier pending issues
    }

    // ONE COGS journal for the whole approval (DR COGS · CR inventory at
    // issue cost) — the invoices.post shape, sourced to the service order.
    const accountingStore = await import("../../accounting/infrastructure/accounting.store");
    const cogsMapping = await accountingStore.findActivePurpose("COGS");
    if (cogsMapping === undefined) {
      const { purposeNotMapped } = await import(
        "../../accounting/domain/posting-engine/posting-errors"
      );
      throw purposeNotMapped({ purposeKey: "COGS" });
    }
    const inventoryByAccount = new Map<string, string>();
    let cogsTotal = new Decimal(0);
    for (const { plan } of plans) {
      const inventoryAccount = await resolveInventoryAccount(order.warehouseId);
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
          en: `Service order ${order.orderNo ?? orderId} — parts issued at approval`,
          ar: `أمر خدمة ${order.orderNo ?? orderId} — صرف القطع عند الموافقة`,
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
          en: `Service order ${order.orderNo ?? orderId} — stock issued to the job`,
          ar: `أمر خدمة ${order.orderNo ?? orderId} — صرف مخزون للعمل`,
        },
      });
    }
    const spec: JournalSpec = {
      source: { docType: "service_order", docId: orderId, operation: "issue_parts" },
      entryDate: today,
      description: {
        en: `Service order ${order.orderNo ?? orderId} — parts issue COGS entry`,
        ar: `أمر خدمة ${order.orderNo ?? orderId} — قيد تكلفة صرف القطع`,
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
      await store.patchServiceOrderLine({
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
    orderId: string,
    actorId: string | null,
  ): Promise<{
    invoiceId: string;
    invoiceNo: string | null;
    journalEntryId: string;
    cogsJournalEntryId: string | null;
  }> {
    const order = await this.requireOrder(orderId);
    const lines = await store.listServiceOrderLines(orderId);
    const live = lines.filter((line) => line.status !== "VOID");
    if (live.length === 0) {
      throw new ServiceOrderInputInvalidError(`service order ${orderId} has no live lines to invoice`);
    }

    const today = new Date().toISOString().slice(0, 10);
    // PARTS bill qty × unit price; SERVICE bills the estimated hours at the
    // per-hour rate (the order line's billing semantics — the job-card
    // contract). SO lines carry no tax/discount columns: the invoice lines
    // resolve their tax code from the ITEM row (the T47 billing-run
    // precedent) and bill undiscounted.
    const invoiceLines = [];
    for (const line of live) {
      const taxCodeId = await store.findItemTaxCodeForCrm(line.itemId);
      invoiceLines.push({
        itemId: line.itemId,
        accountId: null,
        deliveryLineId: null,
        description: line.description,
        descriptionAr: line.descriptionAr,
        qty: line.lineType === "PARTS" ? line.qty : (line.estimatedHours ?? line.qty),
        unitPrice: line.unitPrice,
        discountAmount: null,
        taxCodeId: taxCodeId ?? null,
        batchId: null,
        serialIds: null,
        note: line.note,
      });
    }

    // `reserve`: a with-goods (flow B) CREDIT invoice — stock issues + COGS
    // at the invoice's own post. `issue_immediate`: stock already left at
    // approval; the invoice is revenue-only (warehouseId NULL → no second
    // COGS journal over the order's life). The policy is approve-time (no
    // parts_issue_mode column — 0027 DDL binding): the persisted line
    // stamps carry it — PARTS lines with an issue journal left at approval;
    // PARTS lines on holds (or no PARTS lines at all) are with-goods.
    const hasParts = live.some((line) => line.lineType === "PARTS");
    const issuedAtApproval = live.some(
      (line) => line.lineType === "PARTS" && line.issueJournalId !== null,
    );
    const withGoods = hasParts && !issuedAtApproval;
    const created = await this.invoices.create({
      branchId: order.branchId,
      customerId: order.partnerId,
      salesRepId: null,
      kind: "CREDIT",
      invoiceDate: today,
      dueDate: null, // BR-026: the customer's terms from the invoice date
      currencyCode: await ownTenantBaseCurrency(),
      exchangeRate: null,
      orderId: null,
      deliveryId: null,
      warehouseId: withGoods ? order.warehouseId : null,
      cashAccountId: null,
      jobCardId: null,
      vehicleId: null,
      // Contract linkage is provenance only — §7: it never alters a journal.
      contractId: order.contractId,
      serviceOrderId: orderId,
      projectId: null,
      note: `Service order ${order.orderNo ?? orderId}`,
      noteAr: `أمر خدمة ${order.orderNo ?? orderId}`,
      actorId,
      lines: invoiceLines,
    });

    // Auto-approve by the POLICY actor + post in-transaction — exactly the
    // job-card invoiceCard path (approved_by carries the sentinel, never an
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

    // Link order line ↔ invoice line: the port owns the mapping. The
    // invoice lines list in line_no order = the live order lines in
    // line_no order (built 1:1 above); verified defensively by itemId.
    const invoiceLineRows = await salesStore.listSalesInvoiceLines(created.id);
    if (invoiceLineRows.length !== live.length) {
      throw new ServiceOrderInputInvalidError(
        `service order ${orderId}: invoice carried ${invoiceLineRows.length} lines for ${live.length} order lines — mapping refused`,
      );
    }
    for (let index = 0; index < live.length; index += 1) {
      const orderLine = live[index]!;
      const invoiceLine = invoiceLineRows[index]!;
      if (invoiceLine.itemId !== orderLine.itemId) {
        throw new ServiceOrderInputInvalidError(
          `service order ${orderId} line ${orderLine.lineNo}: invoice line ${invoiceLine.lineNo} maps a different item — linkage refused`,
        );
      }
      await store.patchServiceOrderLine({ id: orderLine.id, invoiceLineId: invoiceLine.id });
      // issue_immediate: copy the order line's issue snapshot onto the
      // invoice line (W-3 provenance — the createFromDelivery pattern) so
      // credit notes re-enter stock at the ORIGINAL issue cost.
      if (!withGoods && orderLine.lineType === "PARTS" && orderLine.issueUnitCost !== null) {
        await salesStore.markInvoiceLineIssued({
          lineId: invoiceLine.id,
          issueUnitCost: orderLine.issueUnitCost,
          issueValue: orderLine.issueValue ?? orderLine.issueUnitCost,
        });
      }
    }

    // `reserve`: consume the SERVICE_ORDER holds. The invoice's post already
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

  // -- shared ---------------------------------------------------------------------

  private async requireOrder(orderId: string): Promise<store.ServiceOrderRow> {
    const order = await store.findServiceOrderById(orderId);
    if (order === undefined) throw new ServiceOrderNotFoundError(orderId);
    return order;
  }
}
