/**
 * PHASE-022 T-P22-3-b · the companion area barrel (MASTER-PLAN §2 layout:
 * src/companion/ — dashboards, statements, invoice views, the approvals
 * affordance, master-data search; ALL READ-CACHED† — the structural
 * no-write proof in __tests__/companion-personal.test asserts these
 * modules never import enqueue or the command builders).
 */
export {
  approvalsAffordance,
  onlineOnlyGate,
  type ApprovalsAffordance,
  type OnlineOnlyDisableReason,
} from "./approvals-affordance";
export {
  buildCompanionDashboard,
  type CompanionDashboard,
  type DashboardMetric,
  type DashboardVanStock,
} from "./dashboard-viewmodel";
export {
  buildStatementView,
  type StatementView,
  type StatementViewEntry,
} from "./statement-viewmodel";
export {
  buildCachedInvoices,
  buildOwnDocuments,
  type CachedInvoiceRow,
  type OwnDocumentRow,
} from "./invoice-views";
export { searchMasterData, type MasterDataHit } from "./master-data-search";
