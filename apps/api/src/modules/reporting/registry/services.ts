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
  treasury: TreasuryQueriesService;
  partners: PartnerQueriesService;
  tax: TaxQueriesService;
  users: UserQueriesService;
  audit: AuditService;
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
      treasury: new TreasuryQueriesService(),
      partners: new PartnerQueriesService(),
      tax: new TaxQueriesService(),
      users: new UserQueriesService(),
      audit: new AuditService(new DrizzleAuditStore()),
    };
  }
  return bundle;
}
