import { Module, Inject, type OnModuleInit } from "@nestjs/common";

import { AccountingModule } from "../accounting/accounting.module";
import { AuditModule } from "../audit/audit.module";
import { TaxModule } from "../tax/tax.module";
import { InventoryModule } from "../inventory/inventory.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { BudgetingModule } from "../budgeting/budgeting.module";
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
import { RfqService } from "./application/rfq";
import { SupplierQuoteService } from "./application/quotes";
import { AwardService } from "./application/award";
import { BlanketService } from "./application/blanket";
import { ScorecardService } from "./application/scorecards";
import { CapexService } from "./application/capex";
import { SupplierAdvancesService } from "./application/advances";
import { TenderIntakeService } from "./application/tenders";
import { registerScorecardSweepJob } from "./infrastructure/scorecard-sweep.job";
import { getBoss } from "../../infra/jobs/boss";
import { PurchasingController } from "./presentation/purchasing.controller";
import { SourcingController } from "./presentation/sourcing.controller";
import { PortalController } from "./presentation/portal.controller";

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
 * PHASE-038 additions: the sourcing negotiation loop in front of the PO
 * (H-11) — RFQ lifecycle (BR-063), supplier quotes + the P-05 portal
 * skeleton (the public PortalController shares this module's quote
 * service), the comparison/award matrix with the 3-bid floor (BR-062) and
 * PO/blanket-release generation, blanket agreements (P-03), supplier
 * scorecards + approved items (P-04, with the approved-vendor gate on PO
 * creation), CAPEX requests with the PHASE-028 guard (P-10/P-15),
 * supplier advances + early-payment discounts (G-33/G-34), and tender
 * intake (P-14/DF-52/53).
 *
 * Dependencies (DEPENDENCY_RULES §2; the phase §4): accounting (posting
 * engine, numbering, reconciliation framework) + inventory (receiveStock —
 * purchasing NEVER writes stock tables) + tax (resolver + INV-012 adapter)
 * + audit + notifications (the BR-062 advisory inbox) + budgeting (the
 * ControlGuard declared edge for CAPEX). Every journal flows through
 * PostingEngine.post (ADR-0007).
 */
@Module({
  imports: [AccountingModule, AuditModule, TaxModule, InventoryModule, NotificationsModule, BudgetingModule],
  controllers: [PurchasingController, SourcingController, PortalController],
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
    RfqService,
    SupplierQuoteService,
    AwardService,
    BlanketService,
    ScorecardService,
    CapexService,
    SupplierAdvancesService,
    TenderIntakeService,
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
    RfqService,
    SupplierQuoteService,
    AwardService,
    BlanketService,
    ScorecardService,
  ],
})
export class PurchasingModule implements OnModuleInit {
  async onModuleInit(): Promise<void> {
    // PHASE-038 T-06: the scorecard nightly sweep (2:40 UTC) — the same
    // degraded-boot discipline as the ZATCA backfill (registration
    // failure never takes the module down; the schedule is an idempotent
    // replace).
    await registerScorecardSweepJob(getBoss(), this.scorecards).catch((error) => {
      void error;
    });
  }

  constructor(@Inject(ScorecardService) private readonly scorecards: ScorecardService) {}
}
