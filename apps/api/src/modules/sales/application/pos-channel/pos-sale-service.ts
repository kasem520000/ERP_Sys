import { Inject, Injectable } from "@nestjs/common";

import { AuditService } from "../../../audit/api/audit";
import * as posStore from "../../../pos/infrastructure/pos.store";
import {
  PosTerminalInactiveError,
  PosTerminalNotFoundError,
  PosTenderInvalidError,
  PosWalkInCustomerError,
} from "../../../pos/domain/pos-errors";
import * as store from "../../infrastructure/sales.store";
import { SalesInvoiceService } from "../invoices";
import { CreditNoteService } from "../credit-notes";
import { POLICY_ACTOR_ID } from "../invoices";

/**
 * POS sale service (PHASE-016 T5 — the pos channel lives INSIDE the sales
 * module per the phase plan): a POS sale IS a sales invoice — created and
 * posted through `SalesInvoiceService` (the ONLY writer of sales documents),
 * with channel='POS', kind=CASH, and the terminal's till + warehouse. The
 * posting path is the existing PHASE-012 chain: settlement journal (G-02
 * split by tenders: cash → till, card → CARD_RECEIVABLE) + COGS journal
 * (G-03 at issue cost, FEFO/serials through the movement core) in ONE
 * transaction (INV-013/018); the BR-005 autopost policy actor is recorded
 * distinctly from the cashier (`approved_by = policy:pos.cash_autopost`).
 *
 * Offline replays (the sync push path) reuse `submit` with the SAME client
 * id + OFF- receipt number: the store insert is idempotent on the client
 * id and the posting engine replays the original result (INV-013) — the
 * second dedupe layer beyond the per-command idempotencyKey (§11).
 */
@Injectable()
export class PosSaleService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    private readonly invoices: SalesInvoiceService,
    private readonly creditNotes: CreditNoteService,
  ) {}

  /**
   * Submit a counter sale. Online path: the cashier's session posts
   * directly; offline path (from the sync push handler): the command
   * carries the client id + OFF- number and replays safely.
   */
  async submit(input: {
    terminalId: string;
    /** null = the walk-in cash customer (resolved/created per tenant). */
    customerId: string | null;
    lines: readonly PosSaleLine[];
    tenders: readonly { method: "CASH" | "CARD"; amount: string; reference?: string | null }[];
    orderType: "DINE_IN" | "TAKEAWAY" | "DELIVERY" | "COUNTER";
    checkId?: string | null;
    /** Offline provenance (sync path): the OFF- number + client UUIDv7. */
    offlineReceiptNo?: string | null;
    clientId?: string;
    invoiceDate?: string;
    actorId: string | null;
  }) {
    const terminal = await this.requireActiveTerminal(input.terminalId);

    // Tenders must cover the total exactly (change is computed client-side
    // and returned as part of the receipt; the ledger records tenders).
    if (input.tenders.length === 0) {
      throw new PosTenderInvalidError("at least one tender line is required");
    }
    let tenderTotal = 0;
    for (const tender of input.tenders) {
      if (!/^\d+(\.\d{1,4})?$/.test(tender.amount) || Number(tender.amount) <= 0) {
        throw new PosTenderInvalidError(`tender amount ${tender.amount} is not a positive money value`);
      }
      tenderTotal += Number(tender.amount);
    }

    // The customer: named or the tenant's walk-in cash customer.
    const customerId =
      input.customerId ?? (await this.walkInCustomerId(terminal.branchId, input.actorId));

    const invoiceDate = input.invoiceDate ?? new Date().toISOString().slice(0, 10);

    // BR-003 staleness gate on the POS path (PHASE-020 C-09b — the
    // approve()-side gate predates this; the POS autopost bypassed it, so
    // a tampered/stale offline price could post silently). Policy-gated
    // EXACTLY like approve(): when manual overrides are disallowed, every
    // line's price must match the deterministic resolution — drift is
    // PRICE_CHANGED, never a silent post. With overrides allowed (the
    // default), lane pricing stands (016 semantics unchanged).
    const overrideAllowed =
      (await store.readSetting<boolean>("sales.price_override_allowed")) ?? true;
    if (!overrideAllowed) {
      for (const line of input.lines) {
        const resolved = await (
          await import("../pricing")
        ).resolveSalesPrice({ customerId, itemId: line.itemId, qty: line.qty });
        if (resolved.source !== "MANUAL" && resolved.unitPrice !== line.unitPrice) {
          const { PriceChangedError } = await import("../../domain/sales-errors");
          throw new PriceChangedError({
            itemId: line.itemId,
            resolved: resolved.unitPrice,
            provided: line.unitPrice,
          });
        }
      }
    }

    const created = await this.invoices.create({
      branchId: terminal.branchId,
      customerId,
      salesRepId: null,
      kind: "CASH",
      invoiceDate,
      dueDate: invoiceDate,
      currencyCode: await this.tenantBaseCurrency(),
      exchangeRate: null,
      orderId: null,
      deliveryId: null,
      warehouseId: terminal.warehouseId,
      cashAccountId: terminal.cashAccountId,
      note: null,
      noteAr: null,
      actorId: input.actorId,
      lines: input.lines.map((line) => ({
        itemId: line.itemId,
        accountId: null,
        deliveryLineId: null,
        description: line.description ?? null,
        descriptionAr: line.descriptionAr ?? null,
        qty: line.qty,
        unitPrice: line.unitPrice,
        discountAmount: line.discountAmount ?? null,
        taxCodeId: line.taxCodeId ?? null,
        batchId: null,
        serialIds: line.serialIds ?? null,
        note: null,
      })),
      pos: {
        clientId: input.clientId,
        terminalId: terminal.id,
        orderType: input.orderType,
        tableId:
          input.checkId === undefined || input.checkId === null
            ? null
            : (await this.checkTable(input.checkId)) ?? null,
        offlineReceiptNo: input.offlineReceiptNo ?? null,
        tenders: input.tenders.map((tender) => ({
          method: tender.method,
          amount: tender.amount,
          reference: tender.reference ?? null,
        })),
      },
    });

    // BR-005: if the autopost policy was off, the counter flow still
    // posts in-transaction — approved_by carries the POLICY sentinel
    // (DOCUMENT_LIFECYCLE §2 rule 1; never an audit actor), posted_by +
    // the audit trail carry the cashier.
    let posted = created;
    let journalEntryId: string | null = created.postedJournalId;
    if (created.status !== "POSTED") {
      await store.updateSalesInvoiceStatus({
        id: created.id,
        status: "APPROVED",
        actorId: POLICY_ACTOR_ID,
      });
      const result = await this.invoices.post(created.id, input.actorId ?? POLICY_ACTOR_ID);
      posted = result.invoice;
      journalEntryId = result.journalEntryId;
    }

    void tenderTotal; // Authoritative tender/total equality lives in the
    // posting path's G-02 split (Decimal math; a mismatch refuses the post
    // and the whole UoW rolls back — zero ledger residue).

    // Table-service settlement: stamp the check PAID + free the table —
    // same transaction as the posting (the UoW is ambient; a failure here
    // rolls the sale back with it, so a paid table without a posted
    // invoice is impossible).
    if (input.checkId !== undefined && input.checkId !== null) {
      await this.settleCheck(input.checkId, posted.id);
    }

    // Shift capture feed (the PHASE-008 seam: "the POS feed lands
    // PHASE-016"): the open shift on the terminal's till accumulates the
    // CASH tender portion (card money never sits in the drawer — INV-019
    // alignment; the treasury service owns the write).
    {
      const treasuryStore = await import("../../../treasury/infrastructure/treasury.store");
      const openShift = await treasuryStore.findOpenShiftForAccount(terminal.cashAccountId);
      if (openShift !== undefined) {
        const tenders = (posted.tenders ?? []) as { method: string; amount: string }[];
        const cashPortion = tenders
          .filter((tender) => tender.method === "CASH")
          .reduce((sum, tender) => sum + Number(tender.amount), 0)
          .toFixed(4);
        if (cashPortion !== "0.0000") {
          const { ShiftService } = await import("../../../treasury/application/shift-service");
          const subledger =
            new (await import("../../../partners/application/subledger-service")).PartnerSubledgerService();
          const posting = new (await import("../../../accounting/application/posting-service")).PostingService(
            this.audit,
            subledger,
          );
          const shifts = new ShiftService(this.audit, posting);
          await shifts.capture({
            id: openShift.id,
            cashIn: cashPortion,
            cashOut: "0",
            actorId: input.actorId,
          });
        }
      }
    }

    await this.audit.record({
      action: "pos_sale.posted",
      entityType: "sales_invoice",
      entityId: posted.id,
      actorId: input.actorId ?? undefined,
      after: {
        invoiceNo: posted.invoiceNo,
        offlineReceiptNo: input.offlineReceiptNo ?? null,
        terminalId: terminal.id,
        orderType: input.orderType,
        tenders: input.tenders,
        totalGross: posted.totalGross,
        journalEntryId,
      },
    });
    return { invoice: posted, journalEntryId, terminal };
  }

  /**
   * The offline replay path (sync push handler → here): dedupe on the
   * (terminal, OFF- number) pair first — an ACCEPTED replay returns the
   * original result with zero additional ledger effects (INV-013 + the
   * §11 second dedupe layer).
   */
  async submitOffline(
    input: Parameters<PosSaleService["submit"]>[0] & { idempotencyKey: string },
  ) {
    if (typeof input.offlineReceiptNo === "string" && input.offlineReceiptNo.length > 0) {
      const existing = await store.findPosInvoiceByOfflineNo(
        input.terminalId,
        input.offlineReceiptNo,
      );
      if (existing !== undefined) {
        return { invoice: existing, replay: true as const };
      }
    }
    const result = await this.submit(input);
    await this.audit.record({
      action: "pos_sale.synced",
      entityType: "sales_invoice",
      entityId: result.invoice.id,
      after: {
        offlineReceiptNo: input.offlineReceiptNo ?? null,
        invoiceNo: result.invoice.invoiceNo,
        idempotencyKey: input.idempotencyKey,
      },
    });
    return { invoice: result.invoice, replay: false as const };
  }

  /**
   * POS return: a credit note referencing the original invoice (BR-004 —
   * the reference is NEVER optional; `pos.return_requires_original_invoice`
   * is template policy enforced by shape: a POS return always carries it).
   * Stock re-enters at the ORIGINAL issue cost (W-3) through the existing
   * credit-note posting path.
   */
  async returnSale(input: {
    terminalId: string;
    invoiceId: string;
    lines: readonly {
      invoiceLineId: string;
      qty: string;
      reason?: string | null;
    }[];
    note?: string | null;
    actorId: string | null;
  }) {
    const terminal = await this.requireActiveTerminal(input.terminalId);
    const invoice = await store.findSalesInvoiceById(input.invoiceId);
    if (invoice === undefined) {
      throw new PosWalkInCustomerError(`invoice ${input.invoiceId} does not exist`);
    }
    const invoiceLines = await store.listSalesInvoiceLines(input.invoiceId);
    const note = await this.creditNotes.create({
      branchId: terminal.branchId,
      salesRepId: null,
      invoiceId: input.invoiceId,
      noteDate: new Date().toISOString().slice(0, 10),
      note: input.note ?? `POS return on terminal ${terminal.code}`,
      noteAr: null,
      actorId: input.actorId,
      lines: input.lines.map((line) => {
        const original = invoiceLines.find(
          (candidate: { id: string }) => candidate.id === line.invoiceLineId,
        );
        if (original === undefined) {
          throw new PosTenderInvalidError(`line ${line.invoiceLineId} is not on invoice ${input.invoiceId}`);
        }
        return {
          invoiceLineId: line.invoiceLineId,
          qty: line.qty,
          unitPrice: original.unitPrice,
          discountAmount: original.discountAmount,
          taxCodeId: original.taxCodeId,
          returnToStock: original.itemId !== null,
          batchId: original.batchId,
          serialIds: original.serialIds,
          description: original.description,
          descriptionAr: original.descriptionAr,
          note: line.reason ?? "POS return",
        };
      }),
    });
    await this.creditNotes.approve(note.id, POLICY_ACTOR_ID);
    const posted = await this.creditNotes.post(note.id, input.actorId);
    await this.audit.record({
      action: "credit_note.posted",
      entityType: "credit_note",
      entityId: note.id,
      actorId: input.actorId ?? undefined,
      after: {
        terminalId: terminal.id,
        invoiceId: input.invoiceId,
        noteNo: posted.noteNo ?? note.noteNo,
      },
    });
    return posted;
  }

  // -- helpers -----------------------------------------------------------------

  private async requireActiveTerminal(terminalId: string) {
    const terminal = await posStore.findTerminalById(terminalId);
    if (terminal === undefined) throw new PosTerminalNotFoundError(terminalId);
    if (terminal.status !== "ACTIVE") throw new PosTerminalInactiveError(terminalId);
    return terminal;
  }

  /** The tenant's walk-in cash customer (created once, reused — no partner
   * spam per sale; code POS-WALKIN is reserved). */
  private async walkInCustomerId(branchId: string, actorId: string | null): Promise<string> {
    void branchId;
    const partnersStore = await import("../../../partners/infrastructure/partners.store");
    const existing = await partnersStore.findPartnerByCode("POS-WALKIN");
    if (existing !== undefined) {
      if (existing.kind !== "CUSTOMER" && existing.kind !== "BOTH") {
        throw new PosWalkInCustomerError(
          "partner code POS-WALKIN is reserved for the walk-in cash customer",
        );
      }
      return existing.id;
    }
    // Create through the partners store (the service's own insert path —
    // same validations apply at sale time via requireCustomer); the
    // walk-in is a singleton per tenant, code-reserved.
    const partner = await partnersStore.insertPartner({
      kind: "CUSTOMER",
      code: "POS-WALKIN",
      name: "Walk-in customer",
      nameAr: "عميل نقدي",
      taxNumber: null,
      creditLimit: null,
      creditTermsId: null,
      priceListId: null,
    });
    await this.audit.record({
      action: "partner.created",
      entityType: "partner",
      entityId: partner.id,
      actorId: actorId ?? undefined,
      after: { code: partner.code, name: partner.name, kind: "CUSTOMER", origin: "pos-walkin" },
    });
    return partner.id;
  }

  private async checkTable(checkId: string): Promise<string | null> {
    const check = await posStore.findCheckById(checkId);
    return check?.tableId ?? null;
  }

  private async settleCheck(checkId: string, invoiceId: string) {
    const check = await posStore.findCheckById(checkId);
    if (check === undefined || check.status !== "OPEN") return null;
    const settled = await posStore.closeCheck({ id: checkId, status: "PAID", invoiceId });
    if (check.tableId !== null) {
      await posStore.updateTableStatus({ id: check.tableId, status: "FREE" });
    }
    return settled;
  }

  private async tenantBaseCurrency(): Promise<string> {
    const { ownTenantBaseCurrency } = await import("../../../../infra/settings/setting-reader");
    return ownTenantBaseCurrency();
  }
}

export interface PosSaleLine {
  itemId: string;
  description?: string | null;
  descriptionAr?: string | null;
  qty: string;
  unitPrice: string;
  discountAmount?: string | null;
  taxCodeId?: string | null;
  batchId?: string | null;
  serialIds?: string[] | null;
}
