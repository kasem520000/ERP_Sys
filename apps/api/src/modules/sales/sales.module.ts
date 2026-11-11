import { Module, Inject, type OnModuleInit } from "@nestjs/common";

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
import { ReturnsService } from "./application/rma";
import { WarrantiesService } from "./application/warranties";
import { DunningService } from "./application/dunning";
import { SalesReallocationService } from "./application/reallocations";
import { ArQueriesService } from "./application/ar-queries";
import { SalesRepService, InvoiceOverdueService } from "./application/reps";
import { PosSaleService } from "./application/pos-channel/pos-sale-service";
import { JobCardService } from "./job-cards/application/job-card-service";
import { JobCardPosting } from "./job-cards/application/posting/job-card-posting";
import { SalesController, PartnerCreditCheckController } from "./presentation/sales.controller";
import { JobCardsController } from "./presentation/job-cards.controller";
import { CommerceController } from "./presentation/commerce.controller";
import { ReturnsController } from "./presentation/returns.controller";
import { DunningController } from "./presentation/dunning.controller";
import { AgencyPortalController } from "./presentation/agency-portal.controller";
import { registerWarrantyExpiryJob } from "./infrastructure/warranty-expiry.job";
import { registerDunningSweepJob } from "./infrastructure/dunning-sweep.job";
import { getBoss } from "../../infra/jobs/boss";

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
  controllers: [
    SalesController,
    PartnerCreditCheckController,
    JobCardsController,
    CommerceController,
    ReturnsController,
    DunningController,
    AgencyPortalController,
  ],
  providers: [
    QuotationService,
    SalesOrderService,
    DeliveryNoteService,
    SalesInvoiceService,
    CreditNoteService,
    // PHASE-039 (0055): the customer RMA workflow (G-35/G-36/G-37 at
    // completion) + the managed-warranty register with its expiry sweep.
    ReturnsService,
    WarrantiesService,
    // PHASE-039 (0056/0057/0058): the dunning engine — the policy ladder
    // (BR-065 monotonic), the late-fee register (L1-12) with its fee
    // invoice through SalesInvoiceService, the collection-agency layer
    // (L1-11, G-39) and the partner credit reviews (L1-10).
    DunningService,
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
    ReturnsService,
    WarrantiesService,
    DunningService,
    SalesReallocationService,
    ArQueriesService,
    SalesRepService,
    InvoiceOverdueService,
    PosSaleService,
    JobCardService,
    JobCardPosting,
  ],
})
export class SalesModule implements OnModuleInit {
  constructor(
    @Inject(WarrantiesService) private readonly warranties: WarrantiesService,
    @Inject(DunningService) private readonly dunning: DunningService,
  ) {}

  async onModuleInit(): Promise<void> {
    // PHASE-039 T-05: the warranty expiry sweep (2:50 UTC) — the same
    // degraded-boot discipline as the scorecard sweep (registration
    // failure never takes the module down; the schedule is an idempotent
    // replace).
    await registerWarrantyExpiryJob(getBoss(), this.warranties).catch(() => undefined);
    // PHASE-039 T-07: the dunning sweep (2:45 UTC — BEFORE the warranty
    // sweep at 2:50): the BR-065 ladder pass + the credit-review-due
    // notifications, same degraded-boot discipline.
    await registerDunningSweepJob(getBoss(), this.dunning).catch(() => undefined);
  }
}
