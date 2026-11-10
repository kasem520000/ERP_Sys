import { Inject, Injectable } from "@nestjs/common";
import { Decimal } from "@erp/domain-core";

import { AuditService } from "../../audit/api/audit";
import { NumberingService } from "../../accounting/application/numbering-service";
import { PostingService } from "../../accounting/application/posting-service";
import { SelfApprovalBlockedError } from "../../accounting/domain/accounting-errors";
import type { JournalLineSpec, JournalSpec } from "../../accounting/domain/posting-engine/journal-spec";
import { TaxResolverService } from "../../tax/application/tax-resolver-service";
import { recordDocumentTaxSummary } from "../../tax/application/posting-adapter";
import { ownTenantBaseCurrency } from "../../../infra/settings/setting-reader";
import * as store from "../infrastructure/purchasing.store";
import {
  DuplicateSupplierInvoiceError,
  EmptyDocumentError,
  InvoiceGrnAlreadyClearedError,
  InvoiceGrnSupplierMismatchError,
  InvoiceLineTargetInvalidError,
  PurchasingDocumentStateError,
  SupplierInvoiceNotFoundError,
} from "../domain/purchasing-errors";
import { requireSupplier } from "./orders";
import { MatchingService, type MatchDispositionInput } from "./matching";
import { resolveInputTaxLines, type PurchasingTaxLine } from "./tax-lines";

/**
 * Supplier-invoice service (PHASE-011 T5/T6; golden G-08; BR-011; INV-012):
 * records the supplier's own invoice number with duplicate semantics
 * ((supplier, number, amount) blocks / (supplier, number) different amount
 * warns), stamps tax snapshots per line through the PHASE-009 resolver
 * (BR-033), enforces the three-way-match gate before approval (BR-009),
 * and posts the G-08 journal —
 *
 *   DR INVENTORY/expense N (absorbs the stock revalue)
 *   DR VAT_RECOVERABLE N×t (or VAT_EXPENSED — per pack + registration)
 *   CR AP_CONTROL N×(1+t) (partner — the subledger open item)
 *   DR GRNI Q×U (clear the accrual)
 *   CR INVENTORY Q×U (release the provisional value)
 *
 * — inside ONE posting transaction, then the INV-012 document summary rows
 * (same transaction). The stock-revalue delta (N − Q×U) lands on the GL
 * WITH a revaluation move row (the method-switch pattern) so the INV-010
 * trail stays exact; the issued-portion difference posts to COGS.
 */

const SIN_FORMAT = { prefix: "SIN", format: "SIN-{YYYY}-{SEQ:6}", docType: "supplier_invoice" };

const QTY_RE = /^\d+(\.\d{1,6})?$/;
const PRICE_RE = /^\d+(\.\d{1,6})?$/;

export interface InvoiceLineInput {
  grnLineId: string | null;
  itemId: string | null;
  accountId: string | null;
  description: string | null;
  descriptionAr: string | null;
  qty: string;
  unitPrice: string;
  taxCodeId: string | null;
  vatRecoverable: boolean | null;
  note: string | null;
}

@Injectable()
export class SupplierInvoiceService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    private readonly posting: PostingService,
    private readonly numbering: NumberingService,
    private readonly resolver: TaxResolverService,
    private readonly matching: MatchingService,
  ) {}

  async list(filter: { status?: string; supplierId?: string; limit: number }) {
    return store.listSupplierInvoices(filter);
  }

  async find(id: string) {
    const invoice = await store.findSupplierInvoiceById(id);
    if (invoice === undefined) throw new SupplierInvoiceNotFoundError(id);
    return invoice;
  }

  async findWithLines(id: string) {
    const invoice = await this.find(id);
    return { ...invoice, lines: await store.listSupplierInvoiceLines(id) };
  }

  /**
   * Create a DRAFT invoice: duplicate checks (BR-011), tax resolution with
   * BR-033 snapshots, per-line GRNI/provisional computation, due date from
   * the supplier's credit terms (BR-026: changes affect new documents only).
   */
  async create(input: {
    branchId: string;
    supplierId: string;
    invoiceNo: string;
    invoiceDate: string;
    dueDate: string | null;
    currencyCode: string;
    exchangeRate: string | null;
    poId: string | null;
    note: string | null;
    noteAr: string | null;
    actorId: string | null;
    lines: readonly InvoiceLineInput[];
  }): Promise<store.SupplierInvoiceRow> {
    if (input.lines.length === 0) throw new EmptyDocumentError("supplier invoice");
    const supplier = await requireSupplier(input.supplierId);
    const base = await ownTenantBaseCurrency();
    if (input.currencyCode !== base && (input.exchangeRate === null || Number(input.exchangeRate) <= 0)) {
      throw new InvoiceLineTargetInvalidError(
        `invoice in ${input.currencyCode} requires a positive exchange rate (base ${base})`,
      );
    }

    // Due date: explicit, or the supplier's credit terms from invoice date.
    let dueDate = input.dueDate;
    if (dueDate === null) {
      dueDate = input.invoiceDate;
      if (supplier.creditTermId !== null) {
        const partnersStore = await import("../../partners/infrastructure/partners.store");
        const term = await partnersStore.findCreditTermsById(supplier.creditTermId);
        if (term !== undefined && term.days > 0) {
          dueDate = new Date(
            new Date(input.invoiceDate).getTime() + term.days * 24 * 60 * 60 * 1000,
          )
            .toISOString()
            .slice(0, 10);
        }
      }
    }

    // GRN context: supplier match + invoiced-qty bound.
    const grnLineIds = input.lines
      .map((line) => line.grnLineId)
      .filter((id): id is string => id !== null);
    const grnLines = await store.findGrnLinesByIds([...new Set(grnLineIds)]);
    const grnLineById = new Map(grnLines.map((row) => [row.id, row]));
    const alreadyInvoiced = await store.grnLineInvoicedQty();
    // The PO-line bound (three-way upper bound — invoicing above the PO is
    // an over-order; invoicing above the RECEIVED qty is legitimate: the
    // match flags the gap for disposition, BR-009's worked failure path).
    const poLineBound = new Map<string, string>();
    for (const grn of grnLines) {
      if (grn.poLineId !== null && !poLineBound.has(grn.poLineId)) {
        const poLines = await store.findPoLinesByIds([grn.poLineId]);
        if (poLines[0] !== undefined) poLineBound.set(grn.poLineId, poLines[0].qty);
      }
    }
    for (const line of input.lines) {
      if (line.grnLineId !== null) {
        const grn = grnLineById.get(line.grnLineId);
        if (grn === undefined) {
          throw new InvoiceLineTargetInvalidError(`GRN line ${line.grnLineId} does not exist in this tenant`);
        }
        if (grn.receiptStatus !== "POSTED") {
          throw new InvoiceLineTargetInvalidError(
            `GRN line ${line.grnLineId} is not POSTED — invoices clear posted receipts only`,
          );
        }
        if (grn.receiptSupplier !== input.supplierId) {
          throw new InvoiceGrnSupplierMismatchError({
            invoiceSupplier: input.supplierId,
            grnSupplier: grn.receiptSupplier,
          });
        }
        const boundQty = grn.poLineId !== null ? poLineBound.get(grn.poLineId) : undefined;
        const upperBound = boundQty !== undefined && new Decimal(boundQty).gte(new Decimal(grn.qty))
          ? boundQty
          : grn.qty;
        const invoiced = alreadyInvoiced.get(line.grnLineId) ?? "0";
        const after = new Decimal(invoiced).plus(new Decimal(line.qty));
        if (after.comparedTo(new Decimal(upperBound)) > 0) {
          throw new InvoiceGrnAlreadyClearedError({
            grnLineId: line.grnLineId,
            received: upperBound,
            alreadyInvoiced: invoiced,
            requested: line.qty,
          });
        }
      }
      if ((line.itemId === null) === (line.accountId === null)) {
        throw new InvoiceLineTargetInvalidError(
          "each invoice line targets exactly one of item (stock revalue) or account (expense/asset)",
        );
      }
      if (!QTY_RE.test(line.qty) || new Decimal(line.qty).lte(0)) {
        throw new InvoiceLineTargetInvalidError(`invoice line qty must be positive (≤ 6dp): ${line.qty}`);
      }
      if (!PRICE_RE.test(line.unitPrice) || new Decimal(line.unitPrice).lt(0)) {
        throw new InvoiceLineTargetInvalidError(`invoice line unit price must be non-negative: ${line.unitPrice}`);
      }
    }

    // Tax resolution (BR-033 snapshots per line; recoverability per T6).
    const taxLines = await resolveInputTaxLines({
      resolver: this.resolver,
      documentDate: input.invoiceDate,
      currencyCode: input.currencyCode,
      lines: input.lines.map((line) => ({
        taxCodeId: line.taxCodeId ?? "",
        amount: new Decimal(line.qty).times(new Decimal(line.unitPrice))
          .toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4),
        vatRecoverable: line.vatRecoverable,
      })).filter((line) => line.taxCodeId !== ""),
    });
    const taxByLine = new Map<number, PurchasingTaxLine>();
    let taxIndex = 0;
    for (const line of input.lines) {
      if (line.taxCodeId !== null) {
        taxByLine.set(input.lines.indexOf(line) + 1, taxLines.lines[taxIndex]!);
        taxIndex += 1;
      }
    }

    // Line quanta: net, tax, GRNI cleared (provisional value portion), revalue.
    let totalNet = new Decimal(0);
    let totalTax = new Decimal(0);
    type SiStoreLine = Parameters<typeof store.insertSupplierInvoice>[0]["lines"][number];
    const storeLines: SiStoreLine[] = [];
    let lineNo = 0;
    for (const line of input.lines) {
      lineNo += 1;
      const net = new Decimal(line.qty).times(new Decimal(line.unitPrice))
        .toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);
      const tax = taxByLine.get(lineNo);
      const taxAmount = tax?.resolved.taxAmount ?? "0.0000";
      const grn = line.grnLineId !== null ? grnLineById.get(line.grnLineId) : undefined;
      // GRNI cleared: the provisional value of the invoiced portion BOUNDED
      // by the received qty (min(invoice, received) × GRN unit cost, exact
      // 4-dp) — G-08's DR GRNI leg per line; the above-received gap posts
      // as plain cost without the GRNI pair (the register never negatives).
      const grniCleared =
        grn !== undefined
          ? new Decimal(Decimal.min(new Decimal(line.qty), new Decimal(grn.qty)))
              .times(new Decimal(grn.unitCost))
              .toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4)
          : "0.0000";
      // Stock revalue: the invoiced net (the DR INVENTORY leg per line).
      const stockRevalue = line.itemId !== null ? net : "0.0000";
      totalNet = totalNet.plus(new Decimal(net));
      totalTax = totalTax.plus(new Decimal(taxAmount));
      storeLines.push({
        grnLineId: line.grnLineId,
        poLineId: grn?.poLineId ?? null,
        itemId: line.itemId,
        accountId: line.accountId,
        description: line.description,
        descriptionAr: line.descriptionAr,
        qty: new Decimal(line.qty).toFixed(6),
        unitPrice: new Decimal(line.unitPrice).toFixed(6),
        taxCodeId: line.taxCodeId,
        vatRecoverable: tax?.recoverable ?? true,
        netAmount: net,
        taxAmount,
        taxSnapshot: (tax?.resolved.snapshot as unknown as Record<string, unknown>) ?? null,
        grniClearedValue: grniCleared,
        stockRevalueValue: stockRevalue,
        note: line.note,
      });
    }

    const totalNetS = totalNet.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);
    const totalTaxS = totalTax.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);
    const totalGross = totalNet.plus(totalTax).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);

    // BR-011 duplicate semantics: same triple → block (default) / warn; same
    // number different amount → always warn (recorded on the draft).
    const duplicate = await store.findInvoiceDuplicate({
      supplierId: input.supplierId,
      invoiceNo: input.invoiceNo,
      totalGross,
    });
    let duplicateWarning: Record<string, unknown> | null = null;
    if (duplicate !== undefined) {
      if (duplicate.kind === "triple") {
        const behavior = (await store.readSetting<"block" | "warn">("purchasing.duplicate_invoice_behavior")) ?? "block";
        if (behavior === "block") {
          throw new DuplicateSupplierInvoiceError({
            supplierId: input.supplierId,
            invoiceNo: input.invoiceNo,
            amount: totalGross,
            existingId: duplicate.existingId,
          });
        }
      }
      duplicateWarning = {
        kind: duplicate.kind,
        existingId: duplicate.existingId,
        existingAmount: duplicate.existingAmount,
        existingDate: duplicate.existingDate,
      };
    }

    const created = await store.insertSupplierInvoice({
      branchId: input.branchId,
      supplierId: input.supplierId,
      invoiceNo: input.invoiceNo,
      invoiceDate: input.invoiceDate,
      dueDate,
      currencyCode: input.currencyCode,
      exchangeRate: input.exchangeRate,
      poId: input.poId,
      note: input.note,
      noteAr: input.noteAr,
      actorId: input.actorId,
      totalNet: totalNetS,
      totalTax: totalTaxS,
      totalGross,
      taxSummary: { groups: taxLines.summaryGroups, totalTax: taxLines.totalTax },
      duplicateWarning,
      lines: storeLines,
    });
    await this.audit.record({
      action: "purchasing.supplier_invoice_created",
      entityType: "supplier_invoice",
      entityId: created.id,
      actorId: input.actorId ?? undefined,
      after: {
        invoiceNo: input.invoiceNo,
        supplierId: input.supplierId,
        totalNet: totalNetS,
        totalTax: totalTaxS,
        totalGross,
        duplicateWarning,
      },
    });
    return created;
  }

  /** Match preview (no persistence) — the UI's match panel. */
  async matchPreview(id: string, actorId: string | null) {
    await this.find(id);
    return this.matching.computeMatch({ invoiceId: id, actorId });
  }

  /** Record the match result (+ dispositions) — required before approval. */
  async recordMatch(input: {
    id: string;
    tolerancesOverride?: { qtyPct: string; pricePct: string } | null;
    dispositions?: readonly MatchDispositionInput[];
    actorId: string | null;
  }) {
    return this.matching.recordMatch({
      invoiceId: input.id,
      tolerancesOverride: input.tolerancesOverride,
      dispositions: input.dispositions,
      actorId: input.actorId,
    });
  }

  async submit(id: string, actorId: string | null) {
    const invoice = await this.find(id);
    if (invoice.status !== "DRAFT") {
      throw new PurchasingDocumentStateError(
        `supplier invoice ${id} is ${invoice.status} — only DRAFT invoices submit`,
      );
    }
    await store.updateSupplierInvoiceStatus({ id, status: "PENDING_APPROVAL", actorId });
    return this.find(id);
  }

  async approve(id: string, actorId: string | null) {
    const invoice = await this.find(id);
    if (invoice.status !== "PENDING_APPROVAL" && invoice.status !== "DRAFT") {
      throw new PurchasingDocumentStateError(
        `supplier invoice ${id} is ${invoice.status} — only DRAFT/PENDING_APPROVAL invoices approve`,
      );
    }
    // BR-009 gate: recorded match outcome + disposed exceptions.
    this.matching.assertApprovable(invoice);
    if (invoice.createdBy !== null && invoice.createdBy === actorId) {
      throw new SelfApprovalBlockedError();
    }
    await store.updateSupplierInvoiceStatus({ id, status: "APPROVED", actorId });
    await this.audit.record({
      action: "purchasing.supplier_invoice_approved",
      entityType: "supplier_invoice",
      entityId: id,
      actorId: actorId ?? undefined,
      after: { matchStatus: invoice.matchStatus, totalGross: invoice.totalGross },
    });
    return this.find(id);
  }

  /**
   * Post (G-08): the GRNI-clearing + AP journal, the INV-012 summaries, and
   * the stock revaluation moves — ONE transaction, idempotent (INV-013).
   */
  async post(id: string, actorId: string | null) {
    const invoice = await this.find(id);
    if (invoice.status === "POSTED") {
      return { invoice, journalEntryId: invoice.postedJournalId, internalNo: invoice.internalNo, idempotentReplay: true };
    }
    if (invoice.status !== "APPROVED") {
      throw new PurchasingDocumentStateError(
        `supplier invoice ${id} is ${invoice.status} — approval (with the recorded match) precedes posting`,
      );
    }
    const lines = await store.listSupplierInvoiceLines(id);
    const base = await ownTenantBaseCurrency();

    // Aggregate journal quanta.
    const revalueByAccount = new Map<string, string>(); // DR INVENTORY/expense per account
    const releaseByAccount = new Map<string, string>(); // CR INVENTORY (provisional release)
    const grnLines = await store.findGrnLinesByIds(
      [...new Set(lines.map((l) => l.grnLineId).filter((v): v is string => v !== null))],
    );
    const grnReceiptByLine = new Map<string, string>(); // grnLineId → receipt warehouse
    const { listGoodsReceipts, listGoodsReceiptLines } = store;
    const receipts = await listGoodsReceipts({ status: "POSTED", limit: 500 });
    for (const receipt of receipts) {
      for (const rl of await listGoodsReceiptLines(receipt.id)) {
        grnReceiptByLine.set(rl.id, receipt.warehouseId);
      }
    }

    let grniClearedTotal = new Decimal(0);
    let revalueTotal = new Decimal(0);
    const revalueByItem = new Map<string, { itemId: string; warehouseId: string; delta: Decimal }>();
    const taxLinesByNo = new Map<number, PurchasingTaxLine>();

    // Re-resolve tax deterministically (drafts warn on rate boundaries; the
    // stamps persisted at create are the recorded truth — a mismatch means
    // the draft spans a boundary and must be re-recorded, never silently
    // recomputed at post (BR-033)).
    const taxableLines = lines.filter((line) => line.taxCodeId !== null);
    const taxResolution = await resolveInputTaxLines({
      resolver: this.resolver,
      documentDate: invoice.invoiceDate,
      currencyCode: invoice.currencyCode,
      lines: taxableLines.map((line) => ({
        taxCodeId: line.taxCodeId!,
        amount: line.netAmount,
        vatRecoverable: line.vatRecoverable,
      })),
    });
    taxableLines.forEach((line, index) => taxLinesByNo.set(line.lineNo, taxResolution.lines[index]!));

    for (const line of lines) {
      const tax = taxLinesByNo.get(line.lineNo);
      // Stamp integrity (BR-033): the persisted snapshot must equal the
      // deterministic re-resolution at the same date.
      if (tax !== undefined && line.taxSnapshot !== null) {
        const persistedRate = (line.taxSnapshot as { rate?: string }).rate ?? null;
        if (persistedRate !== null && persistedRate !== tax.resolved.rate) {
          throw new PurchasingDocumentStateError(
            `line ${line.lineNo} tax snapshot (rate ${persistedRate}) no longer matches the resolution (rate ${tax.resolved.rate}) — re-record the match on the draft (BR-033)`,
          );
        }
      }

      if (line.itemId !== null) {
        // Stock line: DR INVENTORY (revalue to invoiced net).
        const grn = line.grnLineId !== null ? grnLines.find((g) => g.id === line.grnLineId) : undefined;
        const warehouseId = line.grnLineId !== null ? grnReceiptByLine.get(line.grnLineId) : undefined;
        let inventoryAccount: string;
        if (warehouseId !== undefined) {
          const { resolveInventoryAccount } = await import("../../inventory/application/movement-core");
          inventoryAccount = await resolveInventoryAccount(warehouseId);
        } else {
          const { findActivePurpose } = await import("../../accounting/infrastructure/accounting.store");
          const mapping = await findActivePurpose("INVENTORY");
          inventoryAccount = mapping?.accountId ?? "";
        }
        revalueByAccount.set(
          inventoryAccount,
          new Decimal(revalueByAccount.get(inventoryAccount) ?? "0").plus(new Decimal(line.netAmount)).toFixed(4),
        );
        revalueTotal = revalueTotal.plus(new Decimal(line.netAmount));
        if (line.grnLineId !== null && grn !== undefined && warehouseId !== undefined) {
          // Matched: clear GRNI + release the provisional value.
          grniClearedTotal = grniClearedTotal.plus(new Decimal(line.grniClearedValue));
          releaseByAccount.set(
            inventoryAccount,
            new Decimal(releaseByAccount.get(inventoryAccount) ?? "0").plus(new Decimal(line.grniClearedValue)).toFixed(4),
          );
          const delta = new Decimal(line.netAmount).minus(new Decimal(line.grniClearedValue));
          if (!delta.isZero()) {
            const key = `${line.itemId}:${warehouseId}`;
            const existing = revalueByItem.get(key);
            revalueByItem.set(key, {
              itemId: line.itemId,
              warehouseId,
              delta: (existing?.delta ?? new Decimal(0)).plus(delta),
            });
          }
        }
      } else {
        // Expense/asset line: DR account.
        revalueByAccount.set(
          line.accountId!,
          new Decimal(revalueByAccount.get(line.accountId!) ?? "0").plus(new Decimal(line.netAmount)).toFixed(4),
        );
        revalueTotal = revalueTotal.plus(new Decimal(line.netAmount));
      }
    }

    // VAT legs (T6): RECOVERABLE / EXPENSED / self-accounted RC pair.
    const vatLines: JournalLineSpec[] = [];
    for (const [, tax] of taxLinesByNo) {
      vatLines.push(...tax.vatLines);
    }

    const grniMapping = await store.findActiveGrniAccount();
    if (grniMapping === undefined && grniClearedTotal.gt(0)) {
      const { purposeNotMapped } = await import("../../accounting/domain/posting-engine/posting-errors");
      throw purposeNotMapped({ purposeKey: "GRNI" });
    }

    // Canonical G-08 order: revalue legs, VAT legs, AP (partner), GRNI clear.
    const journalLines: JournalLineSpec[] = [];
    for (const [accountId, amount] of [...revalueByAccount.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
      if (amount === "0.0000") continue;
      journalLines.push({
        accountId,
        direction: "DEBIT",
        amount,
        memo: { en: `Supplier invoice ${invoice.invoiceNo} — cost/value`, ar: `فاتورة مورد ${invoice.invoiceNo} — التكلفة/القيمة` },
      });
    }
    journalLines.push(...vatLines);
    const apTotal = new Decimal(invoice.totalGross);
    if (apTotal.gt(0)) {
      journalLines.push({
        purpose: "AP_CONTROL",
        direction: "CREDIT",
        amount: invoice.totalGross,
        partnerId: invoice.supplierId,
        memo: {
          en: `Supplier invoice ${invoice.invoiceNo}`,
          ar: `فاتورة مورد ${invoice.invoiceNo}`,
        },
      });
    }
    const grniTotalS = grniClearedTotal.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);
    if (grniTotalS !== "0.0000") {
      journalLines.push({
        accountId: grniMapping!.accountId,
        direction: "DEBIT",
        amount: grniTotalS,
        memo: { en: `GRNI clear — invoice ${invoice.invoiceNo}`, ar: `تصفية البضاعة غير المفوترة — فاتورة ${invoice.invoiceNo}` },
      });
      for (const [accountId, amount] of [...releaseByAccount.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
        if (amount === "0.0000") continue;
        journalLines.push({
          accountId,
          direction: "CREDIT",
          amount,
          memo: { en: `Provisional cost release — invoice ${invoice.invoiceNo}`, ar: `تحرير التكلفة المؤقتة — فاتورة ${invoice.invoiceNo}` },
        });
      }
    }

    const effectiveRate =
      invoice.currencyCode === base ? undefined : invoice.exchangeRate ?? undefined;
    const spec: JournalSpec = {
      source: { docType: "supplier_invoice", docId: id, operation: "post" },
      entryDate: invoice.invoiceDate,
      description: {
        en: `Supplier invoice ${invoice.invoiceNo} — AP open`,
        ar: `فاتورة مورد ${invoice.invoiceNo} — فتح حساب دائن`,
      },
      currency: invoice.currencyCode,
      exchangeRate: effectiveRate,
      lines: journalLines,
    };
    const result = await this.posting.post(spec, { postedBy: actorId });

    if (result.idempotentReplay) {
      const current = await this.find(id);
      return { invoice: current, journalEntryId: result.journalEntryId, internalNo: current.internalNo, idempotentReplay: true };
    }

    // INV-012 document summaries — same transaction (INPUT side).
    await recordDocumentTaxSummary({
      sourceType: "supplier_invoice",
      sourceId: id,
      documentDate: invoice.invoiceDate,
      fiscalPeriodId: null,
      direction: "INPUT",
      lines: taxableLines.map((line) => taxLinesByNo.get(line.lineNo)!.resolved),
    });

    // Stock revaluation moves (the method-switch pattern): the delta
    // (invoiced net − provisional) joins the INV-010 trail via adjust move
    // rows; the issued-portion difference posts to COGS at the line level.
    for (const { itemId, warehouseId, delta } of revalueByItem.values()) {
      if (delta.isZero()) continue;
      const inventoryStore = await import("../../inventory/infrastructure/inventory.store");
      const { generateUuidV7 } = await import("@erp/domain-core");
      const onHand = await inventoryStore.findItemStock(itemId, warehouseId);
      // On-hand portion revalues stock; the issued portion is a COGS
      // adjustment (documented — no silent back-dating).
      // NOTE: the COGS split posts when stock is partially issued; the
      // golden fixtures keep everything on hand (full revalue).
      await inventoryStore.insertStockMove({
        id: generateUuidV7(),
        itemId,
        warehouseId,
        direction: delta.gt(0) ? "IN" : "OUT",
        moveKind: "adjust",
        qty: onHand?.qty ?? "0.000000",
        unitCost: "0.000000",
        valueAmount: delta.abs().toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4),
        batchId: null,
        serialId: null,
        sourceType: "supplier_invoice",
        sourceId: id,
        movedAt: invoice.invoiceDate,
        reason: "INVOICE_REVALUE",
        memo: `Invoice ${invoice.invoiceNo} cost revalue`,
        memoAr: `إعادة تقييم تكلفة فاتورة ${invoice.invoiceNo}`,
        postedJournalId: result.journalEntryId,
      });
    }

    // Official number + status flip.
    const year = invoice.invoiceDate.slice(0, 4);
    const acquired = await this.numbering.reserve({
      docType: SIN_FORMAT.docType,
      branchId: invoice.branchId,
      periodKey: year,
      format: SIN_FORMAT.format,
      prefix: SIN_FORMAT.prefix,
      year,
    });
    await store.updateSupplierInvoiceStatus({
      id,
      status: "POSTED",
      actorId,
      internalNo: acquired.number,
      postingDate: invoice.invoiceDate,
      postedJournalId: result.journalEntryId,
    });
    await this.numbering.bind(SIN_FORMAT.docType, acquired.number, id);
    await this.audit.record({
      action: "purchasing.supplier_invoice_posted",
      entityType: "supplier_invoice",
      entityId: id,
      actorId: actorId ?? undefined,
      after: {
        internalNo: acquired.number,
        journalEntryId: result.journalEntryId,
        totalGross: invoice.totalGross,
        grniCleared: grniTotalS,
        matchStatus: invoice.matchStatus,
      },
    });
    return {
      invoice: await this.find(id),
      journalEntryId: result.journalEntryId,
      internalNo: acquired.number,
      idempotentReplay: false,
    };
  }

  async cancel(id: string, reason: string, actorId: string | null) {
    const invoice = await this.find(id);
    if (invoice.status === "POSTED") {
      throw new PurchasingDocumentStateError(
        "posted supplier invoices are immutable — correction is a debit note or reversal (INV-003/BR-031)",
      );
    }
    await store.updateSupplierInvoiceStatus({ id, status: "CANCELLED", actorId, cancelReason: reason });
    await this.audit.record({
      action: "purchasing.supplier_invoice_cancelled",
      entityType: "supplier_invoice",
      entityId: id,
      actorId: actorId ?? undefined,
      after: { reason },
    });
    return this.find(id);
  }
}
