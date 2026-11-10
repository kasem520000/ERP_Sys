import type { ReportContract } from "../application/contract";

/**
 * PHASE-013 · the report-contract registry (REPORTING_ARCHITECTURE §2):
 * every code-defined contract, assembled. The module's boot hook
 * (ReportingModule.onModuleInit) validates the full set — a malformed
 * contract fails startup; the meta-tests assert the failure modes.
 * Registered rows are the PHASE-013 set of REPORT_CATALOG §1–§7 whose
 * data phases (003–012) are delivered (§13 readiness matrix).
 */

import {
  posSalesByTerminalContract,
  posSalesByHourContract,
  treasuryShiftCashReconciliationContract,
} from "./industry/pos";
import {
  trialBalanceContract,
  generalLedgerContract,
  incomeStatementContract,
  balanceSheetContract,
  cashFlowContract,
  journalRegisterContract,
  costCentersContract,
} from "./financial/statements";
import { fiscalClosePackContract } from "./financial/close-pack";
import {
  arAgingContract,
  apAgingContract,
  partnerStatementContract,
  supplierStatementContract,
  arAllocationsContract,
  partnerBalancesContract,
} from "./operational/ar-ap";
import {
  salesByItemContract,
  salesByCustomerContract,
  salesByRepContract,
  salesByPaymentMethodContract,
  salesByBranchContract,
  salesDocumentFlowContract,
  salesProfitabilityContract,
} from "./operational/sales";
import {
  purchasingBySupplierContract,
  purchasingByItemContract,
  purchasingGrniContract,
  purchasingPoStatusContract,
  purchasingMatchingExceptionsContract,
} from "./operational/purchasing";
import {
  inventoryStockOnHandContract,
  inventoryMovementContract,
  inventoryValuationContract,
  inventoryExpiryContract,
  inventoryCountVarianceContract,
  inventoryTransferLogContract,
  inventorySerialTrackingContract,
  inventorySlowMovingContract,
} from "./operational/inventory";
import {
  salesDailyRevenueContract,
  inventoryReorderAlertsContract,
} from "./operational/dashboard";
import {
  treasuryDailyCashContract,
  treasuryReceiptsRegisterContract,
  treasuryPaymentsRegisterContract,
  treasuryPettyCashContract,
  treasuryExpensesContract,
  treasuryShiftsContract,
  treasuryBankReconContract,
  treasuryFxDifferencesContract,
  taxVatReturnContract,
  taxSummaryByTreatmentContract,
  platformAuditTrailContract,
  platformUserActivityContract,
  platformReportRunsContract,
  platformSubscriptionUsageContract,
} from "./operational/treasury-tax-platform";
import {
  inventoryExpiryListContract,
  groceryExpiryWriteoffContract,
  retailImeiRegisterContract,
} from "./industry/industry";
import {
  automotiveJobCardProfitabilityContract,
  automotiveVehicleServiceHistoryContract,
  distributionRepSettlementContract,
  distributionRouteVisitComplianceContract,
  distributionVanStockBalancesContract,
  salesDiscountEffectivenessContract,
  salesCommissionsDueContract,
} from "./industry/phase017";
import {
  manufacturingProductionCostContract,
  manufacturingBatchGenealogyContract,
  manufacturingQcInspectionLogContract,
} from "./industry/phase018";
import {
  servicesContractRevenueScheduleContract,
  servicesTimeBillingSummaryContract,
} from "./industry/phase019";
import { fixedAssetsAssetRegisterContract } from "./fixed-assets/asset-register.contract";
import { fixedAssetsDepreciationScheduleContract } from "./fixed-assets/depreciation-schedule.contract";
import { fixedAssetsMovementsContract } from "./fixed-assets/movements.contract";
import { notesMaturityCalendarContract } from "./notes/maturity-calendar.contract";
import { notesAgingContract } from "./notes/aging.contract";
import { notesDishonoredRegisterContract } from "./notes/dishonored-register.contract";
import { installmentsScheduleContract } from "./installments/schedule.contract";
import { installmentsAgingContract } from "./installments/aging.contract";
// PHASE-028/029 (restored lineage) · the budgeting + payroll sets.
import { budgetingBudgetVsActualContract } from "./budgeting/budget-vs-actual.contract";
import { budgetingVarianceAnalysisContract } from "./budgeting/variance-analysis.contract";
import { payrollRegisterContract } from "./payroll/register.contract";
import { payrollCostSummaryContract } from "./payroll/cost-summary.contract";
import { payrollEosProvisionContract } from "./payroll/eos-provision.contract";
// PHASE-034 · the consolidation set (REPORT_CATALOG §10 — the four
// contracts that assert INV-026 in the footer and block exports on
// failure; statements read the completed run's immutable snapshots).
import { consolidationConsolidatedTbContract } from "./consolidation/consolidated-tb.contract";
import { consolidationConsolidatedIsContract } from "./consolidation/consolidated-is.contract";
import { consolidationConsolidatedBsContract } from "./consolidation/consolidated-bs.contract";
import { consolidationEliminationsLogContract } from "./consolidation/eliminations-log.contract";

export const REPORT_CONTRACTS: readonly ReportContract[] = Object.freeze([
  // §1 financial statements
  trialBalanceContract,
  generalLedgerContract,
  incomeStatementContract,
  balanceSheetContract,
  cashFlowContract,
  fiscalClosePackContract,
  journalRegisterContract,
  costCentersContract,
  // §2 AR/AP
  arAgingContract,
  apAgingContract,
  partnerStatementContract,
  supplierStatementContract,
  arAllocationsContract,
  partnerBalancesContract,
  // §3 sales & purchasing
  salesByItemContract,
  salesByCustomerContract,
  salesByRepContract,
  salesByPaymentMethodContract,
  salesByBranchContract,
  salesDocumentFlowContract,
  salesProfitabilityContract,
  purchasingBySupplierContract,
  purchasingByItemContract,
  purchasingGrniContract,
  purchasingPoStatusContract,
  purchasingMatchingExceptionsContract,
  // §4 inventory
  inventoryStockOnHandContract,
  inventoryMovementContract,
  inventoryValuationContract,
  inventoryExpiryContract,
  inventoryCountVarianceContract,
  inventoryTransferLogContract,
  inventorySerialTrackingContract,
  inventorySlowMovingContract,
  // §3+§4 dashboard-binding additions (PHASE-014 §2.7; REPORT_CATALOG §14)
  salesDailyRevenueContract,
  inventoryReorderAlertsContract,
  // §5 treasury
  treasuryDailyCashContract,
  treasuryReceiptsRegisterContract,
  treasuryPaymentsRegisterContract,
  treasuryPettyCashContract,
  treasuryExpensesContract,
  treasuryShiftsContract,
  treasuryBankReconContract,
  treasuryFxDifferencesContract,
  // §6 tax
  taxVatReturnContract,
  taxSummaryByTreatmentContract,
  // §7 platform
  platformAuditTrailContract,
  platformUserActivityContract,
  platformReportRunsContract,
  platformSubscriptionUsageContract,
  // §8 industry (industries/reports/README PHASE-015 rows — the keys the
  // retail/grocery/restaurant template manifests pin verbatim)
  inventoryExpiryListContract,
  groceryExpiryWriteoffContract,
  retailImeiRegisterContract,
  // §8 industry (industries/reports/README PHASE-016 rows — the POS set
  // the Z report reconciles against)
  posSalesByTerminalContract,
  posSalesByHourContract,
  treasuryShiftCashReconciliationContract,
  // §8 industry (industries/reports/README PHASE-017 rows — the automotive
  // workshop + van-sales distribution + commissions set)
  automotiveJobCardProfitabilityContract,
  automotiveVehicleServiceHistoryContract,
  distributionRepSettlementContract,
  distributionRouteVisitComplianceContract,
  distributionVanStockBalancesContract,
  salesDiscountEffectivenessContract,
  salesCommissionsDueContract,
  // §9 industry (industries/reports/README PHASE-018 rows — the
  // manufacturing set)
  manufacturingProductionCostContract,
  manufacturingBatchGenealogyContract,
  manufacturingQcInspectionLogContract,
  // §10 industry (industries/reports/README PHASE-019 rows — the
  // professional-services services set)
  servicesContractRevenueScheduleContract,
  servicesTimeBillingSummaryContract,
  // §9 financial depth (REPORT_CATALOG §9 PHASE-026 rows — the fixed-assets
  // set: the as-of register with the fa-cost-tie/fa-accum-tie block-on-fail
  // checks, the remaining depreciation schedule, the movements register
  // with journal provenance)
  fixedAssetsAssetRegisterContract,
  fixedAssetsDepreciationScheduleContract,
  fixedAssetsMovementsContract,
  // §9 financial depth — PHASE-027 rows (REPORT_CATALOG §9): the
  // notes/installments set — the as-of maturity calendar with the
  // inv024-custody-tie block-on-fail check, the notes aging with the
  // notes-open-tie/notes-payable-tie footer ties, the dishonored register
  // with its G-26 provenance check, one plan's installment schedule with
  // the schedule-sum-tie/lines-count-tie checks, and the installments aging
  // with the installments-inv016-tie sanity
  notesMaturityCalendarContract,
  notesAgingContract,
  notesDishonoredRegisterContract,
  installmentsScheduleContract,
  installmentsAgingContract,
  // §9 financial depth — PHASE-028 rows (REPORT_CATALOG §9): the
  // budgeting set — budget vs actual (the ACTIVE version baseline vs the
  // dimension-grouped GL actuals per period, the budget-ledger-tie
  // block-on-fail check folding to the trial balance) and the variance
  // analysis (the period trend + top over/under lines + threshold
  // highlighting, the same ledger tie)
  budgetingBudgetVsActualContract,
  budgetingVarianceAnalysisContract,
  // §payroll — PHASE-029 rows (REPORT_CATALOG §payroll): the payroll set —
  // the register (per-employee gross/deductions/net with the INV-025 +
  // G-29 journal tie), the cost summary (cost center × project × period
  // with the per-period ledger tie), and the EOS provision (accruals,
  // settlements, balances with the GL fold)
  payrollRegisterContract,
  payrollCostSummaryContract,
  payrollEosProvisionContract,
  // §10 consolidation (REPORT_CATALOG §10 PHASE-034 rows — the
  // consolidated-statement set: TB/IS/BS with the inv026 headline
  // block-on-fail assertion + the TB balance tie, and the eliminations
  // log with the eliminations-journal-tie INV-006 chain check; group
  // views over the completed run's immutable snapshots — never live
  // member books)
  consolidationConsolidatedTbContract,
  consolidationConsolidatedIsContract,
  consolidationConsolidatedBsContract,
  consolidationEliminationsLogContract,
]);

export { validateRegistry, registrySnapshot } from "./runtime";
