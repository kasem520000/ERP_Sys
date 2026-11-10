import type { z } from "zod";

/**
 * PHASE-013 · report contract types (REPORT_CONTRACT.md §1–§2, normative).
 * A report IS its contract: identity, parameters, scope, permission,
 * currency handling, data sources, aggregation, drill-down, exports,
 * localization, freshness, and reconciliation assertions. Contracts are
 * code-defined TypeScript modules (REPORTING_ARCHITECTURE §2) — tenants
 * save parameter sets, never new logic.
 */

export type Bilingual = { readonly ar: string; readonly en: string };

export type ReportCategory =
  | "financial"
  | "ar-ap"
  | "sales"
  | "purchasing"
  | "inventory"
  | "treasury"
  | "tax"
  | "platform"
  | "industry";

export type DataSourceModule =
  | "accounting"
  | "sales"
  | "purchasing"
  | "inventory"
  | "treasury"
  | "tax"
  | "partners"
  | "audit"
  | "identity"
  | "tenancy"
  | "reporting"
  | "pos" // PHASE-016: the pos module query surface (Z-report contracts)
  | "distribution" // PHASE-017: the distribution query surface (settlements/van/routes)
  | "manufacturing" // PHASE-018: the manufacturing query surface (production cost/genealogy/QC)
  | "crm" // PHASE-019: the CRM query surface (contract revenue schedule / time billing)
  | "fixed_assets" // PHASE-026: the fixed_assets query surface (asset register/schedule/movements)
  | "notes" // PHASE-027: the notes query surface (maturity calendar / aging / dishonored register)
  | "installments" // PHASE-027: the installments query surface (schedule / aging)
  | "budgeting" // PHASE-028: the budgeting query surface (budget vs actual / variance analysis)
  | "payroll" // PHASE-029: the payroll query surface (register / cost summary / EOS provision)
  | "consolidation"; // PHASE-034: the consolidation query surface (consolidated TB/IS/BS + eliminations log over the completed run's immutable snapshots)

export interface DataSourceDecl {
  readonly module: DataSourceModule;
  readonly service: string;
  readonly tables: readonly string[];
  readonly purpose: Bilingual;
}

export interface MeasureDecl {
  readonly id: string;
  readonly kind: "sum" | "count" | "balance" | "derived";
  readonly source?: string;
  readonly rounding?: string;
}

export interface DrillTargetDecl {
  readonly from: string;
  readonly route: string;
  readonly label: Bilingual;
  /** Permission required at the hop (checked at link generation, §4). */
  readonly permission: string;
}

export interface AssertionDecl {
  readonly id: string;
  readonly invariant?: string;
  readonly check: string;
  readonly onFailure: "block-export";
  readonly message: Bilingual;
}

export type ExecutionClass = "inline" | "job";

/** Contract-level metadata (REPORT_CONTRACT §1) + the executable runner. */
export interface ReportContract {
  readonly id: string;
  readonly version: number;
  readonly title: Bilingual;
  readonly category: ReportCategory;
  readonly description: Bilingual;

  /** Zod schema for the run parameters (validated before execution). */
  readonly parameters: z.ZodType<ReportParams>;

  readonly scopeRules: {
    readonly tenant: true;
    readonly branches: "required" | "optional" | "fixed-all";
    readonly warehouses?: "optional" | "required";
    readonly costCenters?: "optional";
    readonly dateRange: "required" | "optional";
    readonly asOf: "required" | "optional" | "forbidden";
  };

  readonly requiredPermission: string;

  readonly currencyHandling: {
    readonly presentation: "base" | "document" | "both";
    readonly method: "posted-rates";
  };

  readonly dataSources: readonly DataSourceDecl[];

  readonly aggregation: {
    readonly groupBy: readonly string[];
    readonly measures: readonly MeasureDecl[];
    readonly sorting: readonly { by: string; dir: "asc" | "desc" }[];
    readonly zeroSuppression: "rows" | "none";
  };

  readonly totals: {
    readonly rowTotals: boolean;
    readonly grandTotals: "sum" | "balance-check" | "none";
    readonly subTotalsByGroup: boolean;
  };

  readonly drillTargets: readonly DrillTargetDecl[];

  readonly exportFormats: readonly ("pdf" | "xlsx" | "csv")[];
  readonly printTemplate?: "a4-report" | "a4-document";

  readonly localization: {
    readonly numerals: "western";
    readonly direction: "per-run-locale";
    readonly labels: "registry-bilingual";
  };

  readonly freshness: {
    readonly semantics: "as-of" | "current";
    readonly cacheTtlSeconds: number;
    readonly invalidationEvents: readonly string[];
  };

  readonly assertions: readonly AssertionDecl[];

  /** Inline vs pg-boss job (REPORTING_ARCHITECTURE §3). */
  readonly executionClass: ExecutionClass;

  /**
   * The executable derivation (ADR-0011: read-only through module-owned
   * authorized query services — never raw cross-module SQL). Returns the
   * result content; the run service wraps it into the stored envelope.
   */
  readonly run: (ctx: RunContext, params: ReportParams) => Promise<ReportContent>;
}

/** Normalized run parameters (REPORT_CONTRACT §1 required keys). */
export interface ReportParams {
  readonly dateFrom?: string;
  readonly dateTo?: string;
  readonly asOf?: string | null;
  readonly asOfDate?: string;
  readonly period?: string;
  readonly branchIds?: readonly string[] | null;
  readonly warehouseIds?: readonly string[] | null;
  readonly partnerId?: string;
  readonly partnerIds?: readonly string[];
  /** PHASE-017 (industry): the vehicle of `automotive.vehicle_service_history`. */
  readonly vehicleId?: string;
  /** PHASE-018 (industry): the batch of `manufacturing.batch_genealogy`. */
  readonly batchId?: string;
  /** PHASE-019 (industry): the contract of `services.contract_revenue_schedule`. */
  readonly contractId?: string;
  /** PHASE-019 (industry): the project of `services.time_billing_summary`. */
  readonly projectId?: string;
  /** PHASE-026 (fixed assets): the category of the asset-register/schedule filters. */
  readonly categoryId?: string;
  /** PHASE-026 (fixed assets): the custodian of the asset-register filter. */
  readonly custodianUserId?: string;
  /** PHASE-026 (fixed assets): the depreciation method filter (schedule). */
  readonly method?: string;
  /** PHASE-026 (fixed assets): the movement kind filter (movements). */
  readonly movementKind?: string;
  /** PHASE-026 (fixed assets): the projection fiscal period (schedule). */
  readonly fiscalPeriodId?: string;
  /** PHASE-029 (payroll): the run of `payroll.register`. */
  readonly runId?: string;
  /** PHASE-027 (notes): the issuing-bank filter of the maturity calendar. */
  readonly bank?: string;
  /** PHASE-027 (notes): the free-text reason filter of the dishonored register. */
  readonly reason?: string;
  /** PHASE-027 (installments): the plan of `installments.schedule`. */
  readonly planId?: string;
  /** PHASE-028 (budgeting): the explicit budget of the variance contracts
   * (defaults to the ACTIVE version of (fiscalYearId, scope)). */
  readonly budgetId?: string;
  /** PHASE-028 (budgeting): the scope filter when no explicit budgetId
   * (ACCOUNTS / COST_CENTERS / PROJECTS / BRANCHES). */
  readonly scope?: string;
  /** PHASE-028 (budgeting): the variance-analysis warning threshold (int
   * percent — the highlighting cutoff, default 100). */
  readonly thresholdPercent?: number;
  readonly customerId?: string;
  readonly supplierId?: string;
  readonly itemId?: string;
  readonly customerIds?: readonly string[];
  readonly supplierIds?: readonly string[];
  readonly repIds?: readonly string[] | null;
  readonly categoryIds?: readonly string[];
  readonly fiscalYearId?: string;
  readonly jurisdiction?: string;
  readonly currency?: "base" | "document";
  readonly locale: "ar" | "en";
  readonly grouping?: string;
  readonly zeroSuppression?: boolean;
  readonly includeOpening?: boolean;
  readonly comparative?: "none" | "prior-period" | "prior-year";
  readonly buckets?: readonly string[];
  /** Days-to-expiry bucket edges (industry expiry list; default 7/30/60). */
  readonly bucketDays?: readonly number[];
  readonly status?: string;
  readonly sourceType?: string;
  readonly exceptionType?: string;
  readonly noSaleDays?: number;
  readonly varianceThreshold?: string;
  readonly countSessionId?: string;
  readonly serial?: string;
  readonly direction?: "sales" | "purchases" | "RECEIVED" | "ISSUED";
  readonly role?: "CUSTOMER" | "SUPPLIER";
  readonly dimension?: string;
  readonly action?: string;
  readonly onlyNegative?: boolean;
  readonly openOnly?: boolean;
  readonly accountId?: string;
  readonly accountIds?: readonly string[];
  readonly costCenterId?: string;
  readonly cashAccountId?: string;
  readonly userId?: string;
  readonly reportKey?: string;
  readonly runStatus?: string;
  readonly entryType?: string;
  readonly matchResult?: string;
  [key: string]: unknown;
}

/** Effective execution context (scope intersection applied, §3–§5). */
export interface RunContext {
  readonly tenantId: string;
  readonly userId: string | null;
  /** Effective branch scope AFTER intersection with grants (null = all). */
  readonly effectiveBranchIds: readonly string[] | null;
  readonly baseCurrency: string;
  readonly permissions: ReadonlySet<string>;
  readonly correlationId?: string;
}

/** Result content produced by a contract's run() (envelope minus chrome). */
export interface ReportContent {
  readonly columns: readonly ReportColumn[];
  readonly groups: readonly ReportGroup[];
  readonly rows: readonly ReportRow[];
  readonly totals: readonly ReportTotal[];
  /** Assertion results (executable checks — REPORT_RECONCILIATION §1). */
  readonly assertionResults: readonly AssertionResult[];
  /** Optional statement-level notes (e.g. the CF indirect-method limitation). */
  readonly notes?: readonly Bilingual[];
}

export interface ReportColumn {
  readonly id: string;
  readonly label: Bilingual;
  readonly type: "text" | "money" | "qty" | "date" | "status" | "link";
  readonly numeric?: boolean;
  readonly widthHint?: number;
}

export interface ReportGroup {
  readonly key: string;
  readonly label: Bilingual;
  readonly subtotal?: Record<string, string>;
}

export interface ReportRow {
  readonly key: string;
  readonly values: Record<string, string | number | null>;
  readonly groupKey?: string;
  readonly drillLinks?: readonly DrillLink[];
}

export interface DrillLink {
  readonly label: Bilingual;
  readonly route: string;
}

export interface ReportTotal {
  readonly id: string;
  readonly label: Bilingual;
  readonly amount: string;
  readonly kind: "sum" | "check";
}

export interface AssertionResult {
  readonly id: string;
  readonly status: "PASS" | "FAIL";
  readonly detail?: Bilingual;
  /** The exact compared values (persisted for audit review, §1.5). */
  readonly compared?: { readonly left: string; readonly right: string };
}

/** The stored runtime result envelope (REPORT_CONTRACT §2, normative). */
export interface ReportResult {
  readonly reportId: string;
  readonly contractVersion: number;
  readonly runId: string;
  readonly paramsEcho: Record<string, unknown>;
  readonly columns: readonly ReportColumn[];
  readonly groups: readonly ReportGroup[];
  readonly rows: readonly ReportRow[];
  readonly totals: readonly ReportTotal[];
  readonly assertions: readonly AssertionResult[];
  readonly freshness: {
    readonly computedAt: string;
    readonly asOf?: string | null;
    readonly cacheState: "fresh" | "stale" | "recomputed";
  };
  readonly formatting: {
    readonly baseCurrency: string;
    readonly numerals: "western";
    readonly locale: "ar" | "en";
  };
  readonly notes?: readonly Bilingual[];
}

/** Registry snapshot row (navigation + command menu, §2). */
export interface RegistrySnapshotRow {
  readonly id: string;
  readonly title: Bilingual;
  readonly category: ReportCategory;
  readonly requiredPermission: string;
  readonly version: number;
  readonly executionClass: ExecutionClass;
  readonly exportFormats: readonly string[];
  readonly semantics: "as-of" | "current";
}
