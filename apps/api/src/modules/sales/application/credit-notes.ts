import { Inject, Injectable } from "@nestjs/common";
import { Decimal } from "@erp/domain-core";

import { AuditService } from "../../audit/api/audit";
import { NumberingService } from "../../accounting/application/numbering-service";
import { PostingService } from "../../accounting/application/posting-service";
import { SelfApprovalBlockedError } from "../../accounting/domain/accounting-errors";
import type { JournalLineSpec, JournalSpec } from "../../accounting/domain/posting-engine/journal-spec";
import { TaxResolverService } from "../../tax/application/tax-resolver-service";
import { recordDocumentTaxSummary } from "../../tax/application/posting-adapter";
import {
  planReceipt,
  applyReceipt,
  applySerialFlips,
  resolveInventoryAccount,
  stagePendingOverlay,
  type ReceiptPlan,
} from "../../inventory/application/movement-core";
import { ownTenantBaseCurrency } from "../../../infra/settings/setting-reader";
import * as store from "../infrastructure/sales.store";
import {
  CreditNoteExceedsInvoiceError,
  CreditNoteRefInvalidError,
  EmptyDocumentError,
  ReturnWindowExceededError,
  SalesDocumentStateError,
  SalesInvoiceNotFoundError,
  CreditNoteNotFoundError,
} from "../domain/sales-errors";
import { salesLineNetAmount, PRICE_RE } from "./pricing";
import { resolveOutputTaxLines, type SalesTaxLine } from "./tax-lines";

/**
 * Credit-note service (PHASE-012 T7; BR-004; golden G-04 + W-3): returns
 * and corrections referencing a POSTED invoice — the reference is NEVER
 * optional (BR-004), the return window enforces by dates (0 = unlimited
 * dates, never unlimited reference), and return stock RE-ENTERS AT THE
 * ORIGINAL ISSUE COST snapshotted on the invoice line (W-3: 2 × 60.0000 —
 * never a current-average recompute). Posting is ONE transaction:
 *
 *   credit-note entry (credit_note:post):
 *     DR SALES_RETURNS (net) · DR VAT_PAYABLE (tax) · CR AR_CONTROL (partner)
 *   stock re-entry (credit_note:reentry), return lines only:
 *     DR INVENTORY · CR COGS at the original cost
 *     (+ planReceipt/applyReceipt rows — batch preserved, the originally
 *      sold serial re-shelves, BR-017/BR-018)
 *
 * INV-016: the credit total never exceeds the referenced invoice's
 * outstanding (an over-credit would float as an unallocated balance);
 * standalone credit notes only when policy-flagged (default OFF).
 */

const CRN_FORMAT = { prefix: "CRN", format: "CRN-{YYYY}-{SEQ:6}", docType: "credit_note" };

const QTY_RE = /^\d+(\.\d{1,6})?$/;

export interface CreditNoteLineInput {
  invoiceLineId: string;
  qty: string;
  unitPrice: string | null;
  discountAmount: string | null;
  taxCodeId: string | null;
  returnToStock: boolean;
  batchId: string | null;
  serialIds: string[] | null;
  description: string | null;
  descriptionAr: string | null;
  note: string | null;
}

@Injectable()
export class CreditNoteService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    private readonly posting: PostingService,
    private readonly numbering: NumberingService,
    private readonly resolver: TaxResolverService,
  ) {}

  async list(filter: { status?: string; customerId?: string; invoiceId?: string; limit: number }) {
    return store.listCreditNotes(filter);
  }

  async find(id: string) {
    const note = await store.findCreditNoteById(id);
    if (note === undefined) throw new CreditNoteNotFoundError(id);
    return note;
  }

  async findWithLines(id: string) {
    const note = await this.find(id);
    return { ...note, lines: await store.listCreditNoteLines(id) };
  }

  async create(input: {
    branchId: string;
    salesRepId: string | null;
    invoiceId: string;
    noteDate: string;
    note: string | null;
    noteAr: string | null;
    actorId: string | null;
    /** PHASE-017 T4 (0025): the originating job card (warranty corrections).
     * Pure provenance — persisted to credit_notes.job_card_id. */
    jobCardId?: string | null;
    lines: readonly CreditNoteLineInput[];
  }) {
    if (input.lines.length === 0) throw new EmptyDocumentError("credit note");
    const invoice = await store.findSalesInvoiceById(input.invoiceId);
    if (invoice === undefined) throw new SalesInvoiceNotFoundError(input.invoiceId);
    if (invoice.status !== "POSTED") {
      throw new CreditNoteRefInvalidError(
        `invoice ${input.invoiceId} is ${invoice.status} — credit notes reference POSTED invoices only`,
      );
    }

    // BR-004: the return window (0 = unlimited dates; reference never disables).
    const windowDays = (await store.readSetting<number>("sales.return_window_days")) ?? 14;
    if (windowDays > 0) {
      // Whole-UTC-date ms difference — exact integer division (no
      // floating-point rounding; the | 0 coercion mirrors ar-queries' day
      // math under the ADR-0009 lint rule).
      const days =
        (new Date(`${input.noteDate}T00:00:00Z`).getTime() -
          new Date(`${invoice.invoiceDate}T00:00:00Z`).getTime()) /
          (24 * 60 * 60 * 1000) | 0;
      if (days > windowDays) {
        throw new ReturnWindowExceededError({
          invoiceId: invoice.id,
          invoiceDate: invoice.invoiceDate,
          noteDate: input.noteDate,
          windowDays,
        });
      }
    }

    const invoiceLines = await store.listSalesInvoiceLines(invoice.id);
    const invoiceLineById = new Map(invoiceLines.map((line) => [line.id, line]));
    const alreadyCredited = await this.creditedQtyByInvoiceLine(invoice.id);

    const taxLines = await resolveOutputTaxLines({
      resolver: this.resolver,
      documentDate: input.noteDate,
      currencyCode: invoice.currencyCode,
      lines: input.lines
        .map((line) => {
          const invoiceLine = invoiceLineById.get(line.invoiceLineId);
          const unitPrice = line.unitPrice ?? invoiceLine?.unitPrice ?? "0";
          return {
            taxCodeId: line.taxCodeId ?? invoiceLine?.taxCodeId ?? "",
            amount: salesLineNetAmount(line.qty, unitPrice, line.discountAmount ?? "0"),
          };
        })
        .filter((line) => line.taxCodeId !== ""),
    });
    const taxByLine = new Map<number, SalesTaxLine>();
    let taxIndex = 0;
    for (let index = 0; index < input.lines.length; index += 1) {
      const line = input.lines[index]!;
      const invoiceLine = invoiceLineById.get(line.invoiceLineId);
      const hasTax = (line.taxCodeId ?? invoiceLine?.taxCodeId ?? null) !== null;
      if (hasTax) {
        taxByLine.set(index + 1, taxLines.lines[taxIndex]!);
        taxIndex += 1;
      }
    }

    let totalNet = new Decimal(0);
    let totalTax = new Decimal(0);
    let reentryTotal = new Decimal(0);
    type CnStoreLine = Parameters<typeof store.insertCreditNote>[0]["lines"][number];
    const storeLines: CnStoreLine[] = [];
    let lineNo = 0;
    for (const line of input.lines) {
      lineNo += 1;
      const invoiceLine = invoiceLineById.get(line.invoiceLineId);
      if (invoiceLine === undefined) {
        throw new CreditNoteRefInvalidError(
          `invoice line ${line.invoiceLineId} does not exist on invoice ${input.invoiceId}`,
        );
      }
      if (!QTY_RE.test(line.qty) || Number(line.qty) <= 0) {
        throw new CreditNoteRefInvalidError(`credit line qty must be positive (≤ 6dp): ${line.qty}`);
      }
      const credited = alreadyCredited.get(line.invoiceLineId) ?? "0";
      const after = new Decimal(credited).plus(new Decimal(line.qty));
      if (after.comparedTo(new Decimal(invoiceLine.qty)) > 0) {
        throw new CreditNoteRefInvalidError(
          `return of ${line.qty} exceeds the invoiced ${invoiceLine.qty} (already credited ${credited}) on line ${line.invoiceLineId}`,
        );
      }
      const unitPrice = line.unitPrice ?? invoiceLine.unitPrice;
      if (!PRICE_RE.test(unitPrice) || Number(unitPrice) < 0) {
        throw new CreditNoteRefInvalidError(`credit line unit price must be non-negative: ${unitPrice}`);
      }
      const net = salesLineNetAmount(line.qty, unitPrice, line.discountAmount ?? "0");
      const tax = taxByLine.get(lineNo);
      const taxAmount = tax?.resolved.taxAmount ?? "0.0000";
      totalNet = totalNet.plus(new Decimal(net));
      totalTax = totalTax.plus(new Decimal(taxAmount));

      // W-3: the re-entry cost is the invoice line's ORIGINAL issue cost
      // snapshot — never a current-average recompute (INVENTORY_ACCOUNTING §2).
      let reentryUnitCost: string | null = null;
      let reentryValue: string | null = null;
      if (line.returnToStock) {
        if (invoiceLine.itemId === null) {
          throw new CreditNoteRefInvalidError(
            `invoice line ${line.invoiceLineId} is not a stock line — only stock lines return to stock`,
          );
        }
        if (invoiceLine.issueUnitCost === null) {
          throw new CreditNoteRefInvalidError(
            `invoice line ${line.invoiceLineId} carries no issue-cost snapshot — the reference must be a stock-issued line (W-3)`,
          );
        }
        reentryUnitCost = invoiceLine.issueUnitCost;
        reentryValue = new Decimal(invoiceLine.issueUnitCost)
          .times(new Decimal(line.qty))
          .toDecimalPlaces(4, Decimal.ROUND_HALF_UP)
          .toFixed(4);
        reentryTotal = reentryTotal.plus(new Decimal(reentryValue));
      }
      storeLines.push({
        invoiceLineId: line.invoiceLineId,
        itemId: invoiceLine.itemId,
        description: line.description,
        descriptionAr: line.descriptionAr,
        qty: new Decimal(line.qty).toFixed(6),
        unitPrice: new Decimal(unitPrice).toFixed(6),
        discountAmount: new Decimal(line.discountAmount ?? "0").toFixed(4),
        taxCodeId: line.taxCodeId ?? invoiceLine.taxCodeId,
        netAmount: net,
        taxAmount,
        taxSnapshot: (tax?.resolved.snapshot as unknown as Record<string, unknown>) ?? null,
        returnToStock: line.returnToStock,
        batchId: line.batchId ?? invoiceLine.batchId,
        serialIds: line.serialIds ?? invoiceLine.serialIds,
        reentryUnitCost,
        reentryValue,
        note: line.note,
      });
    }

    const totalNetS = totalNet.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);
    const totalTaxS = totalTax.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);
    const totalGross = totalNet.plus(totalTax).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);

    // INV-016 bound: credit total ≤ the invoice's outstanding AR.
    const outstanding = await this.invoiceOutstanding(invoice.id);
    if (new Decimal(totalGross).comparedTo(new Decimal(outstanding)) > 0) {
      const standalone =
        (await store.readSetting<boolean>("sales.credit_note_standalone_allowed")) ?? false;
      if (!standalone) {
        throw new CreditNoteExceedsInvoiceError({
          invoiceId: invoice.id,
          outstanding,
          requested: totalGross,
        });
      }
    }

    const created = await store.insertCreditNote({
      branchId: input.branchId,
      customerId: invoice.customerId,
      salesRepId: input.salesRepId,
      invoiceId: invoice.id,
      noteDate: input.noteDate,
      currencyCode: invoice.currencyCode,
      exchangeRate: invoice.exchangeRate,
      note: input.note,
      noteAr: input.noteAr,
      actorId: input.actorId,
      jobCardId: input.jobCardId ?? null,
      totalNet: totalNetS,
      totalTax: totalTaxS,
      totalGross,
      reentryValue: reentryTotal.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4),
      taxSummary: { groups: taxLines.summaryGroups, totalTax: taxLines.totalTax },
      lines: storeLines,
    });
    await this.audit.record({
      action: "sales.credit_note_created",
      entityType: "credit_note",
      entityId: created.id,
      actorId: input.actorId ?? undefined,
      after: {
        invoiceId: invoice.id,
        totalGross,
        reentryValue: reentryTotal.toFixed(4),
        windowDays,
      },
    });
    return created;
  }

  async submit(id: string, actorId: string | null) {
    const note = await this.find(id);
    if (note.status !== "DRAFT") {
      throw new SalesDocumentStateError(
        `credit note ${id} is ${note.status} — only DRAFT notes submit`,
      );
    }
    await store.updateCreditNoteStatus({ id, status: "PENDING_APPROVAL", actorId });
    return this.find(id);
  }

  async approve(id: string, actorId: string | null) {
    const note = await this.find(id);
    if (note.status !== "PENDING_APPROVAL" && note.status !== "DRAFT") {
      throw new SalesDocumentStateError(
        `credit note ${id} is ${note.status} — only DRAFT/PENDING_APPROVAL notes approve`,
      );
    }
    if (note.createdBy !== null && note.createdBy === actorId) {
      throw new SelfApprovalBlockedError();
    }
    await store.updateCreditNoteStatus({ id, status: "APPROVED", actorId });
    await this.audit.record({
      action: "sales.credit_note_approved",
      entityType: "credit_note",
      entityId: id,
      actorId: actorId ?? undefined,
      after: { totalGross: note.totalGross },
    });
    return this.find(id);
  }

  /**
   * Post (G-04 + W-3): the credit-note entry + the stock re-entry — ONE
   * transaction, idempotent (INV-013). The re-entry posts at the ORIGINAL
   * issue cost; batch preserved; the originally sold serial re-shelves
   * (BR-017/BR-018).
   *
   * `options.reentryWarehouseId` (PHASE-017 T4): the explicit re-entry
   * warehouse — only the job-card port needs it. An issue_immediate card
   * issues stock at approval, so its invoice carries warehouseId NULL and
   * the document chain alone can't resolve where the warranty part goes
   * back on the shelf; the port passes the card's warehouse here.
   */
  async post(
    id: string,
    actorId: string | null,
    options: { reentryWarehouseId?: string | null } = {},
  ) {
    const note = await this.find(id);
    if (note.status === "POSTED") {
      return {
        note,
        journalEntryId: note.postedJournalId,
        noteNo: note.noteNo,
        idempotentReplay: true,
      };
    }
    if (note.status !== "APPROVED") {
      throw new SalesDocumentStateError(
        `credit note ${id} is ${note.status} — approval precedes posting`,
      );
    }
    const lines = await store.listCreditNoteLines(id);
    const base = await ownTenantBaseCurrency();
    const invoice = await store.findSalesInvoiceById(note.invoiceId);
    if (invoice === undefined) throw new SalesInvoiceNotFoundError(note.invoiceId);

    // (1) Plan the re-entry receipts (original cost; no writes yet).
    // The warehouse is needed ONLY when a line actually re-enters stock —
    // service/correction-only notes never resolve it.
    const needsReentry = lines.some((line) => line.returnToStock);
    const reentryWarehouse = needsReentry
      ? await this.resolveReentryWarehouse(note.id, invoice, options.reentryWarehouseId)
      : null;
    const plans: { line: store.CreditNoteLineRow; plan: ReceiptPlan }[] = [];
    for (const line of lines) {
      if (!line.returnToStock) continue;
      const plan = await planReceipt({
        itemId: line.itemId!,
        warehouseId: reentryWarehouse!,
        qty: line.qty,
        unitCost: line.reentryUnitCost!,
        movedAt: note.noteDate,
        moveKind: "receipt",
        sourceType: "credit_note",
        sourceId: id,
        reason: "CUSTOMER_RETURN",
        batchId: line.batchId,
        serialIds: line.serialIds ?? [],
        memo: `Credit note ${note.noteNo ?? id} — customer return`,
        memoAr: `إشعار دائن ${note.noteNo ?? id} — مرتجع عميل`,
      });
      plans.push({ line, plan });
      stagePendingOverlay(plan);
    }

    // (2) The credit-note entry: DR SALES_RETURNS · DR VAT_PAYABLE ·
    // CR AR_CONTROL (partner).
    const accountingStore = await import("../../accounting/infrastructure/accounting.store");
    const returnsMapping = await accountingStore.findActivePurpose("SALES_RETURNS");
    if (returnsMapping === undefined) {
      const { purposeNotMapped } = await import("../../accounting/domain/posting-engine/posting-errors");
      throw purposeNotMapped({ purposeKey: "SALES_RETURNS" });
    }
    const taxableLines = lines.filter((line) => line.taxCodeId !== null);
    const taxResolution = await resolveOutputTaxLines({
      resolver: this.resolver,
      documentDate: note.noteDate,
      currencyCode: note.currencyCode,
      lines: taxableLines.map((line) => ({ taxCodeId: line.taxCodeId!, amount: line.netAmount })),
    });
    const taxLinesByNo = new Map<number, SalesTaxLine>();
    taxableLines.forEach((line, index) => taxLinesByNo.set(line.lineNo, taxResolution.lines[index]!));
    for (const line of taxableLines) {
      const tax = taxLinesByNo.get(line.lineNo);
      if (tax !== undefined && line.taxSnapshot !== null) {
        const persistedRate = (line.taxSnapshot as { rate?: string }).rate ?? null;
        if (persistedRate !== null && persistedRate !== tax.resolved.rate) {
          throw new SalesDocumentStateError(
            `line ${line.lineNo} tax snapshot (rate ${persistedRate}) no longer matches the resolution (rate ${tax.resolved.rate}) — re-open the draft (BR-033)`,
          );
        }
      }
    }
    const vatLines: JournalLineSpec[] = [];
    for (const [, tax] of taxLinesByNo) {
      // Credit notes MIRROR the invoice VAT: the output tax comes back.
      for (const vatLine of tax.vatLines) {
        vatLines.push({
          ...vatLine,
          direction: vatLine.direction === "CREDIT" ? "DEBIT" : "CREDIT",
        });
      }
    }
    const creditLines: JournalLineSpec[] = [
      {
        accountId: returnsMapping.accountId,
        direction: "DEBIT",
        amount: note.totalNet,
        memo: {
          en: `Credit note ${note.noteNo ?? id} — sales returns`,
          ar: `إشعار دائن ${note.noteNo ?? id} — مردودات المبيعات`,
        },
      },
      ...vatLines,
      {
        purpose: "AR_CONTROL",
        direction: "CREDIT",
        amount: note.totalGross,
        partnerId: note.customerId,
        memo: {
          en: `Credit note ${note.noteNo ?? id}`,
          ar: `إشعار دائن ${note.noteNo ?? id}`,
        },
      },
    ];
    const effectiveRate = note.currencyCode === base ? undefined : note.exchangeRate ?? undefined;
    const creditSpec: JournalSpec = {
      source: { docType: "credit_note", docId: id, operation: "post" },
      entryDate: note.noteDate,
      description: {
        en: `Credit note ${note.noteNo ?? id} — return/correction`,
        ar: `إشعار دائن ${note.noteNo ?? id} — مرتجع/تصحيح`,
      },
      currency: note.currencyCode,
      exchangeRate: effectiveRate,
      lines: creditLines,
    };
    const result = await this.posting.post(creditSpec, { postedBy: actorId });
    if (result.idempotentReplay) {
      const current = await this.find(id);
      return {
        note: current,
        journalEntryId: result.journalEntryId,
        noteNo: current.noteNo,
        idempotentReplay: true,
      };
    }

    // (3) INV-012 summaries (OUTPUT side, mirrored).
    await recordDocumentTaxSummary({
      sourceType: "credit_note",
      sourceId: id,
      documentDate: note.noteDate,
      fiscalPeriodId: null,
      direction: "OUTPUT",
      lines: taxableLines.map((line) => taxLinesByNo.get(line.lineNo)!.resolved),
    });

    // (4) The stock re-entry journal + the receipt rows (original cost).
    let reentryJournalId: string | null = null;
    if (plans.length > 0) {
      const cogsMapping = await accountingStore.findActivePurpose("COGS");
      if (cogsMapping === undefined) {
        const { purposeNotMapped } = await import("../../accounting/domain/posting-engine/posting-errors");
        throw purposeNotMapped({ purposeKey: "COGS" });
      }
      const inventoryAccount = await resolveInventoryAccount(reentryWarehouse!);
      const reentryValue = new Decimal(note.reentryValue)
        .toDecimalPlaces(4, Decimal.ROUND_HALF_UP)
        .toFixed(4);
      const reentrySpec: JournalSpec = {
        source: { docType: "credit_note", docId: id, operation: "reentry" },
        entryDate: note.noteDate,
        description: {
          en: `Credit note ${note.noteNo ?? id} — stock re-entry at original cost`,
          ar: `إشعار دائن ${note.noteNo ?? id} — إعادة إدخال المخزون بالتكلفة الأصلية`,
        },
        currency: base,
        lines: [
          {
            accountId: inventoryAccount,
            direction: "DEBIT",
            amount: reentryValue,
            memo: {
              en: `Return re-entry — credit note ${note.noteNo ?? id}`,
              ar: `إعادة إدخال مرتجع — إشعار دائن ${note.noteNo ?? id}`,
            },
          },
          {
            accountId: cogsMapping.accountId,
            direction: "CREDIT",
            amount: reentryValue,
            memo: {
              en: `COGS release — credit note ${note.noteNo ?? id}`,
              ar: `تحرير تكلفة المبيعات — إشعار دائن ${note.noteNo ?? id}`,
            },
          },
        ],
      };
      const reentryResult = await this.posting.post(reentrySpec, { postedBy: actorId });
      reentryJournalId = reentryResult.journalEntryId;
      for (const { line, plan } of plans) {
        // The originally sold serial re-shelves: sold → returned → in_stock
        // (BR-018 — the original sale stays in the move ledger's history).
        if ((line.serialIds ?? []).length > 0) {
          await applySerialFlips(line.serialIds!, "RETURN", note.noteDate);
        }
        await applyReceipt(plan, reentryJournalId);
      }
    }

    // (5) Official CRN- number + status flip.
    const year = note.noteDate.slice(0, 4);
    const acquired = await this.numbering.reserve({
      docType: CRN_FORMAT.docType,
      branchId: note.branchId,
      periodKey: year,
      format: CRN_FORMAT.format,
      prefix: CRN_FORMAT.prefix,
      year,
    });
    await store.updateCreditNoteStatus({
      id,
      status: "POSTED",
      actorId,
      noteNo: acquired.number,
      postingDate: note.noteDate,
      postedJournalId: result.journalEntryId,
    });
    await this.numbering.bind(CRN_FORMAT.docType, acquired.number, id);
    await this.audit.record({
      action: "sales.credit_note_posted",
      entityType: "credit_note",
      entityId: id,
      actorId: actorId ?? undefined,
      after: {
        noteNo: acquired.number,
        journalEntryId: result.journalEntryId,
        reentryJournalId,
        totalGross: note.totalGross,
        reentryValue: note.reentryValue,
        invoiceId: note.invoiceId,
      },
    });
    return {
      note: await this.find(id),
      journalEntryId: result.journalEntryId,
      noteNo: acquired.number,
      idempotentReplay: false,
    };
  }

  async cancel(id: string, reason: string, actorId: string | null) {
    const note = await this.find(id);
    if (note.status === "POSTED") {
      throw new SalesDocumentStateError(
        "posted credit notes are immutable — corrections are always new documents (INV-003)",
      );
    }
    await store.updateCreditNoteStatus({ id, status: "CANCELLED", actorId, cancelReason: reason });
    await this.audit.record({
      action: "sales.credit_note_cancelled",
      entityType: "credit_note",
      entityId: id,
      actorId: actorId ?? undefined,
      after: { reason },
    });
    return this.find(id);
  }

  /** Σ credited qty per invoice line (the return bound). */
  private async creditedQtyByInvoiceLine(invoiceId: string): Promise<Map<string, string>> {
    const notes = await store.listCreditNotes({ invoiceId, limit: 500 });
    const map = new Map<string, string>();
    for (const noteRow of notes) {
      if (noteRow.status !== "POSTED" && noteRow.status !== "APPROVED") continue;
      const lines = await store.listCreditNoteLines(noteRow.id);
      for (const line of lines) {
        map.set(
          line.invoiceLineId,
          new Decimal(map.get(line.invoiceLineId) ?? "0").plus(new Decimal(line.qty)).toFixed(6),
        );
      }
    }
    return map;
  }

  /** The invoice's outstanding AR (the INV-016 credit bound). */
  private async invoiceOutstanding(invoiceId: string): Promise<string> {
    const items = await store.arOpenItemsAsOf({
      asOf: new Date().toISOString().slice(0, 10),
      openOnly: false,
      limit: 10000,
      side: "ALL",
    });
    const relevant = items.filter(
      (item) =>
        item.sourceId === invoiceId &&
        item.sourceType === "sales_invoice" &&
        item.direction === "DEBIT",
    );
    let total = new Decimal(0);
    for (const item of relevant) {
      total = total.plus(new Decimal(item.outstanding));
    }
    return total.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);
  }

  /** The re-entry warehouse: explicit (the job-card port passes the
   * card's — issue_immediate invoices carry warehouseId NULL), else the
   * with-goods invoice's, else the DN's. */
  private async resolveReentryWarehouse(
    noteId: string,
    invoice: store.SalesInvoiceRow,
    explicitWarehouseId: string | null | undefined,
  ): Promise<string> {
    if (explicitWarehouseId !== null && explicitWarehouseId !== undefined) return explicitWarehouseId;
    if (invoice.warehouseId !== null) return invoice.warehouseId;
    if (invoice.deliveryId !== null) {
      const delivery = await store.findDeliveryNoteById(invoice.deliveryId);
      if (delivery !== undefined) return delivery.warehouseId;
    }
    throw new CreditNoteRefInvalidError(
      `credit note ${noteId} cannot resolve the re-entry warehouse — pass the warehouse explicitly or reference a stock-issued invoice`,
    );
  }
}
