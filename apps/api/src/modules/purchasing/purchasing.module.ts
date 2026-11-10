import { Module } from "@nestjs/common";

import { AccountingModule } from "../accounting/accounting.module";
import { AuditModule } from "../audit/audit.module";
import { TaxModule } from "../tax/tax.module";
import { InventoryModule } from "../inventory/inventory.module";
import { PurchaseRequestService, PurchaseOrderService } from "./application/orders";
import { GoodsReceiptService } from "./application/goods-receipts";
import { SupplierInvoiceService } from "./application/supplier-invoices";
import { DebitNoteService } from "./application/debit-notes";
import { ReallocationService } from "./application/reallocations";
import { ApQueriesService } from "./application/ap-queries";
import { LandedCostService } from "./application/landed-costs";
import { OpeningApService } from "./application/opening-ap";
import { PurchasingReconciliationService } from "./application/purchasing-reconciliation";
import { MatchingService } from "./application/matching";
import { PurchasingController } from "./presentation/purchasing.controller";

/**
 * Purchasing module (PHASE-011): the procure-to-pay chain — purchase
 * requests → orders (BR-010 thresholds, revisions) → goods receipts (G-07:
 * stock via the PHASE-010 movement core + GRNI accrual) → supplier
 * invoices (three-way match BR-009, G-08 with the GRNI clear + AP open,
 * VAT recoverability per pack + registration) → debit notes (G-09) →
 * payments (the PHASE-008 treasury service, keyed purchasing.payments.*)
 * with audited re-allocations; AP aging/statement/GRNI query services
 * (deterministic as-of), the landed-cost baseline, and the RC-09 GRNI
 * reconciliation registered into the PHASE-007 framework (PC-04).
 *
 * Dependencies (DEPENDENCY_RULES §2; the phase §4): accounting (posting
 * engine, numbering, reconciliation framework) + inventory (receiveStock —
 * purchasing NEVER writes stock tables) + tax (resolver + INV-012 adapter)
 * + audit. Every journal flows through PostingEngine.post (ADR-0007).
 */
@Module({
  imports: [AccountingModule, AuditModule, TaxModule, InventoryModule],
  controllers: [PurchasingController],
  providers: [
    MatchingService,
    PurchaseRequestService,
    PurchaseOrderService,
    GoodsReceiptService,
    SupplierInvoiceService,
    DebitNoteService,
    ReallocationService,
    ApQueriesService,
    LandedCostService,
    OpeningApService,
    PurchasingReconciliationService,
  ],
  exports: [
    MatchingService,
    PurchaseRequestService,
    PurchaseOrderService,
    GoodsReceiptService,
    SupplierInvoiceService,
    DebitNoteService,
    ReallocationService,
    ApQueriesService,
    LandedCostService,
    OpeningApService,
  ],
})
export class PurchasingModule {}
