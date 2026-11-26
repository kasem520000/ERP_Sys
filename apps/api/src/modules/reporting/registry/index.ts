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
  taxEInvoicingLogContract,
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
import { fixedAssetsMaintenanceCostsContract } from "./fixed-assets/maintenance-costs.contract";
import { fixedAssetsMaintenanceBacklogContract } from "./fixed-assets/maintenance-backlog.contract";
import { fixedAssetsMeterReadingsContract } from "./fixed-assets/meter-readings.contract";
import { fixedAssetsExpiryRegisterContract } from "./fixed-assets/expiry-register.contract";
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
// PHASE-046 (W-6, T-13 — D-12): the two compliance contracts — the
// statutory-summary fold (the three-way statutory-totals-tie) and the
// EOSB liability view (the standing-model eosb-provision-tie).
import { payrollStatutorySummaryContract } from "./payroll/statutory-summary.contract";
import { payrollEosbLiabilityContract } from "./payroll/eosb-liability.contract";
// PHASE-034 · the consolidation set (REPORT_CATALOG §10 — the four
// contracts that assert INV-026 in the footer and block exports on
// failure; statements read the completed run's immutable snapshots).
import { consolidationConsolidatedTbContract } from "./consolidation/consolidated-tb.contract";
import { consolidationConsolidatedIsContract } from "./consolidation/consolidated-is.contract";
import { consolidationConsolidatedBsContract } from "./consolidation/consolidated-bs.contract";
import { consolidationEliminationsLogContract } from "./consolidation/eliminations-log.contract";
// PHASE-038 · the sourcing set (REPORT_CATALOG §3 additions — the award
// matrix rendered verbatim from the frozen snapshot and the supplier
// scorecard list).
import {
  purchasingRfqAwardMatrixContract,
  purchasingSupplierScorecardContract,
} from "./operational/sourcing";
// PHASE-039 · the returns + collections set (REPORT_CATALOG §3 additions —
// the unified RMA register over both families and the dunning status
// worklist).
import {
  salesRmaRegisterContract,
  salesDunningStatusContract,
} from "./operational/returns-dunning";
// PHASE-041 · the communications set (REPORT_CATALOG §7 addition — the
// outbound delivery log over the send ledger).
import { communicationOutboundDeliveryLogContract } from "./communication/outbound-delivery-log.contract";
// PHASE-042 · the manufacturing-execution set (REPORT_CATALOG §9 additions —
// work-center utilization/OEE, the downtime analysis, the rework cost
// register, the cost-variance rollup).
import { manufacturingWorkCenterUtilizationContract } from "./manufacturing/work-center-utilization.contract";
import { manufacturingDowntimeAnalysisContract } from "./manufacturing/downtime-analysis.contract";
import { manufacturingReworkCostContract } from "./manufacturing/rework-cost.contract";
import { manufacturingCostVarianceContract } from "./manufacturing/cost-variance.contract";
// PHASE-044 · the WMS intelligence set (REPORT_CATALOG §4 additions — the
// bin-contents register, the cycle-count variance register, the ABC
// classification, the slow-movement intelligence view).
import {
  inventoryAbcClassificationContract,
  inventoryBinContentsContract,
  inventoryCycleCountVarianceContract,
  inventorySlowMovementContract,
} from "./operational/wms";
// PHASE-043 · the MRP & planning set (REPORT_CATALOG additions — the MRP
// exceptions view (the data-readiness defects + the run residuals) and the
// ATP/CTP position register with the BR-080 exclusion evidence).
import { manufacturingMrpExceptionsContract } from "./manufacturing/mrp-exceptions.contract";
import { manufacturingAtpPositionContract } from "./manufacturing/atp-position.contract";
// PHASE-045 · the hr set (REPORT_CATALOG §9's PHASE-045 rows — the
// workforce registers: the attendance register with the derivation's
// verdicts + minute facts, the leave balance cells with the INV-031
// render-time cap re-check, and the overtime folds with BR-084's
// feeding law as first-class columns).
import { hrAttendanceRegisterContract } from "./hr/attendance-register.contract";
import { hrLeaveBalancesContract } from "./hr/leave-balances.contract";
import { hrOvertimeSummaryContract } from "./hr/overtime-summary.contract";
// PHASE-047 (W-6, T-15) · the talent set (REPORT_CATALOG §9's PHASE-047
// rows — the four report contracts, registry 106 → 110): the appraisal
// cycle results (BR-090's manager-outcomes-only posture, the W-4 bridge
// precedent), the recruitment funnel (BR-088's FIXED ladder as count
// columns — counts only, the applicants' personal data never ships), the
// training completions (the once-stamped completed_at + the result
// vocabulary), and the document expiry register (the tenant's configured
// sweep windows as the band source — red line 5's DATA law; the document
// number never ships, amendment A-4).
import { hrPerformanceCycleResultsContract } from "./hr/performance-cycle-results.contract";
import { hrRecruitmentPipelineContract } from "./hr/recruitment-pipeline.contract";
import { hrTrainingCompletionsContract } from "./hr/training-completions.contract";
import { hrDocumentExpiryContract } from "./hr/document-expiry.contract";
// PHASE-048 (W-14 — T-17, dated 2026-11-22) · the projects set
// (REPORT_CATALOG §9's PHASE-048 rows — the four report contracts,
// registry 110 → 114): every contract reads the W-9…W-12 engines'
// own outputs VERBATIM (zero parallel computation — D-15's law) and
// rides the module's own read keys (the §12 convention, matrix §3.26).
import { projectsEvmSummaryContract } from "./projects/evm-summary.contract";
import { projectsContractProgressContract } from "./projects/contract-progress.contract";
import { projectsRetentionStatementContract } from "./projects/retention-statement.contract";
import { projectFieldserviceSlaContract } from "./projects/fieldservice-sla.contract";
// PHASE-050 (W-30 — T-17, dated 2026-11-23) · the quality set
// (REPORT_CATALOG §9's PHASE-050 rows — the four report contracts,
// registry 118 → 122): every contract reads the quality module's own
// registers VERBATIM (zero parallel computation — D-18's law; the BR-103
// gate fold and the sweep's own probe shape compose the engines' own
// reads) and rides the module's own read key (the §12 convention,
// matrix §3.28 — quality.view).
import { qualityNcrRegisterContract } from "./quality/ncr-register.contract";
import { qualityCapaStatusContract } from "./quality/capa-status.contract";
import { qualityCalibrationDueContract } from "./quality/calibration-due.contract";
import { qualityComplaintsSummaryContract } from "./quality/complaints-summary.contract";
// PHASE-051 (W-40 — T-15, dated 2026-11-26) · the trade set
// (REPORT_CATALOG §9's PHASE-051 rows — the four report contracts,
// registry 122 → 126): every contract reads the trade module's own
// registers VERBATIM (zero parallel computation — D-18's law; the
// duty/VAT line fold the completion act rides + the sweep's own
// effective-config band fold are the engines' own reads) and rides
// the module's own read keys (the §12 convention, matrix §3.29 —
// trade.lc.view · trade.customs.view · trade.shipments.view ·
// trade.view).
import { tradeLcRegisterContract } from "./trade/lc-register.contract";
import { tradeCustomsDeclarationRegisterContract } from "./trade/customs-declaration-register.contract";
import { tradeShipmentStatusContract } from "./trade/shipment-status.contract";
import { tradeDutyDrawbackStatusContract } from "./trade/duty-drawback-status.contract";

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
  // PHASE-044 · the WMS intelligence set
  inventoryBinContentsContract,
  inventoryCycleCountVarianceContract,
  inventoryAbcClassificationContract,
  inventorySlowMovementContract,
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
  // §6 tax — PHASE-035 T-06 (audit EVAL-F-6): the documented-but-missing
  // 86th contract, registry 85 → 86.
  taxEInvoicingLogContract,
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
  // §9 financial depth — PHASE-049 rows (REPORT_CATALOG §9's PHASE-049
  // additions; W-22, T-16, dated 2026-11-22): the CMMS set — the
  // work-order cost register with the LIVE INV-034 tie (the GL
  // maintenance-expense debit vs the order's own source legs, plus the
  // no-posting-before-completion arm), the maintenance backlog (the
  // overdue ACTIVE plans by their OWN next-due date + the open orders,
  // the days derived from the database's CURRENT_DATE), the meter
  // readings log (the engine's own rows with the source vocabulary +
  // the JOB work-order link check), and the fleet expiry register
  // (R-10's engine read verbatim — the four chips + the single
  // designated-odometer binding) — every figure the engines' own,
  // zero parallel computation; the §12 module-register key reuse
  // (assets.maintenance.view ×2 · assets.meters.view ·
  // assets.expiry.view).
  fixedAssetsMaintenanceCostsContract,
  fixedAssetsMaintenanceBacklogContract,
  fixedAssetsMeterReadingsContract,
  fixedAssetsExpiryRegisterContract,
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
  // §payroll — PHASE-046 rows (REPORT_CATALOG §payroll; W-6, T-13 — D-12):
  // the statutory-summary (per period × profile row: base, shares, capped
  // counts, the frozen accrued/remitted liability — the three-way
  // statutory-totals-tie) and the EOSB liability (per employee: service
  // years, tier days, entitlement, the standing provision, settled, the
  // delta — the standing-model eosb-provision-tie)
  payrollStatutorySummaryContract,
  payrollEosbLiabilityContract,
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
  // §purchasing sourcing (REPORT_CATALOG §3 PHASE-038 rows): the frozen
  // award matrix (the evidence contract — the stored snapshot renders
  // verbatim, never recomputed) and the supplier scorecard (P-04's
  // rolling-window scores with the sample decomposition).
  purchasingRfqAwardMatrixContract,
  purchasingSupplierScorecardContract,
  // §sales returns + collections (REPORT_CATALOG §3 PHASE-039 rows): the
  // unified RMA register (customer 0055 + supplier 0059 families with
  // their completion documents and cycle days) and the dunning status
  // worklist (overdue items × ladder step × fee register × referrals).
  salesRmaRegisterContract,
  salesDunningStatusContract,
  // §7 platform additions — PHASE-041 (REPORT_CATALOG §7 row): the outbound
  // delivery log (every send a row: status, provider, ref, cost, attempts).
  communicationOutboundDeliveryLogContract,
  // §9 industry additions — PHASE-042 (REPORT_CATALOG §9 rows — the
  // manufacturing-execution set): work-center utilization & OEE, the
  // downtime analysis by reason, the rework cost register (G-41/BR-069),
  // and the cost-variance rollup (setup/usage/rate + yield).
  manufacturingWorkCenterUtilizationContract,
  manufacturingDowntimeAnalysisContract,
  manufacturingReworkCostContract,
  manufacturingCostVarianceContract,
  manufacturingMrpExceptionsContract,
  manufacturingAtpPositionContract,
  // §9 workforce — PHASE-045 rows (REPORT_CATALOG §9's PHASE-045
  // additions): the hr set — the attendance register (punch sessions +
  // the derived day verdicts with the status-vocabulary +
  // session-shape block-on-fail checks), the leave balances (per-year
  // cells with the leave-inv031-balance-cap render-time re-check), and
  // the overtime summary (per-employee/rule folds with BR-084's feeding
  // split — the pre-approval-required pending hours surface as the
  // never-fed exception column).
  hrAttendanceRegisterContract,
  hrLeaveBalancesContract,
  hrOvertimeSummaryContract,
  // §9 workforce — PHASE-047 rows (REPORT_CATALOG §9's PHASE-047
  // additions; W-6, T-15): the talent set — the appraisal cycle results
  // (the manager-outcomes-only posture with the BR-090 block-on-fail
  // check), the recruitment funnel (the stage-total tie over the FIXED
  // ladder), the training completions (the completion-shape check), and
  // the document expiry register (the band-vocabulary check over the
  // tenant's configured thresholds).
  hrPerformanceCycleResultsContract,
  hrRecruitmentPipelineContract,
  hrTrainingCompletionsContract,
  hrDocumentExpiryContract,
  // §10 projects — PHASE-048 rows (REPORT_CATALOG §9's PHASE-048
  // additions; W-14, T-17, dated 2026-11-22): the projects set — the
  // EVM summary (the W-10 snapshot's own figures + the INV-033
  // block-on-fail tie), the contract progress (the W-11 certificates
  // register + the BR-093 ceiling card's own read, with BR-092's pair
  // re-check), the retention statement (the whole ledger verbatim,
  // NO amount totals by design — the W-13 print law), and the
  // field-service SLA posture (the pure single-clock readout, nothing
  // recorded — the no-fabricated-target check).
  projectsEvmSummaryContract,
  projectsContractProgressContract,
  projectsRetentionStatementContract,
  projectFieldserviceSlaContract,
  // §9 quality — PHASE-050 rows (REPORT_CATALOG §9's PHASE-050 additions;
  // W-30, T-17, dated 2026-11-23): the QMS set — the NCR register (the
  // module's own rows with the item/partner briefs; quantities never
  // summed across unlike units), the CAPA status (the BR-103 gate's own
  // verdict figures through the same fold the close act rides), the
  // calibration due window (the sweep's own probe shape — the effective
  // thresholds ladder folded into disjoint bands), and the complaints
  // summary (the register's own grouped counts, counts only) — every
  // figure the quality module's own, zero parallel computation.
  qualityNcrRegisterContract,
  qualityCapaStatusContract,
  qualityCalibrationDueContract,
  qualityComplaintsSummaryContract,
  // §9 trade — PHASE-051 rows (REPORT_CATALOG §9's PHASE-051 additions;
  // registry 122 → 126): every figure the trade module's own, zero
  // parallel computation.
  tradeLcRegisterContract,
  tradeCustomsDeclarationRegisterContract,
  tradeShipmentStatusContract,
  tradeDutyDrawbackStatusContract,
]);

export { validateRegistry, registrySnapshot } from "./runtime";
