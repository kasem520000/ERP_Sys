import { Module } from "@nestjs/common";

import { AccountingModule } from "../accounting/accounting.module";
import { AuditModule } from "../audit/audit.module";
import { TaxModule } from "../tax/tax.module";
import { InventoryModule } from "../inventory/inventory.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { QuotationService } from "./application/quotations";
import { SalesOrderService } from "./application/orders";
import { DeliveryNoteService } from "./application/deliveries";
import { SalesInvoiceService } from "./application/invoices";
import { CreditNoteService } from "./application/credit-notes";
import { SalesReallocationService } from "./application/reallocations";
import { ArQueriesService } from "./application/ar-queries";
import { SalesRepService, InvoiceOverdueService } from "./application/reps";
import { PosSaleService } from "./application/pos-channel/pos-sale-service";
import { JobCardService } from "./job-cards/application/job-card-service";
import { JobCardPosting } from "./job-cards/application/posting/job-card-posting";
import { SalesController, PartnerCreditCheckController } from "./presentation/sales.controller";
import { JobCardsController } from "./presentation/job-cards.controller";
import { CommerceController } from "./presentation/commerce.controller";

/**
 * Sales module (PHASE-012): the quote-to-cash chain — quotations (BR-006
 * validity, conversion) → sales orders (optional soft reservations against
 * the PHASE-010 seam) → delivery notes (G-03 COGS via the movement core,
 * no AR; BR-007 both flows) → sales invoices (G-01 credit / G-02 cash /
 * G-03 with-goods; BR-033 snapshots; BR-001 credit limits at approval with
 * the no-TOCTOU re-verification; BR-005 policy autopost) → credit notes
 * (G-04 + the W-3 original-cost re-entry; BR-004 window + mandatory
 * reference); receipts ride the PHASE-008 treasury service (keyed
 * sales.receipts.*) with audited re-allocation documents (BR-027/INV-016);
 * AR aging + customer statements as deterministic as-of recomputations
 * (RC-10; the RC-01/RC-03 tie rides the PHASE-007 'AR' framework check);
 * the invoice.overdue exactly-once job; rep attribution (commissions are
 * PHASE-017 — none exist here).
 *
 * Dependencies (DEPENDENCY_RULES §2; the phase §4): accounting (posting
 * engine, numbering) + inventory (issueStock/re-entry — sales NEVER writes
 * stock tables) + tax (resolver + INV-012 adapter) + audit +
 * notifications (the overdue digest). Every journal flows through
 * PostingEngine.post (ADR-0007).
 */
@Module({
  imports: [AccountingModule, AuditModule, TaxModule, InventoryModule, NotificationsModule],
  controllers: [SalesController, PartnerCreditCheckController, JobCardsController, CommerceController],
  providers: [
    QuotationService,
    SalesOrderService,
    DeliveryNoteService,
    SalesInvoiceService,
    CreditNoteService,
    SalesReallocationService,
    ArQueriesService,
    SalesRepService,
    InvoiceOverdueService,
    PosSaleService,
    JobCardService,
    // PHASE-017 T4-a: the job-card posting port (issue_immediate COGS at
    // approval, completion invoicing, warranty credit notes). PostingService
    // comes from AccountingModule; ReservationService from InventoryModule
    // (both imported + exported there).
    JobCardPosting,
  ],
  exports: [
    QuotationService,
    SalesOrderService,
    DeliveryNoteService,
    SalesInvoiceService,
    CreditNoteService,
    SalesReallocationService,
    ArQueriesService,
    SalesRepService,
    InvoiceOverdueService,
    PosSaleService,
    JobCardService,
    JobCardPosting,
  ],
})
export class SalesModule {}
