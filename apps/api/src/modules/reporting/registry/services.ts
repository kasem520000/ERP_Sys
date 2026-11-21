import { StatementQueries } from "../../accounting/application/statement-queries";
import { GlQueries } from "../../accounting/application/gl-queries";
import { ArQueriesService } from "../../sales/application/ar-queries";
import { ApQueriesService } from "../../purchasing/application/ap-queries";
import { SalesAnalyticsService } from "../../sales/application/sales-analytics";
import { ApAnalyticsService } from "../../purchasing/application/ap-analytics";
import { InventoryQueriesService } from "../../inventory/application/inventory-queries";
import { IndustryInventoryQueriesService } from "../../inventory/application/industry-queries";
import { PosQueriesService } from "../../pos/application/pos-queries";
import { AutomotiveQueriesService } from "./industry/automotive-queries";
import { DistributionQueriesService } from "./industry/distribution-queries";
import { ManufacturingQueriesService } from "./industry/manufacturing-queries";
import { CrmQueriesService } from "./industry/crm-queries";
import { FixedAssetsQueriesService } from "./fixed-assets/fixed-assets-queries";
import { NotesQueriesService } from "./notes/notes-queries";
import { InstallmentsQueriesService } from "./installments/installments-queries";
import { BudgetingQueriesService } from "./budgeting/budgeting-queries";
import { PayrollQueriesService } from "./payroll/payroll-queries";
import { ConsolidationQueriesService } from "./consolidation/consolidation-queries";
import { TreasuryQueriesService } from "../../treasury/application/treasury-queries";
import { SourcingQueriesService } from "./sourcing/sourcing-queries";
import { ReturnsDunningQueriesService } from "./sales/returns-dunning-queries";
import { CommunicationQueriesService } from "./communication/outbound-delivery-queries";
import { HrQueriesService } from "./hr/hr-queries";
import { ProjectActualsService } from "../../crm/application/project-actuals-service";
import { ProjectBudgetService } from "../../crm/application/project-budget-service";
import { EvmService } from "../../crm/application/evm-service";
import { ChangeOrderService } from "../../crm/application/change-order-service";
import { SubcontractService } from "../../crm/application/subcontract-service";
import { RetentionService } from "../../crm/application/retention-service";
import { ProgressBillingService } from "../../crm/application/progress-billing-service";
import { FieldserviceService } from "../../crm/application/fieldservice-service";
import { ServiceOrderPosting } from "../../crm/application/service-order-posting";
import { SalesInvoiceService } from "../../sales/application/invoices";
import { ReservationService } from "../../inventory/application/reservation-service";
import { InboxService } from "../../notifications/application/inbox-service";
import { TaxResolverService } from "../../tax/application/tax-resolver-service";
import { NumberingService } from "../../accounting/application/numbering-service";
import { PostingService } from "../../accounting/application/posting-service";
import { PartnerSubledgerService } from "../../partners/application/subledger-service";
import { ManufacturingExecutionQueriesService } from "./manufacturing/queries";
import { PlanningQueriesService } from "./manufacturing/planning-queries";
import { WmsQueriesService } from "./operational/wms-queries";
import { PartnerQueriesService } from "../../partners/application/partner-queries";
import { TaxQueriesService } from "../../tax/application/tax-queries";
import { UserQueriesService } from "../../identity/application/user-queries";
import { AuditService } from "../../audit/api/audit";
import { DrizzleAuditStore } from "../../audit/infrastructure/drizzle-audit.store";

/**
 * PHASE-013 · the reporting service locator: contracts are static modules,
 * so the module-owned authorized query services they consume are provided
 * through lazy singletons (direct construction — the same pattern the db
 * fixtures use; every service here is a stateless reader over the ambient
 * tenant transaction).
 */

export interface ReportingServices {
  statements: StatementQueries;
  gl: GlQueries;
  ar: ArQueriesService;
  ap: ApQueriesService;
  salesAnalytics: SalesAnalyticsService;
  apAnalytics: ApAnalyticsService;
  inventory: InventoryQueriesService;
  /** PHASE-015 · the industry-report query surface (expiry list, write-off register + GL tie, IMEI register). */
  industryInventory: IndustryInventoryQueriesService;
  /** PHASE-016 · the POS report query surface (by-terminal/by-hour + the shift cash tie-out). */
  posQueries: PosQueriesService;
  /** PHASE-017 · the automotive report query surface (job-card profitability + GL tie, vehicle history). */
  automotive: AutomotiveQueriesService;
  /** PHASE-017 · the distribution/commissions query surface (settlements + GL tie, route compliance, van stock + conservation tie, FOC effectiveness, commissions due + total tie). */
  distribution: DistributionQueriesService;
  /** PHASE-018 · the manufacturing query surface (production cost + materials GL tie, the batch-genealogy recall walk with sales doc numbers, the QC inspection log). */
  manufacturing: ManufacturingQueriesService;
  /** PHASE-019 · the CRM query surface (contract revenue schedule + revenue GL tie + the AR overdue open-item buckets, the time-billing summary). */
  crm: CrmQueriesService;
  /** PHASE-026 · the fixed_assets query surface (as-of asset register + fa-cost-tie/fa-accum-tie, depreciation schedule, movements with journal provenance). */
  fixedAssets: FixedAssetsQueriesService;
  /** PHASE-027 · the notes query surface (as-of maturity calendar + inv024-custody-tie, aging + notes-open-tie/notes-payable-tie, the dishonored register with G-26 provenance). */
  notes: NotesQueriesService;
  /** PHASE-027 · the installments query surface (one plan's schedule + schedule-sum-tie/lines-count-tie, the aging with the installments-inv016-tie sanity). */
  installments: InstallmentsQueriesService;
  /** PHASE-028 · the budgeting query surface (budget vs actual + the budget-ledger-tie fold, the variance analysis with top over/under lines). */
  budgeting: BudgetingQueriesService;
  /** PHASE-029 · the payroll query surface (the register with the INV-025/journal tie, the cost summary with the per-period ledger tie, the EOS provision with the GL balance fold). */
  payroll: PayrollQueriesService;
  /** PHASE-034 · the consolidation query surface (the completed run's immutable snapshot → consolidated TB/IS/BS with the render-time INV-026 line-by-line re-check, the eliminations log with its journal-chain tie). Statements read snapshots — never live member books. */
  consolidation: ConsolidationQueriesService;
  /** PHASE-038 · the sourcing query surface (the frozen award matrix rendered verbatim from the stored snapshot, the scorecard list). */
  sourcing: SourcingQueriesService;
  /** PHASE-039 · the returns + collections query surface (the unified customer+supplier RMA register, the dunning status worklist). */
  returnsDunning: ReturnsDunningQueriesService;
  /** PHASE-041 · the communication query surface (the outbound delivery log over the send ledger). */
  communication: CommunicationQueriesService;
  /** PHASE-045 · the hr query surface (the attendance register with the
   * derived day verdicts, the per-year leave balance cells with the
   * INV-031 cap re-check, the overtime folds with BR-084's feeding split). */
  hr: HrQueriesService;
  /** PHASE-043 · the planning query surface (the MRP exceptions view + the
   * ATP/CTP positions with the BR-080 evidence). */
  planningQueries: PlanningQueriesService;
  /** PHASE-042 · the manufacturing-execution query surface (work-center
   * utilization/OEE, the downtime analysis, the rework cost register, the
   * cost-variance rollup). */
  manufacturingExecution: ManufacturingExecutionQueriesService;
  /** PHASE-044 · the WMS intelligence query surface (the bin-contents
   * register + the INV-029 fold, the cycle-count variance register, the
   * ABC classification, the slow-movement intelligence view). */
  wmsQueries: WmsQueriesService;
  treasury: TreasuryQueriesService;
  partners: PartnerQueriesService;
  tax: TaxQueriesService;
  users: UserQueriesService;
  audit: AuditService;
  /** PHASE-048 (W-14 — T-17, dated 2026-11-22) · the projects query
   * surface — the W-9…W-12 engines the four projects contracts read
   * VERBATIM (zero parallel computation: every figure is the engine's
   * own string; stateless readers over the ambient tenant transaction,
   * the same direct-construction graph the db fixtures build). */
  projectsActuals: ProjectActualsService;
  projectsBudgets: ProjectBudgetService;
  projectsEvm: EvmService;
  projectsChangeOrders: ChangeOrderService;
  projectsSubcontracts: SubcontractService;
  projectsRetention: RetentionService;
  projectsBilling: ProgressBillingService;
  projectsFieldservice: FieldserviceService;
}

let bundle: ReportingServices | undefined;

export function reportingServices(): ReportingServices {
  if (bundle === undefined) {
    bundle = {
      statements: new StatementQueries(),
      gl: new GlQueries(),
      ar: new ArQueriesService(),
      ap: new ApQueriesService(),
      salesAnalytics: new SalesAnalyticsService(),
      apAnalytics: new ApAnalyticsService(),
      inventory: new InventoryQueriesService(),
      industryInventory: new IndustryInventoryQueriesService(),
      posQueries: new PosQueriesService(),
      automotive: new AutomotiveQueriesService(),
      distribution: new DistributionQueriesService(),
      manufacturing: new ManufacturingQueriesService(),
      crm: new CrmQueriesService(),
      fixedAssets: new FixedAssetsQueriesService(),
      notes: new NotesQueriesService(),
      installments: new InstallmentsQueriesService(),
      budgeting: new BudgetingQueriesService(),
      payroll: new PayrollQueriesService(),
      consolidation: new ConsolidationQueriesService(),
      sourcing: new SourcingQueriesService(),
      returnsDunning: new ReturnsDunningQueriesService(),
      communication: new CommunicationQueriesService(),
      hr: new HrQueriesService(),
      planningQueries: new PlanningQueriesService(),
      manufacturingExecution: new ManufacturingExecutionQueriesService(),
      wmsQueries: new WmsQueriesService(),
      treasury: new TreasuryQueriesService(),
      partners: new PartnerQueriesService(),
      tax: new TaxQueriesService(),
      users: new UserQueriesService(),
      audit: new AuditService(new DrizzleAuditStore()),
      // PHASE-048 (W-14 — T-17, dated 2026-11-22): the projects engines —
      // the same dependency graph the __db__/projects fixtures build
      // (audit + posting + numbering shared, actuals the root reader).
      projectsActuals: new ProjectActualsService(),
      projectsBudgets: new ProjectBudgetService(new AuditService(new DrizzleAuditStore()), new ProjectActualsService()),
      projectsChangeOrders: new ChangeOrderService(new AuditService(new DrizzleAuditStore()), new PostingService(new AuditService(new DrizzleAuditStore()), new PartnerSubledgerService())),
      projectsSubcontracts: new SubcontractService(new AuditService(new DrizzleAuditStore()), new PostingService(new AuditService(new DrizzleAuditStore()), new PartnerSubledgerService()), new ProjectActualsService()),
      projectsRetention: new RetentionService(new AuditService(new DrizzleAuditStore()), new PostingService(new AuditService(new DrizzleAuditStore()), new PartnerSubledgerService()), new ProjectActualsService()),
      projectsBilling: (() => {
        const audit = new AuditService(new DrizzleAuditStore());
        const posting = new PostingService(audit, new PartnerSubledgerService());
        return new ProgressBillingService(
          audit,
          posting,
          new NumberingService(audit),
          new ProjectActualsService(),
          new ChangeOrderService(audit, posting),
        );
      })(),
      projectsEvm: new EvmService(
        new ProjectBudgetService(new AuditService(new DrizzleAuditStore()), new ProjectActualsService()),
        new ProjectActualsService(),
      ),
      projectsFieldservice: (() => {
        const audit = new AuditService(new DrizzleAuditStore());
        const posting = new PostingService(audit, new PartnerSubledgerService());
        const numbering = new NumberingService(audit);
        const invoices = new SalesInvoiceService(audit, posting, numbering, new TaxResolverService());
        const postings = new ServiceOrderPosting(posting, invoices, new ReservationService(audit));
        return new FieldserviceService(audit, new InboxService(), postings);
      })(),
    };
  }
  return bundle;
}
